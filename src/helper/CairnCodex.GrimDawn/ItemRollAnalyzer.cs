using GrimDawnItemStats;

namespace CairnCodex.GrimDawn;

internal static class ItemRollAnalyzer
{
    private const int PercentileSampleSize = 4096;

    public static ItemRollAnalysisBatch Analyze(
        string installationPath,
        IReadOnlyList<ItemRollInput> items)
    {
        if (items.Count == 0)
        {
            throw new ArgumentException("At least one item is required.", nameof(items));
        }

        var gameData = ItemCatalogBuilder.Load(installationPath);
        var distributions = new Dictionary<RollTemplateKey, RollDistribution>();
        return new ItemRollAnalysisBatch(
            gameData.InstallationPath,
            items.Select(item => Analyze(gameData, item, distributions)).ToArray());
    }

    internal static ItemRollAnalysis Analyze(
        ItemCatalogData gameData,
        ItemRollInput item,
        IDictionary<RollTemplateKey, RollDistribution>? distributionCache = null)
    {
        if (item.Seed == 0)
        {
            return ItemRollAnalysis.Unsupported(item, "The item has no usable roll seed.");
        }
        if (!gameData.Records.TryGetValue(item.BaseRecord, out var baseRecord))
        {
            return ItemRollAnalysis.Unsupported(item, "The base item record was not found in the loaded game data.");
        }

        if (!TryResolveOptional(gameData, item.PrefixRecord, out var prefix, out var prefixError))
        {
            return ItemRollAnalysis.Unsupported(item, prefixError!);
        }
        if (!TryResolveOptional(gameData, item.SuffixRecord, out var suffix, out var suffixError))
        {
            return ItemRollAnalysis.Unsupported(item, suffixError!);
        }

        var baseStats = ToInputStats(baseRecord.Record).ToArray();
        var prefixStats = prefix is null ? null : ToInputStats(prefix.Record).ToArray();
        var suffixStats = suffix is null ? null : ToInputStats(suffix.Record).ToArray();
        var basePetStats = ResolvePetStats(gameData, baseRecord);
        var prefixPetStats = ResolvePetStats(gameData, prefix);
        var suffixPetStats = ResolvePetStats(gameData, suffix);
        var result = ItemStatEngine.Compute(
            baseStats,
            item.Seed,
            prefixStats: prefixStats,
            suffixStats: suffixStats);
        var hasPetStats = basePetStats is not null || prefixPetStats is not null || suffixPetStats is not null;
        var petResult = hasPetStats
            ? ItemStatEngine.Compute(
                basePetStats ?? [],
                item.Seed,
                prefixStats: prefixPetStats,
                suffixStats: suffixPetStats)
            : null;
        var trusted = result.UnmodeledFields.Count == 0 &&
            (petResult is null || petResult.UnmodeledFields.Count == 0);
        RollDistribution? distribution = null;
        if (trusted)
        {
            var key = new RollTemplateKey(item.BaseRecord, item.PrefixRecord, item.SuffixRecord);
            if (distributionCache is null || !distributionCache.TryGetValue(key, out distribution))
            {
                distribution = BuildDistribution(
                    baseStats,
                    prefixStats,
                    suffixStats,
                    basePetStats,
                    prefixPetStats,
                    suffixPetStats);
                distributionCache?.Add(key, distribution);
            }
        }

        var stats = result.Stats
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => Score(pair.Key, pair.Value, distribution?.Values))
            .ToArray();
        var petStats = (petResult?.Stats ?? new Dictionary<string, double>())
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => Score(pair.Key, pair.Value, distribution?.PetValues))
            .ToArray();
        var groupedPercentiles = ScoreGroups(stats).Concat(ScoreGroups(petStats)).ToArray();
        var basePercentile = SourcePercentile(stats, baseStats, petStats, basePetStats);
        var prefixPercentile = SourcePercentile(stats, prefixStats, petStats, prefixPetStats);
        var suffixPercentile = SourcePercentile(stats, suffixStats, petStats, suffixPetStats);
        var unmodeledFields = result.UnmodeledFields
            .Concat((petResult?.UnmodeledFields ?? []).Select(field => $"pet:{field}"))
            .ToArray();
        return new ItemRollAnalysis(
            item.BaseRecord,
            item.PrefixRecord,
            item.SuffixRecord,
            item.Seed,
            true,
            trusted,
            trusted ? null : "One or more rollable fields are not modeled; scoring is withheld.",
            trusted ? PercentileSampleSize : 0,
            groupedPercentiles.Length == 0 ? null : groupedPercentiles.Average(),
            basePercentile,
            prefixPercentile,
            suffixPercentile,
            stats,
            petStats,
            unmodeledFields,
            result.ProcLines?.Select(line => new RolledProcLine(
                line.Field,
                line.Min,
                line.Max,
                line.DurationMin,
                line.Chance)).ToArray() ?? []);
    }

    private static double? SourcePercentile(
        IReadOnlyList<RolledStat> stats,
        ItemStatEngine.InputStat[]? source,
        IReadOnlyList<RolledStat> petStats,
        ItemStatEngine.InputStat[]? petSource)
    {
        var grouped = SourceScoreGroups(stats, source)
            .Concat(SourceScoreGroups(petStats, petSource))
            .ToArray();
        return grouped.Length == 0 ? null : grouped.Average();
    }

    private static IEnumerable<double> SourceScoreGroups(
        IReadOnlyList<RolledStat> stats,
        ItemStatEngine.InputStat[]? source)
    {
        if (source is null) return [];
        var fields = source.Select(stat => stat.Stat).ToHashSet(StringComparer.Ordinal);
        return ScoreGroups(stats.Where(stat => fields.Contains(stat.Field)).ToArray());
    }

    private static IEnumerable<double> ScoreGroups(IReadOnlyList<RolledStat> stats)
    {
        var scored = stats.Where(stat => stat.EstimatedPercentile.HasValue).ToArray();
        return scored
            .GroupBy(stat => GetScoreGroup(stat.Field, scored), StringComparer.Ordinal)
            .Select(group => group.Average(stat => stat.EstimatedPercentile!.Value));
    }

    private static RollDistribution BuildDistribution(
        ItemStatEngine.InputStat[] baseStats,
        ItemStatEngine.InputStat[]? prefixStats,
        ItemStatEngine.InputStat[]? suffixStats,
        ItemStatEngine.InputStat[]? basePetStats,
        ItemStatEngine.InputStat[]? prefixPetStats,
        ItemStatEngine.InputStat[]? suffixPetStats)
    {
        var values = new Dictionary<string, List<double>>(StringComparer.Ordinal);
        var petValues = new Dictionary<string, List<double>>(StringComparer.Ordinal);
        var hasPetStats = basePetStats is not null || prefixPetStats is not null || suffixPetStats is not null;
        for (var index = 0; index < PercentileSampleSize; index++)
        {
            var seed = unchecked(0x9E3779B9u * checked((uint)(index + 1)));
            if (seed == 0) seed = 1;
            var sample = ItemStatEngine.Compute(
                baseStats,
                seed,
                prefixStats: prefixStats,
                suffixStats: suffixStats);
            if (sample.UnmodeledFields.Count > 0)
            {
                throw new InvalidDataException(
                    "A trusted item template became untrusted during percentile sampling.");
            }
            foreach (var pair in sample.Stats)
            {
                if (!values.TryGetValue(pair.Key, out var samples))
                {
                    samples = new List<double>(PercentileSampleSize);
                    values[pair.Key] = samples;
                }
                samples.Add(pair.Value);
            }
            if (hasPetStats)
            {
                var petSample = ItemStatEngine.Compute(
                    basePetStats ?? [],
                    seed,
                    prefixStats: prefixPetStats,
                    suffixStats: suffixPetStats);
                if (petSample.UnmodeledFields.Count > 0)
                {
                    throw new InvalidDataException(
                        "A trusted pet-bonus template became untrusted during percentile sampling.");
                }
                AddSamples(petValues, petSample.Stats);
            }
        }

        return new RollDistribution(ToSortedSamples(values), ToSortedSamples(petValues));
    }

    private static void AddSamples(
        IDictionary<string, List<double>> values,
        IReadOnlyDictionary<string, double> sample)
    {
        foreach (var pair in sample)
        {
            if (!values.TryGetValue(pair.Key, out var samples))
            {
                samples = new List<double>(PercentileSampleSize);
                values[pair.Key] = samples;
            }
            samples.Add(pair.Value);
        }
    }

    private static IReadOnlyDictionary<string, double[]> ToSortedSamples(
        IReadOnlyDictionary<string, List<double>> values) =>
        values.ToDictionary(
            pair => pair.Key,
            pair =>
            {
                var samples = pair.Value.ToArray();
                Array.Sort(samples);
                return samples;
            },
            StringComparer.Ordinal);

    private static RolledStat Score(
        string field,
        double value,
        IReadOnlyDictionary<string, double[]>? distribution)
    {
        if (distribution is null ||
            !distribution.TryGetValue(field, out var samples) ||
            samples.Length == 0)
        {
            return new RolledStat(field, value, false, null, null, null);
        }

        var minimum = samples[0];
        var maximum = samples[^1];
        if (Math.Abs(maximum - minimum) < 0.0000001)
        {
            return new RolledStat(field, value, false, minimum, maximum, null);
        }

        var lower = Array.BinarySearch(samples, value);
        if (lower < 0) lower = ~lower;
        else while (lower > 0 && samples[lower - 1] == value) lower--;
        var upper = lower;
        while (upper < samples.Length && samples[upper] == value) upper++;
        var percentile = 100.0 * (lower + (upper - lower) * 0.5) / samples.Length;
        return new RolledStat(field, value, true, minimum, maximum, percentile);
    }

    private static string GetScoreGroup(string field, IReadOnlyList<RolledStat> scored)
    {
        if (field.EndsWith("Min", StringComparison.Ordinal))
        {
            var root = field[..^3];
            if (scored.Any(stat => stat.Field == root + "Max")) return root;
        }
        if (field.EndsWith("Max", StringComparison.Ordinal))
        {
            var root = field[..^3];
            if (scored.Any(stat => stat.Field == root + "Min")) return root;
        }
        return field;
    }

    private static bool TryResolveOptional(
        ItemCatalogData gameData,
        string record,
        out CatalogSourceRecord? resolved,
        out string? error)
    {
        resolved = null;
        error = null;
        if (string.IsNullOrWhiteSpace(record))
        {
            return true;
        }
        if (!gameData.Records.TryGetValue(record, out resolved))
        {
            error = $"Affix record was not found in the loaded game data: {record}";
            return false;
        }
        return true;
    }

    private static ItemStatEngine.InputStat[]? ResolvePetStats(
        ItemCatalogData gameData,
        CatalogSourceRecord? source)
    {
        var petRecord = source?.Record.Text("petBonusName");
        if (string.IsNullOrWhiteSpace(petRecord) ||
            !gameData.Records.TryGetValue(petRecord, out var resolved))
        {
            return null;
        }
        return ToInputStats(resolved.Record).ToArray();
    }

    private static IEnumerable<ItemStatEngine.InputStat> ToInputStats(
        CairnCodex.GrimDawn.Gdia.GameData.ArzRecord record)
    {
        foreach (var pair in record.Values)
        {
            var numbers = pair.Value
                .Where(value => value.Number.HasValue)
                .Select(value => value.Number!.Value)
                .Where(value => Math.Abs(value) > 0.01)
                .ToArray();
            var text = pair.Value.LastOrDefault(value => value.Text is not null)?.Text ?? string.Empty;
            if (numbers.Length == 0 && text.Length == 0)
            {
                continue;
            }
            // Match GDIA's ARZ projection: zero-valued fields are discarded, and duplicate
            // numeric rows are reduced to the greatest value before seed replay.
            var numeric = numbers.Length == 0 ? 0 : numbers.Max();
            yield return new ItemStatEngine.InputStat(pair.Key, text, numeric);
        }
    }
}

internal readonly record struct RollTemplateKey(
    string BaseRecord,
    string PrefixRecord,
    string SuffixRecord);

internal sealed record RollDistribution(
    IReadOnlyDictionary<string, double[]> Values,
    IReadOnlyDictionary<string, double[]> PetValues);

internal sealed record AnalyzeItemRollsRequest(
    string InstallationPath,
    IReadOnlyList<ItemRollInput> Items);

internal sealed record ItemRollInput(
    string BaseRecord,
    string PrefixRecord,
    string SuffixRecord,
    uint Seed);

internal sealed record ItemRollAnalysisBatch(
    string InstallationPath,
    IReadOnlyList<ItemRollAnalysis> Items);

internal sealed record ItemRollAnalysis(
    string BaseRecord,
    string PrefixRecord,
    string SuffixRecord,
    uint Seed,
    bool Supported,
    bool Trusted,
    string? Reason,
    int PercentileSampleSize,
    double? OverallEstimatedPercentile,
    double? BaseEstimatedPercentile,
    double? PrefixEstimatedPercentile,
    double? SuffixEstimatedPercentile,
    IReadOnlyList<RolledStat> Stats,
    IReadOnlyList<RolledStat> PetStats,
    IReadOnlyList<string> UnmodeledFields,
    IReadOnlyList<RolledProcLine> ProcLines,
    int ModelVersion = 3)
{
    public static ItemRollAnalysis Unsupported(ItemRollInput item, string reason) =>
        new(
            item.BaseRecord,
            item.PrefixRecord,
            item.SuffixRecord,
            item.Seed,
            false,
            false,
            reason,
            0,
            null,
            null,
            null,
            null,
            [],
            [],
            [],
            []);
}

internal sealed record RolledStat(
    string Field,
    double Value,
    bool Rollable,
    double? ObservedMinimum,
    double? ObservedMaximum,
    double? EstimatedPercentile);

internal sealed record RolledProcLine(
    string Field,
    double? Min,
    double? Max,
    double? DurationMin,
    double Chance);
