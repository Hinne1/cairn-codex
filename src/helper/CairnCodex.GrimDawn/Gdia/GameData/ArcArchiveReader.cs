using System.Text;
using K4os.Compression.LZ4;

namespace CairnCodex.GrimDawn.Gdia.GameData;

// Adapted from GDIA's MIT-licensed Parser/Arc reader at the pinned upstream commit.
internal static class ArcArchiveReader
{
    private const int HeaderSize = 28;
    private const int PartSize = 12;
    private const int TocSize = 44;

    public static IReadOnlyDictionary<string, string> ReadTags(string path)
    {
        using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: true);

        if (stream.Length < HeaderSize)
        {
            throw new InvalidDataException($"ARC file is too short: {path}");
        }

        _ = reader.ReadInt32();
        var version = reader.ReadInt32();
        var fileCount = reader.ReadInt32();
        var partCount = reader.ReadInt32();
        var partTableSize = reader.ReadInt32();
        var stringTableSize = reader.ReadInt32();
        var partTableOffset = reader.ReadInt32();

        if (version != 3 || fileCount < 0 || partCount < 0 || stringTableSize < 0 ||
            partTableSize != checked(partCount * PartSize))
        {
            throw new InvalidDataException($"Unsupported or invalid ARC header in {path}.");
        }

        stream.Position = partTableOffset;
        var parts = new ArcPart[partCount];
        for (var index = 0; index < parts.Length; index++)
        {
            parts[index] = new ArcPart(reader.ReadInt32(), reader.ReadInt32(), reader.ReadInt32());
        }

        var stringsOffset = checked(partTableOffset + partTableSize);
        ValidateRange(stream, stringsOffset, stringTableSize, "ARC string table");
        stream.Position = stringsOffset;
        var stringBytes = reader.ReadBytes(stringTableSize);
        var names = ReadNullTerminatedStrings(stringBytes, fileCount);

        var tocOffset = checked(stringsOffset + stringTableSize);
        ValidateRange(stream, tocOffset, checked(fileCount * TocSize), "ARC table of contents");
        stream.Position = tocOffset;
        var entries = new ArcEntry[fileCount];
        for (var index = 0; index < entries.Length; index++)
        {
            _ = reader.ReadInt32();
            _ = reader.ReadInt32();
            _ = reader.ReadInt32();
            var decompressedLength = reader.ReadInt32();
            _ = reader.ReadInt32();
            _ = reader.ReadInt64();
            var entryPartCount = reader.ReadInt32();
            var firstPart = reader.ReadInt32();
            _ = reader.ReadInt32();
            _ = reader.ReadInt32();
            entries[index] = new ArcEntry(decompressedLength, entryPartCount, firstPart);
        }

        var tags = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < names.Count; index++)
        {
            if (!names[index].EndsWith(".txt", StringComparison.OrdinalIgnoreCase) ||
                entries[index].DecompressedLength <= 0)
            {
                continue;
            }

            var text = Encoding.UTF8.GetString(Extract(stream, reader, parts, entries[index]));
            text = text.TrimStart('\uFEFF').Replace("\r\n", "\n").Replace('\r', '\n');
            foreach (var line in text.Split('\n'))
            {
                var separator = line.IndexOf('=');
                if (separator <= 0 || !line.StartsWith("tag", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var tag = line[..separator].Trim();
                var value = RemoveColorCodes(line[(separator + 1)..].Trim());
                if (tag.Length > 0)
                {
                    tags[tag] = value;
                }
            }
        }

        return tags;
    }

    private static byte[] Extract(
        Stream stream,
        BinaryReader reader,
        IReadOnlyList<ArcPart> parts,
        ArcEntry entry)
    {
        if (entry.FirstPart < 0 || entry.PartCount < 0 ||
            entry.FirstPart > parts.Count - entry.PartCount)
        {
            throw new InvalidDataException("ARC entry references invalid file parts.");
        }

        var output = new byte[entry.DecompressedLength];
        var outputOffset = 0;
        for (var index = 0; index < entry.PartCount; index++)
        {
            var part = parts[entry.FirstPart + index];
            if (part.Offset < 0 || part.CompressedLength < 0 || part.DecompressedLength < 0 ||
                outputOffset > output.Length - part.DecompressedLength)
            {
                throw new InvalidDataException("ARC file part has invalid dimensions.");
            }

            ValidateRange(stream, part.Offset, part.CompressedLength, "ARC file part");
            stream.Position = part.Offset;
            var compressed = reader.ReadBytes(part.CompressedLength);
            if (part.CompressedLength == part.DecompressedLength)
            {
                compressed.CopyTo(output, outputOffset);
            }
            else
            {
                var decoded = LZ4Codec.Decode(
                    compressed,
                    output.AsSpan(outputOffset, part.DecompressedLength));
                if (decoded != part.DecompressedLength)
                {
                    throw new InvalidDataException("ARC file part did not decode to its declared length.");
                }
            }

            outputOffset += part.DecompressedLength;
        }

        if (outputOffset != output.Length)
        {
            throw new InvalidDataException("ARC entry did not fill its declared output length.");
        }

        return output;
    }

    private static List<string> ReadNullTerminatedStrings(byte[] bytes, int count)
    {
        var result = new List<string>(count);
        var offset = 0;
        for (var index = 0; index < count; index++)
        {
            var end = Array.IndexOf(bytes, (byte)0, offset);
            if (end < 0)
            {
                throw new InvalidDataException("ARC string table is truncated.");
            }

            result.Add(Encoding.Latin1.GetString(bytes, offset, end - offset));
            offset = end + 1;
        }

        return result;
    }

    private static string RemoveColorCodes(string value)
    {
        var builder = new StringBuilder(value.Length);
        for (var index = 0; index < value.Length; index++)
        {
            if (value[index] == '^' && index + 1 < value.Length)
            {
                index++;
                continue;
            }

            builder.Append(value[index]);
        }

        return builder.ToString();
    }

    private static void ValidateRange(Stream stream, int offset, int length, string label)
    {
        if (offset < 0 || length < 0 || offset > stream.Length || length > stream.Length - offset)
        {
            throw new InvalidDataException($"{label} falls outside the archive.");
        }
    }

    private sealed record ArcPart(int Offset, int CompressedLength, int DecompressedLength);
    private sealed record ArcEntry(int DecompressedLength, int PartCount, int FirstPart);
}
