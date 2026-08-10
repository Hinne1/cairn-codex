using System.Security.Cryptography;

namespace CairnCodex.GrimDawn;

internal static class WriteTransactionSelfTest
{
    public static WriteTransactionSelfTestResult Run()
    {
        var root = Path.Combine(Path.GetTempPath(), $"cairn-codex-write-test-{Guid.NewGuid():N}");
        var backupDirectory = Path.Combine(root, "backups");
        var target = Path.Combine(root, "transfer.fixture");
        Directory.CreateDirectory(root);

        try
        {
            var source = RandomNumberGenerator.GetBytes(4096);
            var replacement = RandomNumberGenerator.GetBytes(6144);
            File.WriteAllBytes(target, source);
            var sourceHash = VerifiedFileTransaction.HashFile(target);
            var result = VerifiedFileTransaction.Replace(
                Guid.NewGuid().ToString("N"),
                target,
                sourceHash,
                replacement,
                backupDirectory,
                path =>
                {
                    if (!File.ReadAllBytes(path).AsSpan().SequenceEqual(replacement))
                    {
                        throw new InvalidDataException("Replacement validator rejected the fixture.");
                    }
                },
                enforceProcessGate: false);

            var backupMatches = File.ReadAllBytes(result.BackupPath).AsSpan().SequenceEqual(source);
            var targetMatches = File.ReadAllBytes(target).AsSpan().SequenceEqual(replacement);
            var rollbackMatches =
                File.ReadAllBytes(result.RollbackPath).AsSpan().SequenceEqual(source);
            if (!backupMatches || !targetMatches || !rollbackMatches)
            {
                throw new InvalidDataException("Verified write transaction did not preserve all expected bytes.");
            }

            var committedHash = VerifiedFileTransaction.HashFile(target);
            var staleSourceRejected = false;
            try
            {
                VerifiedFileTransaction.Replace(
                    Guid.NewGuid().ToString("N"),
                    target,
                    sourceHash,
                    RandomNumberGenerator.GetBytes(512),
                    backupDirectory,
                    _ => { },
                    enforceProcessGate: false);
            }
            catch (SourceChangedException)
            {
                staleSourceRejected = true;
            }

            var invalidReplacementRejected = false;
            try
            {
                VerifiedFileTransaction.Replace(
                    Guid.NewGuid().ToString("N"),
                    target,
                    committedHash,
                    RandomNumberGenerator.GetBytes(512),
                    backupDirectory,
                    _ => throw new InvalidDataException("Expected validator rejection."),
                    enforceProcessGate: false);
            }
            catch (InvalidDataException exception) when (exception.Message == "Expected validator rejection.")
            {
                invalidReplacementRejected = true;
            }

            if (!staleSourceRejected || !invalidReplacementRejected ||
                !VerifiedFileTransaction.HashFile(target).Equals(committedHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("Verified write transaction accepted an unsafe negative case.");
            }

            return new WriteTransactionSelfTestResult(
                true,
                source.Length,
                replacement.Length,
                sourceHash,
                result.CommittedSha256,
                backupMatches,
                rollbackMatches,
                staleSourceRejected,
                invalidReplacementRejected);
        }
        finally
        {
            if (Directory.Exists(root) &&
                Path.GetFileName(root).StartsWith("cairn-codex-write-test-", StringComparison.Ordinal))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }
}

internal sealed record WriteTransactionSelfTestResult(
    bool Passed,
    int SourceBytes,
    int ReplacementBytes,
    string SourceSha256,
    string ReplacementSha256,
    bool BackupVerified,
    bool RollbackVerified,
    bool StaleSourceRejected,
    bool InvalidReplacementRejected);
