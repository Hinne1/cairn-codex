namespace CairnCodex.GrimDawn;

internal static class CollectionSnapshotBuilder
{
    public static CollectionSnapshot Scan()
    {
        var discovery = GrimDawnDiscovery.Discover();
        var installation = discovery.Installations.FirstOrDefault()
            ?? throw new DirectoryNotFoundException("No Grim Dawn installation was discovered.");
        var gameData = ItemCatalogBuilder.Load(installation.Path);
        var knownFormulas = FormulaSaveScanner.Scan(discovery);
        var catalog = ItemCatalogBuilder.Build(gameData, knownFormulas);
        var availableByRecord = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var availableByAffixRecord = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var scannedStashes = new List<ScannedStash>();
        var accountStores = new List<ScannedAccountStore>();
        var observedItems = new List<ObservedStashItem>();
        var warnings = new List<CollectionScanWarning>();
        var eligibleRecords = catalog.Items
            .Concat(catalog.PlannerItems)
            .Select(item => item.Record)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rollDistributions = new Dictionary<RollTemplateKey, RollDistribution>();

        foreach (var candidate in discovery.SaveLocations.SelectMany(location => location.TransferStashes))
        {
            if (candidate.Error is not null)
            {
                warnings.Add(new CollectionScanWarning(candidate.Path, candidate.Error));
                continue;
            }

            try
            {
                var stash = TransferStashScanner.Scan(candidate.Path);
                scannedStashes.Add(new ScannedStash(
                    stash.Path,
                    stash.IsHardcore,
                    stash.ModLabel,
                    stash.ItemCount,
                    stash.LastWriteUtc,
                    stash.Sha256));
                foreach (var item in stash.Tabs.SelectMany(tab => tab.Items))
                {
                    availableByRecord[item.BaseRecord] =
                        availableByRecord.GetValueOrDefault(item.BaseRecord) + checked((int)item.StackCount);
                    if (!string.IsNullOrWhiteSpace(item.PrefixRecord))
                    {
                        availableByAffixRecord[item.PrefixRecord] =
                            availableByAffixRecord.GetValueOrDefault(item.PrefixRecord) + 1;
                    }
                    if (!string.IsNullOrWhiteSpace(item.SuffixRecord))
                    {
                        availableByAffixRecord[item.SuffixRecord] =
                            availableByAffixRecord.GetValueOrDefault(item.SuffixRecord) + 1;
                    }
                    var rollAnalysis = eligibleRecords.Contains(item.BaseRecord)
                        ? ItemRollAnalyzer.Analyze(
                            gameData,
                            new ItemRollInput(
                                item.BaseRecord,
                                item.PrefixRecord,
                                item.SuffixRecord,
                                item.Seed),
                            rollDistributions)
                        : null;
                    observedItems.Add(new ObservedStashItem(
                        stash.Path,
                        item.TabIndex,
                        item.ItemIndex,
                        item.BaseRecord,
                        item.PrefixRecord,
                        item.SuffixRecord,
                        item.ModifierRecord,
                        item.TransmuteRecord,
                        item.Seed,
                        item.MateriaRecord,
                        item.RelicCompletionBonusRecord,
                        item.RelicSeed,
                        item.EnchantmentRecord,
                        item.AscendantRecord,
                        item.AscendantRecord2H,
                        item.EnchantmentSeed,
                        item.MateriaCombines,
                        item.StackCount,
                        item.Rerolls,
                        item.AffixRerolls,
                        rollAnalysis));
                }
            }
            catch (Exception exception) when (
                exception is ArgumentException or IOException or InvalidDataException or UnauthorizedAccessException)
            {
                warnings.Add(new CollectionScanWarning(candidate.Path, exception.Message));
            }
        }

        foreach (var saveLocation in discovery.SaveLocations)
        {
            foreach (var directory in new[] { saveLocation.Path }.Concat(Directory.EnumerateDirectories(saveLocation.Path)))
            {
                foreach (var fileName in new[] { "reagents.gst", "reagents.gsh", "potions.gst", "potions.gsh" })
                {
                    var path = Path.Combine(directory, fileName);
                    if (!File.Exists(path)) continue;
                    try
                    {
                        var store = TransferStashScanner.Scan(path);
                        var entries = store.Tabs.SelectMany(tab => tab.Items)
                            .Select(item => new AccountStoreEntry(item.BaseRecord, checked((int)item.StackCount)))
                            .ToArray();
                        accountStores.Add(new ScannedAccountStore(
                            store.Path,
                            fileName.StartsWith("reagents", StringComparison.OrdinalIgnoreCase) ? "reagents" : "potions",
                            store.IsHardcore,
                            store.ItemCount,
                            store.LastWriteUtc,
                            store.Sha256,
                            entries));
                    }
                    catch (Exception exception) when (
                        exception is ArgumentException or IOException or InvalidDataException or UnauthorizedAccessException)
                    {
                        warnings.Add(new CollectionScanWarning(path, exception.Message));
                    }
                }
            }
        }

        // Local and Steam Cloud saves may both expose the same account store. The
        // newest file is the authoritative copy; adding both would double every
        // component quantity and turn synchronization into fake collection progress.
        foreach (var store in accountStores
                     .GroupBy(store => $"{store.Kind}:{store.IsHardcore}", StringComparer.OrdinalIgnoreCase)
                     .Select(group => group.MaxBy(store => store.LastWriteUtc)!))
        {
            foreach (var entry in store.Entries)
            {
                availableByRecord[entry.Record] =
                    availableByRecord.GetValueOrDefault(entry.Record) + entry.Quantity;
            }
        }

        var rollSummary = observedItems
            .Where(item => item.RollAnalysis?.Trusted == true &&
                           item.RollAnalysis.OverallEstimatedPercentile.HasValue)
            .GroupBy(item => item.BaseRecord, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => new
                {
                    Best = group.Max(item => item.RollAnalysis!.OverallEstimatedPercentile!.Value),
                    Count = group.Count()
                },
                StringComparer.OrdinalIgnoreCase);
        var items = catalog.Items
            .Select(item => new CollectionCatalogItem(
                item,
                availableByRecord.GetValueOrDefault(item.Record),
                rollSummary.TryGetValue(item.Record, out var rolls) ? rolls.Best : null,
                rollSummary.TryGetValue(item.Record, out rolls) ? rolls.Count : 0))
            .ToArray();
        var summaries = items
            .GroupBy(item => item.Rarity, StringComparer.OrdinalIgnoreCase)
            .OrderBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .Select(group => new CollectionRaritySummary(
                group.Key,
                group.Count(),
                group.Count(item => item.AvailableCount > 0),
                group.Sum(item => item.AvailableCount)))
            .ToArray();
        var plannerItems = catalog.PlannerItems
            .Select(item => new CollectionCatalogItem(
                item,
                availableByRecord.GetValueOrDefault(item.Record),
                rollSummary.TryGetValue(item.Record, out var rolls) ? rolls.Best : null,
                rollSummary.TryGetValue(item.Record, out rolls) ? rolls.Count : 0))
            .ToArray();
        var supplies = catalog.Supplies
            .Select(item => new CollectionCatalogItem(
                item,
                availableByRecord.GetValueOrDefault(item.Record),
                null,
                0))
            .ToArray();
        var materials = catalog.Materials
            .Select(item => new CollectionCatalogItem(
                item,
                availableByRecord.GetValueOrDefault(item.Record),
                null,
                0))
            .ToArray();
        var affixes = catalog.Affixes
            .Select(affix => new CollectionAffix(
                affix.Key,
                affix.Name,
                affix.Kind,
                affix.Rarity,
                affix.Records,
                affix.Records.Sum(record => availableByAffixRecord.GetValueOrDefault(record)),
                affix.Presentations))
            .ToArray();
        var affixSummary = new CollectionAffixSummary(
            affixes.Length,
            affixes.Count(affix => affix.AvailableCount > 0),
            affixes.Sum(affix => affix.AvailableCount));

        return new CollectionSnapshot(
            DateTime.UtcNow,
            discovery,
            catalog.ContentPacks,
            scannedStashes,
            observedItems,
            warnings,
            summaries,
            items,
            affixSummary,
            affixes,
            plannerItems,
            supplies,
            materials,
            accountStores);
    }
}

internal sealed record CollectionSnapshot(
    DateTime ScannedAtUtc,
    GrimDawnDiscoveryResult Discovery,
    IReadOnlyList<CatalogContentPack> ContentPacks,
    IReadOnlyList<ScannedStash> ScannedStashes,
    IReadOnlyList<ObservedStashItem> ObservedItems,
    IReadOnlyList<CollectionScanWarning> Warnings,
    IReadOnlyList<CollectionRaritySummary> Rarities,
    IReadOnlyList<CollectionCatalogItem> Items,
    CollectionAffixSummary AffixSummary,
    IReadOnlyList<CollectionAffix> Affixes,
    IReadOnlyList<CollectionCatalogItem> PlannerItems,
    IReadOnlyList<CollectionCatalogItem> Supplies,
    IReadOnlyList<CollectionCatalogItem> Materials,
    IReadOnlyList<ScannedAccountStore> AccountStores);

internal sealed record ScannedAccountStore(
    string Path,
    string Kind,
    bool IsHardcore,
    int ItemCount,
    DateTime LastWriteUtc,
    string Sha256,
    IReadOnlyList<AccountStoreEntry> Entries);

internal sealed record AccountStoreEntry(string Record, int Quantity);

internal sealed record ScannedStash(
    string Path,
    bool IsHardcore,
    string ModLabel,
    int ItemCount,
    DateTime LastWriteUtc,
    string Sha256);

internal sealed record CollectionScanWarning(string Path, string Message);

internal sealed record ObservedStashItem(
    string SourcePath,
    int TabIndex,
    int ItemIndex,
    string BaseRecord,
    string PrefixRecord,
    string SuffixRecord,
    string ModifierRecord,
    string TransmuteRecord,
    uint Seed,
    string MateriaRecord,
    string RelicCompletionBonusRecord,
    uint RelicSeed,
    string EnchantmentRecord,
    string AscendantRecord,
    string AscendantRecord2H,
    uint EnchantmentSeed,
    uint MateriaCombines,
    uint StackCount,
    uint Rerolls,
    uint AffixRerolls,
    ItemRollAnalysis? RollAnalysis);

internal sealed record CollectionRaritySummary(
    string Rarity,
    int Total,
    int Collected,
    int AvailableCopies);

internal sealed record CollectionAffixSummary(int Total, int Collected, int AvailableCopies);

internal sealed record CollectionAffix(
    string Key,
    string Name,
    string Kind,
    string Rarity,
    IReadOnlyList<string> Records,
    int AvailableCount,
    IReadOnlyDictionary<string, ItemPresentation> Presentations);

internal sealed record CollectionCatalogItem(
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
    ItemPresentation Presentation,
    int AvailableCount,
    double? BestRollPercentile,
    int AnalyzedCopyCount)
{
    public CollectionCatalogItem(
        CatalogItem item,
        int availableCount,
        double? bestRollPercentile,
        int analyzedCopyCount)
        : this(
            item.Record,
            item.Name,
            item.Rarity,
            item.ItemClass,
            item.Slot,
            item.LevelRequirement,
            item.ItemLevel,
            item.SetName,
            item.SetRecord,
            item.Bitmap,
            item.ContentPack,
            item.SetPresentation,
            item.Acquisition,
            item.Presentation,
            availableCount,
            bestRollPercentile,
            analyzedCopyCount)
    {
    }
}
