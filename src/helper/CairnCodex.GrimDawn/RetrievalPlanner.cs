using System.Security.Cryptography;
using IAGrim.Parser.Stash;
using IAGrim.StashFile;

namespace CairnCodex.GrimDawn;

internal static class RetrievalPlanner
{
    public static IngestRetrievalRoundTripValidation ValidateInMemoryRoundTrip(
        string path,
        int tabIndex,
        int itemIndex)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var fullPath = Path.GetFullPath(path);
        var sourceBytes = ReadShared(fullPath);
        var original = TransferStashSerializer.Parse(sourceBytes);
        var working = TransferStashSerializer.Parse(sourceBytes);
        if (tabIndex < 0 || tabIndex >= working.Tabs.Count)
        {
            throw new ArgumentOutOfRangeException(nameof(tabIndex));
        }
        if (itemIndex < 0 || itemIndex >= working.Tabs[tabIndex].Items.Count)
        {
            throw new ArgumentOutOfRangeException(nameof(itemIndex));
        }

        var sourceCount = working.Tabs.Sum(tab => tab.Items.Count);
        var selector = new IngestItemSelector(tabIndex, itemIndex);
        var payload = VaultItemPayload.From(working.Version, selector, working.Tabs[tabIndex].Items[itemIndex]);
        working.Tabs[tabIndex].Items.RemoveAt(itemIndex);
        var ingestedBytes = TransferStashSerializer.Serialize(working);
        var ingested = TransferStashSerializer.Parse(ingestedBytes);
        if (ingested.Tabs.Sum(tab => tab.Items.Count) != sourceCount - 1 ||
            !TransferStashSerializer.AreEquivalent(working, ingested))
        {
            throw new InvalidDataException("In-memory ingest stage failed before retrieval validation.");
        }

        ingested.Tabs[tabIndex].Items.Insert(itemIndex, payload.ToItem(ingested.Version));
        var restoredBytes = TransferStashSerializer.Serialize(ingested);
        var restored = TransferStashSerializer.Parse(restoredBytes);
        var semanticRoundTrip = TransferStashSerializer.AreEquivalent(original, restored);
        var idempotent = restoredBytes.AsSpan().SequenceEqual(TransferStashSerializer.Serialize(restored));
        if (!semanticRoundTrip || !idempotent)
        {
            throw new InvalidDataException("In-memory ingest/retrieval roundtrip failed validation.");
        }

        return new IngestRetrievalRoundTripValidation(
            fullPath,
            original.Version,
            tabIndex,
            itemIndex,
            payload.BaseRecord,
            payload.Seed,
            sourceCount,
            restored.Tabs.Sum(tab => tab.Items.Count),
            semanticRoundTrip,
            idempotent);
    }

    public static RetrievalPlanValidation Plan(
        string path,
        int targetTabIndex,
        IReadOnlyList<VaultItemPayload> items) =>
        Prepare(path, targetTabIndex, items).Public;

    public static CommittedRetrievalResult Commit(
        string operationId,
        string path,
        string expectedSourceSha256,
        int targetTabIndex,
        IReadOnlyList<VaultItemPayload> items,
        string backupDirectory)
    {
        var prepared = Prepare(path, targetTabIndex, items);
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
                    throw new InvalidDataException("Replacement stash failed the retrieval plan validator.");
                }
            });

        return new CommittedRetrievalResult(prepared.Public, transaction);
    }

    private static PreparedRetrievalPlan Prepare(
        string path,
        int targetTabIndex,
        IReadOnlyList<VaultItemPayload> payloads)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        if (payloads.Count == 0)
        {
            throw new ArgumentException("At least one vault item is required.", nameof(payloads));
        }

        var fullPath = Path.GetFullPath(path);
        var before = new FileInfo(fullPath);
        var sourceBytes = ReadShared(fullPath);
        var after = new FileInfo(fullPath);
        if (before.Length != after.Length || before.LastWriteTimeUtc != after.LastWriteTimeUtc)
        {
            throw new IOException("Transfer stash changed while the retrieval plan was being read.");
        }

        var sourceHash = Convert.ToHexStringLower(SHA256.HashData(sourceBytes));
        var stash = TransferStashSerializer.Parse(sourceBytes);
        if (targetTabIndex < 0 || targetTabIndex >= stash.Tabs.Count)
        {
            throw new ArgumentOutOfRangeException(
                nameof(targetTabIndex), $"Target tab index {targetTabIndex} is outside the stash.");
        }

        var target = stash.Tabs[targetTabIndex];
        if (target.Items.Count != 0)
        {
            throw new InvalidDataException(
                $"Target tab {targetTabIndex} must be empty for the first retrieval milestone.");
        }

        var sourceItemCount = stash.Tabs.Sum(candidate => candidate.Items.Count);
        var restored = payloads.Select(payload => payload.ToItem(stash.Version)).ToArray();
        target.Items.AddRange(restored);

        var replacementBytes = TransferStashSerializer.Serialize(stash);
        var replacement = TransferStashSerializer.Parse(replacementBytes);
        var replacementItemCount = replacement.Tabs.Sum(candidate => candidate.Items.Count);
        var replacementTarget = replacement.Tabs[targetTabIndex];
        var restoredExactly =
            replacementTarget.Items.Count == restored.Length &&
            restored.Zip(replacementTarget.Items, TransferStashSerializer.AreEquivalent).All(equal => equal);
        var semanticallyValid =
            replacementItemCount == sourceItemCount + payloads.Count &&
            restoredExactly &&
            TransferStashSerializer.AreEquivalent(stash, replacement);
        var secondSerialization = TransferStashSerializer.Serialize(replacement);
        var idempotent = replacementBytes.AsSpan().SequenceEqual(secondSerialization);
        if (!semanticallyValid || !idempotent)
        {
            throw new InvalidDataException("Proposed retrieval replacement failed validation.");
        }

        var publicPlan = new RetrievalPlanValidation(
            fullPath,
            sourceHash,
            stash.Version,
            targetTabIndex,
            sourceItemCount,
            replacementItemCount,
            replacementBytes.Length,
            Convert.ToHexStringLower(SHA256.HashData(replacementBytes)),
            payloads.Select(payload => new RetrievalItemSummary(payload.BaseRecord, payload.Seed)).ToArray(),
            restoredExactly,
            semanticallyValid,
            idempotent);
        return new PreparedRetrievalPlan(publicPlan, stash, replacementBytes);
    }

    private static byte[] ReadShared(string path)
    {
        using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var bytes = new byte[stream.Length];
        stream.ReadExactly(bytes);
        return bytes;
    }

    private sealed record PreparedRetrievalPlan(
        RetrievalPlanValidation Public,
        Stash ReplacementStash,
        byte[] ReplacementBytes);
}

internal sealed record PlanRetrieveItemsRequest(
    string Path,
    int TargetTabIndex,
    IReadOnlyList<VaultItemPayload> Items);

internal sealed record ValidateIngestRetrievalRoundTripRequest(
    string Path,
    int TabIndex,
    int ItemIndex);

internal sealed record CommitRetrieveItemsRequest(
    string OperationId,
    string Path,
    string ExpectedSourceSha256,
    int TargetTabIndex,
    IReadOnlyList<VaultItemPayload> Items,
    string BackupDirectory);

internal sealed record RetrievalItemSummary(string BaseRecord, uint Seed);

internal sealed record RetrievalPlanValidation(
    string Path,
    string SourceSha256,
    uint StashVersion,
    int TargetTabIndex,
    int SourceItemCount,
    int ReplacementItemCount,
    int ReplacementBytes,
    string ReplacementSha256,
    IReadOnlyList<RetrievalItemSummary> Items,
    bool RestoredExactly,
    bool SemanticallyValid,
    bool Idempotent);

internal sealed record CommittedRetrievalResult(
    RetrievalPlanValidation Plan,
    VerifiedFileTransactionResult Transaction);

internal sealed record IngestRetrievalRoundTripValidation(
    string Path,
    uint StashVersion,
    int TabIndex,
    int ItemIndex,
    string BaseRecord,
    uint Seed,
    int SourceItemCount,
    int RestoredItemCount,
    bool SemanticallyEquivalent,
    bool Idempotent);
