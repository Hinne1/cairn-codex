using CairnCodex.GrimDawn.Gdia.GameData;

namespace CairnCodex.GrimDawn;

internal static class ItemPresentationBuilderSelfTest
{
    private const string SetPath = "records/items/sets/fixture_set.dbr";
    private const string RootSkillPath = "records/skills/fixture/root.dbr";
    private const string FinalSpawnPath = "records/skills/fixture/spawn_final.dbr";
    private const string TextLevelSkillPath = "records/skills/fixture/text_level.dbr";
    private const string InitialSkillPath = "records/skills/fixture/initial.dbr";
    private const string AttackSkillPath = "records/skills/fixture/attack.dbr";

    public static ItemPresentationBuilderSelfTestResult Run()
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
            ["tagFixtureSet"] = "Fixture Guardian",
            ["tagRootSkill"] = "Fixture Storm",
            ["tagTextSkill"] = "Text-Level Nova",
            ["tagInitialSkill"] = "Initial Nova",
            ["tagAttackSkill"] = "Attack Nova"
        };
        var presentation = ItemPresentationBuilder.BuildSet(
            SetPath,
            new ItemPresentationSource(tags, records));

        Check(presentation is not null, "The fixture set did not produce a presentation.");
        Check(presentation!.Name == "Fixture Guardian", "The fixture set name was not resolved.");
        Check(presentation.Members.Count == 4, "The fixture set did not preserve all members.");
        Check(presentation.Tiers.Count == 1, "The final linked skill leaked into another set tier.");
        var tier = presentation.Tiers.Single();
        Check(tier.RequiredPieces == 4, "The granted skill was not attached to the four-piece tier.");
        Check(tier.GrantedSkill?.Name == "Fixture Storm", "The parent granted skill was not preserved.");
        var linked = tier.GrantedSkill!.LinkedSkills.ToDictionary(skill => skill.Name);
        Check(linked.Keys.Order().SequenceEqual(
            new[] { "Attack Nova", "Initial Nova", "Text-Level Nova" }.Order()),
            "The final spawn's linked skills were not preserved exactly.");
        Check(HasWeaponDamage(linked["Text-Level Nova"], 300),
            "A text-encoded skillLevel field was not used for its linked skill.");
        Check(HasWeaponDamage(linked["Initial Nova"], 400),
            "initialSkillName did not inherit the parent granted-skill level.");
        Check(HasWeaponDamage(linked["Attack Nova"], 400),
            "attackSkillName did not inherit the parent granted-skill level.");

        return new ItemPresentationBuilderSelfTestResult(
            Passed: true,
            Assertions: assertions,
            FinalTierPassed: true,
            TextLevelPassed: true,
            InheritedLevelsPassed: true);
    }

    private static bool HasWeaponDamage(ItemGrantedSkillPresentation skill, double expected) =>
        skill.Lines.Any(line => line.Label == "Weapon Damage" && line.Minimum == expected);

    private static IReadOnlyDictionary<string, CatalogSourceRecord> FixtureRecords() =>
        new Dictionary<string, CatalogSourceRecord>(StringComparer.OrdinalIgnoreCase)
        {
            [SetPath] = Source(SetPath, "ItemSet",
                ("setName", Text("tagFixtureSet")),
                ("setMembers", Text("member1", "member2", "member3", "member4")),
                ("itemSkillName", Text(RootSkillPath)),
                ("itemSkillLevel", Number(0, 0, 0, 4))),
            [RootSkillPath] = Source(RootSkillPath, "Skill",
                ("skillDisplayName", Text("tagRootSkill")),
                ("spawnObjects", Text("spawn1", "spawn2", "spawn3", FinalSpawnPath))),
            [FinalSpawnPath] = Source(FinalSpawnPath, "Pet",
                ("skillName1", Text(TextLevelSkillPath)),
                ("skillLevel1", Text("3")),
                ("initialSkillName", Text(InitialSkillPath)),
                ("attackSkillName", Text(AttackSkillPath))),
            [TextLevelSkillPath] = DisplaySkill(TextLevelSkillPath, "tagTextSkill"),
            [InitialSkillPath] = DisplaySkill(InitialSkillPath, "tagInitialSkill"),
            [AttackSkillPath] = DisplaySkill(AttackSkillPath, "tagAttackSkill")
        };

    private static CatalogSourceRecord DisplaySkill(string path, string displayTag) =>
        Source(path, "Skill",
            ("skillDisplayName", Text(displayTag)),
            ("isPetDisplayable", Number(1)),
            ("weaponDamagePct", Number(100, 200, 300, 400)));

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

internal sealed record ItemPresentationBuilderSelfTestResult(
    bool Passed,
    int Assertions,
    bool FinalTierPassed,
    bool TextLevelPassed,
    bool InheritedLevelsPassed);
