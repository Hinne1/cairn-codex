using System.Security.Cryptography;
using IAGrim.Parser.Stash;

namespace CairnCodex.GrimDawn;

internal static class IngestPlanner
{
    public static IngestPlanValidation Validate(string path, int tabIndex, int itemIndex)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var fullPath = Path.GetFullPath(path);
        var sourceBytes = File.ReadAllBytes(fullPath);
        var sourceHash = Convert.ToHexStringLower(SHA256.HashData(sourceBytes));
        var stash = TransferStashSerializer.Parse(sourceBytes);
        if (tabIndex < 0 || tabIndex >= stash.Tabs.Count)
        {
            throw new ArgumentOutOfRangeException(nameof(tabIndex), "Ingest tab index is outside the stash.");
        }

        var tab = stash.Tabs[tabIndex];
        if (itemIndex < 0 || itemIndex >= tab.Items.Count)
        {
            throw new ArgumentOutOfRangeException(nameof(itemIndex), "Ingest item index is outside the tab.");
        }

        var sourceItemCount = stash.Tabs.Sum(candidate => candidate.Items.Count);
        var selected = tab.Items[itemIndex];
        var payload = VaultItemPayload.From(stash.Version, selected);
        tab.Items.RemoveAt(itemIndex);

        var replacementBytes = TransferStashSerializer.Serialize(stash);
        var replacement = TransferStashSerializer.Parse(replacementBytes);
        var replacementItemCount = replacement.Tabs.Sum(candidate => candidate.Items.Count);
        var semanticallyValid =
            replacementItemCount == sourceItemCount - 1 &&
            TransferStashSerializer.AreEquivalent(stash, replacement);
        var secondSerialization = TransferStashSerializer.Serialize(replacement);
        var idempotent = replacementBytes.AsSpan().SequenceEqual(secondSerialization);
        if (!semanticallyValid || !idempotent)
        {
            throw new InvalidDataException("Proposed ingest replacement failed validation.");
        }

        return new IngestPlanValidation(
            fullPath,
            sourceHash,
            stash.Version,
            tabIndex,
            itemIndex,
            sourceItemCount,
            replacementItemCount,
            replacementBytes.Length,
            Convert.ToHexStringLower(SHA256.HashData(replacementBytes)),
            payload,
            semanticallyValid,
            idempotent);
    }
}

internal sealed record ValidateIngestPlanRequest(string Path, int TabIndex, int ItemIndex);

internal sealed record IngestPlanValidation(
    string Path,
    string SourceSha256,
    uint StashVersion,
    int TabIndex,
    int ItemIndex,
    int SourceItemCount,
    int ReplacementItemCount,
    int ReplacementBytes,
    string ReplacementSha256,
    VaultItemPayload Item,
    bool SemanticallyValid,
    bool Idempotent);

internal sealed record VaultItemPayload(
    uint StashVersion,
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
    public static VaultItemPayload From(uint stashVersion, Item item) =>
        new(
            stashVersion,
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
}
