using System.Globalization;
using System.Text.RegularExpressions;
using CairnCodex.GrimDawn.Gdia.GameData;

namespace CairnCodex.GrimDawn;

internal static partial class ItemPresentationBuilder
{
    private const double JitterPercent = 20;

    private static readonly IReadOnlyDictionary<string, StatLabel> Labels =
        new Dictionary<string, StatLabel>(StringComparer.Ordinal)
        {
            ["characterStrength"] = new("Physique"),
            ["characterDexterity"] = new("Cunning"),
            ["characterIntelligence"] = new("Spirit"),
            ["characterLife"] = new("Health"),
            ["characterMana"] = new("Energy"),
            ["characterStrengthModifier"] = new("Physique", "%"),
            ["characterDexterityModifier"] = new("Cunning", "%"),
            ["characterIntelligenceModifier"] = new("Spirit", "%"),
            ["characterLifeModifier"] = new("Health", "%"),
            ["characterManaModifier"] = new("Energy", "%"),
            ["characterLifeRegen"] = new("Health Regenerated per Second"),
            ["characterLifeRegenModifier"] = new("Health Regeneration", "%"),
            ["characterManaRegen"] = new("Energy Regenerated per Second"),
            ["characterManaRegenModifier"] = new("Energy Regeneration", "%"),
            ["characterOffensiveAbility"] = new("Offensive Ability"),
            ["characterDefensiveAbility"] = new("Defensive Ability"),
            ["characterOffensiveAbilityModifier"] = new("Offensive Ability", "%"),
            ["characterDefensiveAbilityModifier"] = new("Defensive Ability", "%"),
            ["characterAttackSpeedModifier"] = new("Attack Speed", "%"),
            ["characterSpellCastSpeedModifier"] = new("Casting Speed", "%"),
            ["characterRunSpeedModifier"] = new("Movement Speed", "%"),
            ["characterTotalSpeedModifier"] = new("Total Speed", "%"),
            ["characterConstitutionModifier"] = new("Constitution", "%"),
            ["characterHealIncreasePercent"] = new("Healing Effects", "%"),
            ["characterRunSpeedMaxModifier"] = new("Maximum Movement Speed", "%"),
            ["characterAttackSpeedMaxModifier"] = new("Maximum Attack Speed", "%"),
            ["characterSpellCastSpeedMaxModifier"] = new("Maximum Casting Speed", "%"),
            ["characterDodgePercent"] = new("Chance to Avoid Melee Attacks", "%"),
            ["characterDeflectProjectile"] = new("Chance to Avoid Projectiles", "%"),
            ["characterEnergyAbsorptionPercent"] = new("Energy Absorption from Enemy Spells", "%"),
            ["characterIncreasedExperience"] = new("Experience Gained", "%"),
            ["offensiveCritDamageModifier"] = new("Critical Damage", "%"),
            ["offensiveTotalDamageModifier"] = new("All Damage", "%"),
            ["offensivePhysicalModifier"] = new("Physical Damage", "%"),
            ["offensivePierceModifier"] = new("Pierce Damage", "%"),
            ["offensiveFireModifier"] = new("Fire Damage", "%"),
            ["offensiveColdModifier"] = new("Cold Damage", "%"),
            ["offensiveLightningModifier"] = new("Lightning Damage", "%"),
            ["offensivePoisonModifier"] = new("Acid Damage", "%"),
            ["offensiveLifeModifier"] = new("Vitality Damage", "%"),
            ["offensiveAetherModifier"] = new("Aether Damage", "%"),
            ["offensiveChaosModifier"] = new("Chaos Damage", "%"),
            ["offensiveElementalModifier"] = new("Elemental Damage", "%"),
            ["offensiveSlowPhysicalModifier"] = new("Internal Trauma Damage", "%"),
            ["offensiveSlowBleedingModifier"] = new("Bleeding Damage", "%"),
            ["offensiveSlowFireModifier"] = new("Burn Damage", "%"),
            ["offensiveSlowColdModifier"] = new("Frostburn Damage", "%"),
            ["offensiveSlowLightningModifier"] = new("Electrocute Damage", "%"),
            ["offensiveSlowPoisonModifier"] = new("Poison Damage", "%"),
            ["offensiveSlowLifeModifier"] = new("Vitality Decay", "%"),
            ["offensiveSlowPhysicalDurationModifier"] = new("Internal Trauma Duration", "%"),
            ["offensiveSlowBleedingDurationModifier"] = new("Bleeding Duration", "%"),
            ["offensiveSlowFireDurationModifier"] = new("Burn Duration", "%"),
            ["offensiveSlowColdDurationModifier"] = new("Frostburn Duration", "%"),
            ["offensiveSlowLightningDurationModifier"] = new("Electrocute Duration", "%"),
            ["offensiveSlowPoisonDurationModifier"] = new("Poison Duration", "%"),
            ["offensiveSlowLifeDurationModifier"] = new("Vitality Decay Duration", "%"),
            ["offensiveLifeLeechMin"] = new("of Attack Damage converted to Health", "%"),
            ["damageAbsorptionPercent"] = new("Damage Absorption", "%"),
            ["defensivePhysical"] = new("Physical Resistance", "%"),
            ["defensivePierce"] = new("Pierce Resistance", "%"),
            ["defensiveFire"] = new("Fire Resistance", "%"),
            ["defensiveCold"] = new("Cold Resistance", "%"),
            ["defensiveLightning"] = new("Lightning Resistance", "%"),
            ["defensivePoison"] = new("Acid Resistance", "%"),
            ["defensiveLife"] = new("Vitality Resistance", "%"),
            ["defensiveAether"] = new("Aether Resistance", "%"),
            ["defensiveChaos"] = new("Chaos Resistance", "%"),
            ["defensiveElementalResistance"] = new("Elemental Resistance", "%"),
            ["defensiveBleeding"] = new("Bleeding Resistance", "%"),
            ["defensiveStun"] = new("Reduced Stun Duration", "%"),
            ["defensiveFreeze"] = new("Reduced Freeze Duration", "%"),
            ["defensiveTrap"] = new("Reduced Entrapment Duration", "%"),
            ["defensivePetrify"] = new("Reduced Petrify Duration", "%"),
            ["defensiveTotalSpeedResistance"] = new("Slow Resistance", "%"),
            ["defensiveReflect"] = new("Damage Reflected", "%"),
            ["defensiveProtectionModifier"] = new("Increased Armor", "%"),
            ["defensiveBonusProtection"] = new("Armor"),
            ["defensiveBlockModifier"] = new("Shield Block Chance", "%"),
            ["defensiveBlockAmountModifier"] = new("Shield Damage Blocked", "%"),
            ["defensivePercentReflectionResistance"] = new("Reflected Damage Reduction", "%"),
            ["defensivePercentCurrentLife"] = new("Maximum Health Resistance", "%"),
            ["defensiveSlowLifeLeach"] = new("Life Leech Resistance", "%"),
            ["defensiveBleedingDuration"] = new("Reduced Bleeding Duration", "%"),
            ["defensiveFireDuration"] = new("Reduced Burn Duration", "%"),
            ["defensiveAbsorptionModifier"] = new("Increased Armor Absorption", "%"),
            ["characterDefensiveBlockRecoveryReduction"] = new("Shield Recovery Time", "%"),
            ["skillCooldownReduction"] = new("Skill Recharge", "%"),
            ["skillManaCostReduction"] = new("Skill Energy Cost", "%"),
            ["skillComboChargeSpendReduction"] = new("Weapon Pool Charge Cost", "%"),
            ["retaliationTotalDamageModifier"] = new("Total Retaliation Damage", "%")
        };

    private static readonly (string Root, string Label)[] FlatDamage =
    [
        ("offensivePhysical", "Physical Damage"),
        ("offensiveBonusPhysical", "Physical Damage"),
        ("offensivePierce", "Pierce Damage"),
        ("offensiveFire", "Fire Damage"),
        ("offensiveCold", "Cold Damage"),
        ("offensiveLightning", "Lightning Damage"),
        ("offensivePoison", "Acid Damage"),
        ("offensiveLife", "Vitality Damage"),
        ("offensiveAether", "Aether Damage"),
        ("offensiveChaos", "Chaos Damage"),
        ("offensiveElemental", "Elemental Damage")
    ];

    private static readonly (string Root, string Label)[] DurationDamage =
    [
        ("offensiveSlowPhysical", "Internal Trauma"),
        ("offensiveSlowBleeding", "Bleeding"),
        ("offensiveSlowFire", "Burn"),
        ("offensiveSlowCold", "Frostburn"),
        ("offensiveSlowLightning", "Electrocute"),
        ("offensiveSlowPoison", "Poison"),
        ("offensiveSlowLife", "Vitality Decay")
    ];

    private static readonly (string Root, string Label)[] RetaliationDamage =
    [
        ("retaliationPhysical", "Physical Retaliation"),
        ("retaliationPierce", "Pierce Retaliation"),
        ("retaliationFire", "Fire Retaliation"),
        ("retaliationCold", "Cold Retaliation"),
        ("retaliationLightning", "Lightning Retaliation"),
        ("retaliationPoison", "Acid Retaliation"),
        ("retaliationLife", "Vitality Retaliation"),
        ("retaliationAether", "Aether Retaliation"),
        ("retaliationChaos", "Chaos Retaliation")
    ];

    public static ItemPresentation Build(ArzRecord record, ItemPresentationSource data)
    {
        var baseLines = new List<ItemPresentationLine>();
        AddHeader(record, baseLines);
        AddFlatDamage(record, baseLines);
        AddDurationDamage(record, baseLines);
        AddSimpleStats(record, baseLines, "standard");
        AddConversions(record, baseLines);
        AddSkillBonuses(record, data, baseLines);
        AddDifficultyUnlockEffects(record, baseLines);

        var sections = new List<ItemPresentationSection>();
        if (baseLines.Count > 0) sections.Add(new ItemPresentationSection("base", null, baseLines));

        AddSkillModifiers(record, data, sections);

        var petRecord = record.Text("petBonusName");
        if (petRecord is not null && data.Records.TryGetValue(petRecord, out var pet))
        {
            var petLines = new List<ItemPresentationLine>();
            AddFlatDamage(pet.Record, petLines, "pet");
            AddDurationDamage(pet.Record, petLines, "pet");
            AddSimpleStats(pet.Record, petLines, "pet");
            AddConversions(pet.Record, petLines, "pet");
            if (petLines.Count > 0)
                sections.Add(new ItemPresentationSection("pet", "Bonus to All Pets", petLines));
        }

        var flavorText = TrimQuotes(Resolve(record.Text("itemText"), data.Tags));
        var grantedSkill = BuildGrantedSkill(record, data);
        var searchParts = new List<string>();
        if (flavorText is not null) searchParts.Add(flavorText);
        searchParts.AddRange(sections.Select(section => section.Heading).OfType<string>());
        searchParts.AddRange(sections.SelectMany(section => section.ParentSkills ?? []));
        searchParts.AddRange(sections.SelectMany(section => section.Lines).Select(SearchLine));
        if (grantedSkill is not null) AddGrantedSkillSearchParts(grantedSkill, searchParts);
        return new ItemPresentation(
            flavorText,
            sections,
            grantedSkill,
            string.Join(' ', searchParts.Where(value => !string.IsNullOrWhiteSpace(value))));
    }

    public static ItemSetPresentation? BuildSet(string? path, ItemPresentationSource data)
    {
        if (path is null || !data.Records.TryGetValue(path, out var source)) return null;
        var record = source.Record;
        var members = record.Values.GetValueOrDefault("setMembers")?
            .Select(value => value.Text)
            .OfType<string>()
            .Where(value => value.Length > 0)
            .ToArray() ?? [];
        if (members.Length == 0) return null;

        var tiers = new List<ItemSetBonusTier>();
        var previousLines = new List<ItemPresentationLine>();
        for (var level = 1; level <= members.Length; level++)
        {
            var currentLines = BuildSetTierLines(record, data, level);
            var newLines = currentLines.Except(previousLines).ToArray();
            var petBecameActive = IsTierValueActive(record, "petBonusLevel", level) &&
                !IsTierValueActive(record, "petBonusLevel", level - 1);
            var petLines = petBecameActive ? BuildSetPetLines(record, data) : [];
            var modifiersBecameActive = IsTierValueActive(record, "itemSkillModifierControl", level) &&
                !IsTierValueActive(record, "itemSkillModifierControl", level - 1);
            var grantedSkillBecameActive = IsTierValueActive(record, "itemSkillLevel", level) &&
                !IsTierValueActive(record, "itemSkillLevel", level - 1);
            var skillModifiers = new List<ItemPresentationSection>();
            if (modifiersBecameActive) AddSkillModifiers(record, data, skillModifiers);
            var grantedSkill = grantedSkillBecameActive ? BuildGrantedSkill(record, data) : null;
            if (newLines.Length > 0 || petLines.Count > 0 || skillModifiers.Count > 0 || grantedSkill is not null)
                tiers.Add(new ItemSetBonusTier(
                    level,
                    newLines,
                    petLines,
                    skillModifiers,
                    grantedSkill));
            previousLines = currentLines;
        }
        return new ItemSetPresentation(
            Resolve(record.Text("setName"), data.Tags) ?? HumanizePath(path),
            TrimQuotes(Resolve(record.Text("setDescription"), data.Tags)),
            members,
            tiers);
    }

    private static List<ItemPresentationLine> BuildSetTierLines(
        ArzRecord record,
        ItemPresentationSource data,
        int level)
    {
        var lines = new List<ItemPresentationLine>();
        AddFlatDamage(record, lines, level: level);
        AddDurationDamage(record, lines, level: level);
        AddSimpleStats(record, lines, "standard", level);
        AddRetaliation(record, lines, level);
        AddConversions(record, lines, level: level);
        AddSetSkillBonuses(record, data, lines, level);
        return lines;
    }

    private static IReadOnlyList<ItemPresentationLine> BuildSetPetLines(
        ArzRecord record,
        ItemPresentationSource data)
    {
        var path = record.Text("petBonusName");
        if (path is null || !data.Records.TryGetValue(path, out var source)) return [];
        var lines = new List<ItemPresentationLine>();
        AddFlatDamage(source.Record, lines, "pet");
        AddDurationDamage(source.Record, lines, "pet");
        AddSimpleStats(source.Record, lines, "pet");
        AddRetaliation(source.Record, lines);
        AddConversions(source.Record, lines, "pet");
        return lines;
    }

    private static bool IsTierValueActive(ArzRecord record, string field, int level) =>
        level > 0 && NumberAt(record, field, level) is { } value && Math.Abs(value) > 0.001;

    private static void AddHeader(ArzRecord record, List<ItemPresentationLine> lines)
    {
        var itemClass = record.Text("Class") ?? string.Empty;
        if (itemClass.StartsWith("Weapon", StringComparison.Ordinal) &&
            record.Number("offensivePhysicalMin") is { } minimum &&
            record.Number("offensivePhysicalMax") is { } maximum &&
            (Math.Abs(minimum) > 0.001 || Math.Abs(maximum) > 0.001))
        {
            lines.Add(Line("Physical Damage", minimum, maximum));
        }
        if (record.Number("defensiveProtection") is { } armor && Math.Abs(armor) > 0.001)
            lines.Add(Line("Armor", armor, null));
        if (record.Number("defensiveBlockChance") is { } chance &&
            record.Number("defensiveBlock") is { } blocked &&
            Math.Abs(chance) > 0.001 && Math.Abs(blocked) > 0.001)
        {
            lines.Add(Line("Chance to Block", chance, null, "%", suffix: $" {Format(blocked)} Damage"));
        }
        if (record.Number("blockRecoveryTime") is { } recovery && Math.Abs(recovery) > 0.001)
            lines.Add(Line("Block Recovery", recovery, null, "s"));
    }

    private static void AddDifficultyUnlockEffects(
        ArzRecord record,
        List<ItemPresentationLine> lines)
    {
        if (record.Type != "ItemDifficultyUnlock") return;
        var difficulty = record.Text("difficultyUnlocked");
        if (string.IsNullOrWhiteSpace(difficulty)) return;
        var isCrucible = string.Equals(
            record.Text("gameMode"),
            "Survival",
            StringComparison.OrdinalIgnoreCase);
        lines.Add(Line(
            isCrucible
                ? $"Unlocks {difficulty} Crucible difficulty"
                : $"Unlocks {difficulty} difficulty",
            null,
            null));
        if (isCrucible) return;
        if ((record.Values.GetValueOrDefault("statQuests")?.Count ?? 0) > 0)
            lines.Add(Line("Unlocks Attribute/Skill rewards from quests on lower difficulties", null, null));
        lines.Add(Line("Unlocks Riftgates on lower difficulties", null, null));
        lines.Add(Line("Unlocks all inventory bags", null, null));
    }

    private static void AddFlatDamage(
        ArzRecord record,
        List<ItemPresentationLine> lines,
        string tone = "standard",
        int? level = null)
    {
        foreach (var (root, label) in FlatDamage)
        {
            if (root == "offensivePhysical" &&
                (record.Text("Class") ?? string.Empty).StartsWith("Weapon", StringComparison.Ordinal))
                continue;
            var minimumValue = level.HasValue
                ? NumberAt(record, root + "Min", level.Value)
                : record.Number(root + "Min");
            if (minimumValue is not { } minimum || Math.Abs(minimum) < 0.001) continue;
            var maximum = level.HasValue
                ? NumberAt(record, root + "Max", level.Value)
                : record.Number(root + "Max");
            var range = level.HasValue
                ? new NumericRange(minimum, minimum)
                : RollRange(record, root + "Min", minimum, scaled: true);
            var maxRange = maximum.HasValue && Math.Abs(maximum.Value) > 0.001
                ? level.HasValue
                    ? new NumericRange(maximum.Value, maximum.Value)
                    : RollRange(record, root + "Max", maximum.Value, scaled: true)
                : range;
            lines.Add(Line(label, range.Minimum, maxRange.Maximum, tone: tone));
        }
    }

    private static void AddSimpleStats(
        ArzRecord record,
        List<ItemPresentationLine> lines,
        string tone,
        int? level = null)
    {
        foreach (var pair in Labels)
        {
            var fieldValue = level.HasValue
                ? NumberAt(record, pair.Key, level.Value)
                : record.Number(pair.Key);
            if (fieldValue is not { } value || Math.Abs(value) < 0.001) continue;
            var scaled = pair.Key.StartsWith("offensive", StringComparison.Ordinal) &&
                pair.Key.EndsWith("Modifier", StringComparison.Ordinal);
            if (pair.Key == "skillCooldownReduction" &&
                record.Number("skillCooldownReductionChance") is { } chance && chance > 0)
                continue;
            var range = level.HasValue
                ? new NumericRange(value, value)
                : RollRange(record, pair.Key, value, scaled);
            var prefix = pair.Key is "skillCooldownReduction" or "skillManaCostReduction" or
                "characterDefensiveBlockRecoveryReduction" || value < 0
                ? "−"
                : string.Empty;
            var absoluteMinimum = Math.Min(Math.Abs(range.Minimum), Math.Abs(range.Maximum));
            var absoluteMaximum = Math.Max(Math.Abs(range.Minimum), Math.Abs(range.Maximum));
            lines.Add(Line(
                pair.Value.Label,
                absoluteMinimum,
                absoluteMaximum,
                pair.Value.Unit,
                tone,
                prefix));
        }
    }

    private static void AddDurationDamage(
        ArzRecord record,
        List<ItemPresentationLine> lines,
        string tone = "standard",
        int? level = null)
    {
        foreach (var (root, label) in DurationDamage)
        {
            var minimumValue = level.HasValue
                ? NumberAt(record, root + "Min", level.Value)
                : record.Number(root + "Min");
            if (minimumValue is not { } minimum || Math.Abs(minimum) < 0.001) continue;
            var maximum = level.HasValue
                ? NumberAt(record, root + "Max", level.Value)
                : record.Number(root + "Max");
            var duration = level.HasValue
                ? NumberAt(record, root + "DurationMin", level.Value)
                : record.Number(root + "DurationMin");
            if (!duration.HasValue || duration.Value <= 0) duration = 1;

            var minimumRange = level.HasValue
                ? new NumericRange(minimum, minimum)
                : RollRange(record, root + "Min", minimum, scaled: true);
            var maximumRange = maximum.HasValue && Math.Abs(maximum.Value) > 0.001
                ? level.HasValue
                    ? new NumericRange(maximum.Value, maximum.Value)
                    : RollRange(record, root + "Max", maximum.Value, scaled: true)
                : minimumRange;
            var durationLabel = Math.Abs(duration.Value - 1) < 0.001
                ? $"{label} Damage per Second"
                : $"{label} Damage over {Format(duration.Value)} Seconds";
            lines.Add(Line(
                durationLabel,
                minimumRange.Minimum * duration.Value,
                maximumRange.Maximum * duration.Value,
                tone: tone));
        }
    }

    private static void AddConversions(
        ArzRecord record,
        List<ItemPresentationLine> lines,
        string tone = "standard",
        int? level = null)
    {
        for (var index = 1; index <= 2; index++)
        {
            var suffix = index == 1 ? string.Empty : index.ToString(CultureInfo.InvariantCulture);
            var percentageField = "conversionPercentage" + suffix;
            var percentage = level.HasValue
                ? NumberAt(record, percentageField, level.Value)
                : record.Number(percentageField);
            if (percentage is not { } value || Math.Abs(value) < 0.001) continue;
            var input = record.Text("conversionInType" + suffix);
            var output = record.Text("conversionOutType" + suffix);
            if (input is null || output is null) continue;
            var range = level.HasValue
                ? new NumericRange(value, value)
                : new NumericRange(
                    Math.Max(0, Math.Round(value * 0.8, MidpointRounding.AwayFromZero)),
                    Math.Min(100, Math.Round(value * 1.2, MidpointRounding.AwayFromZero)));
            lines.Add(Line(
                $"{DamageName(input)} Damage converted to {DamageName(output)} Damage",
                range.Minimum,
                range.Maximum,
                "%",
                tone));
        }
    }

    private static void AddRetaliation(
        ArzRecord record,
        List<ItemPresentationLine> lines,
        int? level = null)
    {
        foreach (var (root, label) in RetaliationDamage)
        {
            var minimum = level.HasValue
                ? NumberAt(record, root + "Min", level.Value)
                : record.Number(root + "Min");
            if (minimum is { } minimumValue && Math.Abs(minimumValue) > 0.001)
            {
                var maximum = level.HasValue
                    ? NumberAt(record, root + "Max", level.Value)
                    : record.Number(root + "Max");
                lines.Add(Line(
                    label,
                    minimumValue,
                    maximum is { } maximumValue && Math.Abs(maximumValue) > 0.001
                        ? maximumValue
                        : null));
            }
            var modifier = level.HasValue
                ? NumberAt(record, root + "Modifier", level.Value)
                : record.Number(root + "Modifier");
            if (modifier is { } modifierValue && Math.Abs(modifierValue) > 0.001)
                lines.Add(Line(label, Math.Abs(modifierValue), null, "%", prefix: modifierValue < 0 ? "−" : string.Empty));
        }
        var freeze = level.HasValue
            ? NumberAt(record, "retaliationFreezeMin", level.Value)
            : record.Number("retaliationFreezeMin");
        if (freeze is { } freezeValue && Math.Abs(freezeValue) > 0.001)
            lines.Add(Line("Freeze Retaliation", freezeValue, null, "s"));
    }

    private static void AddSetSkillBonuses(
        ArzRecord record,
        ItemPresentationSource data,
        List<ItemPresentationLine> lines,
        int level)
    {
        foreach (var index in NumberedFields(record, "augmentSkillName"))
        {
            var path = record.Text("augmentSkillName" + index);
            var value = NumberAt(record, "augmentSkillLevel" + index, level);
            if (path is null || value is not { } amount || Math.Abs(amount) < 0.001) continue;
            lines.Add(Line("to " + ResolveSkillName(path, data), amount, null, tone: "skill", prefix: "+"));
        }
        foreach (var index in NumberedFields(record, "augmentMasteryName"))
        {
            var path = record.Text("augmentMasteryName" + index);
            var value = NumberAt(record, "augmentMasteryLevel" + index, level);
            if (path is null || value is not { } amount || Math.Abs(amount) < 0.001) continue;
            lines.Add(Line(
                "to all skills in " + ResolveMasteryName(path, data),
                amount,
                null,
                tone: "mastery",
                prefix: "+"));
        }
        if (NumberAt(record, "augmentAllLevel", level) is { } allSkills && Math.Abs(allSkills) > 0.001)
            lines.Add(Line("to All Skills", allSkills, null, tone: "mastery", prefix: "+"));
    }

    private static void AddSkillBonuses(
        ArzRecord record,
        ItemPresentationSource data,
        List<ItemPresentationLine> lines)
    {
        foreach (var index in NumberedFields(record, "augmentSkillName"))
        {
            var skillRecord = record.Text("augmentSkillName" + index);
            var level = record.Number("augmentSkillLevel" + index);
            if (skillRecord is null || level is null) continue;
            lines.Add(Line("to " + ResolveSkillName(skillRecord, data), level.Value, null, tone: "skill", prefix: "+"));
        }
        foreach (var index in NumberedFields(record, "augmentMasteryName"))
        {
            var masteryRecord = record.Text("augmentMasteryName" + index);
            var level = record.Number("augmentMasteryLevel" + index);
            if (masteryRecord is null || level is null) continue;
            lines.Add(Line(
                "to all skills in " + ResolveMasteryName(masteryRecord, data),
                level.Value,
                null,
                tone: "mastery",
                prefix: "+"));
        }
        if (record.Number("augmentAllLevel") is { } allSkills)
            lines.Add(Line("to All Skills", allSkills, null, tone: "mastery", prefix: "+"));
    }

    private static ItemGrantedSkillPresentation? BuildGrantedSkill(
        ArzRecord item,
        ItemPresentationSource data)
    {
        var skillPath = item.Text("itemSkillName") ?? item.Text("skillName");
        if (skillPath is null || !TryResolveDisplaySkill(skillPath, data, out var skill)) return null;
        var name = Resolve(skill.Text("skillDisplayName"), data.Tags) ?? "Granted Skill";
        var description = Resolve(skill.Text("skillBaseDescription"), data.Tags);
        var level = Math.Max(1, RecordInteger(item, "itemSkillLevelEq") ??
            RecordInteger(item, "itemSkillLevel") ?? 1);
        var trigger = ResolveTrigger(item.Text("itemSkillAutoController"), skill, level);
        var lines = BuildGrantedSkillLines(skill, data, level, includeModifierMechanics: false);
        var rootSkill = data.Records.TryGetValue(skillPath, out var rootSource)
            ? rootSource.Record
            : skill;
        var linkedSkills = BuildLinkedGrantedSkills(rootSkill, data, level);
        return new ItemGrantedSkillPresentation(name, description, trigger, lines, linkedSkills);
    }

    private static IReadOnlyList<ItemPresentationLine> BuildGrantedSkillLines(
        ArzRecord skill,
        ItemPresentationSource data,
        int level,
        bool includeModifierMechanics)
    {
        var lines = new List<ItemPresentationLine>();
        if (NumberAt(skill, "skillManaCost", level) is { } energy)
            lines.Add(Line("Energy Cost", energy, null));
        if (NumberAt(skill, "skillCooldownTime", level) is { } cooldown)
            lines.Add(Line("Skill Recharge", cooldown, null, "s"));
        if ((NumberAt(skill, "skillActiveDuration", level) ??
             NumberAt(skill, "spawnObjectsTimeToLive", level)) is { } duration)
            lines.Add(Line("Duration", duration, null, "s"));
        if (NumberAt(skill, "skillTargetRadius", level) is { } radius)
            lines.Add(Line("Target Area", radius, null, "m"));
        if (NumberAt(skill, "skillTargetAngle", level) is { } angle)
            lines.Add(Line("Attack Arc", angle, null, "°"));
        if (NumberAt(skill, "skillTargetNumber", level) is { } targets)
            lines.Add(Line("Target Maximum", targets, null));
        if (NumberAt(skill, "weaponDamagePct", level) is { } weaponDamage)
            lines.Add(Line("Weapon Damage", weaponDamage, null, "%"));
        AddFlatDamage(skill, lines, "standard", level);
        AddDurationDamage(skill, lines, "standard", level);
        AddSimpleStats(skill, lines, "standard", level);
        AddRetaliation(skill, lines, level);
        AddConversions(skill, lines, level: level);
        AddHealingAndSlowEffects(skill, lines, level);
        if (NumberAt(skill, "projectileExplosionRadius", level) is { } explosionRadius && explosionRadius > 0)
            lines.Add(Line("Target Area", explosionRadius, null, "m"));
        if (includeModifierMechanics)
        {
            AddSkillModifierSpecialStats(skill, lines);
            AddSkillModifierMechanics(skill, data, lines, includeGeometry: false);
        }
        return lines.Distinct().ToArray();
    }

    private static IReadOnlyList<ItemGrantedSkillPresentation> BuildLinkedGrantedSkills(
        ArzRecord rootSkill,
        ItemPresentationSource data,
        int level)
    {
        var spawnPath = TextAt(rootSkill, "spawnObjects", level);
        if (spawnPath is null || !data.Records.TryGetValue(spawnPath, out var spawnSource)) return [];

        var spawn = spawnSource.Record;
        var candidates = new List<(string Path, int Level)>();
        void AddCandidate(string? path, int skillLevel)
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            var normalizedLevel = Math.Max(1, skillLevel);
            var existingIndex = candidates.FindIndex(candidate =>
                string.Equals(candidate.Path, path, StringComparison.OrdinalIgnoreCase));
            if (existingIndex >= 0)
            {
                if (normalizedLevel > candidates[existingIndex].Level)
                    candidates[existingIndex] = (path, normalizedLevel);
                return;
            }
            candidates.Add((path, normalizedLevel));
        }

        for (var index = 1; index <= 16; index++)
        {
            var path = spawn.Text("skillName" + index);
            var skillLevel = RecordInteger(spawn, "skillLevel" + index) ?? 1;
            AddCandidate(path, skillLevel);
        }
        AddCandidate(spawn.Text("initialSkillName"), level);
        AddCandidate(spawn.Text("attackSkillName"), level);

        var linked = new List<ItemGrantedSkillPresentation>();
        foreach (var candidate in candidates)
        {
            if (!TryResolveDisplaySkill(candidate.Path, data, out var displaySkill) ||
                (displaySkill.Number("isPetDisplayable") ?? 0) <= 0)
                continue;
            var name = Resolve(displaySkill.Text("skillDisplayName"), data.Tags) ??
                HumanizePath(candidate.Path);
            var description = Resolve(displaySkill.Text("skillBaseDescription"), data.Tags);
            var lines = BuildGrantedSkillLines(
                displaySkill,
                data,
                candidate.Level,
                includeModifierMechanics: true);
            linked.Add(new ItemGrantedSkillPresentation(name, description, null, lines, []));
        }
        return linked;
    }

    private static void AddGrantedSkillSearchParts(
        ItemGrantedSkillPresentation skill,
        List<string> parts)
    {
        parts.Add(skill.Name);
        if (skill.Description is not null) parts.Add(skill.Description);
        if (skill.Trigger is not null) parts.Add(skill.Trigger);
        parts.AddRange(skill.Lines.Select(SearchLine));
        foreach (var linked in skill.LinkedSkills) AddGrantedSkillSearchParts(linked, parts);
    }

    private static void AddSkillModifiers(
        ArzRecord item,
        ItemPresentationSource data,
        List<ItemPresentationSection> sections)
    {
        foreach (var index in NumberedFields(item, "modifiedSkillName"))
        {
            var modifiedSkill = item.Text("modifiedSkillName" + index);
            var modifierSkill = item.Text("modifierSkillName" + index);
            if (modifiedSkill is null || modifierSkill is null ||
                !data.Records.TryGetValue(modifierSkill, out var modifier))
                continue;
            var modifierRecord = ResolveSkillModifierRecord(modifier.Record, data);
            var skillName = ResolveSkillName(modifiedSkill, data);
            var parentSkills = data.GrantedSkillParentPaths(modifiedSkill)
                .Select(path => ResolveSkillName(path, data)).Distinct().ToArray();
            var lines = new List<ItemPresentationLine>();
            AddFlatDamage(modifierRecord, lines, level: 1);
            AddDurationDamage(modifierRecord, lines, level: 1);
            AddSimpleStats(modifierRecord, lines, "standard", level: 1);
            AddRetaliation(modifierRecord, lines, level: 1);
            AddConversions(modifierRecord, lines, level: 1);
            AddSkillModifierSpecialStats(modifierRecord, lines);
            AddHealingAndSlowEffects(modifierRecord, lines, 1);
            AddSkillModifierMechanics(modifierRecord, data, lines);
            AddSkillModifierMechanics(modifier.Record, data, lines);
            var uniqueLines = lines.Distinct().ToArray();
            if (uniqueLines.Length > 0)
                AddOrMergeSection(sections, new ItemPresentationSection(
                    "skill-modifier",
                    skillName,
                    uniqueLines, parentSkills));

            var visualLines = new List<ItemPresentationLine>();
            AddSkillModifierVisuals(modifierRecord, data, visualLines);
            AddSkillModifierVisuals(modifier.Record, data, visualLines);
            var uniqueVisualLines = visualLines.Distinct().ToArray();
            if (uniqueVisualLines.Length > 0)
                AddOrMergeSection(sections, new ItemPresentationSection(
                    "visual-modifier",
                    skillName + " · Visual transformation",
                    uniqueVisualLines, parentSkills));
        }
    }

    private static void AddOrMergeSection(
        List<ItemPresentationSection> sections,
        ItemPresentationSection section)
    {
        var existingIndex = sections.FindIndex(existing =>
            existing.Kind == section.Kind &&
            string.Equals(existing.Heading, section.Heading, StringComparison.Ordinal));
        if (existingIndex < 0)
        {
            sections.Add(section);
            return;
        }
        var existing = sections[existingIndex];
        sections[existingIndex] = existing with
        {
            Lines = existing.Lines.Concat(section.Lines).Distinct().ToArray(),
            ParentSkills = (existing.ParentSkills ?? []).Concat(section.ParentSkills ?? []).Distinct().ToArray()
        };
    }

    private static IEnumerable<int> NumberedFields(ArzRecord record, string prefix) =>
        record.Values.Keys
            .Where(key => key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .Select(key => int.TryParse(key[prefix.Length..], out var index) ? index : 0)
            .Where(index => index > 0).Distinct().Order();

    private static ArzRecord ResolveSkillModifierRecord(
        ArzRecord record,
        ItemPresentationSource data)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (true)
        {
            var next = record.Text("petSkillName") ?? record.Text("buffSkillName");
            if (next is null || !seen.Add(next) || !data.Records.TryGetValue(next, out var source))
                return record;
            record = source.Record;
        }
    }

    private static void AddSkillModifierSpecialStats(
        ArzRecord record,
        List<ItemPresentationLine> lines)
    {
        if (record.Number("offensiveTotalDamageReductionPercentMin") is { } damageReduction &&
            Math.Abs(damageReduction) > 0.001)
        {
            var duration = record.Number("offensiveTotalDamageReductionPercentDurationMin");
            var label = duration is { } seconds && seconds > 0
                ? $"Reduced Target's Damage for {Format(seconds)} Seconds"
                : "Reduced Target's Damage";
            lines.Add(Line(label, Math.Abs(damageReduction), null, "%"));
        }
        if (record.Number("skillCooldownTime") is { } cooldown && Math.Abs(cooldown) > 0.001)
            lines.Add(Line("Skill Recharge", Math.Abs(cooldown), null, "s", prefix: cooldown < 0 ? "−" : "+"));
        if (record.Number("skillActiveDuration") is { } activeDuration && Math.Abs(activeDuration) > 0.001)
            lines.Add(Line("Duration", Math.Abs(activeDuration), null, "s", prefix: activeDuration < 0 ? "−" : "+"));
        if (record.Number("petLimit") is { } summonLimit && Math.Abs(summonLimit) > 0.001)
            lines.Add(Line("Summon Limit", Math.Abs(summonLimit), null, prefix: summonLimit < 0 ? "−" : "+"));
    }

    private static void AddSkillModifierMechanics(
        ArzRecord record,
        ItemPresentationSource data,
        List<ItemPresentationLine> lines,
        bool includeGeometry = true)
    {
        var changedPets = record.Values.GetValueOrDefault("petChanges")?
            .Select(value => value.Text)
            .OfType<string>()
            .Where(path => path.Length > 0)
            .ToArray() ?? [];
        if (changedPets.Any(path =>
                data.Records.TryGetValue(path, out var source) &&
                string.Equals(source.Record.Type, "PetPlayerScaling", StringComparison.OrdinalIgnoreCase)))
        {
            lines.Add(Line("Scales with player bonuses instead of Pet Bonuses", null, null));
        }

        AddExactPercent(record, lines, "weaponDamagePct", "Weapon Damage");
        AddExactPercent(record, lines, "skillChanceWeight", "Chance on Default Weapon Attack", showPositive: true);
        AddExactPercent(record, lines, "projectilePiercing", "Chance to Pass Through Enemies");
        AddExactPercent(record, lines, "retaliationDamagePct", "of Retaliation Damage added to Attack");

        if (record.Number("offensiveDamageMultModifier") is { } totalDamage && Math.Abs(totalDamage) > 0.001)
            lines.Add(Line($"Total Damage Modified by {Format(totalDamage)}%", null, null));
        if (includeGeometry)
        {
            if (record.Number("skillTargetNumber") is { } targets && Math.Abs(targets) > 0.001)
                lines.Add(Line("Target Maximum", Math.Abs(targets), null, prefix: targets < 0 ? "−" : "+"));
            if (record.Number("skillTargetAngle") is { } angle && Math.Abs(angle) > 0.001)
                lines.Add(Line("Attack Arc", Math.Abs(angle), null, "°", prefix: angle < 0 ? "−" : "+"));
            if (record.Number("skillTargetRadius") is { } radius && Math.Abs(radius) > 0.001)
                lines.Add(Line("Target Area", Math.Abs(radius), null, "m", prefix: radius < 0 ? "−" : "+"));
        }
        if (record.Number("projectileLaunchNumber") is { } projectiles && Math.Abs(projectiles) > 0.001)
            lines.Add(Line(Math.Abs(projectiles) == 1 ? "Projectile" : "Projectiles", Math.Abs(projectiles), null,
                prefix: projectiles < 0 ? "−" : "+"));
        if (record.Number("projectileLaunchRotation") is { } spread && Math.Abs(spread) > 0.001)
            lines.Add(Line("Projectile Spread", Math.Abs(spread), null, "°"));
        if (record.Number("explosionRadius") is { } explosionRadius && Math.Abs(explosionRadius) > 0.001)
            lines.Add(Line("Explosion Radius", Math.Abs(explosionRadius), null, "m",
                prefix: explosionRadius < 0 ? "−" : "+"));
        if (record.Number("petBurstSpawn") is { } summons && Math.Abs(summons) > 0.001)
            lines.Add(Line(Math.Abs(summons) == 1 ? "Summon" : "Summons", Math.Abs(summons), null,
                prefix: summons < 0 ? "−" : "+"));
        if (record.Number("petLimit") is { } summonLimit && Math.Abs(summonLimit) > 0.001)
            lines.Add(Line("Summon Limit", Math.Abs(summonLimit), null, prefix: summonLimit < 0 ? "−" : "+"));
        if (record.Number("cooldownCharges") is { } charges && Math.Abs(charges) > 0.001)
            lines.Add(Line(Math.Abs(charges) == 1 ? "Skill Charge" : "Skill Charges", Math.Abs(charges), null,
                prefix: charges < 0 ? "−" : "+"));
        if (record.Number("waveDistance") is { } distance && Math.Abs(distance) > 0.001)
            lines.Add(Line("Travel Distance", Math.Abs(distance), null, "m", prefix: distance < 0 ? "−" : "+"));
        if (record.Number("spawnObjectsTimeToLive") is { } objectDuration && Math.Abs(objectDuration) > 0.001)
            lines.Add(Line("Spawned Object Duration", Math.Abs(objectDuration), null, "s",
                prefix: objectDuration < 0 ? "−" : "+"));

        if (record.Number("skillLifePercent") is { } healing && Math.Abs(healing) > 0.001)
            lines.Add(Line("Health Restored", Math.Abs(healing), null, "%", prefix: healing < 0 ? "−" : "+"));
        if (record.Number("skillLifePercentBuffDuration") is { } healthDuration && Math.Abs(healthDuration) > 0.001)
            lines.Add(Line("Health Bonus Duration", Math.Abs(healthDuration), null, "s",
                prefix: healthDuration < 0 ? "−" : "+"));
        if (record.Number("skillComboChargeLevel") is { } chargeLevel && Math.Abs(chargeLevel) > 0.001)
            lines.Add(Line("Maximum Charge Level", Math.Abs(chargeLevel), null,
                prefix: chargeLevel < 0 ? "−" : "+"));
        if (record.Number("skillComboChargeDuration") is { } chargeDuration && Math.Abs(chargeDuration) > 0.001)
            lines.Add(Line("Charge Duration", Math.Abs(chargeDuration), null, "s",
                prefix: chargeDuration < 0 ? "−" : "+"));

        if (record.Number("skillCooldownReductionChance") is { } cooldownChance && cooldownChance > 0 &&
            record.Number("skillCooldownReduction") is { } cooldownReduction && Math.Abs(cooldownReduction) > 0.001)
        {
            lines.Add(Line(
                $"{Format(cooldownChance)}% Chance for {Format(Math.Abs(cooldownReduction))}% Skill Cooldown Reduction",
                null,
                null));
        }

        AddResistanceReduction(record, lines,
            "offensiveTotalResistanceReductionAbsoluteMin",
            "offensiveTotalResistanceReductionAbsoluteDurationMin",
            "Reduced Target's Resistances");
        AddResistanceReduction(record, lines,
            "offensiveTotalResistanceReductionPercentMin",
            "offensiveTotalResistanceReductionPercentDurationMin",
            "Reduced Target's Resistances",
            "%");
        AddResistanceReduction(record, lines,
            "offensiveSlowDefensiveAbilityMin",
            "offensiveSlowDefensiveAbilityDurationMin",
            "Reduced Target's Defensive Ability");

        if (record.Number("offensiveFreezeMin") is { } freeze && freeze > 0)
        {
            var chance = record.Number("offensiveFreezeChance");
            lines.Add(Line(chance is { } value && value > 0
                    ? $"{Format(value)}% Chance to Freeze Target for {Format(freeze)} Seconds"
                    : $"Freeze Target for {Format(freeze)} Seconds",
                null,
                null));
        }
        if (record.Number("offensivePetrifyMin") is { } petrify && petrify > 0)
            lines.Add(Line($"Petrify Target for {Format(petrify)} Seconds", null, null));

        if (record.Number("sparkChance") is { } sparkChance && sparkChance > 0 &&
            record.Number("sparkMaxNumber") is { } sparkTargets && sparkTargets > 0)
        {
            lines.Add(Line(
                $"{Format(sparkChance)}% Chance to Chain to up to {Format(sparkTargets)} Targets",
                null,
                null));
        }

        AddTriggeredSkillAdjustment(
            record,
            data,
            lines,
            "refreshCooldownSkill",
            "refreshCooldownAmount",
            "refreshCooldownChance",
            "refreshCooldownTrigger",
            "reduce {0}'s recharge by {1} Seconds");
        AddTriggeredSkillAdjustment(
            record,
            data,
            lines,
            "refreshDurationSkill",
            "refreshDurationAmount",
            "refreshDurationChance",
            "refreshDurationTrigger",
            "extend {0} by {1} Seconds",
            record.Number("refreshDurationMax"));
    }

    private static void AddSkillModifierVisuals(
        ArzRecord record,
        ItemPresentationSource data,
        List<ItemPresentationLine> lines)
    {
        var petChanges = record.Values.GetValueOrDefault("petChanges")?
            .Select(value => value.Text)
            .OfType<string>()
            .Where(value => value.Length > 0)
            .ToArray() ?? [];
        if (petChanges.Length > 0)
        {
            var form = DescribeChangedForm(petChanges[0], data);
            lines.Add(Line(form is null ? "Alternate summoned form" : "Summoned form: " + form,
                null, null, tone: "visual"));
        }

        var shapeshift = record.Text("shapeshiftMeshOverrideMale") ?? record.Text("shapeshiftMeshOverrideFemale");
        if (shapeshift is not null)
        {
            var form = DescribeVisualPath(shapeshift);
            lines.Add(Line(form is null ? "Alternate shapeshift form" : "Shapeshift form: " + form,
                null, null, tone: "visual"));
        }

        AddVisualOverride(record, lines, ["projectileOverride", "projectileFXOverride", "projectileFragmentsOverride"],
            "Alternate projectile effects");
        AddVisualOverride(record, lines, ["targetFxPakOverride"], "Alternate impact effects");
        AddVisualOverride(record, lines, ["waveFxPakOverride"], "Alternate wave effects");
        AddVisualOverride(record, lines, ["lineEffectOverride"], "Alternate line effects");
        AddVisualOverride(record, lines, ["lightningOverride"], "Alternate lightning effects");
        AddVisualOverride(record, lines, ["particleEffect1Override", "particleEffect2Override"],
            "Alternate particle effects");
        AddVisualOverride(record, lines, ["warmUpEffectName"], "Alternate warm-up effects");
        AddVisualOverride(record, lines, ["charFxPakOtherNames"], "Alternate character effects");
        AddVisualOverride(record, lines, ["fxChanges"], "Alternate skill effects");
    }

    private static void AddExactPercent(
        ArzRecord record,
        List<ItemPresentationLine> lines,
        string field,
        string label,
        bool showPositive = false)
    {
        if (record.Number(field) is not { } value || Math.Abs(value) < 0.001) return;
        lines.Add(Line(label, Math.Abs(value), null, "%",
            prefix: value < 0 ? "−" : showPositive ? "+" : string.Empty));
    }

    private static void AddResistanceReduction(
        ArzRecord record,
        List<ItemPresentationLine> lines,
        string valueField,
        string durationField,
        string label,
        string unit = "")
    {
        if (record.Number(valueField) is not { } value || Math.Abs(value) < 0.001) return;
        var duration = record.Number(durationField);
        var suffix = duration is { } seconds && seconds > 0
            ? $" for {Format(seconds)} Seconds"
            : string.Empty;
        lines.Add(Line(label, Math.Abs(value), null, unit, suffix: suffix));
    }

    private static void AddTriggeredSkillAdjustment(
        ArzRecord record,
        ItemPresentationSource data,
        List<ItemPresentationLine> lines,
        string skillField,
        string amountField,
        string chanceField,
        string triggerField,
        string actionFormat,
        double? maximum = null)
    {
        var skill = record.Text(skillField);
        var amount = record.Number(amountField);
        var chance = record.Number(chanceField);
        if (skill is null || amount is not { } seconds || chance is not { } chanceValue ||
            Math.Abs(seconds) < 0.001 || chanceValue <= 0)
            return;
        var action = string.Format(
            CultureInfo.InvariantCulture,
            actionFormat,
            ResolveSkillName(skill, data),
            Format(Math.Abs(seconds)));
        var maximumText = maximum is { } cap && cap > 0 ? $" (up to {Format(cap)} Seconds)" : string.Empty;
        lines.Add(Line($"{Format(chanceValue)}% Chance {TriggerPhrase(record.Text(triggerField))} to {action}{maximumText}",
            null, null));
    }

    private static string TriggerPhrase(string? trigger) => trigger switch
    {
        "AttackEnemyCrit" => "on Critical Attack",
        "AttackEnemy" => "on Attack",
        "HitByEnemy" => "when Hit",
        "KillEnemy" => "on Enemy Death",
        _ => "when triggered"
    };

    private static void AddVisualOverride(
        ArzRecord record,
        List<ItemPresentationLine> lines,
        IReadOnlyList<string> fields,
        string label)
    {
        if (!fields.Any(field => record.Values.GetValueOrDefault(field)?.Any(value =>
                !string.IsNullOrWhiteSpace(value.Text)) == true))
            return;
        lines.Add(Line(label, null, null, tone: "visual"));
    }

    private static string? DescribeChangedForm(string path, ItemPresentationSource data)
    {
        if (!data.Records.TryGetValue(path, out var source)) return DescribeVisualPath(path);
        var candidates = new[]
        {
            source.Record.Text("mesh"),
            source.Record.Text("baseTexture"),
            source.Record.Text("unarmedSpawnAnim"),
            path
        };
        foreach (var candidate in candidates)
        {
            var description = DescribeVisualPath(candidate);
            if (description is not null) return description;
        }
        return null;
    }

    private static string? DescribeVisualPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        if (path.Contains("direwolf", StringComparison.OrdinalIgnoreCase)) return "Direwolf";
        if (path.Contains("raven", StringComparison.OrdinalIgnoreCase) &&
            path.Contains("spectral", StringComparison.OrdinalIgnoreCase)) return "Spectral Raven";
        if (path.Contains("werewolf", StringComparison.OrdinalIgnoreCase)) return "Werewolf";
        if (path.Contains("inquisitorseal_aether", StringComparison.OrdinalIgnoreCase)) return "Aether form";
        return null;
    }

    private static bool TryResolveDisplaySkill(
        string path,
        ItemPresentationSource data,
        out ArzRecord skill)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (seen.Add(path) && data.Records.TryGetValue(path, out var source))
        {
            skill = source.Record;
            if (skill.Text("skillDisplayName") is not null) return true;
            path = skill.Text("buffSkillName") ?? skill.Text("petSkillName") ?? string.Empty;
            if (path.Length == 0) break;
        }
        skill = null!;
        return false;
    }

    private static string ResolveSkillName(string path, ItemPresentationSource data) =>
        TryResolveDisplaySkill(path, data, out var skill)
            ? Resolve(skill.Text("skillDisplayName"), data.Tags) ?? HumanizePath(path)
            : HumanizePath(path);

    private static string ResolveMasteryName(string path, ItemPresentationSource data)
    {
        if (data.Records.TryGetValue(path, out var source))
        {
            foreach (var field in new[] { "skillDisplayName", "skillTabTitle", "description" })
            {
                var resolved = Resolve(source.Record.Text(field), data.Tags);
                if (!string.IsNullOrWhiteSpace(resolved)) return resolved;
            }
        }
        return HumanizePath(path);
    }

    private static NumericRange RollRange(ArzRecord record, string field, double value, bool scaled)
    {
        if (IsFixed(field)) return new NumericRange(value, value);
        var spread = (int)(Math.Abs(value) * JitterPercent * 0.01);
        if (spread == 0) spread = 1;
        var minimum = value - spread;
        var maximum = value + spread;
        if (scaled)
        {
            var scale = record.Number("attributeScalePercent") ?? 0;
            minimum = Math.Truncate((float)minimum * (float)(100 + scale) / 100f);
            maximum = Math.Truncate((float)maximum * (float)(100 + scale) / 100f);
        }
        return new NumericRange(minimum, maximum);
    }

    private static bool IsFixed(string field) =>
        field.StartsWith("augment", StringComparison.Ordinal) ||
        field is "defensiveProtection" or "defensiveBlockChance" or "defensiveBlock" or
            "blockRecoveryTime" or "characterBaseAttackSpeed";

    private static ItemPresentationLine Line(
        string label,
        double? minimum,
        double? maximum,
        string unit = "",
        string tone = "standard",
        string prefix = "",
        string suffix = "")
    {
        if (minimum.HasValue && maximum.HasValue && maximum.Value < minimum.Value)
            (minimum, maximum) = (maximum, minimum);
        return new(
            label,
            minimum,
            maximum.HasValue && minimum.HasValue && Math.Abs(maximum.Value - minimum.Value) < 0.001
                ? null
                : maximum,
            unit,
            tone,
            prefix,
            suffix);
    }

    private static string SearchLine(ItemPresentationLine line) =>
        string.Join(' ', new[] { line.Label, line.Prefix, line.Suffix });

    private static string? Resolve(string? tag, IReadOnlyDictionary<string, string> tags) =>
        string.IsNullOrWhiteSpace(tag) ? null : tags.GetValueOrDefault(tag, tag);

    private static double? NumberAt(ArzRecord record, string field, int level)
    {
        if (!record.Values.TryGetValue(field, out var values)) return null;
        var numbers = values.Where(value => value.Number.HasValue).Select(value => value.Number!.Value).ToArray();
        if (numbers.Length == 0) return null;
        return numbers[Math.Clamp(level - 1, 0, numbers.Length - 1)];
    }

    private static string? TextAt(ArzRecord record, string field, int level)
    {
        if (!record.Values.TryGetValue(field, out var values)) return null;
        var text = values.Select(value => value.Text).Where(value => !string.IsNullOrWhiteSpace(value)).ToArray();
        return text.Length == 0 ? null : text[Math.Clamp(level - 1, 0, text.Length - 1)];
    }

    private static int? RecordInteger(ArzRecord record, string field)
    {
        if (record.Number(field) is { } number)
            return checked((int)Math.Round(number));
        return int.TryParse(record.Text(field), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static string? TrimQuotes(string? value) =>
        value is { Length: >= 2 } && value[0] == '"' && value[^1] == '"'
            ? value[1..^1]
            : value;

    private static string? ResolveTrigger(string? controller, ArzRecord skill, int level)
    {
        if (controller is not null)
        {
            var chance = PercentPattern().Match(controller).Groups[1].Value;
            var prefix = chance.Length > 0 ? chance + "% " : string.Empty;
            if (controller.Contains("onattackcrit", StringComparison.OrdinalIgnoreCase))
                return prefix + "Chance on Critical Attack";
            if (controller.Contains("onmeleehit", StringComparison.OrdinalIgnoreCase))
                return prefix + "Chance on Melee Attack";
            if (controller.Contains("onattack", StringComparison.OrdinalIgnoreCase))
                return prefix + "Chance on Attack";
            if (controller.Contains("onanyhit", StringComparison.OrdinalIgnoreCase))
                return prefix + "Chance when Hit";
            if (controller.Contains("onblock", StringComparison.OrdinalIgnoreCase))
                return prefix + "Chance on Block";
            if (controller.Contains("onkill", StringComparison.OrdinalIgnoreCase))
                return prefix + "Chance on Enemy Death";
            var healthThreshold = HealthThresholdPattern().Match(controller).Groups[1].Value;
            if (healthThreshold.Length > 0)
                return prefix + "Chance at " + healthThreshold + "% Health";
            if (controller.Contains("onlowhealth", StringComparison.OrdinalIgnoreCase))
                return prefix + "Chance at Low Health";
            if (prefix.Length > 0) return prefix.Trim();
        }

        if (skill.Type.StartsWith("Skill_WPAttack", StringComparison.OrdinalIgnoreCase) &&
            NumberAt(skill, "skillChanceWeight", level) is { } chanceWeight &&
            chanceWeight > 0)
        {
            return Format(chanceWeight) + "% Chance on Default Weapon Attack";
        }
        return null;
    }

    private static string DamageName(string value) => value switch
    {
        "Life" => "Vitality",
        "Poison" => "Acid",
        "SlowPhysical" => "Internal Trauma",
        "SlowFire" => "Burn",
        "SlowCold" => "Frostburn",
        "SlowLightning" => "Electrocute",
        "SlowLife" => "Vitality Decay",
        _ => value.Replace("Base", string.Empty, StringComparison.Ordinal)
    };

    private static string HumanizePath(string path)
    {
        var name = Path.GetFileNameWithoutExtension(path).Replace('_', ' ');
        return CultureInfo.InvariantCulture.TextInfo.ToTitleCase(name);
    }

    private static string Format(double value) => value.ToString("0.#", CultureInfo.InvariantCulture);

    [GeneratedRegex(@"_([0-9]+)%", RegexOptions.CultureInvariant)]
    private static partial Regex PercentPattern();

    [GeneratedRegex(@"selfat([0-9]+)%health", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HealthThresholdPattern();

    private static void AddHealingAndSlowEffects(ArzRecord record, List<ItemPresentationLine> lines, int level)
    {
        if (NumberAt(record, "skillLifeBonusBuffDuration", level) is { } healing && Math.Abs(healing) > 0.001)
            lines.Add(Line("Health Restored per Second", healing, null));
        foreach (var (field, label) in new[] {
            ("offensiveSlowTotalSpeed", "Total Speed"),
            ("offensiveSlowAttackSpeed", "Attack Speed"),
            ("offensiveSlowRunSpeed", "Movement Speed"),
            ("offensiveSlowSpellCastSpeed", "Casting Speed") })
        {
            if (NumberAt(record, field + "Min", level) is not { } amount || Math.Abs(amount) < 0.001) continue;
            var maximum = NumberAt(record, field + "Max", level);
            var duration = NumberAt(record, field + "DurationMin", level);
            var suffix = duration is > 0 ? $" for {Format(duration.Value)} {(duration == 1 ? "Second" : "Seconds")}" : "";
            var chance = NumberAt(record, field + "Chance", level);
            var prefix = chance is > 0 and < 100 ? $"{Format(chance.Value)}% Chance for " : "";
            lines.Add(Line("Reduced Target's " + label + suffix, amount,
                maximum is > 0 && maximum != amount ? maximum : null, "%", prefix: prefix));
        }
    }

    private sealed record StatLabel(string Label, string Unit = "");
    private readonly record struct NumericRange(double Minimum, double Maximum);
}

internal sealed record ItemPresentationSource(
    IReadOnlyDictionary<string, string> Tags,
    IReadOnlyDictionary<string, CatalogSourceRecord> Records)
{
    private IReadOnlyDictionary<string, string[]>? grantedSkillParents;

    public IReadOnlyList<string> GrantedSkillParentPaths(string path)
    {
        grantedSkillParents ??= Records.Values
            .SelectMany(source => (source.Record.Values.GetValueOrDefault("grantedSkills") ?? [])
                .Where(value => !string.IsNullOrWhiteSpace(value.Text))
                .Select(value => (Child: value.Text!, Parent: source.Record.Name)))
            .GroupBy(pair => pair.Child, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Select(pair => pair.Parent).Distinct().ToArray(),
                StringComparer.OrdinalIgnoreCase);
        return grantedSkillParents.GetValueOrDefault(path) ?? [];
    }

}

internal sealed record ItemPresentation(
    string? FlavorText,
    IReadOnlyList<ItemPresentationSection> Sections,
    ItemGrantedSkillPresentation? GrantedSkill,
    string SearchText);
internal sealed record ItemPresentationSection(
    string Kind,
    string? Heading,
    IReadOnlyList<ItemPresentationLine> Lines,
    IReadOnlyList<string>? ParentSkills = null);
internal sealed record ItemPresentationLine(
    string Label,
    double? Minimum,
    double? Maximum,
    string Unit,
    string Tone,
    string Prefix,
    string Suffix);
internal sealed record ItemGrantedSkillPresentation(
    string Name,
    string? Description,
    string? Trigger,
    IReadOnlyList<ItemPresentationLine> Lines,
    IReadOnlyList<ItemGrantedSkillPresentation> LinkedSkills);
internal sealed record ItemSetPresentation(
    string Name,
    string? Description,
    IReadOnlyList<string> Members,
    IReadOnlyList<ItemSetBonusTier> Tiers);
internal sealed record ItemSetBonusTier(
    int RequiredPieces,
    IReadOnlyList<ItemPresentationLine> Lines,
    IReadOnlyList<ItemPresentationLine> PetLines,
    IReadOnlyList<ItemPresentationSection> SkillModifiers,
    ItemGrantedSkillPresentation? GrantedSkill);
