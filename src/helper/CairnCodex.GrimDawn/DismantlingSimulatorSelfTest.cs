using CairnCodex.GrimDawn.Gdia.GameData;

namespace CairnCodex.GrimDawn;

internal static class DismantlingSimulatorSelfTest
{
    private const string DismantleTable = "records/ui/inventor/dismantlepanel/dismantle_table.dbr";
    private const string MasterTable = "records/test/mt_dismantling.dbr";
    private const string DynamicTable = "records/test/tdyn_dismantling.dbr";
    private const string UnlimitedTable = "records/test/tdyn_unlimited.dbr";
    private const string LowReward = "records/items/materia/test_low.dbr";
    private const string NearReward = "records/items/materia/test_near.dbr";
    private const string HighReward = "records/items/crafting/materials/test_high.dbr";

    public static DismantlingSimulatorSelfTestResult Run()
    {
        var assertions = 0;
        void Check(bool condition, string message)
        {
            assertions++;
            if (!condition) throw new InvalidDataException(message);
        }

        var data = FixtureData();
        var preview = DismantlingSimulator.Simulate(data,
        [
            new DismantlingInputItem("rare-1", "Rare fixture", "rare", 1)
        ]);
        Check(preview.ItemCount == 1 && preview.DynamiteCost == 1, "Dynamite preview count drifted.");
        Check(preview.IronCost == 160, "Installed cost expression semantics drifted.");
        Check(preview.ScrapMinimum == 1 && preview.ScrapMaximum == 2,
            "Scrap outcome bounds drifted.");
        Check(Math.Abs(preview.ScrapExpected - 1.75) < 0.000001,
            "Scrap expected value drifted.");

        var low = preview.Rewards.Single(reward => reward.Record == LowReward);
        var near = preview.Rewards.Single(reward => reward.Record == NearReward);
        Check(preview.Rewards.All(reward => reward.Record != HighReward),
            "A reward above maxItemLevelEquation escaped the dynamic-table level gate.");
        Check(Math.Abs(low.ExpectedCount - (1d / 3d)) < 0.000001 &&
              Math.Abs(near.ExpectedCount - (1d / 6d)) < 0.000001,
            "Bell-slope or no-drop weighting drifted.");
        Check(Math.Abs(preview.Rewards.Sum(reward => reward.ExpectedCount) - 0.5) < 0.000001,
            "A positive blank master-table entry stopped contributing no-drop probability.");

        var unlimited = DismantlingSimulator.Simulate(data,
        [
            new DismantlingInputItem("epic-1", "Epic fixture", "epic", 1)
        ]);
        Check(unlimited.Rewards.Count == 1 && unlimited.Rewards[0].Record == HighReward &&
              Math.Abs(unlimited.Rewards[0].ExpectedCount - 1) < 0.000001,
            "disableLevelLimits did not preserve the out-of-range reward.");

        var badRecords = new Dictionary<string, CatalogSourceRecord>(data.Records,
            StringComparer.OrdinalIgnoreCase)
        {
            [DynamicTable] = Source(DynamicTable, "LootItemTable_DynWeight",
                ("lootName1", Text(LowReward)),
                ("lootWeight1", Number(100)),
                ("minItemLevelEquation", Text("1")),
                ("maxItemLevelEquation", Text("characterLevel+1")),
                ("targetLevelEquation", Text("parentLevel")),
                ("bellSlope", Number(100)))
        };
        var rejectedUnsupportedEquation = false;
        try
        {
            DismantlingSimulator.Simulate(data with { Records = badRecords },
            [
                new DismantlingInputItem("rare-bad", "Bad fixture", "rare", 1)
            ]);
        }
        catch (InvalidDataException exception) when (
            exception.Message.Contains("Unsupported Grim Dawn loot equation", StringComparison.Ordinal))
        {
            rejectedUnsupportedEquation = true;
        }
        Check(rejectedUnsupportedEquation, "Unknown loot equations did not fail closed.");

        var missingEquationRecords = new Dictionary<string, CatalogSourceRecord>(data.Records,
            StringComparer.OrdinalIgnoreCase)
        {
            [DynamicTable] = Source(DynamicTable, "LootItemTable_DynWeight",
                ("lootName1", Text(LowReward)),
                ("lootWeight1", Number(100)),
                ("minItemLevelEquation", Text("1")),
                ("targetLevelEquation", Text("parentLevel")),
                ("bellSlope", Number(100)))
        };
        Check(Rejects(data with { Records = missingEquationRecords }, "missing maxItemLevelEquation"),
            "Missing dynamic-table equations did not fail closed.");

        var missingReferenceRecords = new Dictionary<string, CatalogSourceRecord>(data.Records,
            StringComparer.OrdinalIgnoreCase)
        {
            [MasterTable] = Source(MasterTable, "LootMasterTable",
                ("lootName1", Text("records/test/missing-table.dbr")),
                ("lootWeight1", Number(100)))
        };
        Check(Rejects(data with { Records = missingReferenceRecords }, "references a missing record"),
            "Missing nested loot-table records did not fail closed.");

        return new DismantlingSimulatorSelfTestResult(
            true,
            assertions,
            LevelLimitsPassed: true,
            BellSlopePassed: true,
            NoDropPassed: true,
            FailClosedPassed: true);
    }

    private static ItemCatalogData FixtureData()
    {
        var records = new Dictionary<string, CatalogSourceRecord>(StringComparer.OrdinalIgnoreCase)
        {
            [DismantleTable] = Source(DismantleTable, string.Empty,
                ("dismantleCost", Text("itemLevel*10+150")),
                ("itemWeights", Number(25, 75)),
                ("rareItemBonus", Text(MasterTable)),
                ("rareItemBonusWeight", Number(100)),
                ("epicItemBonus", Text(UnlimitedTable)),
                ("epicItemBonusWeight", Number(100))),
            [MasterTable] = Source(MasterTable, "LootMasterTable",
                ("lootName1", Text(DynamicTable)),
                ("lootWeight1", Number(50)),
                ("lootWeight2", Number(50))),
            [DynamicTable] = Source(DynamicTable, "LootItemTable_DynWeight",
                ("lootName1", Text(LowReward)),
                ("lootWeight1", Number(100)),
                ("lootName2", Text(NearReward)),
                ("lootWeight2", Number(100)),
                ("lootName3", Text(HighReward)),
                ("lootWeight3", Number(100)),
                ("minItemLevelEquation", Text("1*1")),
                ("maxItemLevelEquation", Text("(parentLevel*1)+1")),
                ("targetLevelEquation", Text("(parentLevel/1)")),
                ("bellSlope", Number(100, 50, 25, 10, 5, 1))),
            [UnlimitedTable] = Source(UnlimitedTable, "LootItemTable_DynWeight",
                ("lootName1", Text(HighReward)),
                ("lootWeight1", Number(100)),
                ("disableLevelLimits", Number(1)),
                ("minItemLevelEquation", Text("1")),
                ("maxItemLevelEquation", Text("parentLevel")),
                ("targetLevelEquation", Text("parentLevel")),
                ("bellSlope", Number(100, 100, 100, 100, 100, 100))),
            [LowReward] = Source(LowReward, "Item", ("itemLevel", Number(1)), ("itemNameTag", Text("tagLow"))),
            [NearReward] = Source(NearReward, "Item", ("itemLevel", Number(2)), ("itemNameTag", Text("tagNear"))),
            [HighReward] = Source(HighReward, "Item", ("itemLevel", Number(5)), ("itemNameTag", Text("tagHigh")))
        };
        return new ItemCatalogData(
            "fixture",
            [new ContentPack("fixture", "fixture.arz", "fixture.arc")],
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["tagLow"] = "Low reward",
                ["tagNear"] = "Near reward",
                ["tagHigh"] = "High reward"
            },
            records);
    }

    private static bool Rejects(ItemCatalogData data, string expectedMessage)
    {
        try
        {
            DismantlingSimulator.Simulate(data,
            [
                new DismantlingInputItem("rare-rejected", "Rejected fixture", "rare", 1)
            ]);
            return false;
        }
        catch (InvalidDataException exception)
        {
            return exception.Message.Contains(expectedMessage, StringComparison.Ordinal);
        }
    }

    private static CatalogSourceRecord Source(
        string name,
        string type,
        params (string Name, IReadOnlyList<ArzValue> Values)[] fields) =>
        new(new ArzRecord(name, type, fields.ToDictionary(
            field => field.Name,
            field => field.Values,
            StringComparer.OrdinalIgnoreCase)), "fixture");

    private static IReadOnlyList<ArzValue> Text(params string[] values) =>
        values.Select(ArzValue.FromText).ToArray();

    private static IReadOnlyList<ArzValue> Number(params double[] values) =>
        values.Select(ArzValue.FromNumber).ToArray();
}

internal sealed record DismantlingSimulatorSelfTestResult(
    bool Passed,
    int Assertions,
    bool LevelLimitsPassed,
    bool BellSlopePassed,
    bool NoDropPassed,
    bool FailClosedPassed);
