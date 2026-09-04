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

        CheckCompleteness(Check);

        return new ItemPresentationBuilderSelfTestResult(
            Passed: true,
            Assertions: assertions,
            FinalTierPassed: true,
            TextLevelPassed: true,
            InheritedLevelsPassed: true);
    }

    private static bool HasWeaponDamage(ItemGrantedSkillPresentation skill, double expected) =>
        skill.Lines.Any(line => line.Label == "Weapon Damage" && line.Minimum == expected);

    private static void CheckCompleteness(Action<bool, string> check)
    {
        const string parent = "records/skills/fixture/form.dbr";
        const string child = "records/skills/fixture/talons.dbr";
        const string weapon = "records/skills/fixture/weapon_modifier.dbr";
        const string healing = "records/skills/fixture/healing_modifier.dbr";
        const string slow = "records/skills/fixture/time_bubble.dbr";
        var records = new Dictionary<string, CatalogSourceRecord>(StringComparer.OrdinalIgnoreCase)
        {
            [parent] = Source(parent, "Skill_Shapeshift", ("skillDisplayName", Text("tagForm")), ("grantedSkills", Text(child))),
            [child] = Source(child, "Skill_AttackProjectile", ("skillDisplayName", Text("tagTalons"))),
            [weapon] = Source(weapon, "Skill_Modifier", ("weaponDamagePct", Number(30))),
            [healing] = Source(healing, "Skill_Modifier", ("skillLifeBonusBuffDuration", Number(400))),
            [slow] = Source(slow, "Skill_AttackProjectileAreaEffect", ("skillDisplayName", Text("tagBubble")),
                ("offensiveSlowTotalSpeedMin", Number(40, 55)), ("offensiveSlowTotalSpeedDurationMin", Number(1, 2)),
                ("projectileExplosionRadius", Number(4.5)), ("skillActiveDuration", Number(5)))
        };
        var tags = new Dictionary<string, string> { ["tagForm"] = "Fixture Form", ["tagTalons"] = "Fixture Talons", ["tagBubble"] = "Time Bubble" };
        var data = new ItemPresentationSource(tags, records);
        var item = Source("records/items/fixture.dbr", "ArmorProtective_Feet",
            ("augmentSkillName5", Text(parent)), ("augmentSkillLevel5", Number(2)),
            ("augmentSkillName11", Text(child)), ("augmentSkillLevel11", Number(3)),
            ("augmentSkillNameInvalid", Text(parent)),
            ("augmentMasteryName5", Text(parent)), ("augmentMasteryLevel5", Number(1)),
            ("modifiedSkillName7", Text(child)), ("modifierSkillName7", Text(weapon)),
            ("modifiedSkillName1", Text(parent)), ("modifierSkillName1", Text(healing)),
            ("itemSkillName", Text(slow)), ("itemSkillLevel", Number(2))).Record;
        var result = ItemPresentationBuilder.Build(item, data);
        var rankLines = result.Sections.Single(section => section.Kind == "base").Lines;
        check(rankLines.Count(line => line.Tone == "skill") == 2, "Sparse rank fields above four were truncated or malformed suffixes were accepted.");
        check(rankLines.Any(line => line.Label == "to Fixture Form" && line.Minimum == 2), "Fifth rank bonus was lost.");
        check(rankLines.Any(line => line.Tone == "mastery"), "Higher mastery bonus field was lost.");
        var ability = result.Sections.Single(section => section.Heading == "Fixture Talons");
        check(ability.Lines.Any(line => line.Label == "Weapon Damage" && line.Minimum == 30), "Seventh modifier slot was lost.");
        check(ability.ParentSkills?.SequenceEqual(new[] { "Fixture Form" }) == true, "Granted-ability parent metadata was lost.");
        check(result.Sections.Single(section => section.Heading == "Fixture Form").Lines.Any(line => line.Label == "Health Restored per Second" && line.Minimum == 400), "Shapeshift flat healing was lost.");
        check(result.GrantedSkill!.Lines.Any(line => line.Label == "Reduced Target's Total Speed for 2 Seconds" && line.Minimum == 55), "Granted slow effect did not use its skill level.");
        check(result.GrantedSkill.Lines.Any(line => line.Label == "Target Area" && line.Minimum == 4.5), "Projectile area was lost.");
        var set = Source("set", "ItemSet", ("setName", Text("tagForm")), ("setMembers", Text("a", "b")),
            ("augmentSkillName5", Text(parent)), ("augmentSkillLevel5", Number(0, 2))).Record;
        records["set"] = new CatalogSourceRecord(set, "fixture");
        var setPresentation = ItemPresentationBuilder.BuildSet("set", data)!;
        check(setPresentation.Tiers.Any(tier => tier.RequiredPieces == 2 && tier.Lines.Any(line => line.Label == "to Fixture Form")), "Fifth set rank bonus was lost.");
        check(ItemCatalogBuilder.QualifyAwakenedName("records/items/awakened/fixture.dbr", "Fixture") == "Awakened Fixture", "Awakened name was not qualified.");
        check(ItemCatalogBuilder.QualifyAwakenedName("records/items/awakened/fixture.dbr", "Awakened Fixture") == "Awakened Fixture", "Awakened qualifier was duplicated.");
        check(ItemCatalogBuilder.QualifyAwakenedName("records/items/fixture.dbr", "Fixture") == "Fixture", "Ordinary item name was changed.");
    }

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
