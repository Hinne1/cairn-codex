namespace CairnCodex.GrimDawn;

internal static class RollCategoryClassifier
{
    private static readonly (string Token, string DamageType)[] DamageTypes =
    {
        ("Physical", "physical"),
        ("Pierce", "pierce"),
        ("Bleeding", "bleeding"),
        ("Fire", "fire"),
        ("Cold", "cold"),
        ("Lightning", "lightning"),
        ("Poison", "acid"),
        ("Life", "vitality"),
        ("Aether", "aether"),
        ("Chaos", "chaos"),
        ("Elemental", "elemental")
    };

    private static readonly string[] DefensiveCharacterTokens =
    {
        "Life",
        "Constitution",
        "DefensiveAbility",
        "HealIncrease",
        "DefensiveBlockRecovery",
        "EnergyAbsorption",
        "Dodge",
        "DeflectProjectile"
    };

    private static readonly string[] OffensiveCharacterTokens =
    {
        "OffensiveAbility",
        "TotalSpeed",
        "AttackSpeed",
        "SpellCastSpeed"
    };

    public static RollCategoryIdentity Classify(string field)
    {
        if (field.StartsWith("defensive", StringComparison.Ordinal))
        {
            return new RollCategoryIdentity("defense", null);
        }
        if (field.StartsWith("retaliation", StringComparison.Ordinal))
        {
            return new RollCategoryIdentity("retaliation", null);
        }
        if (field.StartsWith("offensive", StringComparison.Ordinal))
        {
            return new RollCategoryIdentity("offense", DamageType(field));
        }
        if (field.StartsWith("conversion", StringComparison.Ordinal))
        {
            return new RollCategoryIdentity("offense", null);
        }
        if (field.StartsWith("skill", StringComparison.Ordinal))
        {
            return new RollCategoryIdentity(
                field.Contains("ProjectileSpeed", StringComparison.Ordinal) ? "offense" : "utility",
                null);
        }
        if (field.StartsWith("character", StringComparison.Ordinal))
        {
            if (DefensiveCharacterTokens.Any(token => field.Contains(token, StringComparison.Ordinal)))
            {
                return new RollCategoryIdentity("defense", null);
            }
            if (OffensiveCharacterTokens.Any(token => field.Contains(token, StringComparison.Ordinal)))
            {
                return new RollCategoryIdentity("offense", null);
            }
        }
        // Unknown modeled fields remain visible instead of disappearing from the profile. Utility
        // is the conservative fallback because it makes no claim about a damage type or defense.
        return new RollCategoryIdentity("utility", null);
    }

    public static int DamageTypeOrder(string damageType)
    {
        for (var index = 0; index < DamageTypes.Length; index++)
        {
            if (DamageTypes[index].DamageType == damageType) return index;
        }
        return int.MaxValue;
    }

    private static string? DamageType(string field)
    {
        if (field.Contains("LifeLeech", StringComparison.Ordinal) ||
            field.Contains("LifeLeach", StringComparison.Ordinal))
        {
            return null;
        }
        foreach (var (token, damageType) in DamageTypes)
        {
            if (field.Contains(token, StringComparison.Ordinal)) return damageType;
        }
        return null;
    }
}
