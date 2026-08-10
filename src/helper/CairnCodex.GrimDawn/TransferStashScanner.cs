using System.Security.Cryptography;
using IAGrim.StashFile;

namespace CairnCodex.GrimDawn;

internal static class TransferStashScanner
{
    private const long MaximumStashBytes = 256L * 1024L * 1024L;

    public static TransferStashScanResult Scan(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new ArgumentException("A transfer stash path is required.", nameof(path));
        }

        var fullPath = Path.GetFullPath(path);
        var before = new FileInfo(fullPath);
        if (!before.Exists)
        {
            throw new FileNotFoundException("Transfer stash was not found.", fullPath);
        }

        if (before.Length > MaximumStashBytes)
        {
            throw new InvalidDataException($"Transfer stash exceeds the {MaximumStashBytes} byte safety limit.");
        }

        byte[] bytes;
        using (var stream = new FileStream(
            fullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete))
        {
            bytes = new byte[stream.Length];
            stream.ReadExactly(bytes);
        }

        var after = new FileInfo(fullPath);
        if (before.Length != after.Length || before.LastWriteTimeUtc != after.LastWriteTimeUtc)
        {
            throw new IOException("Transfer stash changed while it was being read; scan discarded.");
        }

        var crypto = new GDCryptoDataBuffer(bytes);
        var stash = new Stash();
        if (!stash.Read(crypto))
        {
            throw new InvalidDataException(stash.LastError ?? "Transfer stash could not be parsed.");
        }

        var tabs = stash.Tabs.Select((tab, tabIndex) => new TransferStashTab(
            tabIndex,
            tab.Width,
            tab.Height,
            tab.Items.Select((item, itemIndex) => new TransferStashItem(
                tabIndex,
                itemIndex,
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
                item.YOffset)).ToArray())).ToArray();

        return new TransferStashScanResult(
            fullPath,
            after.Length,
            Convert.ToHexStringLower(SHA256.HashData(bytes)),
            after.LastWriteTimeUtc,
            stash.Version,
            stash.ModLabel,
            stash.IsExpansion1,
            IsHardcorePath(fullPath),
            tabs,
            tabs.Sum(tab => tab.Items.Count));
    }

    private static bool IsHardcorePath(string path)
    {
        var extension = Path.GetExtension(path);
        return extension.EndsWith("h", StringComparison.OrdinalIgnoreCase);
    }
}

internal sealed record ScanTransferStashRequest(string Path);

internal sealed record TransferStashScanResult(
    string Path,
    long FileSize,
    string Sha256,
    DateTime LastWriteUtc,
    uint Version,
    string ModLabel,
    bool IsExpansion1,
    bool IsHardcore,
    IReadOnlyList<TransferStashTab> Tabs,
    int ItemCount);

internal sealed record TransferStashTab(
    int Index,
    uint Width,
    uint Height,
    IReadOnlyList<TransferStashItem> Items);

internal sealed record TransferStashItem(
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
    uint Unknown,
    uint EnchantmentSeed,
    uint MateriaCombines,
    uint StackCount,
    uint Rerolls,
    uint AffixRerolls,
    uint XOffset,
    uint YOffset);
