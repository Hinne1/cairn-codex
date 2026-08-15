using IAGrim.StashFile;

namespace CairnCodex.GrimDawn;

internal sealed record CharacterSkill(string Record, string Name, int Level, bool Enabled);

internal sealed record CharacterSaveProfile(
    string Path,
    string Name,
    int Level,
    bool IsHardcore,
    string ClassRecord,
    CharacterSkill[] Skills,
    DateTime LastWriteUtc,
    string? Error);

internal static class CharacterSaveReader
{
    private const uint CharacterMagic = 0x58434447; // GDCX

    public static CharacterSaveProfile[] Discover(string installationPath)
    {
        var data = ItemCatalogBuilder.Load(installationPath);
        return FindCharacterFiles()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(path => ReadSafely(path, data))
            .OrderBy(profile => profile.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(profile => profile.Path, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static CharacterSaveProfile ReadSafely(string path, ItemCatalogData data)
    {
        try
        {
            var before = new FileInfo(path);
            var bytes = File.ReadAllBytes(path);
            var parsed = Parse(path, bytes, before.LastWriteTimeUtc, data);
            var after = new FileInfo(path);
            if (before.Length != after.Length || before.LastWriteTimeUtc != after.LastWriteTimeUtc)
            {
                throw new IOException("Character save changed while it was being read; retry after the game finishes saving.");
            }
            return parsed;
        }
        catch (Exception exception) when (
            exception is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            return new CharacterSaveProfile(
                Path.GetFullPath(path),
                CharacterFolderName(path),
                0,
                false,
                string.Empty,
                [],
                File.GetLastWriteTimeUtc(path),
                exception.Message);
        }
    }

    private static CharacterSaveProfile Parse(
        string path,
        byte[] bytes,
        DateTime lastWriteUtc,
        ItemCatalogData data)
    {
        var crypto = new GDCryptoDataBuffer(bytes);
        Require(crypto.ReadCryptoKey(), "Character save is truncated before its encryption key.");
        Require(crypto.ReadCryptoUInt(out var magic) && magic == CharacterMagic, "Character save has an invalid GDCX header.");
        Require(crypto.ReadCryptoInt(out _), "Character save is missing its file version.");
        Require(crypto.ReadCryptoWString(out var name), "Character name could not be decoded.");
        Require(crypto.ReadCryptoBool(out _), "Character save is missing its gender field.");
        Require(crypto.ReadCryptoString(out var classRecord), "Character class could not be decoded.");
        Require(crypto.ReadCryptoInt(out var level), "Character level could not be decoded.");
        Require(crypto.ReadCryptoBool(out var hardcore), "Character mode could not be decoded.");
        Require(crypto.ReadCryptoByte(out _), "Character expansion flag could not be decoded.");
        VerifyChecksum(crypto, "header");

        Require(crypto.ReadCryptoInt(out var dataVersion), "Character save is missing its data version.");
        Require(dataVersion is 6 or 7 or 8,
            $"Unsupported character data version {dataVersion}; no partial profile was imported.");
        SkipEncrypted(crypto, 16);

        var skills = Array.Empty<CharacterSkill>();
        while (crypto.Remaining > 0)
        {
            Require(crypto.ReadCryptoInt(out var blockId), "Character block id is truncated.");
            Require(crypto.ReadCryptoInt(out var blockLength, false), "Character block length is truncated.");
            Require(blockLength >= 0 && blockLength <= crypto.Remaining,
                $"Character block {blockId} has an invalid length.");
            var end = crypto.Cursor + blockLength;
            if (blockId == 3)
            {
                ReadInventoryBlock(crypto);
            }
            else if (blockId == 4)
            {
                ReadPersonalStashBlock(crypto);
            }
            else if (blockId == 8)
            {
                skills = ReadSkills(crypto, data);
            }
            SkipEncrypted(crypto, end - crypto.Cursor);
            Require(crypto.Cursor == end, $"Character block {blockId} did not end at its declared boundary.");
            VerifyChecksum(crypto, $"block {blockId}");
        }

        return new CharacterSaveProfile(
            Path.GetFullPath(path),
            string.IsNullOrWhiteSpace(name) ? CharacterFolderName(path) : name,
            level,
            hardcore,
            classRecord,
            skills,
            lastWriteUtc,
            null);
    }

    private static void ReadInventoryBlock(GDCryptoDataBuffer crypto)
    {
        Require(crypto.ReadCryptoInt(out var version) && version is >= 4 and <= 11,
            "Unsupported character inventory-block version.");
        Require(crypto.ReadCryptoBool(out var hasData), "Character inventory data flag is truncated.");
        if (!hasData) return;
        Require(crypto.ReadCryptoInt(out var sackCount) && sackCount is >= 0 and <= 100,
            "Character inventory sack count is invalid.");
        Require(crypto.ReadCryptoInt(out _) && crypto.ReadCryptoInt(out _),
            "Character inventory selection is truncated.");
        for (var index = 0; index < sackCount; index++) ReadNestedSack(crypto, version);
        Require(crypto.ReadCryptoByte(out _), "Character alternate weapon selection is truncated.");
        for (var index = 0; index < 12; index++) ReadItem(crypto, version, equipment: true);
        Require(crypto.ReadCryptoByte(out _), "Character alternate weapon-set flag is truncated.");
        for (var index = 0; index < 2; index++) ReadItem(crypto, version, equipment: true);
        Require(crypto.ReadCryptoByte(out _), "Character second alternate weapon-set flag is truncated.");
        for (var index = 0; index < 2; index++) ReadItem(crypto, version, equipment: true);
    }

    private static void ReadPersonalStashBlock(GDCryptoDataBuffer crypto)
    {
        Require(crypto.ReadCryptoInt(out var version) && version is >= 6 and <= 11,
            "Unsupported character personal-stash version.");
        Require(crypto.ReadCryptoInt(out var count) && count is >= 0 and <= 100,
            "Character personal-stash count is invalid.");
        for (var index = 0; index < count; index++) ReadNestedStash(crypto, version);
    }

    private static void ReadNestedSack(GDCryptoDataBuffer crypto, int version)
    {
        var end = ReadNestedBlockStart(crypto, 0, "inventory sack");
        Require(crypto.ReadCryptoByte(out _), "Character inventory sack flag is truncated.");
        Require(crypto.ReadCryptoInt(out var count) && count is >= 0 and <= 10_000,
            "Character inventory item count is invalid.");
        for (var index = 0; index < count; index++) ReadItem(crypto, version, equipment: false);
        Require(crypto.Cursor == end, "Character inventory sack length does not match its contents.");
        VerifyChecksum(crypto, "inventory sack");
    }

    private static void ReadNestedStash(GDCryptoDataBuffer crypto, int version)
    {
        var end = ReadNestedBlockStart(crypto, 0, "personal stash");
        Require(crypto.ReadCryptoInt(out _) && crypto.ReadCryptoInt(out _),
            "Character personal-stash dimensions are truncated.");
        Require(crypto.ReadCryptoInt(out var count) && count is >= 0 and <= 10_000,
            "Character personal-stash item count is invalid.");
        for (var index = 0; index < count; index++) ReadItem(crypto, version, equipment: false);
        if (version >= 9)
        {
            for (var index = 0; index < 4; index++)
            {
                Require(crypto.ReadCryptoInt(out _), "Character personal-stash customization is truncated.");
            }
            Require(crypto.ReadCryptoWString(out _), "Character personal-stash name is truncated.");
        }
        Require(crypto.Cursor == end, "Character personal-stash length does not match its contents.");
        VerifyChecksum(crypto, "personal stash");
    }

    private static int ReadNestedBlockStart(GDCryptoDataBuffer crypto, int expectedId, string context)
    {
        Require(crypto.ReadCryptoInt(out var blockId) && blockId == expectedId,
            $"Character {context} has an unexpected nested block id.");
        Require(crypto.ReadCryptoInt(out var length, false) && length >= 0 && length <= crypto.Remaining,
            $"Character {context} has an invalid nested block length.");
        return crypto.Cursor + length;
    }

    private static void ReadItem(GDCryptoDataBuffer crypto, int version, bool equipment)
    {
        for (var index = 0; index < 5; index++) Require(crypto.ReadCryptoString(out _), "Character item record is truncated.");
        Require(crypto.ReadCryptoInt(out _), "Character item seed is truncated.");
        Require(crypto.ReadCryptoString(out _) && crypto.ReadCryptoString(out _), "Character item component is truncated.");
        Require(crypto.ReadCryptoInt(out _), "Character item component seed is truncated.");
        Require(crypto.ReadCryptoString(out _), "Character item augment is truncated.");
        if (version >= 8)
        {
            Require(crypto.ReadCryptoString(out _), "Character ascendant item record is truncated.");
            Require(crypto.ReadCryptoInt(out _), "Character ascendant reroll count is truncated.");
        }
        for (var index = 0; index < 4; index++) Require(crypto.ReadCryptoInt(out _), "Character item field is truncated.");
        if (version >= 8) Require(crypto.ReadCryptoInt(out _), "Character item seed-reroll count is truncated.");
        if (version >= 11) Require(crypto.ReadCryptoInt(out _), "Character item affix-reroll count is truncated.");
        if (equipment)
        {
            Require(crypto.ReadCryptoByte(out _), "Character equipped-item flag is truncated.");
        }
        else
        {
            Require(crypto.ReadCryptoInt(out _) && crypto.ReadCryptoInt(out _), "Character item position is truncated.");
        }
    }

    private static CharacterSkill[] ReadSkills(GDCryptoDataBuffer crypto, ItemCatalogData data)
    {
        Require(crypto.ReadCryptoInt(out var version) && version is >= 5 and <= 8,
            "Unsupported character skill-block version.");
        Require(crypto.ReadCryptoInt(out var count) && count is >= 0 and <= 10_000,
            "Character skill count is invalid.");
        var result = new List<CharacterSkill>(count);
        for (var index = 0; index < count; index++)
        {
            Require(crypto.ReadCryptoString(out var record), "Character skill record is truncated.");
            Require(crypto.ReadCryptoInt(out var level), "Character skill level is truncated.");
            Require(crypto.ReadCryptoBool(out var enabled), "Character skill enabled flag is truncated.");
            Require(crypto.ReadCryptoInt(out _), "Character devotion level is truncated.");
            Require(crypto.ReadCryptoInt(out _), "Character devotion experience is truncated.");
            Require(crypto.ReadCryptoInt(out _), "Character skill sublevel is truncated.");
            if (version >= 8) Require(crypto.ReadCryptoByte(out _), "Character v8 skill field is truncated.");
            Require(crypto.ReadCryptoBool(out _), "Character active-skill flag is truncated.");
            Require(crypto.ReadCryptoBool(out _), "Character transition-skill flag is truncated.");
            Require(crypto.ReadCryptoString(out _), "Character autocast skill is truncated.");
            Require(crypto.ReadCryptoString(out _), "Character autocast controller is truncated.");
            if (level > 0 && !string.IsNullOrWhiteSpace(record))
            {
                result.Add(new CharacterSkill(record, ResolveSkillName(record, data), level, enabled));
            }
        }
        return result
            .DistinctBy(skill => skill.Record, StringComparer.OrdinalIgnoreCase)
            .OrderBy(skill => skill.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string ResolveSkillName(string path, ItemCatalogData data)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (seen.Add(path) && data.Records.TryGetValue(path, out var source))
        {
            var record = source.Record;
            var tag = record.Text("skillDisplayName") ?? record.Text("skillTabTitle");
            if (tag is not null && data.Tags.TryGetValue(tag, out var resolved) && !string.IsNullOrWhiteSpace(resolved))
            {
                return resolved;
            }
            path = record.Text("buffSkillName") ?? record.Text("petSkillName") ?? string.Empty;
            if (path.Length == 0) break;
        }
        var file = System.IO.Path.GetFileNameWithoutExtension(path.Replace('\\', '/'));
        return string.IsNullOrWhiteSpace(file) ? path : file.Replace('_', ' ');
    }

    private static IEnumerable<string> FindCharacterFiles()
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var roots = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "My Games", "Grim Dawn", "save", "main"),
            Path.Combine(profile, "OneDrive", "Documents", "My Games", "Grim Dawn", "save", "main")
        };
        foreach (var root in roots.Where(Directory.Exists))
        {
            foreach (var path in Directory.EnumerateFiles(root, "player.gdc", SearchOption.AllDirectories)) yield return path;
        }
        var steam = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam", "userdata");
        if (Directory.Exists(steam))
        {
            foreach (var path in Directory.EnumerateFiles(steam, "player.gdc", SearchOption.AllDirectories)
                         .Where(path => path.Replace('\\', '/').Contains("/219990/remote/save/main/", StringComparison.OrdinalIgnoreCase)))
            {
                yield return path;
            }
        }
    }

    private static string CharacterFolderName(string path) =>
        Directory.GetParent(path)?.Name.TrimStart('_') ?? "Unknown character";

    private static void SkipEncrypted(GDCryptoDataBuffer crypto, int length)
    {
        Require(length >= 0, "Character block cursor moved beyond its boundary.");
        for (var index = 0; index < length; index++)
        {
            Require(crypto.ReadCryptoByte(out _), "Character block is truncated.");
        }
    }

    private static void VerifyChecksum(GDCryptoDataBuffer crypto, string context)
    {
        Require(crypto.ReadNextCryptoUInt(out var checksum), $"Character {context} checksum is truncated.");
        Require(checksum == 0,
            $"Character {context} checksum failed ({checksum:x8}); no partial profile was imported.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidDataException(message);
    }
}
