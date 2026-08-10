using System.Security.Cryptography;
using IAGrim.Parser.Stash;
using IAGrim.StashFile;

namespace CairnCodex.GrimDawn;

internal static class IngestPlanner
{
    public static IngestPlanValidation Validate(string path, int tabIndex, int itemIndex) =>
        Prepare(path, [new IngestItemSelector(tabIndex, itemIndex)]).Public;

    public static IngestPlanValidation Plan(string path, IReadOnlyList<IngestItemSelector> selectors) =>
        Prepare(path, selectors).Public;

    public static CommittedIngestResult Commit(
        string operationId,
        string path,
        string expectedSourceSha256,
        IReadOnlyList<IngestItemSelector> selectors,
        string backupDirectory)
    {
        var prepared = Prepare(path, selectors);
        if (!prepared.Public.SourceSha256.Equals(expectedSourceSha256, StringComparison.OrdinalIgnoreCase))
        {
            throw new SourceChangedException(
                $"Source hash changed after planning. Expected {expectedSourceSha256}, found {prepared.Public.SourceSha256}.");
        }

        var transaction = VerifiedFileTransaction.Replace(
            operationId,
            prepared.Public.Path,
            expectedSourceSha256,
            prepared.ReplacementBytes,
            backupDirectory,
            replacementPath =>
            {
                var replacement = TransferStashSerializer.Parse(File.ReadAllBytes(replacementPath));
                if (!TransferStashSerializer.AreEquivalent(prepared.ReplacementStash, replacement))
                {
                    throw new InvalidDataException("Replacement stash failed the ingest plan validator.");
                }
            });

        return new CommittedIngestResult(prepared.Public, transaction);
    }

    private static PreparedIngestPlan Prepare(
        string path,
        IReadOnlyList<IngestItemSelector> selectors)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        if (selectors.Count == 0)
        {
            throw new ArgumentException("At least one item selector is required.", nameof(selectors));
        }
        if (selectors.Distinct().Count() != selectors.Count)
        {
            throw new ArgumentException("Duplicate item selectors are not allowed.", nameof(selectors));
        }

        var fullPath = Path.GetFullPath(path);
        var before = new FileInfo(fullPath);
        var sourceBytes = ReadShared(fullPath);
        var after = new FileInfo(fullPath);
        if (before.Length != after.Length || before.LastWriteTimeUtc != after.LastWriteTimeUtc)
        {
            throw new IOException("Transfer stash changed while the ingest plan was being read.");
        }

        var sourceHash = Convert.ToHexStringLower(SHA256.HashData(sourceBytes));
        var stash = TransferStashSerializer.Parse(sourceBytes);
        var selected = new List<(IngestItemSelector Selector, Item Item)>();
        foreach (var selector in selectors)
        {
            if (selector.TabIndex < 0 || selector.TabIndex >= stash.Tabs.Count)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(selectors), $"Ingest tab index {selector.TabIndex} is outside the stash.");
            }
            var tab = stash.Tabs[selector.TabIndex];
            if (selector.ItemIndex < 0 || selector.ItemIndex >= tab.Items.Count)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(selectors),
                    $"Ingest item index {selector.ItemIndex} is outside tab {selector.TabIndex}.");
            }
            selected.Add((selector, tab.Items[selector.ItemIndex]));
        }

        var sourceItemCount = stash.Tabs.Sum(candidate => candidate.Items.Count);
        var payloads = selected
            .Select(entry => VaultItemPayload.From(stash.Version, entry.Selector, entry.Item))
            .ToArray();
        foreach (var entry in selected
                     .OrderByDescending(entry => entry.Selector.TabIndex)
                     .ThenByDescending(entry => entry.Selector.ItemIndex))
        {
            stash.Tabs[entry.Selector.TabIndex].Items.RemoveAt(entry.Selector.ItemIndex);
        }

        var replacementBytes = TransferStashSerializer.Serialize(stash);
        var replacement = TransferStashSerializer.Parse(replacementBytes);
        var replacementItemCount = replacement.Tabs.Sum(candidate => candidate.Items.Count);
        var semanticallyValid =
            replacementItemCount == sourceItemCount - selectors.Count &&
            TransferStashSerializer.AreEquivalent(stash, replacement);
        var secondSerialization = TransferStashSerializer.Serialize(replacement);
        var idempotent = replacementBytes.AsSpan().SequenceEqual(secondSerialization);
        if (!semanticallyValid || !idempotent)
        {
            throw new InvalidDataException("Proposed ingest replacement failed validation.");
        }

        var publicPlan = new IngestPlanValidation(
            fullPath,
            sourceHash,
            stash.Version,
            sourceItemCount,
            replacementItemCount,
            replacementBytes.Length,
            Convert.ToHexStringLower(SHA256.HashData(replacementBytes)),
            payloads,
            semanticallyValid,
            idempotent);
        return new PreparedIngestPlan(publicPlan, stash, replacementBytes);
    }

    private static byte[] ReadShared(string path)
    {
        using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var bytes = new byte[stream.Length];
        stream.ReadExactly(bytes);
        return bytes;
    }

    private sealed record PreparedIngestPlan(
        IngestPlanValidation Public,
        Stash ReplacementStash,
        byte[] ReplacementBytes);
}

internal sealed record IngestItemSelector(int TabIndex, int ItemIndex);

internal sealed record ValidateIngestPlanRequest(string Path, int TabIndex, int ItemIndex);

internal sealed record PlanIngestItemsRequest(
    string Path,
    IReadOnlyList<IngestItemSelector> Items);

internal sealed record CommitIngestItemsRequest(
    string OperationId,
    string Path,
    string ExpectedSourceSha256,
    IReadOnlyList<IngestItemSelector> Items,
    string BackupDirectory);

internal sealed record IngestPlanValidation(
    string Path,
    string SourceSha256,
    uint StashVersion,
    int SourceItemCount,
    int ReplacementItemCount,
    int ReplacementBytes,
    string ReplacementSha256,
    IReadOnlyList<VaultItemPayload> Items,
    bool SemanticallyValid,
    bool Idempotent);

internal sealed record CommittedIngestResult(
    IngestPlanValidation Plan,
    VerifiedFileTransactionResult Transaction);

internal sealed record VaultItemPayload(
    uint StashVersion,
    int SourceTabIndex,
    int SourceItemIndex,
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
    uint Unknown,
    uint EnchantmentSeed,
    uint MateriaCombines,
    uint StackCount,
    uint Rerolls,
    uint AffixRerolls,
    uint XOffset,
    uint YOffset)
{
    public static VaultItemPayload From(
        uint stashVersion,
        IngestItemSelector selector,
        Item item) =>
        new(
            stashVersion,
            selector.TabIndex,
            selector.ItemIndex,
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
            item.UNKNOWN,
            item.EnchantmentSeed,
            item.MateriaCombines,
            item.StackCount,
            item.Rerolls,
            item.AffixRerolls,
            item.XOffset,
            item.YOffset);

    public Item ToItem(uint targetStashVersion)
    {
        if (StashVersion != targetStashVersion)
        {
            throw new InvalidDataException(
                $"Vault item uses stash version {StashVersion}, but the target uses version {targetStashVersion}.");
        }

        return new Item(targetStashVersion)
        {
            BaseRecord = BaseRecord,
            PrefixRecord = PrefixRecord,
            SuffixRecord = SuffixRecord,
            ModifierRecord = ModifierRecord,
            TransmuteRecord = TransmuteRecord,
            Seed = Seed,
            MateriaRecord = MateriaRecord,
            RelicCompletionBonusRecord = RelicCompletionBonusRecord,
            RelicSeed = RelicSeed,
            EnchantmentRecord = EnchantmentRecord,
            AscendantRecord = AscendantRecord,
            AscendantRecord2H = AscendantRecord2H,
            UNKNOWN = Unknown,
            EnchantmentSeed = EnchantmentSeed,
            MateriaCombines = MateriaCombines,
            StackCount = StackCount,
            Rerolls = Rerolls,
            AffixRerolls = AffixRerolls,
            XOffset = XOffset,
            YOffset = YOffset
        };
    }
}
