using System.Security.Cryptography;
using IAGrim.Parser.Stash;
using IAGrim.StashFile;

namespace CairnCodex.GrimDawn;

internal static class TransferStashSerializer
{
    public static TransferStashRoundTripResult ValidateRoundTrip(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var fullPath = Path.GetFullPath(path);
        var sourceBytes = File.ReadAllBytes(fullPath);
        var source = Parse(sourceBytes);
        var serializedBytes = Serialize(source);
        var reparsed = Parse(serializedBytes);
        var secondSerialization = Serialize(reparsed);

        var semanticallyEquivalent = AreEquivalent(source, reparsed);
        var idempotent = serializedBytes.AsSpan().SequenceEqual(secondSerialization);
        if (!semanticallyEquivalent || !idempotent)
        {
            throw new InvalidDataException(
                $"Transfer stash v{source.Version} did not pass semantic and idempotent round-trip validation.");
        }

        return new TransferStashRoundTripResult(
            fullPath,
            source.Version,
            source.Tabs.Count,
            source.Tabs.Sum(tab => tab.Items.Count),
            sourceBytes.Length,
            serializedBytes.Length,
            Convert.ToHexStringLower(SHA256.HashData(sourceBytes)),
            Convert.ToHexStringLower(SHA256.HashData(serializedBytes)),
            sourceBytes.AsSpan().SequenceEqual(serializedBytes),
            BitConverter.ToUInt32(sourceBytes) != GDCryptoDataBuffer.XOR_KEY,
            semanticallyEquivalent,
            idempotent);
    }

    public static byte[] Serialize(Stash stash)
    {
        var buffer = new DataBuffer();
        stash.Write(buffer);
        return buffer.Data.AsSpan(0, buffer.Length).ToArray();
    }

    internal static Stash Parse(byte[] bytes)
    {
        var stash = new Stash();
        if (!stash.Read(new GDCryptoDataBuffer(bytes)))
        {
            throw new InvalidDataException(stash.LastError ?? "Transfer stash could not be parsed.");
        }
        return stash;
    }

    internal static bool AreEquivalent(Stash left, Stash right)
    {
        if (left.Unknown1 != right.Unknown1 ||
            left.Unknown2 != right.Unknown2 ||
            left.Version != right.Version ||
            left.ModLabel != right.ModLabel ||
            left.IsExpansion1 != right.IsExpansion1 ||
            left.Tabs.Count != right.Tabs.Count)
        {
            return false;
        }

        for (var tabIndex = 0; tabIndex < left.Tabs.Count; tabIndex++)
        {
            var leftTab = left.Tabs[tabIndex];
            var rightTab = right.Tabs[tabIndex];
            if (leftTab.Width != rightTab.Width ||
                leftTab.Height != rightTab.Height ||
                leftTab.Items.Count != rightTab.Items.Count)
            {
                return false;
            }

            for (var itemIndex = 0; itemIndex < leftTab.Items.Count; itemIndex++)
            {
                if (!AreEquivalent(leftTab.Items[itemIndex], rightTab.Items[itemIndex]))
                {
                    return false;
                }
            }
        }

        return true;
    }

    internal static bool AreEquivalent(Item left, Item right) =>
        left.BaseRecord == right.BaseRecord &&
        left.PrefixRecord == right.PrefixRecord &&
        left.SuffixRecord == right.SuffixRecord &&
        left.ModifierRecord == right.ModifierRecord &&
        left.TransmuteRecord == right.TransmuteRecord &&
        left.Seed == right.Seed &&
        left.MateriaRecord == right.MateriaRecord &&
        left.RelicCompletionBonusRecord == right.RelicCompletionBonusRecord &&
        left.RelicSeed == right.RelicSeed &&
        left.EnchantmentRecord == right.EnchantmentRecord &&
        left.AscendantRecord == right.AscendantRecord &&
        left.AscendantRecord2H == right.AscendantRecord2H &&
        left.UNKNOWN == right.UNKNOWN &&
        left.EnchantmentSeed == right.EnchantmentSeed &&
        left.MateriaCombines == right.MateriaCombines &&
        left.StackCount == right.StackCount &&
        left.Rerolls == right.Rerolls &&
        left.AffixRerolls == right.AffixRerolls &&
        left.XOffset == right.XOffset &&
        left.YOffset == right.YOffset;
}

internal sealed record ValidateTransferStashRoundTripRequest(string Path);

internal sealed record TransferStashRoundTripResult(
    string Path,
    uint Version,
    int TabCount,
    int ItemCount,
    int SourceBytes,
    int SerializedBytes,
    string SourceSha256,
    string SerializedSha256,
    bool ByteIdentical,
    bool SourceWasEncrypted,
    bool SemanticallyEquivalent,
    bool Idempotent);
