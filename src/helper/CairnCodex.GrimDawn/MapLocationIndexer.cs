using System.Buffers.Binary;
using System.Text;
using CairnCodex.GrimDawn.Gdia.GameData;

namespace CairnCodex.GrimDawn;

internal static class MapLocationIndexer
{
    private static readonly byte[] RecordPrefix = Encoding.ASCII.GetBytes("records/");

    public static MapLocationIndexResult Build(string installationPath)
    {
        var data = ItemCatalogBuilder.Load(installationPath);
        var placements = new Dictionary<string, HashSet<MapRegionLocation>>(StringComparer.OrdinalIgnoreCase);
        var archives = FindLevelArchives(data.InstallationPath).ToArray();
        var scannedRegions = 0;

        foreach (var archive in archives)
        {
            using var map = ArcArchiveReader.OpenEntry(archive.Path, "world001.map");
            var regions = ReadRegions(map, data, archive.ContentPack);
            scannedRegions += regions.Count;
            foreach (var region in regions)
            {
                foreach (var record in ScanPlacedRecords(map, region))
                {
                    if (!placements.TryGetValue(record, out var locations))
                    {
                        locations = [];
                        placements[record] = locations;
                    }
                    locations.Add(new MapRegionLocation(
                        region.Name,
                        region.ZoneRecord,
                        region.LevelFile,
                        region.ContentPack,
                        region.OriginX,
                        region.OriginY));
                }
            }
        }

        var reverse = BuildReverseReferences(data.Records);
        var miItems = ItemCatalogBuilder.Build(data).Items
            .Where(item => item.Rarity == "mi")
            .ToArray();
        var miSources = miItems
            .SelectMany(item => item.Acquisition.SourceRecords)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var sourceLocations = new Dictionary<string, IReadOnlyList<MapRegionLocation>>(StringComparer.OrdinalIgnoreCase);
        foreach (var sourceRecord in miSources)
        {
            var locations = ResolveMonsterLocations(sourceRecord, reverse, placements);
            if (locations.Count > 0) sourceLocations[sourceRecord] = locations;
        }
        ApplyScriptedLocationFallbacks(miItems, sourceLocations);
        var locatedMiTiers = miItems.Count(item =>
            item.Acquisition.SourceRecords.Any(sourceLocations.ContainsKey));
        var unlocatedMiBases = miItems
            .Where(item => !item.Acquisition.SourceRecords.Any(sourceLocations.ContainsKey))
            .Select(item => item.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var fingerprints = archives.Select(archive => archive.Path)
            .Concat(data.ContentPacks.Select(pack => pack.DatabasePath))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(path =>
            {
                var file = new FileInfo(path);
                return new MapArchiveFingerprint(path, file.Length, file.LastWriteTimeUtc);
            })
            .ToArray();
        return new MapLocationIndexResult(
            6,
            DateTimeOffset.UtcNow,
            fingerprints,
            scannedRegions,
            placements.Count,
            sourceLocations,
            miItems.Length,
            locatedMiTiers,
            unlocatedMiBases);
    }

    private static void ApplyScriptedLocationFallbacks(
        IEnumerable<CatalogItem> miItems,
        IDictionary<string, IReadOnlyList<MapRegionLocation>> sourceLocations)
    {
        var tempestSpears = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Aetherblessed Spear",
            "Bilesoaked Spear",
            "Bloodsoaked Spear",
            "Flameblessed Spear",
            "Rimeblessed Spear",
            "Stormblessed Spear",
            "Veilmarked Spear"
        };
        foreach (var item in miItems)
        {
            string? name = tempestSpears.Contains(item.Name)
                ? "Tempest Totems (global spawn)"
                : item.Name.Equals("Grundleplith's Tail", StringComparison.OrdinalIgnoreCase)
                    ? "Festering Lair"
                    : null;
            if (name is null) continue;
            foreach (var sourceRecord in item.Acquisition.SourceRecords)
            {
                if (sourceLocations.ContainsKey(sourceRecord)) continue;
                sourceLocations[sourceRecord] =
                [new MapRegionLocation(name, "", "", item.ContentPack, 0, 0)];
            }
        }
    }

    private static IReadOnlyList<MapRegionLocation> ResolveMonsterLocations(
        string monsterRecord,
        IReadOnlyDictionary<string, IReadOnlyList<string>> reverse,
        IReadOnlyDictionary<string, HashSet<MapRegionLocation>> placements)
    {
        var result = new HashSet<MapRegionLocation>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { monsterRecord };
        var queue = new Queue<(string Record, int Depth)>();
        queue.Enqueue((monsterRecord, 0));
        while (queue.Count > 0 && visited.Count <= 1_000)
        {
            var (target, depth) = queue.Dequeue();
            if (placements.TryGetValue(target, out var direct)) result.UnionWith(direct);
            if (depth >= 8) continue;
            foreach (var source in reverse.GetValueOrDefault(target) ?? [])
            {
                if (!IsPlacementBridge(source) || !visited.Add(source))
                    continue;
                queue.Enqueue((source, depth + 1));
            }
        }
        var presentable = result
            .Where(location => !string.IsNullOrWhiteSpace(location.ZoneRecord))
            .ToArray();
        IEnumerable<MapRegionLocation> selected = presentable.Length > 0 ? presentable : result;
        return selected
            .OrderBy(location => location.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(location => location.LevelFile, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static IReadOnlyDictionary<string, IReadOnlyList<string>> BuildReverseReferences(
        IReadOnlyDictionary<string, CatalogSourceRecord> records)
    {
        var result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var source in records.Values)
        {
            foreach (var value in source.Record.Values.Values.SelectMany(values => values)
                         .Select(value => value.Text).OfType<string>())
            {
                if (!value.StartsWith("records/", StringComparison.OrdinalIgnoreCase)) continue;
                if (!result.TryGetValue(value, out var sources))
                {
                    sources = [];
                    result[value] = sources;
                }
                sources.Add(source.Record.Name);
            }
        }
        return result.ToDictionary(
            pair => pair.Key,
            pair => (IReadOnlyList<string>)pair.Value.Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),
            StringComparer.OrdinalIgnoreCase);
    }

    private static bool IsPlacementBridge(string record) =>
        record.Contains("/proxies/", StringComparison.OrdinalIgnoreCase) ||
        record.Contains("/creatures/", StringComparison.OrdinalIgnoreCase) ||
        record.Contains("/triggervolumes/", StringComparison.OrdinalIgnoreCase) ||
        record.Contains("/scriptentities/", StringComparison.OrdinalIgnoreCase) ||
        record.Contains("/spawn", StringComparison.OrdinalIgnoreCase);

    private static IReadOnlyList<MapRegion> ReadRegions(
        Stream map,
        ItemCatalogData data,
        string contentPack)
    {
        Span<byte> header = stackalloc byte[8];
        ReadExactly(map, 0, header);
        var magic = BinaryPrimitives.ReadUInt32LittleEndian(header);
        var version = (int)(magic >> 24);
        if ((magic & 0x00FF_FFFF) != 0x0050_414D || version is < 5 or > 9)
            throw new InvalidDataException("Levels ARC entry is not a supported Grim Dawn map.");

        long offset = 8;
        for (var chunk = 0; chunk < 64 && offset <= map.Length - 8; chunk++)
        {
            ReadExactly(map, offset, header);
            var id = BinaryPrimitives.ReadUInt32LittleEndian(header);
            var size = BinaryPrimitives.ReadUInt32LittleEndian(header[4..]);
            var dataOffset = checked(offset + 8);
            if (dataOffset > map.Length - size) throw new InvalidDataException("Map chunk exceeds the ARC entry.");
            if (id == 1)
            {
                if (size > 64 * 1024 * 1024) throw new InvalidDataException("Map region table is unexpectedly large.");
                var bytes = new byte[checked((int)size)];
                ReadExactly(map, dataOffset, bytes);
                return ParseRegions(bytes, version, data, contentPack);
            }
            offset = checked(dataOffset + size);
            if (id is 2 or 10 or 11 or 26) offset = checked(offset + size);
        }
        throw new InvalidDataException("Map region table was not found.");
    }

    private static IReadOnlyList<MapRegion> ParseRegions(
        byte[] bytes,
        int version,
        ItemCatalogData data,
        string contentPack)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        using var reader = new BinaryReader(stream, Encoding.Latin1);
        var count = reader.ReadInt32();
        if (count is < 0 or > 10_000) throw new InvalidDataException("Map region count is invalid.");
        var result = new List<MapRegion>(count);
        for (var index = 0; index < count; index++)
        {
            // Region bounds are stored as integer world units in MAP9. The world
            // editor's legacy WRL format converts these values to floats later.
            var rawFields = new int[13];
            for (var field = 0; field < rawFields.Length; field++) rawFields[field] = reader.ReadInt32();
            // MAP9 stores the level's horizontal world origin in fields 6 and 8.
            // Fields 0/2/3/5 are tile dimensions (commonly 64); treating those as
            // coordinates collapses every region into a vertical line.
            var originX = (float)rawFields[6];
            var originY = (float)rawFields[8];
            var zoneRecord = ReadSizedString(reader);
            if (version > 6) _ = ReadSizedString(reader);
            if (version >= 8) _ = ReadSizedString(reader);
            var levelFile = ReadSizedString(reader);
            var levelOffset = reader.ReadUInt32();
            var levelLength = reader.ReadUInt32();
            result.Add(new MapRegion(
                ResolveRegionName(zoneRecord, levelFile, data),
                zoneRecord,
                levelFile,
                ResolveRegionContentPack(zoneRecord, levelFile, contentPack),
                originX,
                originY,
                levelOffset,
                levelLength));
        }
        return result;
    }

    private static string ResolveRegionContentPack(string zoneRecord, string levelFile, string fallback)
    {
        // The installed expansion Levels.arc is cumulative, so the archive itself
        // cannot tell us which campaign owns a region. Rift-gate zone records do:
        // a-g are the base campaign, h-i AoM, j FG, and k-l FoA.
        var zoneFile = Path.GetFileNameWithoutExtension(zoneRecord).ToLowerInvariant();
        if (zoneFile.StartsWith("riftgatemap1", StringComparison.Ordinal) && zoneFile.Length > 12)
        {
            return zoneFile[12] switch
            {
                >= 'a' and <= 'g' => "base",
                >= 'h' and <= 'i' => "gdx1",
                'j' => "gdx2",
                >= 'k' and <= 'l' => "gdx3",
                _ => fallback
            };
        }

        // Scripted/fallback regions do not always have a zone record. Preserve the
        // owning item/archive pack rather than guessing from a display name.
        _ = levelFile;
        return fallback;
    }

    private static string ResolveRegionName(string zoneRecord, string levelFile, ItemCatalogData data)
    {
        if (data.Records.TryGetValue(zoneRecord, out var source))
        {
            foreach (var field in new[] { "description", "regionName", "ZoneNameTag", "mapName", "name" })
            {
                var tag = source.Record.Text(field);
                if (tag is not null && data.Tags.TryGetValue(tag, out var name) && !string.IsNullOrWhiteSpace(name))
                    return name.EndsWith(" Rift", StringComparison.OrdinalIgnoreCase) ? name[..^5] : name;
            }
        }
        var file = Path.GetFileNameWithoutExtension(levelFile).Replace('_', ' ').Trim();
        return file.Length > 0 ? file : "Unknown region";
    }

    private static IReadOnlySet<string> ScanPlacedRecords(Stream map, MapRegion region)
    {
        const int blockSize = 1024 * 1024;
        const int overlap = 768;
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var buffer = new byte[blockSize + overlap];
        var tail = 0;
        long consumed = 0;
        while (consumed < region.LevelLength)
        {
            var wanted = (int)Math.Min(blockSize, region.LevelLength - consumed);
            map.Position = checked((long)region.LevelOffset + consumed);
            var read = map.Read(buffer, tail, wanted);
            if (read <= 0) break;
            var total = tail + read;
            var span = buffer.AsSpan(0, total);
            var search = 0;
            while (search <= total - RecordPrefix.Length)
            {
                var relative = span[search..].IndexOf(RecordPrefix);
                if (relative < 0) break;
                var start = search + relative;
                var maxEnd = Math.Min(total, start + 700);
                var end = start;
                while (end < maxEnd && buffer[end] is >= 32 and <= 126) end++;
                if (end - start >= RecordPrefix.Length + 4)
                {
                    var path = Encoding.Latin1.GetString(buffer, start, end - start)
                        .Replace('\\', '/').TrimEnd('\0');
                    var dbr = path.IndexOf(".dbr", StringComparison.OrdinalIgnoreCase);
                    if (dbr >= 0) result.Add(path[..(dbr + 4)]);
                }
                search = start + RecordPrefix.Length;
            }
            tail = Math.Min(overlap, total);
            buffer.AsSpan(total - tail, tail).CopyTo(buffer);
            consumed += read;
        }
        return result;
    }

    private static string ReadSizedString(BinaryReader reader)
    {
        var length = reader.ReadInt32();
        if (length is < 0 or > 32_768 || length > reader.BaseStream.Length - reader.BaseStream.Position)
            throw new InvalidDataException("Map string length is invalid.");
        return Encoding.Latin1.GetString(reader.ReadBytes(length)).Replace('\\', '/');
    }

    private static void ReadExactly(Stream stream, long offset, Span<byte> buffer)
    {
        stream.Position = offset;
        stream.ReadExactly(buffer);
    }

    private static IEnumerable<LevelArchive> FindLevelArchives(string installationPath)
    {
        // The highest installed expansion's world001.map is cumulative: it contains
        // the base campaign and preceding expansions. Scanning older archives would
        // only duplicate placements and multiply a multi-gigabyte pass.
        for (var index = 9; index >= 0; index--)
        {
            var pack = index == 0 ? "base" : $"gdx{index}";
            var root = index == 0 ? installationPath : Path.Combine(installationPath, pack);
            var path = Path.Combine(root, "resources", "Levels.arc");
            if (!File.Exists(path)) continue;
            yield return new LevelArchive(pack, path);
            yield break;
        }
    }

    private sealed record LevelArchive(string ContentPack, string Path);
    private sealed record MapRegion(
        string Name,
        string ZoneRecord,
        string LevelFile,
        string ContentPack,
        float OriginX,
        float OriginY,
        uint LevelOffset,
        uint LevelLength);
}

internal sealed record MapLocationIndexResult(
    int Version,
    DateTimeOffset BuiltAt,
    IReadOnlyList<MapArchiveFingerprint> Archives,
    int RegionCount,
    int PlacedRecordCount,
    IReadOnlyDictionary<string, IReadOnlyList<MapRegionLocation>> SourceLocations,
    int MiTierCount,
    int LocatedMiTierCount,
    IReadOnlyList<string> UnlocatedMiBases);

internal sealed record MapArchiveFingerprint(string Path, long Length, DateTime LastWriteUtc);

internal sealed record MapRegionLocation(
    string Name,
    string ZoneRecord,
    string LevelFile,
    string ContentPack,
    float OriginX,
    float OriginY);
