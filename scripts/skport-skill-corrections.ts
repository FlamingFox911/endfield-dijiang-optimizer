import type { BaseSkillDefinition, EffectMetric, FacilityKind, ModifierTarget, SourceRef } from "@endfield/domain";

// SKPORT still has several pre-release labels and Avywenna's retired factory skill.
// Audited against extracted game data on 2026-09-13; see docs/base-skill-audit.md.
// Match the known erroneous effect as well as the ID so future balance changes
// are not silently replaced with this snapshot.
const LABEL_CORRECTIONS: Record<string, [FacilityKind, EffectMetric, ModifierTarget, number, number]> = {
  "ember:special-northern-training": ["manufacturing_cabin", "production_efficiency", "operator_exp", 20, 30],
  "chen-qianyu:jadeworking": ["growth_chamber", "growth_rate", "rare_mineral", 20, 30],
  "lifeng:youthful-ambition": ["control_nexus", "mood_regen", "all", 12, 16],
  "yvonne:fungal-pigment-extraction": ["growth_chamber", "growth_rate", "fungal", 20, 30],
  "yvonne:fashionista": ["growth_chamber", "mood_drop_reduction", "all", 14, 18],
  "da-pan:worldly-wisdom": ["control_nexus", "mood_regen", "all", 12, 16],
  "last-rite:cemetery-gardening": ["growth_chamber", "growth_rate", "vitrified_plant", 20, 30],
};

function matchesEffect(skill: BaseSkillDefinition, expected: [FacilityKind, EffectMetric, ModifierTarget, number, number]): boolean {
  const [facility, metric, target, firstValue, secondValue] = expected;
  return skill.facilityKind === facility && skill.ranks.length === 2
    && skill.ranks.every((rank, index) => rank.modifiers.length === 1
      && rank.modifiers[0]?.metric === metric
      && rank.modifiers[0]?.appliesTo === target
      && rank.modifiers[0]?.unit === "percent"
      && rank.modifiers[0]?.value === [firstValue, secondValue][index]);
}

export function correctSkportBaseSkill(operatorId: string, original: BaseSkillDefinition): BaseSkillDefinition {
  let skill = original;
  const expected = LABEL_CORRECTIONS[`${operatorId}:${skill.id}`];
  if (expected && matchesEffect(skill, expected)
    && skill.ranks[0]?.label === "alpha" && skill.ranks[1]?.label === "beta") {
    skill = {
      ...skill,
      ranks: skill.ranks.map((rank, index) => ({ ...rank, label: index === 0 ? "beta" : "gamma" })),
    };
  }
  if (operatorId === "da-pan" && skill.id === "worldly-wisdom" && skill.name === "Wordly Wisdom") {
    skill = { ...skill, name: "Worldly Wisdom" };
  }
  if (operatorId === "avywenna" && skill.id === "messengers-secret" && skill.name === "Factory Pioneer"
    && skill.ranks[0]?.label === "alpha" && skill.ranks[1]?.label === "beta"
    && matchesEffect(skill, ["manufacturing_cabin", "production_efficiency", "weapon_exp", 10, 20])) {
    skill = {
      ...skill,
      name: "Messenger's Secret",
      facilityKind: "reception_room",
      icon: {
        id: "skill-avywenna-messengers-secret-corrected-icon",
        kind: "icon",
        path: "https://endfieldtools.dev/assets/images/endfield/facskillicon/facskill_spaceship_guestroom_clue.png",
        attribution: "Released Messenger's Secret icon from EndfieldTools extracted game data.",
      },
      ranks: skill.ranks.map((rank, index) => ({
        ...rank,
        modifiers: [{ metric: "clue_rate_up", appliesTo: "clue_2", value: index + 1, unit: "tier" }],
      })),
    };
  }
  if (skill === original) return original;
  const source: SourceRef = {
    id: `base-skill-audit-${operatorId}`,
    label: `Released ${operatorId} Base Skill correction (2026-09-13 audit)`,
    url: `https://endfieldtools.dev/characters/${operatorId}/`,
    retrievedOn: "2026-09-13",
    confidence: "manual_override",
    notes: "Corrects a known stale SKPORT entry using extracted game skill names, effects and rank suffixes. See docs/base-skill-audit.md.",
  };
  return {
    ...skill,
    sourceRefs: [...skill.sourceRefs, source],
    ranks: skill.ranks.map((rank) => ({ ...rank, sourceRefs: [...rank.sourceRefs, source] })),
  };
}
