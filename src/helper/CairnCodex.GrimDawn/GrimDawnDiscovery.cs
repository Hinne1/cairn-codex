using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace CairnCodex.GrimDawn;

internal static partial class GrimDawnDiscovery
{
    private static readonly string[] TransferFileNames =
    [
        "transfer.gst",
        "transfer.gsh",
        "transfer.bst",
        "transfer.bsh",
        "transfer.cst",
        "transfer.csh",
        "transfer.dst",
        "transfer.dsh"
    ];

    public static GrimDawnDiscoveryResult Discover()
    {
        var steamRoots = FindSteamRoots().ToArray();
        var installations = FindInstallations(steamRoots)
            .DistinctBy(candidate => candidate.Path, StringComparer.OrdinalIgnoreCase)
            .OrderBy(candidate => candidate.Path, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var saves = FindSaveLocations(steamRoots)
            .DistinctBy(candidate => candidate.Path, StringComparer.OrdinalIgnoreCase)
            .OrderBy(candidate => candidate.Path, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new GrimDawnDiscoveryResult(installations, saves);
    }

    private static IEnumerable<GrimDawnInstallation> FindInstallations(IEnumerable<string> steamRoots)
    {
        foreach (var root in steamRoots)
        {
            foreach (var library in FindSteamLibraries(root))
            {
                var path = Path.Combine(library, "steamapps", "common", "Grim Dawn");
                if (TryCreateInstallation(path, "steam", out var installation))
                {
                    yield return installation;
                }
            }
        }

        foreach (var path in FindGogInstallations())
        {
            if (TryCreateInstallation(path, "gog", out var installation))
            {
                yield return installation;
            }
        }
    }

    private static bool TryCreateInstallation(
        string path,
        string source,
        out GrimDawnInstallation installation)
    {
        var fullPath = Path.GetFullPath(path);
        var databasePath = Path.Combine(fullPath, "database", "database.arz");
        installation = new GrimDawnInstallation(fullPath, source, databasePath);
        return File.Exists(databasePath);
    }

    private static IEnumerable<GrimDawnSaveLocation> FindSaveLocations(IEnumerable<string> steamRoots)
    {
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        if (!string.IsNullOrWhiteSpace(documents))
        {
            var localSave = Path.Combine(documents, "My Games", "Grim Dawn", "save");
            if (TryCreateSaveLocation(localSave, "documents", out var location))
            {
                yield return location;
            }
        }

        foreach (var steamRoot in steamRoots)
        {
            var userdata = Path.Combine(steamRoot, "userdata");
            if (!Directory.Exists(userdata))
            {
                continue;
            }

            foreach (var userDirectory in Directory.EnumerateDirectories(userdata))
            {
                var cloudSave = Path.Combine(userDirectory, "219990", "remote", "save");
                if (TryCreateSaveLocation(cloudSave, "steam-cloud", out var location))
                {
                    yield return location;
                }
            }
        }
    }

    private static bool TryCreateSaveLocation(
        string path,
        string source,
        out GrimDawnSaveLocation location)
    {
        location = new GrimDawnSaveLocation(string.Empty, source, []);
        if (!Directory.Exists(path))
        {
            return false;
        }

        var candidates = new List<TransferStashCandidate>();
        foreach (var directory in new[] { path }.Concat(Directory.EnumerateDirectories(path)))
        {
            foreach (var fileName in TransferFileNames)
            {
                var filePath = Path.Combine(directory, fileName);
                if (!File.Exists(filePath))
                {
                    continue;
                }

                try
                {
                    var scan = TransferStashScanner.Scan(filePath);
                    candidates.Add(new TransferStashCandidate(
                        scan.Path,
                        scan.Version,
                        scan.IsHardcore,
                        scan.ModLabel,
                        scan.Tabs.Count,
                        scan.ItemCount,
                        scan.FileSize,
                        scan.LastWriteUtc,
                        null));
                }
                catch (Exception exception) when (
                    exception is ArgumentException or IOException or InvalidDataException or UnauthorizedAccessException)
                {
                    var info = new FileInfo(filePath);
                    candidates.Add(new TransferStashCandidate(
                        Path.GetFullPath(filePath),
                        null,
                        fileName.EndsWith("h", StringComparison.OrdinalIgnoreCase),
                        null,
                        null,
                        null,
                        info.Exists ? info.Length : null,
                        info.Exists ? info.LastWriteTimeUtc : null,
                        exception.Message));
                }
            }
        }

        if (candidates.Count == 0)
        {
            return false;
        }

        location = new GrimDawnSaveLocation(
            Path.GetFullPath(path),
            source,
            candidates.OrderBy(candidate => candidate.Path, StringComparer.OrdinalIgnoreCase).ToArray());
        return true;
    }

    private static IEnumerable<string> FindSteamRoots()
    {
        var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
        {
            if (key?.GetValue("SteamPath") is string registryPath)
            {
                candidates.Add(registryPath);
            }
        }

        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        if (!string.IsNullOrWhiteSpace(programFilesX86))
        {
            candidates.Add(Path.Combine(programFilesX86, "Steam"));
        }

        return candidates.Where(Directory.Exists).Select(Path.GetFullPath);
    }

    private static IEnumerable<string> FindSteamLibraries(string steamRoot)
    {
        yield return steamRoot;

        var vdfPath = Path.Combine(steamRoot, "steamapps", "libraryfolders.vdf");
        if (!File.Exists(vdfPath))
        {
            yield break;
        }

        var content = File.ReadAllText(vdfPath);
        foreach (Match match in SteamLibraryPathRegex().Matches(content))
        {
            var path = match.Groups["path"].Value.Replace("\\\\", "\\");
            if (Directory.Exists(path))
            {
                yield return Path.GetFullPath(path);
            }
        }
    }

    private static IEnumerable<string> FindGogInstallations()
    {
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
            using var games = machine.OpenSubKey(@"SOFTWARE\GOG.com\Games");
            if (games is null)
            {
                continue;
            }

            foreach (var name in games.GetSubKeyNames())
            {
                using var game = games.OpenSubKey(name);
                if (game?.GetValue("PATH") is string path)
                {
                    yield return path;
                }
            }
        }
    }

    [GeneratedRegex("\\\"path\\\"\\s+\\\"(?<path>[^\\\"]+)\\\"", RegexOptions.IgnoreCase)]
    private static partial Regex SteamLibraryPathRegex();
}

internal sealed record GrimDawnDiscoveryResult(
    IReadOnlyList<GrimDawnInstallation> Installations,
    IReadOnlyList<GrimDawnSaveLocation> SaveLocations);

internal sealed record GrimDawnInstallation(string Path, string Source, string DatabasePath);

internal sealed record GrimDawnSaveLocation(
    string Path,
    string Source,
    IReadOnlyList<TransferStashCandidate> TransferStashes);

internal sealed record TransferStashCandidate(
    string Path,
    uint? Version,
    bool IsHardcore,
    string? ModLabel,
    int? TabCount,
    int? ItemCount,
    long? FileSize,
    DateTime? LastWriteUtc,
    string? Error);
