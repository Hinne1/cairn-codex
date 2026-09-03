namespace CairnCodex.GrimDawn;

internal static class ItemRollRatingSelfTest
{
    public static ItemRollRatingSelfTestResult Run()
    {
        var assertions = 0;
        void Check(bool condition, string message)
        {
            assertions++;
            if (!condition) throw new InvalidDataException(message);
        }

        var stats = new[]
        {
            Scored("offensiveFireMin", 80),
            Scored("offensiveFireMax", 60),
            Scored("offensiveColdModifier", 30),
            Scored("offensiveElementalModifier", 70),
            Scored("retaliationFireModifier", 95),
            Scored("characterOffensiveAbility", 90),
            Scored("defensiveFire", 40),
            Scored("characterMana", 50),
            Scored("futureModeledField", 70),
            Fixed("characterRunSpeed")
        };
        var petStats = new[]
        {
            Scored("offensiveFireModifier", 75),
            Scored("characterLifeModifier", 25)
        };
        var categoryDistributions = new Dictionary<string, double[]>(StringComparer.Ordinal)
        {
            ["offense:fire"] = [40, 50, 60, 70, 80, 90]
        };
        var scores = ItemRollAnalyzer.ScoreCategories(stats, petStats, categoryDistributions)
            .ToDictionary(score => score.Key);

        Check(scores.Keys.SequenceEqual(new[]
        {
            "offense:fire", "offense:cold", "offense:elemental", "retaliation", "defense", "utility", "pet"
        }), "Category scores were not emitted in the stable player-facing order.");
        CheckScore(scores["offense:fire"], 230.0 / 3.0, 3, 200.0 / 3.0, "Fire offense");
        CheckScore(scores["offense:cold"], 190.0 / 3.0, 3, null, "Cold offense");
        CheckScore(scores["offense:elemental"], 80, 2, null, "Elemental offense");
        CheckScore(scores["retaliation"], 95, 1, null, "Retaliation");
        CheckScore(scores["defense"], 40, 1, null, "Defense");
        CheckScore(scores["utility"], 60, 2, null, "Utility");
        CheckScore(scores["pet"], 50, 2, null, "Pet");
        Check(RollCategoryClassifier.Classify("skillProjectileSpeedModifier").Category == "offense",
            "Projectile speed was not classified as offense.");
        Check(RollCategoryClassifier.Classify("skillManaCostReduction").Category == "utility",
            "Skill resource economy was not classified as utility.");
        Check(RollCategoryClassifier.Classify("characterDodgePercent").Category == "defense",
            "Dodge was not classified as defense.");
        Check(RollCategoryClassifier.Classify("characterConstitutionModifier").Category == "defense",
            "Constitution was not classified as defense.");
        Check(RollCategoryClassifier.Classify("offensiveLifeLeechMin").DamageType is null,
            "Attack damage converted to health was incorrectly treated as Vitality damage.");
        Check(RollCategoryClassifier.Classify("retaliationFireModifier").Category == "retaliation",
            "Retaliation was incorrectly allowed to inflate ordinary offense.");

        // Perfect 9 in a 7–9 range is 100% quality, despite an 83.33 midrank.
        var discrete = new Dictionary<string, double[]> { ["offensiveVitality"] = [7, 8, 9] };
        var perfect = ItemRollAnalyzer.Score("offensiveVitality", 9, discrete);
        Check(perfect.QualityPercent == 100, "Maximum roll did not receive 100% quality.");
        Check(Math.Abs(perfect.EstimatedPercentile!.Value - 250.0 / 3) < 0.000001, "Discrete ties lost their percentile rank.");
        Check(ItemRollAnalyzer.Score("offensiveVitality", 7, discrete).QualityPercent == 0, "Minimum roll was not 0%.");
        Check(ItemRollAnalyzer.Score("offensiveVitality", 8, discrete).QualityPercent == 50, "Midpoint was not 50%.");
        Check(ItemRollAnalyzer.RangeQuality(12, 7, 9) == 100 && ItemRollAnalyzer.RangeQuality(6, 7, 9) == 0,
            "Sampled-range outliers were not bounded.");
        Check(ItemRollAnalyzer.RangeQuality(9, 9, 9) is null && ItemRollAnalyzer.RangeQuality(double.NaN, 7, 9) is null,
            "Fixed/invalid ranges received quality scores.");
        Check(ItemRollAnalyzer.Score("offensiveVitality", 9, null).QualityPercent is null,
            "Untrusted stats received quality scores.");

        // Exercise the real combination-sample builder with correlated min/max
        // members and nonuniform frequencies, rather than injecting final ranks.
        var values = new Dictionary<string, List<double>> {
            ["offensiveFireMin"] = Enumerable.Range(0, 4096).Select(i => i < 2048 ? 7.0 : i < 3072 ? 8.0 : 9.0).ToList(),
            ["offensiveFireMax"] = Enumerable.Range(0, 4096).Select(i => i < 2048 ? 14.0 : i < 3072 ? 16.0 : 18.0).ToList(),
            ["characterOffensiveAbility"] = Enumerable.Range(0, 4096).Select(i => i < 2048 ? 30.0 : i < 3072 ? 20.0 : 10.0).ToList(),
            ["characterRunSpeed"] = Enumerable.Repeat(5.0, 4096).ToList()
        };
        var sorted = values.ToDictionary(pair => pair.Key, pair => pair.Value.Order().ToArray());
        var generated = ItemRollAnalyzer.BuildCategoryAverageQualities(values, new Dictionary<string, List<double>>(), sorted, new Dictionary<string, double[]>());
        Check(generated["offense:fire"].All(value => value == 50),
            "Category rarity did not sample the same range-quality average, with ranges grouped once.");
        var sampledStats = values.Select(pair => ItemRollAnalyzer.Score(pair.Key, pair.Value[0], sorted)).ToArray();
        var sampledCategory = ItemRollAnalyzer.ScoreCategories(sampledStats, [], generated).Single();
        Check(sampledCategory.QualityPercent == 50 && sampledCategory.CombinationPercentile == 50 && sampledCategory.StatCount == 2,
            "Correlated quality averages and tied combination ranks diverged.");
        var singleValues = new Dictionary<string, List<double>> { ["offensiveFireMin"] = values["offensiveFireMin"] };
        var singleSorted = singleValues.ToDictionary(pair => pair.Key, pair => pair.Value.Order().ToArray());
        var singleSamples = ItemRollAnalyzer.BuildCategoryAverageQualities(singleValues, singleValues, singleSorted, singleSorted);
        Check(singleSamples["offense:fire"][0] == 0 && singleSamples["offense:fire"][2048] == 50 && singleSamples["offense:fire"][4095] == 100,
            "Nonuniform sampling still used marginal percentiles rather than range quality.");
        Check(singleSamples["pet"].SequenceEqual(singleSamples["offense:fire"]),
            "Pet quality sample normalization diverged from item normalization.");
        Check(ItemRollAnalyzer.ScoreCategories([perfect], [], new Dictionary<string, double[]> { ["offense:vitality"] = [0, 50, 100] }).Single().QualityPercent == 100,
            "Perfect per-stat quality was not propagated to the category.");

        return new ItemRollRatingSelfTestResult(
            Passed: true,
            Assertions: assertions,
            DualDamagePassed: true,
            RangeGroupingPassed: true,
            PetIsolationPassed: true,
            FallbackPassed: true,
            CombinationRarityPassed: true);

        void CheckScore(
            RollCategoryScore score,
            double percentile,
            int statCount,
            double? combinationPercentile,
            string label)
        {
            Check(Math.Abs(score.EstimatedPercentile - percentile) < 0.0000001,
                $"{label} produced the wrong aggregate percentile.");
            Check(Math.Abs(score.QualityPercent - percentile) < 0.0000001,
                $"{label} produced the wrong average range quality.");
            Check(score.StatCount == statCount, $"{label} counted the wrong number of stat lines.");
            Check(
                score.CombinationPercentile == combinationPercentile,
                $"{label} produced the wrong combination percentile.");
        }
    }

    private static RolledStat Scored(string field, double percentile) =>
        new(field, percentile, true, 0, 100, percentile, percentile);

    private static RolledStat Fixed(string field) =>
        new(field, 1, false, 1, 1, null);
}

internal sealed record ItemRollRatingSelfTestResult(
    bool Passed,
    int Assertions,
    bool DualDamagePassed,
    bool RangeGroupingPassed,
    bool PetIsolationPassed,
    bool FallbackPassed,
    bool CombinationRarityPassed);
