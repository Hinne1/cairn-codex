using System.Globalization;
using System.Text.RegularExpressions;
using CairnCodex.GrimDawn.Gdia.GameData;

namespace CairnCodex.GrimDawn;

/// <summary>
/// Reads Grim Dawn's installed Inventor tables and projects their random loot
/// graph. This class deliberately has no save, stash, or live-game dependency:
/// it is the read-only half of a possible future dismantling workflow.
/// </summary>
internal static partial class DismantlingSimulator
{
    private const string DismantleTable = "records/ui/inventor/dismantlepanel/dismantle_table.dbr";

    public static DismantlingPreview Simulate(
        string installationPath,
        IReadOnlyList<DismantlingInputItem> items)
    {
        var data = ItemCatalogBuilder.Load(installationPath);
        if (!data.Records.TryGetValue(DismantleTable, out var source))
        {
            throw new InvalidDataException("The installed Grim Dawn dismantling table was not found.");
        }

        var table = source.Record;
        var (ironPerLevel, ironBase) = ParseCost(table.Text("dismantleCost"));
        var scrapWeights = table.Values.GetValueOrDefault("itemWeights")?
            .Select(value => Math.Max(0, value.Number ?? 0))
            .ToArray() ?? [];
        var scrapWeightTotal = scrapWeights.Sum();
        if (scrapWeightTotal <= 0)
        {
            throw new InvalidDataException("The installed Grim Dawn dismantling table has no Scrap outcomes.");
        }
        var scrapOutcomes = scrapWeights
            .Select((weight, index) => new DismantlingScrapOutcome(index + 1,
                scrapWeightTotal > 0 ? weight / scrapWeightTotal : 0))
            .Where(outcome => outcome.Probability > 0)
            .ToArray();
        var scrapExpected = scrapOutcomes.Sum(outcome => outcome.Count * outcome.Probability);

        var rewardAccumulator = new Dictionary<string, RewardAccumulator>(StringComparer.OrdinalIgnoreCase);
        var flattenedCache = new Dictionary<string, Dictionary<string, double>>(StringComparer.OrdinalIgnoreCase);
        var itemResults = new List<DismantlingItemPreview>(items.Count);
        foreach (var item in items)
        {
            var rulePrefix = RulePrefix(item.Rarity, item.Ascendant);
            var tableRecord = table.Text(rulePrefix + "ItemBonus");
            var bonusChance = Math.Clamp((table.Number(rulePrefix + "ItemBonusWeight") ?? 0) / 100d, 0, 1);
            var ironCost = checked(ironBase + item.ItemLevel * ironPerLevel);
            var flattened = tableRecord is null
                ? new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
                : FlattenCached(data, tableRecord, item.ItemLevel, flattenedCache);

            foreach (var reward in flattened)
            {
                var probability = bonusChance * reward.Value;
                if (probability <= 0) continue;
                if (!rewardAccumulator.TryGetValue(reward.Key, out var accumulator))
                {
                    accumulator = new RewardAccumulator(
                        reward.Key,
                        ResolveItemName(data, reward.Key),
                        RewardCategory(reward.Key));
                    rewardAccumulator[reward.Key] = accumulator;
                }
                accumulator.ExpectedCount += probability;
                accumulator.NoDropProbability *= 1 - probability;
            }

            itemResults.Add(new DismantlingItemPreview(
                item.VaultItemId,
                item.Name,
                item.Rarity,
                item.ItemLevel,
                ironCost,
                bonusChance,
                tableRecord));
        }

        var rewards = rewardAccumulator.Values
            .Select(reward => new DismantlingRewardPreview(
                reward.Record,
                reward.Name,
                reward.Category,
                reward.ExpectedCount,
                1 - reward.NoDropProbability))
            .OrderByDescending(reward => reward.ExpectedCount)
            .ThenBy(reward => reward.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new DismantlingPreview(
            DismantleTable,
            source.ContentPack,
            items.Count,
            items.Count,
            itemResults.Sum(item => item.IronCost),
            items.Count * (scrapOutcomes.FirstOrDefault()?.Count ?? 0),
            items.Count * (scrapOutcomes.LastOrDefault()?.Count ?? 0),
            items.Count * scrapExpected,
            scrapOutcomes,
            rewards,
            itemResults);
    }

    private static Dictionary<string, double> Flatten(
        ItemCatalogData data,
        string recordName,
        int itemLevel,
        HashSet<string> ancestors)
    {
        if (!ancestors.Add(recordName))
        {
            throw new InvalidDataException($"Dismantling loot table contains a cycle at {recordName}.");
        }
        try
        {
            if (!data.Records.TryGetValue(recordName, out var source))
            {
                return new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase) { [recordName] = 1 };
            }

            var record = source.Record;
            if (record.Type == "LevelTable")
            {
                var levels = record.Values.GetValueOrDefault("levels")?
                    .Select(value => checked((int)Math.Round(value.Number ?? 0)))
                    .ToArray() ?? [];
                var records = record.Values.GetValueOrDefault("records")?
                    .Select(value => value.Text)
                    .ToArray() ?? [];
                var selected = records
                    .Select((path, index) => new { path, level = index < levels.Length ? levels[index] : 0 })
                    .Where(entry => entry.path is not null && entry.level <= itemLevel)
                    .OrderByDescending(entry => entry.level)
                    .FirstOrDefault()
                    ?? records.Select((path, index) => new { path, level = index < levels.Length ? levels[index] : 0 })
                        .Where(entry => entry.path is not null)
                        .OrderBy(entry => entry.level)
                        .FirstOrDefault();
                return selected?.path is { } selectedPath
                    ? Flatten(data, selectedPath, itemLevel, ancestors)
                    : [];
            }

            if (record.Type is "LootMasterTable" or "LootItemTable_DynWeight")
            {
                var choices = Enumerable.Range(1, 200)
                    .Select(index => new
                    {
                        path = record.Text("lootName" + index),
                        weight = Math.Max(0, record.Number("lootWeight" + index) ?? 0)
                    })
                    .Where(choice => choice.path is not null && choice.weight > 0)
                    .ToArray();
                var total = choices.Sum(choice => choice.weight);
                if (total <= 0) return [];
                var result = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
                foreach (var choice in choices)
                {
                    foreach (var terminal in Flatten(data, choice.path!, itemLevel, ancestors))
                    {
                        result[terminal.Key] = result.GetValueOrDefault(terminal.Key) +
                            choice.weight / total * terminal.Value;
                    }
                }
                return result;
            }

            return new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase) { [recordName] = 1 };
        }
        finally
        {
            ancestors.Remove(recordName);
        }
    }

    private static Dictionary<string, double> FlattenCached(
        ItemCatalogData data,
        string recordName,
        int itemLevel,
        Dictionary<string, Dictionary<string, double>> cache)
    {
        var key = $"{itemLevel}:{recordName}";
        if (!cache.TryGetValue(key, out var flattened))
        {
            flattened = Flatten(data, recordName, itemLevel,
                new HashSet<string>(StringComparer.OrdinalIgnoreCase));
            cache[key] = flattened;
        }
        return flattened;
    }

    private static (int PerLevel, int Base) ParseCost(string? expression)
    {
        var match = CostExpression().Match(expression ?? string.Empty);
        if (!match.Success)
        {
            throw new InvalidDataException(
                $"Unsupported Grim Dawn dismantling cost expression: {expression ?? "<missing>"}");
        }
        return (int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture),
            int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture));
    }

    private static string RulePrefix(string rarity, bool ascendant) => ascendant
        ? "ascendant"
        : rarity.ToLowerInvariant() switch
        {
            "legendary" => "legendary",
            "epic" => "epic",
            "mi" or "rare" => "rare",
            "magical" => "magic",
            _ => "common"
        };

    private static string ResolveItemName(ItemCatalogData data, string recordName)
    {
        if (data.Records.TryGetValue(recordName, out var source))
        {
            var tag = source.Record.Text("itemNameTag") ?? source.Record.Text("description");
            if (tag is not null && data.Tags.TryGetValue(tag, out var resolved) && !string.IsNullOrWhiteSpace(resolved))
            {
                return resolved.Trim();
            }
        }
        return Path.GetFileNameWithoutExtension(recordName).Replace('_', ' ');
    }

    private static string RewardCategory(string recordName)
    {
        var path = recordName.Replace('\\', '/');
        if (path.Contains("/items/materia/", StringComparison.OrdinalIgnoreCase)) return "component";
        if (path.Contains("/items/crafting/materials/", StringComparison.OrdinalIgnoreCase)) return "material";
        return "other";
    }

    [GeneratedRegex(@"itemLevel\s*\*\s*(\d+)\s*\+\s*(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex CostExpression();

    private sealed class RewardAccumulator(string record, string name, string category)
    {
        public string Record { get; } = record;
        public string Name { get; } = name;
        public string Category { get; } = category;
        public double ExpectedCount { get; set; }
        public double NoDropProbability { get; set; } = 1;
    }
}

internal sealed record DismantlingInputItem(
    string VaultItemId,
    string Name,
    string Rarity,
    int ItemLevel,
    bool Ascendant = false);

internal sealed record DismantlingPreview(
    string RuleRecord,
    string ContentPack,
    int ItemCount,
    int DynamiteCost,
    int IronCost,
    int ScrapMinimum,
    int ScrapMaximum,
    double ScrapExpected,
    IReadOnlyList<DismantlingScrapOutcome> ScrapOutcomes,
    IReadOnlyList<DismantlingRewardPreview> Rewards,
    IReadOnlyList<DismantlingItemPreview> Items);

internal sealed record DismantlingScrapOutcome(int Count, double Probability);

internal sealed record DismantlingRewardPreview(
    string Record,
    string Name,
    string Category,
    double ExpectedCount,
    double ChanceAtLeastOne);

internal sealed record DismantlingItemPreview(
    string VaultItemId,
    string Name,
    string Rarity,
    int ItemLevel,
    int IronCost,
    double BonusChance,
    string? BonusTableRecord);
