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

    public static ItemCatalogResult Build(ItemCatalogData data, KnownFormulaIndex? knownFormulas = null)
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
                setPresentations,
                false,
                knownFormulas))
            .Where(item => item is not null)
            .Cast<CatalogItem>()
            .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Record, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var plannerItems = data.Records.Values
            .Where(source =>
                source.Record.Text("itemClassification") == "Rare" &&
                source.Record.Name.Replace('\\', '/').Contains(
                    "/items/faction/",
                    StringComparison.OrdinalIgnoreCase))
            .Select(source => Project(
                source,
                data.Tags,
                data.Records,
                presentationSource,
                acquisitionReferences,
                setPresentations,
                true,
                knownFormulas))
            .Where(item => item is not null && item.Rarity == "faction")
            .Cast<CatalogItem>()
            .OrderBy(item => item.LevelRequirement)
            .ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
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
            plannerItems,
            affixes);
    }

    private static CatalogItem? Project(
        CatalogSourceRecord source,
        IReadOnlyDictionary<string, string> tags,
        IReadOnlyDictionary<string, CatalogSourceRecord> records,
        ItemPresentationSource presentationSource,
        IReadOnlyDictionary<string, IReadOnlyList<AcquisitionReference>> acquisitionReferences,
        IReadOnlyDictionary<string, ItemSetPresentation?> setPresentations,
        bool includeFactionRare,
        KnownFormulaIndex? knownFormulas)
    {
        var record = source.Record;
        var classification = record.Text("itemClassification");
        var normalizedPath = record.Name.Replace('\\', '/');
        var isFactionPath = normalizedPath.Contains("/items/faction/", StringComparison.OrdinalIgnoreCase);
        var isMonsterInfrequent = classification == "Rare" && !isFactionPath && IsMonsterInfrequent(record);
        var isFactionPlanningItem = includeFactionRare &&
            classification == "Rare" &&
            isFactionPath &&
            !isMonsterInfrequent;
        if (classification is not ("Epic" or "Legendary") && !isMonsterInfrequent && !isFactionPlanningItem ||
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

        var acquisition = BuildAcquisition(record.Name, acquisitionReferences, records, tags, knownFormulas);
        if (isMonsterInfrequent &&
            acquisition.SourceRecords.Count == 0 &&
            acquisition.Sources.Count == 1 &&
            acquisition.Sources[0].StartsWith("Special source", StringComparison.OrdinalIgnoreCase))
        {
            // A handful of obsolete MI tiers remain in the ARZ after their loot-table
            // references were removed. They are not obtainable and should not become
            // phantom collection entries (currently this catches the retired level-18
            // Putrid Necklace between its live level-8 and level-32 tiers).
            return null;
        }
        if (!isMonsterInfrequent)
        {
            if (!isFactionPlanningItem &&
                acquisition.Sources.Count >= 4 &&
                acquisition.Sources.All(sourceName =>
                    sourceName.StartsWith("Dropped by", StringComparison.OrdinalIgnoreCase)))
            {
                // A global Epic/Legendary table is referenced by many ordinary monster
                // records. Those references describe who rolls the global table, not a
                // farmable item-specific source (for example Devil's Mark previously
                // claimed a dozen arbitrary dranghouls). Keep small named-source sets,
                // but collapse broad consumers to the honest acquisition label.
                acquisition = acquisition with { Sources = ["Random drop"] };
            }
            // Reverse-record IDs are only serialized for MI map-location joins. Keeping
            // up to 64 monster records on every global-drop Epic/Legendary made the
            // otherwise compact catalog cache balloon by tens of megabytes.
            acquisition = acquisition with { SourceRecords = [] };
        }

        return new CatalogItem(
            record.Name,
            name,
            isMonsterInfrequent ? "mi" : isFactionPlanningItem ? "faction" : classification!.ToLowerInvariant(),
            itemClass,
            slot,
            checked((int)Math.Round(record.Number("levelRequirement") ?? 0)),
            checked((int)Math.Round(record.Number("itemLevel") ?? 0)),
            setName,
            setRecord,
            record.Text("bitmap") ?? record.Text("relicBitmap") ?? record.Text("shardBitmap"),
            source.ContentPack,
            setRecord is null ? null : setPresentations.GetValueOrDefault(setRecord),
            acquisition,
            ItemPresentationBuilder.Build(record, presentationSource));
    }

    private static bool IsMonsterInfrequent(ArzRecord record) =>
        record.Values
            .Where(field => field.Key.StartsWith("augmentSkillName", StringComparison.OrdinalIgnoreCase))
            .SelectMany(field => field.Value)
            .Count(value => value.Text?.StartsWith("records/skills/playerclass", StringComparison.OrdinalIgnoreCase) == true) >= 2 ||
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
        IReadOnlyDictionary<string, IReadOnlyList<AcquisitionReference>> references,
        IReadOnlyDictionary<string, CatalogSourceRecord> records,
        IReadOnlyDictionary<string, string> tags,
        KnownFormulaIndex? knownFormulas)
    {
        var hints = new List<string>();
        var monsterHints = new List<string>();
        var monsterSourceRecords = new List<string>();
        var containerHints = new List<string>();
        var containerSourceRecords = new List<string>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { itemRecord };
        var queue = new Queue<(string Record, int Depth)>();
        queue.Enqueue((itemRecord, 0));
        var sawDropTable = false;
        var sawVendor = false;
        var blueprintRecords = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var factionRequirements = new List<ItemFactionRequirement>();

        // An MI normally reaches its source through two or more reverse references:
        // item -> dynamic loot table -> monster, sometimes with one or more pool tables
        // in between. Walking only the first edge made every MI look like a random drop.
        while (queue.Count > 0 && visited.Count <= 2_000)
        {
            var (target, depth) = queue.Dequeue();
            if (depth >= 8) continue;

            foreach (var reference in references.GetValueOrDefault(target) ?? [])
            {
                if (!records.TryGetValue(reference.Record, out var source)) continue;
                var path = source.Record.Name.Replace('\\', '/');
                var isVendor = path.Contains("/vendors/", StringComparison.OrdinalIgnoreCase) ||
                               path.Contains("/merchants/", StringComparison.OrdinalIgnoreCase);
                var isMonster = source.Record.Type == "Monster" ||
                                path.Contains("/creatures/enemies/", StringComparison.OrdinalIgnoreCase);
                var isContainer = path.Contains("/interactiveobjects/loot", StringComparison.OrdinalIgnoreCase) ||
                                  path.Contains("/lootcontainers/", StringComparison.OrdinalIgnoreCase) ||
                                  path.Contains("/items/lootchests/", StringComparison.OrdinalIgnoreCase);

                // Only a formula whose artifactName points directly at this item is a
                // deterministic recipe for it. Formulae for broad random-item tables
                // are reachable through the drop graph too, but are not useful shopping
                // list recipes for every possible table result.
                if (depth == 0 && source.Record.Type == "ItemArtifactFormula" && reference.Field == "artifactName")
                    blueprintRecords.Add(source.Record.Name);
                if (path.Contains("/loottables/", StringComparison.OrdinalIgnoreCase) && !isVendor)
                    sawDropTable = true;
                if (isVendor)
                {
                    sawVendor = true;
                    var requirement = ParseFactionRequirement(path);
                    if (requirement is not null) factionRequirements.Add(requirement);
                }

                if (isMonster)
                {
                    AddNamedSource("Dropped by", source, tags, monsterHints, monsterSourceRecords);
                    // Proxies point at monsters, but they are not needed to discover the
                    // drop graph. Map placement is indexed independently from sourceRecords.
                    continue;
                }

                if (isContainer)
                {
                    AddNamedSource("Found in", source, tags, containerHints, containerSourceRecords);
                }

                if (visited.Add(reference.Record) && IsAcquisitionBridge(path, source.Record.Type))
                    queue.Enqueue((reference.Record, depth + 1));
            }
        }

        // A boss-specific item table can also be reachable through broad reward
        // chests. When a real monster consumer exists, that is the actionable farming
        // source and its placement graph must not be polluted by every generic chest.
        var preferredHints = monsterHints.Count > 0 ? monsterHints : containerHints;
        var preferredSourceRecords = monsterSourceRecords.Count > 0
            ? monsterSourceRecords
            : containerSourceRecords;
        hints.AddRange(preferredHints);

        if (blueprintRecords.Count > 0) hints.Add("Craftable from a blueprint");
        foreach (var requirement in factionRequirements
                     .DistinctBy(requirement => $"{requirement.Faction}\0{requirement.Reputation}", StringComparer.OrdinalIgnoreCase))
        {
            hints.Add($"Faction vendor: {requirement.Faction} · {requirement.Reputation}");
        }
        if (sawVendor && factionRequirements.Count == 0) hints.Add("Merchant inventory");
        if (hints.Count == 0 && sawDropTable) hints.Add("Random drop");
        if (hints.Count == 0) hints.Add("Special source; exact location not yet indexed");
        return new ItemAcquisitionPresentation(
            hints.Distinct(StringComparer.OrdinalIgnoreCase).Take(64).ToArray(),
            preferredSourceRecords.Distinct(StringComparer.OrdinalIgnoreCase).Take(64).ToArray(),
            factionRequirements
                .DistinctBy(requirement => $"{requirement.Faction}\0{requirement.Reputation}", StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            blueprintRecords.Count == 0
                ? null
                : new ItemCraftingPresentation(
                    blueprintRecords.OrderBy(record => record, StringComparer.OrdinalIgnoreCase).ToArray(),
                    knownFormulas is null
                        ? null
                        : blueprintRecords.Any(knownFormulas.SoftcoreRecords.Contains),
                    knownFormulas is null
                        ? null
                        : blueprintRecords.Any(knownFormulas.HardcoreRecords.Contains)));
    }

    private static ItemFactionRequirement? ParseFactionRequirement(string path)
    {
        const string marker = "/merchants/factiontables/";
        var markerIndex = path.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0) return null;
        var stem = Path.GetFileNameWithoutExtension(path);
        foreach (var reputation in new[] { "friendly", "respected", "honored", "revered" })
        {
            var suffix = $"_{reputation}_";
            var suffixIndex = stem.LastIndexOf(suffix, StringComparison.OrdinalIgnoreCase);
            if (suffixIndex <= 0) continue;
            var key = stem[..suffixIndex];
            return new ItemFactionRequirement(
                FactionDisplayName(key),
                char.ToUpperInvariant(reputation[0]) + reputation[1..],
                path);
        }
        return null;
    }

    private static string FactionDisplayName(string key) => key.ToLowerInvariant() switch
    {
        "avian" => "Noktukari",
        "blacklegion" => "Black Legion",
        "bysmiel" => "Cult of Bysmiel",
        "coven" => "Coven of Ugdenbog",
        "devilscrossing" => "Devil's Crossing",
        "dreeg" => "Cult of Dreeg",
        "exile" => "The Outcast",
        "homestead" => "Homestead",
        "kurn" => "Kurn",
        "kymonchosen" => "Kymon's Chosen",
        "malmouth" => "Malmouth Resistance",
        "orderdeathsvigil" => "Order of Death's Vigil",
        "rovers" => "Rovers",
        "solael" => "Cult of Solael",
        "wendigo" => "Barrowholm",
        _ => key
    };

    private static bool IsAcquisitionBridge(string path, string type) =>
        path.Contains("/loottables/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/enemygear/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/npcgear/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/creatures/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/proxies/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/interactiveobjects/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/lootcontainers/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/items/lootchests/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/vendors/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/merchants/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/items/crafting/blueprints/", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("/quests/", StringComparison.OrdinalIgnoreCase) ||
        type.Contains("Loot", StringComparison.OrdinalIgnoreCase) ||
        type.Contains("Merchant", StringComparison.OrdinalIgnoreCase) ||
        type.Contains("Formula", StringComparison.OrdinalIgnoreCase);

    private static void AddNamedSource(
        string verb,
        CatalogSourceRecord source,
        IReadOnlyDictionary<string, string> tags,
        IList<string> hints,
        IList<string> sourceRecords)
    {
        var record = source.Record;
        var name = new[]
            {
                record.Text("description"),
                record.Text("displayName"),
                record.Text("monsterName"),
                record.Text("itemNameTag")
            }
            .Select(value => Resolve(value, tags)?.Trim())
            .FirstOrDefault(value => IsUsefulSourceName(value));

        if (name is null)
        {
            var fallback = record.Text("FileDescription")?.Trim();
            if (IsUsefulSourceName(fallback)) name = fallback;
        }

        // Ordinary world monsters are the most useful answer to "where can I farm
        // this?". Boss, hero, devotion and procedural variants often share the same
        // legitimate MI table, but listing those first made broad families look like
        // corrupt acquisition data and polluted their first map locations.
        var normalizedPath = record.Name.Replace('\\', '/');
        var isOrdinaryMonster = verb == "Dropped by" &&
            !normalizedPath.Contains("/boss&quest/", StringComparison.OrdinalIgnoreCase) &&
            !normalizedPath.Contains("/hero/", StringComparison.OrdinalIgnoreCase) &&
            !normalizedPath.Contains("/devotion/", StringComparison.OrdinalIgnoreCase);
        if (isOrdinaryMonster)
        {
            sourceRecords.Insert(0, record.Name);
            if (name is not null) hints.Insert(0, $"{verb} {name}");
        }
        else
        {
            sourceRecords.Add(record.Name);
            if (name is not null) hints.Add($"{verb} {name}");
        }
    }

    private static bool IsUsefulSourceName(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        !value.StartsWith("tag", StringComparison.OrdinalIgnoreCase) &&
        !value.StartsWith("records/", StringComparison.OrdinalIgnoreCase);

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
    IReadOnlyList<CatalogItem> PlannerItems,
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
internal sealed record ItemAcquisitionPresentation(
    IReadOnlyList<string> Sources,
    IReadOnlyList<string> SourceRecords,
    IReadOnlyList<ItemFactionRequirement> Factions,
    ItemCraftingPresentation? Crafting);
internal sealed record ItemCraftingPresentation(
    IReadOnlyList<string> BlueprintRecords,
    bool? KnownSoftcore,
    bool? KnownHardcore);
internal sealed record ItemFactionRequirement(string Faction, string Reputation, string VendorRecord);
