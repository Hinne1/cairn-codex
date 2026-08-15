using System.Text;
using System.Text.RegularExpressions;

namespace CairnCodex.GrimDawn;

internal static partial class FormulaSaveScanner
{
    private static readonly string[] FormulaFileNames =
    [
        "formulas.gst", "formulas.gsh",
        "formulas.bst", "formulas.bsh",
        "formulas.cst", "formulas.csh",
        "formulas.dst", "formulas.dsh"
    ];

    public static KnownFormulaIndex Scan(GrimDawnDiscoveryResult discovery)
    {
        var softcore = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var hardcore = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var files = new List<KnownFormulaFile>();

        foreach (var saveLocation in discovery.SaveLocations)
        {
            foreach (var directory in new[] { saveLocation.Path }
                         .Concat(Directory.EnumerateDirectories(saveLocation.Path)))
            {
                foreach (var fileName in FormulaFileNames)
                {
                    var path = Path.Combine(directory, fileName);
                    if (!File.Exists(path)) continue;
                    var isHardcore = fileName.EndsWith("h", StringComparison.OrdinalIgnoreCase);
                    var records = ScanFile(path);
                    (isHardcore ? hardcore : softcore).UnionWith(records);
                    files.Add(new KnownFormulaFile(
                        Path.GetFullPath(path),
                        isHardcore,
                        records.Count,
                        File.GetLastWriteTimeUtc(path)));
                }
            }
        }

        return new KnownFormulaIndex(softcore, hardcore, files);
    }

    internal static IReadOnlySet<string> ScanFile(string path)
    {
        // Formula saves are plaintext GD blocks. Their surrounding integer fields
        // can change independently of the useful payload, so extracting the DBR
        // tokens is both stricter and more version-tolerant than decoding the block.
        var text = Encoding.Latin1.GetString(File.ReadAllBytes(path));
        return FormulaRecordRegex().Matches(text)
            .Select(match => match.Value.Replace('\\', '/'))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    [GeneratedRegex(@"records[/\\][A-Za-z0-9_./\\-]+?\.dbr", RegexOptions.IgnoreCase)]
    private static partial Regex FormulaRecordRegex();
}

internal sealed record KnownFormulaIndex(
    IReadOnlySet<string> SoftcoreRecords,
    IReadOnlySet<string> HardcoreRecords,
    IReadOnlyList<KnownFormulaFile> Files);

internal sealed record KnownFormulaFile(
    string Path,
    bool IsHardcore,
    int RecordCount,
    DateTime LastWriteUtc);
