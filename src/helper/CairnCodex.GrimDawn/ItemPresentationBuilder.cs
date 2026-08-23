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
            ["skillCooldownReduction"] = new("Skill Cooldown Reduction", "%"),
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
        searchParts.AddRange(sections.SelectMany(section => section.Lines).Select(SearchLine));
        if (grantedSkill is not null)
        {
            searchParts.Add(grantedSkill.Name);
            if (grantedSkill.Description is not null) searchParts.Add(grantedSkill.Description);
            if (grantedSkill.Trigger is not null) searchParts.Add(grantedSkill.Trigger);
            searchParts.AddRange(grantedSkill.Lines.Select(SearchLine));
        }
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
            var skillBecameActive = IsTierValueActive(record, "itemSkillLevel", level) &&
                !IsTierValueActive(record, "itemSkillLevel", level - 1);
            var skillModifiers = new List<ItemPresentationSection>();
            if (skillBecameActive) AddSkillModifiers(record, data, skillModifiers);
            var grantedSkill = skillBecameActive ? BuildGrantedSkill(record, data) : null;
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
            Resolve(record.Text("setDescription"), data.Tags),
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
            var range = level.HasValue
                ? new NumericRange(value, value)
                : RollRange(record, pair.Key, value, scaled);
            var prefix = pair.Key is "skillCooldownReduction" or "skillManaCostReduction" || value < 0
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
            var range = new NumericRange(
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
        for (var index = 1; index <= 4; index++)
        {
            var path = record.Text("augmentSkillName" + index);
            var value = NumberAt(record, "augmentSkillLevel" + index, level);
            if (path is null || value is not { } amount || Math.Abs(amount) < 0.001) continue;
            lines.Add(Line("to " + ResolveSkillName(path, data), amount, null, tone: "skill", prefix: "+"));
        }
        for (var index = 1; index <= 3; index++)
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
        for (var index = 1; index <= 4; index++)
        {
            var skillRecord = record.Text("augmentSkillName" + index);
            var level = record.Number("augmentSkillLevel" + index);
            if (skillRecord is null || level is null) continue;
            lines.Add(Line("to " + ResolveSkillName(skillRecord, data), level.Value, null, tone: "skill", prefix: "+"));
        }
        for (var index = 1; index <= 4; index++)
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
        var trigger = ResolveTrigger(item.Text("itemSkillAutoController"));
        var level = Math.Max(1, RecordInteger(item, "itemSkillLevelEq") ??
            RecordInteger(item, "itemSkillLevel") ?? 1);
        var lines = new List<ItemPresentationLine>();
        if (NumberAt(skill, "skillManaCost", level) is { } energy)
            lines.Add(Line("Energy Cost", energy, null));
        if (NumberAt(skill, "skillCooldownTime", level) is { } cooldown)
            lines.Add(Line("Skill Recharge", cooldown, null, "s"));
        if (NumberAt(skill, "skillActiveDuration", level) is { } duration)
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
        return new ItemGrantedSkillPresentation(name, description, trigger, lines);
    }

    private static void AddSkillModifiers(
        ArzRecord item,
        ItemPresentationSource data,
        List<ItemPresentationSection> sections)
    {
        for (var index = 1; index <= 6; index++)
        {
            var modifiedSkill = item.Text("modifiedSkillName" + index);
            var modifierSkill = item.Text("modifierSkillName" + index);
            if (modifiedSkill is null || modifierSkill is null ||
                !data.Records.TryGetValue(modifierSkill, out var modifier))
                continue;
            var modifierRecord = ResolveSkillModifierRecord(modifier.Record, data);
            var lines = new List<ItemPresentationLine>();
            AddFlatDamage(modifierRecord, lines, level: 1);
            AddDurationDamage(modifierRecord, lines, level: 1);
            AddSimpleStats(modifierRecord, lines, "standard", level: 1);
            AddConversions(modifierRecord, lines, level: 1);
            AddSkillModifierSpecialStats(modifierRecord, lines);
            if (lines.Count > 0)
                sections.Add(new ItemPresentationSection(
                    "skill-modifier",
                    ResolveSkillName(modifiedSkill, data),
                    lines));
        }
    }

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

    private static string ResolveTrigger(string? controller)
    {
        if (controller is null) return string.Empty;
        var chance = PercentPattern().Match(controller).Groups[1].Value;
        var prefix = chance.Length > 0 ? chance + "% " : string.Empty;
        if (controller.Contains("enemyonattack", StringComparison.OrdinalIgnoreCase)) return prefix + "Chance on Attack";
        if (controller.Contains("enemyonanyhit", StringComparison.OrdinalIgnoreCase)) return prefix + "Chance when Hit";
        if (controller.Contains("selfonblock", StringComparison.OrdinalIgnoreCase)) return prefix + "Chance when Blocking";
        if (controller.Contains("selfonkill", StringComparison.OrdinalIgnoreCase)) return prefix + "Chance on Enemy Death";
        if (controller.Contains("selfonlowhealth", StringComparison.OrdinalIgnoreCase)) return prefix + "Chance at Low Health";
        return prefix.Trim();
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

    private sealed record StatLabel(string Label, string Unit = "");
    private readonly record struct NumericRange(double Minimum, double Maximum);
}

internal sealed record ItemPresentationSource(
    IReadOnlyDictionary<string, string> Tags,
    IReadOnlyDictionary<string, CatalogSourceRecord> Records);

internal sealed record ItemPresentation(
    string? FlavorText,
    IReadOnlyList<ItemPresentationSection> Sections,
    ItemGrantedSkillPresentation? GrantedSkill,
    string SearchText);
internal sealed record ItemPresentationSection(
    string Kind,
    string? Heading,
    IReadOnlyList<ItemPresentationLine> Lines);
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
    IReadOnlyList<ItemPresentationLine> Lines);
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
