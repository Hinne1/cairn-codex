using CairnCodex.GrimDawn.Gdia.GameData;

namespace CairnCodex.GrimDawn;

internal static class ItemCatalogBuilder
{
    private static readonly HashSet<string> CollectionSlots =
    [
        "head", "chest", "shoulders", "hands", "legs", "feet", "waist",
        "ring", "amulet", "medal", "weapon", "offhand", "shield", "relic"
    ];

    public static ItemCatalogResult Build(string installationPath) => Build(Load(installationPath));

    public static ItemCatalogData Load(string installationPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(installationPath);
        var root = Path.GetFullPath(installationPath);
        if (!Directory.Exists(root))
        {
            throw new DirectoryNotFoundException($"Grim Dawn installation not found: {root}");
        }

        var contentPacks = FindContentPacks(root).ToArray();
        if (contentPacks.Length == 0)
        {
            throw new FileNotFoundException("No Grim Dawn database.arz was found.", root);
        }

        var tags = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var records = new Dictionary<string, CatalogSourceRecord>(StringComparer.OrdinalIgnoreCase);
        foreach (var pack in contentPacks)
        {
            foreach (var pair in ArcArchiveReader.ReadTags(pack.TagsPath))
            {
                tags[pair.Key] = pair.Value;
            }

            // Grim Dawn replaces an entire DBR when a higher-priority ARZ defines the same path.
            foreach (var record in ArzArchiveReader.Read(pack.DatabasePath))
            {
                records[record.Name] = new CatalogSourceRecord(record, pack.Id);
            }
        }

        return new ItemCatalogData(root, contentPacks, tags, records);
    }

    public static ItemCatalogResult Build(ItemCatalogData data)
    {
        var presentationSource = new ItemPresentationSource(data.Tags, data.Records);
        var acquisitionReferences = BuildAcquisitionReferences(data.Records);
        var setPresentations = data.Records.Values
            .Select(source => source.Record.Text("itemSetName"))
            .OfType<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                path => path,
                path => ItemPresentationBuilder.BuildSet(path, presentationSource),
                StringComparer.OrdinalIgnoreCase);
        var items = data.Records.Values
            .Select(source => Project(
                source,
                data.Tags,
                data.Records,
                presentationSource,
                acquisitionReferences,
                setPresentations))
            .Where(item => item is not null)
            .Cast<CatalogItem>()
            .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Record, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var affixes = data.Records.Values
            .Select(source => ProjectAffix(source, data.Tags))
            .Where(affix => affix is not null)
            .Cast<CatalogAffixRecord>()
            .GroupBy(
                affix => $"{affix.Kind}\0{affix.Rarity}\0{affix.Name}",
                StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                var first = group.First();
                return new CatalogAffix(
                    $"{first.Kind}:{first.Rarity}:{first.Name.ToLowerInvariant()}",
                    first.Name,
                    first.Kind,
                    first.Rarity,
                    group.Select(affix => affix.Record)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .OrderBy(record => record, StringComparer.OrdinalIgnoreCase)
                        .ToArray());
            })
            .OrderBy(affix => affix.Kind, StringComparer.OrdinalIgnoreCase)
            .ThenBy(affix => affix.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new ItemCatalogResult(
            data.InstallationPath,
            data.ContentPacks.Select(pack => new CatalogContentPack(pack.Id, pack.DatabasePath, pack.TagsPath)).ToArray(),
            data.Records.Count,
            data.Tags.Count,
            items,
            affixes);
    }

    private static CatalogItem? Project(
        CatalogSourceRecord source,
        IReadOnlyDictionary<string, string> tags,
        IReadOnlyDictionary<string, CatalogSourceRecord> records,
        ItemPresentationSource presentationSource,
        IReadOnlyDictionary<string, IReadOnlyList<AcquisitionReference>> acquisitionReferences,
        IReadOnlyDictionary<string, ItemSetPresentation?> setPresentations)
    {
        var record = source.Record;
        var classification = record.Text("itemClassification");
        var isMonsterInfrequent = classification == "Rare" && IsMonsterInfrequent(record);
        if (classification is not ("Epic" or "Legendary") && !isMonsterInfrequent ||
            record.Name.Contains("/enemygear/", StringComparison.OrdinalIgnoreCase) ||
            record.Name.Contains("/npcgear/", StringComparison.OrdinalIgnoreCase) ||
            record.Name.Contains("/sandbox/", StringComparison.OrdinalIgnoreCase) ||
            IsCategoryTemplate(record.Name))
        {
            return null;
        }

        var itemClass = record.Text("Class") ?? string.Empty;
        var slot = NormalizeSlot(itemClass);
        if (!CollectionSlots.Contains(slot))
        {
            return null;
        }

        var nameParts = new[]
        {
            Resolve(record.Text("itemStyleTag"), tags),
            Resolve(record.Text("itemNameTag") ?? record.Text("description"), tags),
            Resolve(record.Text("itemQualityTag"), tags)
        }.Where(value => !string.IsNullOrWhiteSpace(value));
        var name = string.Join(' ', nameParts).Trim();
        if (name.Length == 0)
        {
            name = record.Name;
        }

        if (name.StartsWith("tag", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("records/", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var setRecord = record.Text("itemSetName");
        string? setName = null;
        if (setRecord is not null && records.TryGetValue(setRecord, out var setSource))
        {
            setName = Resolve(setSource.Record.Text("setName"), tags);
        }

        return new CatalogItem(
            record.Name,
            name,
            isMonsterInfrequent ? "mi" : classification!.ToLowerInvariant(),
            itemClass,
            slot,
            checked((int)Math.Round(record.Number("levelRequirement") ?? 0)),
            checked((int)Math.Round(record.Number("itemLevel") ?? 0)),
            setName,
            setRecord,
            record.Text("bitmap") ?? record.Text("relicBitmap") ?? record.Text("shardBitmap"),
            source.ContentPack,
            setRecord is null ? null : setPresentations.GetValueOrDefault(setRecord),
            BuildAcquisition(record.Name, acquisitionReferences),
            ItemPresentationBuilder.Build(record, presentationSource));
    }

    private static bool IsMonsterInfrequent(ArzRecord record) =>
        record.Values.Values
            .SelectMany(values => values)
            .Select(value => value.Text)
            .Any(value =>
                value?.Contains("/skillmodifiers/monsterinfrequents/", StringComparison.OrdinalIgnoreCase) == true ||
                value?.Contains("/skillmodifiers/mi/", StringComparison.OrdinalIgnoreCase) == true);

    private static CatalogAffixRecord? ProjectAffix(
        CatalogSourceRecord source,
        IReadOnlyDictionary<string, string> tags)
    {
        var path = source.Record.Name.Replace('\\', '/');
        var kind = path.Contains("/lootaffixes/prefix/", StringComparison.OrdinalIgnoreCase)
            ? "prefix"
            : path.Contains("/lootaffixes/suffix/", StringComparison.OrdinalIgnoreCase)
                ? "suffix"
                : null;
        if (kind is null ||
            source.Record.Type != "LootRandomizer" ||
            path.Contains("_base_blank", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var name = Resolve(source.Record.Text("lootRandomizerName"), tags)?.Trim();
        var rarity = source.Record.Text("itemClassification")?.ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(name) ||
            name.StartsWith("tag", StringComparison.OrdinalIgnoreCase) ||
            rarity is not ("magical" or "rare"))
        {
            return null;
        }

        return new CatalogAffixRecord(source.Record.Name, name, kind, rarity);
    }

    private static bool IsCategoryTemplate(string recordName)
    {
        // Grim Dawn ships one internal category/default DBR per content-pack namespace
        // (c000_*, c100_*, c200_*, ...). They inherit a real item's display tag and
        // bitmap but are not lootable item bases, which otherwise creates duplicate,
        // partially populated Codex entries.
        var filename = Path.GetFileName(recordName);
        return filename.Length > 5 &&
               filename[0] == 'c' &&
               char.IsDigit(filename[1]) &&
               filename[2] == '0' &&
               filename[3] == '0' &&
               filename[4] == '_';
    }

    private static IReadOnlyDictionary<string, IReadOnlyList<AcquisitionReference>> BuildAcquisitionReferences(
        IReadOnlyDictionary<string, CatalogSourceRecord> records)
    {
        var references = new Dictionary<string, List<AcquisitionReference>>(StringComparer.OrdinalIgnoreCase);
        foreach (var source in records.Values)
        {
            foreach (var field in source.Record.Values)
            {
                foreach (var value in field.Value.Select(value => value.Text).OfType<string>())
                {
                    if (!value.StartsWith("records/", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!references.TryGetValue(value, out var list))
                    {
                        list = [];
                        references[value] = list;
                    }
                    list.Add(new AcquisitionReference(source.Record.Name, source.Record.Type, field.Key));
                }
            }
        }
        return references.ToDictionary(
            pair => pair.Key,
            pair => (IReadOnlyList<AcquisitionReference>)pair.Value,
            StringComparer.OrdinalIgnoreCase);
    }

    private static ItemAcquisitionPresentation BuildAcquisition(
        string itemRecord,
        IReadOnlyDictionary<string, IReadOnlyList<AcquisitionReference>> references)
    {
        var sources = references.GetValueOrDefault(itemRecord) ?? [];
        var hints = new List<string>();
        if (sources.Any(source => source.Type == "ItemArtifactFormula" && source.Field == "artifactName"))
            hints.Add("Craftable from a learned blueprint");
        if (sources.Any(source =>
                source.Record.Contains("/loottables/vendors/", StringComparison.OrdinalIgnoreCase) ||
                source.Record.Contains("/merchants/", StringComparison.OrdinalIgnoreCase)))
            hints.Add("Merchant or faction inventory");
        if (sources.Any(source =>
                source.Record.Contains("/loottables/", StringComparison.OrdinalIgnoreCase) &&
                !source.Record.Contains("/vendors/", StringComparison.OrdinalIgnoreCase)))
            hints.Add("Random drop");
        if (hints.Count == 0) hints.Add("Special source; exact location not yet indexed");
        return new ItemAcquisitionPresentation(hints);
    }

    private static string? Resolve(string? tag, IReadOnlyDictionary<string, string> tags)
    {
        if (string.IsNullOrWhiteSpace(tag))
        {
            return null;
        }

        return tags.TryGetValue(tag, out var value) ? value : tag;
    }

    private static string NormalizeSlot(string itemClass) => itemClass switch
    {
        "ArmorProtective_Head" => "head",
        "ArmorProtective_Chest" => "chest",
        "ArmorProtective_Shoulders" => "shoulders",
        "ArmorProtective_Hands" => "hands",
        "ArmorProtective_Legs" => "legs",
        "ArmorProtective_Feet" => "feet",
        "ArmorProtective_Waist" => "waist",
        "ArmorJewelry_Ring" => "ring",
        "ArmorJewelry_Amulet" => "amulet",
        "ArmorJewelry_Medal" => "medal",
        "WeaponArmor_Offhand" => "offhand",
        "WeaponArmor_Shield" => "shield",
        "ItemArtifact" => "relic",
        _ when itemClass.StartsWith("Weapon", StringComparison.Ordinal) => "weapon",
        _ => itemClass.Length == 0 ? "unknown" : itemClass.ToLowerInvariant()
    };

    private static IEnumerable<ContentPack> FindContentPacks(string root)
    {
        var baseDatabase = Path.Combine(root, "database", "database.arz");
        var baseTags = Path.Combine(root, "resources", "Text_EN.arc");
        if (File.Exists(baseDatabase) && File.Exists(baseTags))
        {
            yield return new ContentPack("base", baseDatabase, baseTags);
        }

        for (var index = 1; index <= 9; index++)
        {
            var packRoot = Path.Combine(root, $"gdx{index}");
            var databaseDirectory = Path.Combine(packRoot, "database");
            var tagsPath = Path.Combine(packRoot, "resources", "Text_EN.arc");
            if (!Directory.Exists(databaseDirectory) || !File.Exists(tagsPath))
            {
                continue;
            }

            var databasePath = Directory.EnumerateFiles(databaseDirectory, "*.arz")
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();
            if (databasePath is not null)
            {
                yield return new ContentPack($"gdx{index}", databasePath, tagsPath);
            }
        }
    }

}

internal sealed record ItemCatalogData(
    string InstallationPath,
    IReadOnlyList<ContentPack> ContentPacks,
    IReadOnlyDictionary<string, string> Tags,
    IReadOnlyDictionary<string, CatalogSourceRecord> Records);

internal sealed record ContentPack(string Id, string DatabasePath, string TagsPath);
internal sealed record CatalogSourceRecord(ArzRecord Record, string ContentPack);

internal sealed record ItemCatalogResult(
    string InstallationPath,
    IReadOnlyList<CatalogContentPack> ContentPacks,
    int SourceRecordCount,
    int TagCount,
    IReadOnlyList<CatalogItem> Items,
    IReadOnlyList<CatalogAffix> Affixes);

internal sealed record CatalogContentPack(string Id, string DatabasePath, string TagsPath);

internal sealed record CatalogItem(
    string Record,
    string Name,
    string Rarity,
    string ItemClass,
    string Slot,
    int LevelRequirement,
    int ItemLevel,
    string? SetName,
    string? SetRecord,
    string? Bitmap,
    string ContentPack,
    ItemSetPresentation? SetPresentation,
    ItemAcquisitionPresentation Acquisition,
    ItemPresentation Presentation);

internal sealed record CatalogAffix(
    string Key,
    string Name,
    string Kind,
    string Rarity,
    IReadOnlyList<string> Records);

internal sealed record CatalogAffixRecord(string Record, string Name, string Kind, string Rarity);

internal sealed record AcquisitionReference(string Record, string Type, string Field);
internal sealed record ItemAcquisitionPresentation(IReadOnlyList<string> Sources);
