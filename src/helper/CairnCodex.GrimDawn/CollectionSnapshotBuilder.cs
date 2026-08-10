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
