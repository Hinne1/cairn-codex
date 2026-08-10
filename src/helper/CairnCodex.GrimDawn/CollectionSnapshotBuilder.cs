namespace CairnCodex.GrimDawn;

internal static class CollectionSnapshotBuilder
{
    public static CollectionSnapshot Scan()
    {
        var discovery = GrimDawnDiscovery.Discover();
        var installation = discovery.Installations.FirstOrDefault()
            ?? throw new DirectoryNotFoundException("No Grim Dawn installation was discovered.");
        var catalog = ItemCatalogBuilder.Build(installation.Path);
        var availableByRecord = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var scannedStashes = new List<ScannedStash>();
        var observedItems = new List<ObservedStashItem>();
        var warnings = new List<CollectionScanWarning>();

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
                        item.AffixRerolls));
                }
            }
            catch (Exception exception) when (
                exception is ArgumentException or IOException or InvalidDataException or UnauthorizedAccessException)
            {
                warnings.Add(new CollectionScanWarning(candidate.Path, exception.Message));
            }
        }

        var items = catalog.Items
            .Select(item => new CollectionCatalogItem(
                item,
                availableByRecord.GetValueOrDefault(item.Record)))
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

        return new CollectionSnapshot(
            DateTime.UtcNow,
            discovery,
            catalog.ContentPacks,
            scannedStashes,
            observedItems,
            warnings,
            summaries,
            items);
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
    IReadOnlyList<CollectionCatalogItem> Items);

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
    uint AffixRerolls);

internal sealed record CollectionRaritySummary(
    string Rarity,
    int Total,
    int Collected,
    int AvailableCopies);

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
    int AvailableCount)
{
    public CollectionCatalogItem(CatalogItem item, int availableCount)
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
            availableCount)
    {
    }
}
