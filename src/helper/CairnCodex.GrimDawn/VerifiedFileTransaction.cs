using System.Security.Cryptography;

namespace CairnCodex.GrimDawn;

internal static class VerifiedFileTransaction
{
    public static VerifiedFileTransactionResult Replace(
        string operationId,
        string targetPath,
        string expectedSourceSha256,
        ReadOnlySpan<byte> replacement,
        string backupDirectory,
        Action<string> validateReplacement,
        bool enforceProcessGate = true)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(operationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(targetPath);
        ArgumentException.ThrowIfNullOrWhiteSpace(expectedSourceSha256);
        ArgumentException.ThrowIfNullOrWhiteSpace(backupDirectory);
        ArgumentNullException.ThrowIfNull(validateReplacement);

        if (enforceProcessGate)
        {
            WriteSafetyGate.DemandPermit();
        }

        var target = Path.GetFullPath(targetPath);
        var targetDirectory = Path.GetDirectoryName(target)
            ?? throw new ArgumentException("Target must have a parent directory.", nameof(targetPath));
        var sourceHash = HashFile(target);
        if (!sourceHash.Equals(expectedSourceSha256, StringComparison.OrdinalIgnoreCase))
        {
            throw new SourceChangedException(
                $"Source hash changed before write. Expected {expectedSourceSha256}, found {sourceHash}.");
        }

        var backupRoot = Path.GetFullPath(backupDirectory);
        Directory.CreateDirectory(backupRoot);
        var timestamp = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffffffZ");
        var backupPath = Path.Combine(
            backupRoot,
            $"{Path.GetFileName(target)}.{timestamp}.{sourceHash[..12]}.bak");
        var temporaryPath = Path.Combine(targetDirectory, $".cairn-codex.{operationId}.tmp");
        var rollbackPath = Path.Combine(targetDirectory, $".cairn-codex.{operationId}.rollback");

        try
        {
            CopyDurably(target, backupPath);
            if (!HashFile(backupPath).Equals(sourceHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("Durable backup hash does not match the source.");
            }

            WriteDurablyNew(temporaryPath, replacement);
            validateReplacement(temporaryPath);
            var replacementHash = HashFile(temporaryPath);

            var sourceHashAtCommit = HashFile(target);
            if (!sourceHashAtCommit.Equals(sourceHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new SourceChangedException(
                    $"Source hash changed during write preparation. Expected {sourceHash}, found {sourceHashAtCommit}.");
            }

            File.Replace(temporaryPath, target, rollbackPath, ignoreMetadataErrors: false);
            var committedHash = HashFile(target);
            if (!committedHash.Equals(replacementHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("Committed target hash does not match the validated replacement.");
            }

            return new VerifiedFileTransactionResult(
                operationId,
                target,
                sourceHash,
                committedHash,
                backupPath,
                rollbackPath);
        }
        finally
        {
            DeleteIfExists(temporaryPath);
        }
    }

    public static string HashFile(string path)
    {
        using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }

    private static void CopyDurably(string source, string destination)
    {
        using var input = new FileStream(
            source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var output = new FileStream(
            destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024,
            FileOptions.WriteThrough);
        input.CopyTo(output);
        output.Flush(flushToDisk: true);
    }

    private static void WriteDurablyNew(string path, ReadOnlySpan<byte> bytes)
    {
        using var output = new FileStream(
            path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024,
            FileOptions.WriteThrough);
        output.Write(bytes);
        output.Flush(flushToDisk: true);
    }

    private static void DeleteIfExists(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (FileNotFoundException)
        {
        }
    }
}

internal sealed record VerifiedFileTransactionResult(
    string OperationId,
    string TargetPath,
    string SourceSha256,
    string CommittedSha256,
    string BackupPath,
    string RollbackPath);

internal sealed class SourceChangedException(string message) : IOException(message);
