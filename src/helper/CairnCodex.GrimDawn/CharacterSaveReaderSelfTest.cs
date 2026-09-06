using System.Text;
using CairnCodex.GrimDawn.Gdia.GameData;

namespace CairnCodex.GrimDawn;

internal static class CharacterSaveReaderSelfTest
{
    private const string SkillRecord = "records/skills/fixture/reader_skill.dbr";

    public static object Run()
    {
        var assertions = 0;
        void Check(bool condition, string message)
        {
            assertions++;
            if (!condition) throw new InvalidDataException(message);
        }
        var data = new ItemCatalogData("fixture", [],
            new Dictionary<string, string> { ["tagFixtureClass"] = "Fixture Class", ["tagFixtureSkill"] = "Fixture Skill" },
            new Dictionary<string, CatalogSourceRecord>(StringComparer.OrdinalIgnoreCase)
            {
                [SkillRecord] = new(new ArzRecord(SkillRecord, "Skill_Attack",
                    new Dictionary<string, IReadOnlyList<ArzValue>> { ["skillDisplayName"] = [ArzValue.FromText("tagFixtureSkill")] }), "fixture")
            });
        var root = Directory.CreateTempSubdirectory("cairn-character-reader-");
        var validVariants = 0;
        var rejectedVariants = 0;
        try
        {
            foreach (var version in new[] { 6, 7, 8 })
            foreach (var hardcore in new[] { false, true })
            {
                var name = $"Fixture Ω {version} {(hardcore ? "HC" : "SC")}";
                var layout = hardcore ? "steam/userdata/fixture/219990/remote/save/main" : "local/save/main";
                var path = Path.Combine(root.FullName, layout, "_" + name, "player.gdc");
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                var bytes = CreateSave(name, version, hardcore);
                File.WriteAllBytes(path, bytes);
                var stamp = File.GetLastWriteTimeUtc(path);
                var result = CharacterSaveReader.ReadFiles([path, path], data);
                Check(result.Length == 1, "Character paths were not deduplicated.");
                var profile = result.Single();
                Check(profile.Error is null, "Generated character was rejected.");
                Check(profile.Name == name && profile.Level == 84, "Character identity/level was not decoded.");
                Check(profile.IsHardcore == hardcore, "Character mode was not preserved.");
                Check(profile.ClassRecord == "tagFixtureClass" && profile.ClassName == "Fixture Class", "Class tag was not resolved.");
                Check(profile.Skills.Length == 1 && profile.Skills[0] == new CharacterSkill(SkillRecord, "Fixture Skill", 12, true), "Skill fields or zero-rank filtering changed.");
                Check(profile.Factions.Length == 1 && profile.Factions[0] == new CharacterFaction(1, "Devil's Crossing", true, 6000, "Respected"), "Faction reputation was not decoded.");
                Check(profile.Path == Path.GetFullPath(path) && profile.LastWriteUtc == stamp, "File metadata was not retained.");
                Check(File.ReadAllBytes(path).SequenceEqual(bytes) && File.GetLastWriteTimeUtc(path) == stamp, "Character reading mutated its fixture.");
                validVariants++;
            }

            var valid = CreateSave("Fixture failure control", 8, false);
            var corruptChecksum = valid.ToArray();
            corruptChecksum[^1] ^= 0x80;
            var corruptMagic = valid.ToArray();
            corruptMagic[4] ^= 0x01;
            var invalid = new[] { Array.Empty<byte>(), valid[..12], valid[..^3], corruptChecksum, corruptMagic, CreateSave("Unsupported", 9, false) };
            foreach (var bytes in invalid)
            {
                var path = Path.Combine(root.FullName, "_Invalid", "player.gdc");
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllBytes(path, bytes);
                var result = CharacterSaveReader.ReadFiles([path], data).Single();
                Check(!string.IsNullOrWhiteSpace(result.Error), "Malformed character did not report an error.");
                Check(result.Level == 0 && result.Skills.Length == 0 && result.Factions.Length == 0, "Malformed character leaked a partial profile.");
                Check(File.ReadAllBytes(path).SequenceEqual(bytes), "Rejected character bytes changed.");
                rejectedVariants++;
            }
            Check(CharacterSaveReader.ReadFiles([], data).Length == 0, "An account with no characters did not return an empty result.");
            var missing = CharacterSaveReader.ReadFiles([Path.Combine(root.FullName, "_Missing", "player.gdc")], data).Single();
            Check(missing.Error is not null && missing.Skills.Length == 0, "A disappeared save did not fail safely.");
            return new { Passed = true, Assertions = assertions, ValidVariants = validVariants, RejectedVariants = rejectedVariants, ReadOnly = true };
        }
        finally
        {
            // The parameterless self-test owns this newly allocated temporary directory.
            root.Delete(recursive: true);
        }
    }

    // Generates encrypted bytes only; never copies a save or writes to a game directory.
    private static byte[] CreateSave(string name, int version, bool hardcore)
    {
        using var writer = new FixtureWriter();
        writer.UInt(0x58434447); // GDCX
        writer.UInt(1);
        writer.Text(name, wide: true);
        writer.Byte(0);
        writer.Text("tagFixtureClass");
        writer.UInt(84);
        writer.Byte(hardcore ? (byte)1 : (byte)0);
        writer.Byte(0);
        writer.Checksum();
        writer.UInt((uint)version);
        for (var index = 0; index < 16; index++) writer.Byte((byte)index);
        writer.Block(3, () => { writer.UInt(8); writer.Byte(0); }); // Empty inventory
        writer.Block(4, () => { writer.UInt(9); writer.UInt(0); }); // Empty personal stash
        writer.Block(8, () =>
        {
            var skillVersion = version == 6 ? 5u : version == 7 ? 7u : 8u;
            writer.UInt(skillVersion);
            writer.UInt(2);
            foreach (var rank in new[] { 12u, 0u })
            {
                writer.Text(SkillRecord);
                writer.UInt(rank);
                writer.Byte(1);
                writer.UInt(0); writer.UInt(0); writer.UInt(0);
                if (skillVersion >= 8) writer.Byte(0);
                writer.Byte(1); writer.Byte(0);
                writer.Text(""); writer.Text("");
            }
        });
        writer.Block(13, () =>
        {
            writer.UInt(5); writer.UInt(1); writer.UInt(2);
            for (var index = 0; index < 2; index++)
            {
                writer.Byte(0); writer.Byte(1);
                writer.UInt(BitConverter.SingleToUInt32Bits(6000));
                writer.UInt(0); writer.UInt(0);
            }
        });
        return writer.Bytes();
    }

    private sealed class FixtureWriter : IDisposable
    {
        private readonly MemoryStream stream = new();
        private readonly BinaryWriter writer;
        private readonly uint[] table = new uint[256];
        private uint key = 0x1234ABCD;

        public FixtureWriter()
        {
            writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
            writer.Write(key ^ 1431655765u);
            var seed = key;
            for (var index = 0; index < table.Length; index++)
            {
                seed = unchecked(((seed >> 1) | (seed << 31)) * 39916801u);
                table[index] = seed;
            }
        }
        public void UInt(uint value)
        {
            var encrypted = value ^ key;
            writer.Write(encrypted);
            foreach (var part in BitConverter.GetBytes(encrypted)) key ^= table[part];
        }
        public void Byte(byte value)
        {
            var encrypted = (byte)(value ^ key);
            writer.Write(encrypted);
            key ^= table[encrypted];
        }
        public void Text(string value, bool wide = false)
        {
            var bytes = (wide ? Encoding.Unicode : Encoding.ASCII).GetBytes(value);
            UInt((uint)(wide ? value.Length : bytes.Length));
            foreach (var part in bytes) Byte(part);
        }
        public void Checksum() => writer.Write(key);
        public void Block(uint id, Action body)
        {
            UInt(id);
            var lengthPosition = stream.Position;
            var lengthKey = key;
            writer.Write(0u); // Block lengths do not update the rolling key.
            var start = stream.Position;
            body();
            var end = stream.Position;
            stream.Position = lengthPosition;
            writer.Write((uint)(end - start) ^ lengthKey);
            stream.Position = end;
            Checksum();
        }
        public byte[] Bytes() => stream.ToArray();
        public void Dispose() { writer.Dispose(); stream.Dispose(); }
    }
}
