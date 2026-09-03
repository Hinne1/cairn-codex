using System.Buffers.Binary;
using System.Text;
using K4os.Compression.LZ4;

namespace CairnCodex.GrimDawn.Gdia.GameData;

// Adapted from GDIA's MIT-licensed Parser/Arz reader at the pinned upstream commit.
internal static class ArzArchiveReader
{
    private const uint MaximumStringLength = 64 * 1024;
    private const uint MaximumRecordSize = 64 * 1024 * 1024;

    public static IReadOnlyList<ArzRecord> Read(string path)
    {
        using var stream = OpenSharedRead(path);
        using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: true);

        var unknown = reader.ReadUInt16();
        var version = reader.ReadUInt16();
        var recordTableStart = reader.ReadUInt32();
        _ = reader.ReadUInt32(); // record table byte size
        var recordCount = reader.ReadUInt32();
        var stringTableStart = reader.ReadUInt32();
        var stringTableSize = reader.ReadUInt32();

        if (unknown != 2 || version != 3)
        {
            throw new InvalidDataException($"Unsupported ARZ header {unknown}/{version} in {path}.");
        }

        ValidateRange(stream, stringTableStart, stringTableSize, "ARZ string table");
        var strings = ReadStringTable(stream, reader, stringTableStart, stringTableSize);

        stream.Position = recordTableStart;
        var descriptors = new List<RecordDescriptor>(checked((int)recordCount));
        for (var index = 0U; index < recordCount; index++)
        {
            var stringIndex = reader.ReadUInt32();
            var type = ReadLengthPrefixedString(stream, reader);
            var offset = reader.ReadUInt32();
            var compressedSize = reader.ReadUInt32();
            var uncompressedSize = reader.ReadUInt32();
            stream.Seek(8, SeekOrigin.Current);

            if (stringIndex >= strings.Count)
            {
                throw new InvalidDataException($"ARZ record references missing string {stringIndex}.");
            }

            if (compressedSize > MaximumRecordSize || uncompressedSize > MaximumRecordSize)
            {
                throw new InvalidDataException("ARZ record exceeds the supported size limit.");
            }

            descriptors.Add(new RecordDescriptor(
                strings[checked((int)stringIndex)], type, offset, compressedSize, uncompressedSize));
        }

        var records = new List<ArzRecord>(descriptors.Count);
        foreach (var descriptor in descriptors)
        {
            ValidateRange(stream, checked(descriptor.Offset + 24U), descriptor.CompressedSize, "ARZ record");
            stream.Position = descriptor.Offset + 24U;
            var compressed = reader.ReadBytes(checked((int)descriptor.CompressedSize));
            var uncompressed = new byte[checked((int)descriptor.UncompressedSize)];
            var decoded = LZ4Codec.Decode(compressed, uncompressed);
            if (decoded != uncompressed.Length)
            {
                throw new InvalidDataException(
                    $"ARZ record {descriptor.Name} decoded to {decoded} bytes; expected {uncompressed.Length}.");
            }

            records.Add(ParseRecord(descriptor.Name, descriptor.Type, uncompressed, strings));
        }

        return records;
    }

    private static ArzRecord ParseRecord(
        string name,
        string type,
        ReadOnlySpan<byte> data,
        IReadOnlyList<string> strings)
    {
        var accumulated = new Dictionary<string, List<ArzValue>>(StringComparer.Ordinal);
        var offset = 0;

        while (offset < data.Length)
        {
            if (data.Length - offset < 8)
            {
                throw new InvalidDataException($"ARZ record {name} has a truncated field header.");
            }

            var valueType = BinaryPrimitives.ReadUInt16LittleEndian(data[offset..]);
            var count = BinaryPrimitives.ReadUInt16LittleEndian(data[(offset + 2)..]);
            var fieldStringIndex = BinaryPrimitives.ReadUInt32LittleEndian(data[(offset + 4)..]);
            var fieldBytes = checked(count * 4);
            if (fieldStringIndex >= strings.Count || data.Length - offset - 8 < fieldBytes)
            {
                throw new InvalidDataException($"ARZ record {name} contains an invalid field.");
            }

            var fieldName = strings[checked((int)fieldStringIndex)];
            if (!accumulated.TryGetValue(fieldName, out var fieldValues))
            {
                fieldValues = [];
                accumulated[fieldName] = fieldValues;
            }

            for (var index = 0; index < count; index++)
            {
                var raw = BinaryPrimitives.ReadUInt32LittleEndian(data[(offset + 8 + index * 4)..]);
                fieldValues.Add(valueType switch
                {
                    1 => ArzValue.FromNumber(BitConverter.Int32BitsToSingle(unchecked((int)raw))),
                    2 when raw < strings.Count => ArzValue.FromText(strings[checked((int)raw)]),
                    2 => throw new InvalidDataException($"ARZ record {name} references missing value string {raw}."),
                    _ => ArzValue.FromNumber(raw)
                });
            }

            offset += 8 + fieldBytes;
        }

        return new ArzRecord(name, type, new ArzFieldMap(accumulated));
    }

    private static List<string> ReadStringTable(
        Stream stream,
        BinaryReader reader,
        uint start,
        uint byteCount)
    {
        stream.Position = start;
        var end = checked((long)start + byteCount);
        var strings = new List<string>();
        while (stream.Position < end)
        {
            var groupCount = reader.ReadUInt32();
            for (var index = 0U; index < groupCount; index++)
            {
                strings.Add(ReadLengthPrefixedString(stream, reader));
            }
        }

        if (stream.Position != end)
        {
            throw new InvalidDataException("ARZ string table did not end at its declared boundary.");
        }

        return strings;
    }

    private static string ReadLengthPrefixedString(Stream stream, BinaryReader reader)
    {
        var length = reader.ReadUInt32();
        if (length > MaximumStringLength || length > stream.Length - stream.Position)
        {
            throw new InvalidDataException($"Invalid ARZ string length {length}.");
        }

        return Encoding.Latin1.GetString(reader.ReadBytes(checked((int)length)));
    }

    private static void ValidateRange(Stream stream, uint offset, uint length, string label)
    {
        if (offset > stream.Length || length > stream.Length - offset)
        {
            throw new InvalidDataException($"{label} falls outside the archive.");
        }
    }

    private static FileStream OpenSharedRead(string path) =>
        new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);

    private sealed record RecordDescriptor(
        string Name,
        string Type,
        uint Offset,
        uint CompressedSize,
        uint UncompressedSize);
}

internal sealed record ArzRecord(
    string Name,
    string Type,
    IReadOnlyDictionary<string, IReadOnlyList<ArzValue>> Values)
{
    public string? Text(string field) =>
        Values.TryGetValue(field, out var values) ? values.LastOrDefault(value => value.Text is not null).Text : null;

    public double? Number(string field) =>
        Values.TryGetValue(field, out var values) ? values.LastOrDefault(value => value.Number is not null).Number : null;
}

internal readonly record struct ArzValue(string? Text, double? Number)
{
    public static ArzValue FromText(string value) => new(value, null);
    public static ArzValue FromNumber(double value) => new(null, value);
}

/// <summary>
/// Immutable, allocation-conscious field storage for parsed DBR records.
/// A Dictionary plus one retained List per field made the expanded game database
/// several gigabytes larger than the source archives. Parsing still uses those
/// convenient mutable types, but the long-lived graph is reduced to sorted arrays.
/// </summary>
internal sealed class ArzFieldMap : IReadOnlyDictionary<string, IReadOnlyList<ArzValue>>
{
    private readonly Entry[] entries;

    public ArzFieldMap(IReadOnlyDictionary<string, List<ArzValue>> fields)
    {
        entries = fields
            .Select(pair => new Entry(pair.Key, pair.Value.ToArray()))
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .ToArray();
    }

    public int Count => entries.Length;

    public IEnumerable<string> Keys
    {
        get
        {
            foreach (var entry in entries) yield return entry.Key;
        }
    }

    public IEnumerable<IReadOnlyList<ArzValue>> Values
    {
        get
        {
            foreach (var entry in entries) yield return entry.Values;
        }
    }

    public IReadOnlyList<ArzValue> this[string key] =>
        TryGetValue(key, out var value) ? value : throw new KeyNotFoundException(key);

    public bool ContainsKey(string key) => Find(key) >= 0;

    public bool TryGetValue(string key, out IReadOnlyList<ArzValue> value)
    {
        var index = Find(key);
        if (index >= 0)
        {
            value = entries[index].Values;
            return true;
        }

        value = Array.Empty<ArzValue>();
        return false;
    }

    public IEnumerator<KeyValuePair<string, IReadOnlyList<ArzValue>>> GetEnumerator()
    {
        foreach (var entry in entries)
        {
            yield return new KeyValuePair<string, IReadOnlyList<ArzValue>>(entry.Key, entry.Values);
        }
    }

    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();

    private int Find(string key)
    {
        var low = 0;
        var high = entries.Length - 1;
        while (low <= high)
        {
            var middle = low + ((high - low) >> 1);
            var comparison = StringComparer.Ordinal.Compare(entries[middle].Key, key);
            if (comparison == 0) return middle;
            if (comparison < 0) low = middle + 1;
            else high = middle - 1;
        }

        return -1;
    }

    private readonly record struct Entry(string Key, ArzValue[] Values);
}
