using System.Security.Cryptography;
using System.Text;
using CairnCodex.GrimDawn.Gdia.GameData;

namespace CairnCodex.GrimDawn;

internal static class ItemIconExtractor
{
    public static ItemIconExtractionResult Extract(
        string installationPath,
        string outputDirectory,
        IReadOnlyList<string> bitmaps)
    {
        var root = Path.GetFullPath(installationPath);
        var destination = Path.GetFullPath(outputDirectory);
        Directory.CreateDirectory(destination);
        var requested = bitmaps
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(NormalizePath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var unresolved = requested.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var textures = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        var icons = new List<ExtractedItemIcon>(requested.Length);

        foreach (var bitmap in requested)
        {
            var key = IconKey(bitmap);
            if (!File.Exists(Path.Combine(destination, key + ".png"))) continue;
            icons.Add(new ExtractedItemIcon(bitmap, key));
            unresolved.Remove(bitmap);
        }

        foreach (var archive in FindItemArchives(root))
        {
            if (unresolved.Count == 0) break;
            foreach (var pair in ArcArchiveReader.ReadFiles(archive, unresolved))
            {
                textures[pair.Key] = pair.Value;
                unresolved.Remove(pair.Key);
            }
            if (unresolved.Count == 0) break;
        }

        var failures = new List<ItemIconFailure>();
        foreach (var bitmap in textures.Keys.OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
        {
            var texture = textures[bitmap];
            var key = IconKey(bitmap);
            var path = Path.Combine(destination, key + ".png");
            try
            {
                if (!File.Exists(path)) TexImageDecoder.SavePng(texture, path);
                icons.Add(new ExtractedItemIcon(bitmap, key));
            }
            catch (Exception error) when (error is ArgumentException or IOException or InvalidDataException)
            {
                failures.Add(new ItemIconFailure(bitmap, error.Message));
            }
        }

        return new ItemIconExtractionResult(
            icons,
            unresolved.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray(),
            failures);
    }

    private static string IconKey(string bitmap) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(bitmap)));

    private static IEnumerable<string> FindItemArchives(string root)
    {
        for (var index = 9; index >= 1; index--)
        {
            var path = Path.Combine(root, $"gdx{index}", "resources", "Items.arc");
            if (File.Exists(path)) yield return path;
        }
        var basePath = Path.Combine(root, "resources", "Items.arc");
        if (File.Exists(basePath)) yield return basePath;
    }

    private static string NormalizePath(string value) => value.Replace('\\', '/').TrimStart('/');
}

internal sealed record ExtractItemIconsRequest(
    string InstallationPath,
    string OutputDirectory,
    IReadOnlyList<string> Bitmaps);
internal sealed record ItemIconExtractionResult(
    IReadOnlyList<ExtractedItemIcon> Icons,
    IReadOnlyList<string> Missing,
    IReadOnlyList<ItemIconFailure> Failures);
internal sealed record ExtractedItemIcon(string Bitmap, string Key);
internal sealed record ItemIconFailure(string Bitmap, string Error);
