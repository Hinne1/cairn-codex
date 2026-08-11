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

    public static IReadOnlyDictionary<string, byte[]> ReadFiles(
        string path,
        IReadOnlySet<string> requestedPaths)
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
        var names = ReadNullTerminatedStrings(reader.ReadBytes(stringTableSize), fileCount);

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

        var normalized = requestedPaths.Select(NormalizePath).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var byFileName = normalized
            .GroupBy(FileName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);
        var result = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < names.Count; index++)
        {
            var name = NormalizePath(names[index]);
            string[] requested = normalized.Contains(name)
                ? [name]
                : byFileName.GetValueOrDefault(FileName(name)) ?? [];
            if (requested.Length > 0 && entries[index].DecompressedLength > 0)
            {
                var bytes = Extract(stream, reader, parts, entries[index]);
                foreach (var requestedPath in requested) result[requestedPath] = bytes;
            }
        }
        return result;
    }

    public static IReadOnlyList<ArcTextMatch> SearchText(
        string path,
        string requestedPath,
        string needle,
        int contextBytes = 32768,
        int limit = 20)
    {
        if (string.IsNullOrWhiteSpace(needle))
        {
            throw new ArgumentException("ARC text search requires a non-empty needle.", nameof(needle));
        }

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
        var names = ReadNullTerminatedStrings(reader.ReadBytes(stringTableSize), fileCount);
        var requested = NormalizePath(requestedPath);

        var tocOffset = checked(stringsOffset + stringTableSize);
        ValidateRange(stream, tocOffset, checked(fileCount * TocSize), "ARC table of contents");
        stream.Position = tocOffset;
        var target = -1;
        var targetPartCount = 0;
        var targetFirstPart = 0;
        for (var index = 0; index < fileCount; index++)
        {
            _ = reader.ReadInt32();
            _ = reader.ReadInt32();
            _ = reader.ReadInt32();
            _ = reader.ReadUInt32();
            _ = reader.ReadInt32();
            _ = reader.ReadInt64();
            var entryPartCount = reader.ReadInt32();
            var firstPart = reader.ReadInt32();
            _ = reader.ReadInt32();
            _ = reader.ReadInt32();
            if (string.Equals(NormalizePath(names[index]), requested, StringComparison.OrdinalIgnoreCase))
            {
                target = index;
                targetPartCount = entryPartCount;
                targetFirstPart = firstPart;
            }
        }

        if (target < 0)
        {
            throw new ArgumentException($"ARC entry was not found: {requestedPath}");
        }
        if (targetFirstPart < 0 || targetPartCount < 0 ||
            targetFirstPart > parts.Length - targetPartCount)
        {
            throw new InvalidDataException("ARC entry references invalid file parts.");
        }

        contextBytes = Math.Clamp(contextBytes, 256, 262144);
        limit = Math.Clamp(limit, 1, 100);
        var matches = new List<ArcTextMatch>();
        long uncompressedOffset = 0;
        for (var partIndex = 0; partIndex < targetPartCount && matches.Count < limit; partIndex++)
        {
            var part = parts[targetFirstPart + partIndex];
            var decoded = ExtractPart(stream, reader, part);
            var text = Encoding.Latin1.GetString(decoded);
            var searchOffset = 0;
            while (searchOffset < text.Length && matches.Count < limit)
            {
                var matchOffset = text.IndexOf(needle, searchOffset, StringComparison.OrdinalIgnoreCase);
                if (matchOffset < 0) break;
                var contextStart = Math.Max(0, matchOffset - contextBytes);
                var contextEnd = Math.Min(decoded.Length, matchOffset + needle.Length + contextBytes);
                matches.Add(new ArcTextMatch(
                    names[target],
                    partIndex,
                    uncompressedOffset + matchOffset,
                    ExtractPrintableStrings(decoded.AsSpan(contextStart, contextEnd - contextStart))));
                searchOffset = matchOffset + Math.Max(1, needle.Length);
            }
            uncompressedOffset += part.DecompressedLength;
        }
        return matches;
    }

    private static IReadOnlyList<string> ExtractPrintableStrings(ReadOnlySpan<byte> bytes)
    {
        var strings = new List<string>();
        var start = -1;
        for (var index = 0; index <= bytes.Length; index++)
        {
            var printable = index < bytes.Length && bytes[index] is >= 32 and <= 126;
            if (printable && start < 0)
            {
                start = index;
            }
            else if (!printable && start >= 0)
            {
                if (index - start >= 4)
                {
                    strings.Add(Encoding.Latin1.GetString(bytes[start..index]));
                }
                start = -1;
            }
        }
        return strings.Distinct(StringComparer.OrdinalIgnoreCase).Take(500).ToArray();
    }

    private static byte[] ExtractPart(Stream stream, BinaryReader reader, ArcPart part)
    {
        if (part.Offset < 0 || part.CompressedLength < 0 || part.DecompressedLength < 0)
        {
            throw new InvalidDataException("ARC file part has invalid dimensions.");
        }
        ValidateRange(stream, part.Offset, part.CompressedLength, "ARC file part");
        stream.Position = part.Offset;
        var compressed = reader.ReadBytes(part.CompressedLength);
        if (part.CompressedLength == part.DecompressedLength)
        {
            return compressed;
        }
        var output = new byte[part.DecompressedLength];
        var decoded = LZ4Codec.Decode(compressed, output);
        if (decoded != output.Length)
        {
            throw new InvalidDataException("ARC file part did not decode to its declared length.");
        }
        return output;
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

    private static string NormalizePath(string value) => value.Replace('\\', '/').TrimStart('/');
    private static string FileName(string value) => value[(value.LastIndexOf('/') + 1)..];

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

internal sealed record ArcTextMatch(
    string Entry,
    int PartIndex,
    long Offset,
    IReadOnlyList<string> Context);
