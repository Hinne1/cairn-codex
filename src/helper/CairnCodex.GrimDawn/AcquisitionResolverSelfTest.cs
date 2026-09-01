using CairnCodex.GrimDawn.Gdia.GameData;

namespace CairnCodex.GrimDawn;

internal static class AcquisitionResolverSelfTest
{
    private const string MiltonItem = "records/items/gearhead/b016g_head.dbr";
    private const string MiltonTable = "records/items/loottables/gearhead/tdyn_head_b07_milton.dbr";
    private const string MiltonBoss = "records/creatures/enemies/boss&quest/miltonhart.dbr";
    private const string EndlessMiltonPool = "records/endlessdungeon/loottables/armor/lt_head_milton.dbr";
    private const string BroadMasterPool = "records/endlessdungeon/loottables/armor/mt_head_monsterinfreq.dbr";
    private const string GenericMonster = "records/creatures/enemies/groble/groble_voidclanelder.dbr";

    private const string StewardItem = "records/items/gearweapons/melee2h/b203e_axe2h.dbr";
    private const string StewardTable = "records/items/loottables/weapons/tdyn_melee2h_b203_templeguardian.dbr";
    private const string StewardBoss = "records/creatures/enemies/boss&quest/statue_korvaaktombguardian.dbr";
    private const string ConsumingFormula = "records/items/crafting/blueprints/faction/craft_weapon_dreeg_2hsword01.dbr";
    private const string DreegVendor = "records/creatures/npcs/merchants/factiontables/dreeg_revered_01.dbr";

    private const string CraftedItem = "records/items/crafting/fixture_artifact.dbr";
    private const string ProducingFormula = "records/items/crafting/blueprints/fixture_artifact_formula.dbr";
    private const string DirectVendorItem = "records/items/faction/fixture_direct_item.dbr";
    private const string VariantItem = "records/items/gearweapons/fixture_variant_item.dbr";
    private const string VariantTable = "records/items/loottables/fixture_variant_table.dbr";
    private const string VariantMonsterA = "records/creatures/enemies/fixture_variant_a.dbr";
    private const string VariantMonsterB = "records/creatures/enemies/fixture_variant_b.dbr";

    public static AcquisitionResolverSelfTestResult Run()
    {
        var assertions = 0;
        void Check(bool condition, string message)
        {
            assertions++;
            if (!condition) throw new InvalidDataException(message);
        }

        var records = FixtureRecords();
        var tags = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["tagMilton"] = "Milton Hart",
            ["tagGroble"] = "Groble ~ Void Clan Elder",
            ["tagSteward"] = "The Steward",
            ["tagVariantA"] = "Fixture Alpha",
            ["tagVariantB"] = "Fixture Beta"
        };
        var references = ItemCatalogBuilder.BuildAcquisitionReferences(records);

        var milton = Resolve(MiltonItem);
        Check(milton.Sources.SequenceEqual(["Dropped by Milton Hart"]),
            "A broad downstream loot pool displaced Milton's direct producer.");
        Check(milton.SourceRecords.SequenceEqual([MiltonBoss]),
            "Map source records were not bounded to Milton's closest producer.");

        var steward = Resolve(StewardItem);
        Check(steward.Sources.SequenceEqual(["Dropped by The Steward"]),
            "A formula that consumes Steward's Halberd leaked into acquisition hints.");
        Check(steward.SourceRecords.SequenceEqual([StewardBoss]),
            "Steward's direct producer was not retained.");
        Check(steward.Factions.Count == 0 && steward.Crafting is null,
            "A consuming faction formula was treated as a vendor or blueprint source.");

        var crafted = Resolve(CraftedItem);
        Check(crafted.Sources.Contains("Craftable from a blueprint"),
            "A formula artifactName edge was not recognized as a producer.");
        Check(crafted.Sources.Contains("Blueprint vendor: Cult of Dreeg · Revered"),
            "A vendor-sold producing blueprint was not labeled distinctly.");
        Check(crafted.Factions.Count == 0 &&
              crafted.Crafting?.BlueprintRecords.SequenceEqual([ProducingFormula]) == true,
            "A blueprint vendor was exposed as direct faction item stock.");

        var directVendor = Resolve(DirectVendorItem);
        Check(directVendor.Sources.Contains("Faction vendor: Cult of Dreeg · Revered") &&
              directVendor.Factions.Count == 1,
            "Direct faction stock was not preserved.");

        var variants = Resolve(VariantItem);
        Check(variants.Sources.Count == 2 &&
              variants.Sources.Contains("Dropped by Fixture Alpha") &&
              variants.Sources.Contains("Dropped by Fixture Beta"),
            "Equally direct legitimate monster variants were not retained.");
        Check(variants.SourceRecords.Count == 2,
            "Equally direct source records were unexpectedly collapsed.");

        return new AcquisitionResolverSelfTestResult(
            Passed: true,
            Assertions: assertions,
            DirectProducerPassed: true,
            ReagentFormulaRejected: true,
            BlueprintVendorPassed: true,
            DirectVendorPassed: true,
            EqualDepthVariantsPassed: true);

        ItemAcquisitionPresentation Resolve(string itemRecord) =>
            ItemCatalogBuilder.BuildAcquisition(itemRecord, references, records, tags, knownFormulas: null);
    }

    private static IReadOnlyDictionary<string, CatalogSourceRecord> FixtureRecords() =>
        new Dictionary<string, CatalogSourceRecord>(StringComparer.OrdinalIgnoreCase)
        {
            [MiltonItem] = Source(MiltonItem, "Item"),
            [MiltonTable] = Source(MiltonTable, "LootItemTable_DynWeight", ("lootName1", Text(MiltonItem))),
            [MiltonBoss] = Source(MiltonBoss, "Monster", ("description", Text("tagMilton")), ("lootTable", Text(MiltonTable))),
            [EndlessMiltonPool] = Source(EndlessMiltonPool, "LootItemTable", ("lootName1", Text(MiltonTable))),
            [BroadMasterPool] = Source(BroadMasterPool, "LootMasterTable", ("lootName1", Text(EndlessMiltonPool))),
            [GenericMonster] = Source(GenericMonster, "Monster", ("description", Text("tagGroble")), ("lootTable", Text(BroadMasterPool))),

            [StewardItem] = Source(StewardItem, "Item"),
            [StewardTable] = Source(StewardTable, "LootItemTable_DynWeight", ("lootName1", Text(StewardItem))),
            [StewardBoss] = Source(StewardBoss, "Monster", ("description", Text("tagSteward")), ("lootTable", Text(StewardTable))),
            [ConsumingFormula] = Source(ConsumingFormula, "ItemArtifactFormula", ("reagentBaseBaseName", Text(StewardItem))),
            [DreegVendor] = Source(DreegVendor, "Merchant", ("lootName1", Text(ConsumingFormula)), ("lootName2", Text(ProducingFormula)), ("lootName3", Text(DirectVendorItem))),

            [CraftedItem] = Source(CraftedItem, "Item"),
            [ProducingFormula] = Source(ProducingFormula, "ItemArtifactFormula", ("artifactName", Text(CraftedItem))),
            [DirectVendorItem] = Source(DirectVendorItem, "Item"),

            [VariantItem] = Source(VariantItem, "Item"),
            [VariantTable] = Source(VariantTable, "LootItemTable_DynWeight", ("lootName1", Text(VariantItem))),
            [VariantMonsterA] = Source(VariantMonsterA, "Monster", ("description", Text("tagVariantA")), ("lootTable", Text(VariantTable))),
            [VariantMonsterB] = Source(VariantMonsterB, "Monster", ("description", Text("tagVariantB")), ("lootTable", Text(VariantTable)))
        };

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
}

internal sealed record AcquisitionResolverSelfTestResult(
    bool Passed,
    int Assertions,
    bool DirectProducerPassed,
    bool ReagentFormulaRejected,
    bool BlueprintVendorPassed,
    bool DirectVendorPassed,
    bool EqualDepthVariantsPassed);
