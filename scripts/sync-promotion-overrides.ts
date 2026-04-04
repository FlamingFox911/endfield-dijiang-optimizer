import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();
const BUNDLE_DIR = path.join(REPO_ROOT, "catalogs", "2026-03-20-v1.1-phase1");
const USER_AGENT = "endfield-dijiang-optimizer-catalog-maintainer/0.1 (Codex workspace)";
const TODAY = "2026-03-21";

type MaterialCost = {
  itemId: string;
  quantity: number;
};

type SourceRef = {
  id: string;
  label: string;
  url: string;
  retrievedOn: string;
  confidence: "community";
  notes?: string;
};

type OperatorRecord = {
  id: string;
  name: string;
};

type SourcesDocument = {
  catalogVersion: string;
  sources: SourceRef[];
};

type ProgressionDocument = {
  catalogVersion: string;
  baseSkillRanks: Array<Record<string, unknown>>;
  promotionTiers?: Array<Record<string, unknown>>;
  promotionOverrides?: Array<Record<string, unknown>>;
};

type ManifestDocument = {
  catalogId: string;
  catalogVersion: string;
  gameVersion: string;
  snapshotDate: string;
  appCompatibility?: Record<string, unknown>;
  files: Record<string, string>;
  counts?: Record<string, number>;
  notes?: string[];
};

function wikiPageName(name: string): string {
  return encodeURIComponent(name.replace(/ /g, "_"));
}

function sourceIdForOperator(operatorId: string): string {
  return `wiki-${operatorId}`;
}

function sourceLabelForOperator(name: string): string {
  return `Endfield Talos Wiki ${name} page`;
}

function toItemId(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseMaterialCost(part: string): MaterialCost {
  const match = part.trim().match(/^(.+?) x(\d+)$/);
  const [, itemName, quantityText] = match ?? [];
  if (!itemName || !quantityText) {
    throw new Error(`Could not parse material segment '${part}'.`);
  }

  return {
    itemId: toItemId(itemName.trim()),
    quantity: Number(quantityText),
  };
}

async function fetchOperatorE4Line(operator: OperatorRecord): Promise<string> {
  const url = `https://endfield.wiki.gg/wiki/${wikiPageName(operator.name)}?action=raw`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const raw = await response.text();
  const match = raw.match(/^\|e4\s*=\s*(.+)$/m);
  const [, e4Line] = match ?? [];
  if (!e4Line) {
    throw new Error(`Could not find '|e4 =' for ${operator.name}.`);
  }

  return e4Line.trim();
}

async function main() {
  const [operatorsRaw, sourcesRaw, progressionRaw, manifestRaw] = await Promise.all([
    fs.readFile(path.join(BUNDLE_DIR, "operators.json"), "utf8"),
    fs.readFile(path.join(BUNDLE_DIR, "sources.json"), "utf8"),
    fs.readFile(path.join(BUNDLE_DIR, "progression.json"), "utf8"),
    fs.readFile(path.join(BUNDLE_DIR, "manifest.json"), "utf8"),
  ]);

  const operators = (JSON.parse(operatorsRaw) as { operators: OperatorRecord[] }).operators;
  const sourcesDoc = JSON.parse(sourcesRaw) as SourcesDocument;
  const progressionDoc = JSON.parse(progressionRaw) as ProgressionDocument;
  const manifestDoc = JSON.parse(manifestRaw) as ManifestDocument;

  const sharedPromotionTiers = [
    {
      promotionTier: 1,
      requiredLevel: 20,
      materialCosts: [
        { itemId: "protodisk", quantity: 8 },
        { itemId: "pink-bolete", quantity: 3 },
        { itemId: "t-creds", quantity: 1600 },
      ],
      sourceRefs: [
        {
          id: "wiki-operator-overview",
          label: "Endfield Talos Wiki Operator overview page",
          url: "https://endfield.wiki.gg/wiki/Operator",
          retrievedOn: TODAY,
          confidence: "community",
          notes: "Used for shared Base Skill node costs and shared promotion requirements from wiki text.",
        },
      ],
    },
    {
      promotionTier: 2,
      requiredLevel: 40,
      materialCosts: [
        { itemId: "protodisk", quantity: 25 },
        { itemId: "red-bolete", quantity: 5 },
        { itemId: "t-creds", quantity: 6500 },
      ],
      sourceRefs: [
        {
          id: "wiki-operator-overview",
          label: "Endfield Talos Wiki Operator overview page",
          url: "https://endfield.wiki.gg/wiki/Operator",
          retrievedOn: TODAY,
          confidence: "community",
          notes: "Used for shared Base Skill node costs and shared promotion requirements from wiki text.",
        },
      ],
    },
    {
      promotionTier: 3,
      requiredLevel: 60,
      materialCosts: [
        { itemId: "protoset", quantity: 24 },
        { itemId: "ruby-bolete", quantity: 5 },
        { itemId: "t-creds", quantity: 18000 },
      ],
      sourceRefs: [
        {
          id: "wiki-operator-overview",
          label: "Endfield Talos Wiki Operator overview page",
          url: "https://endfield.wiki.gg/wiki/Operator",
          retrievedOn: TODAY,
          confidence: "community",
          notes: "Used for shared Base Skill node costs and shared promotion requirements from wiki text.",
        },
      ],
    },
    {
      promotionTier: 4,
      requiredLevel: 80,
      materialCosts: [
        { itemId: "protoset", quantity: 36 },
        { itemId: "t-creds", quantity: 100000 },
      ],
      sourceRefs: [
        {
          id: "wiki-operator-overview",
          label: "Endfield Talos Wiki Operator overview page",
          url: "https://endfield.wiki.gg/wiki/Operator",
          retrievedOn: TODAY,
          confidence: "community",
          notes: "Used for shared Base Skill node costs and shared promotion requirements from wiki text.",
        },
      ],
    },
  ];

  const promotionOverrides = [];

  for (const operator of operators) {
    const e4Line = await fetchOperatorE4Line(operator);
    const materialCosts = e4Line.split(",").map(parseMaterialCost);
    const additionalMaterialCosts = materialCosts.filter(
      (cost) => cost.itemId !== "protoset" && cost.itemId !== "t-creds",
    );

    if (additionalMaterialCosts.length === 0) {
      throw new Error(`No operator-specific Promotion IV materials found for ${operator.name}.`);
    }

    const sourceId = sourceIdForOperator(operator.id);
    const sourceRef: SourceRef = {
      id: sourceId,
      label: sourceLabelForOperator(operator.name),
      url: `https://endfield.wiki.gg/wiki/${wikiPageName(operator.name)}`,
      retrievedOn: TODAY,
      confidence: "community",
      notes: "Used for operator Promotion IV material requirements from raw wiki page source.",
    };

    const existingSourceIndex = sourcesDoc.sources.findIndex((existing) => existing.id === sourceId);
    if (existingSourceIndex >= 0) {
      sourcesDoc.sources[existingSourceIndex] = {
        ...sourcesDoc.sources[existingSourceIndex],
        ...sourceRef,
      };
    } else {
      sourcesDoc.sources.push(sourceRef);
    }

    promotionOverrides.push({
      operatorId: operator.id,
      promotionTier: 4,
      additionalMaterialCosts,
      sourceRefs: [sourceRef],
    });
  }

  sourcesDoc.sources.sort((left, right) => left.id.localeCompare(right.id));
  progressionDoc.promotionTiers = sharedPromotionTiers;
  progressionDoc.promotionOverrides = promotionOverrides;

  const gapsDoc = {
    catalogVersion: manifestDoc.catalogVersion,
    gaps: [],
  };

  manifestDoc.counts = {
    ...(manifestDoc.counts ?? {}),
    operators: operators.length,
    sources: sourcesDoc.sources.length,
    gaps: 0,
  };
  manifestDoc.notes = [
    "This bundle covers the full released assignable operator roster for the 2026-03-20 snapshot; Endministrator remains intentionally excluded.",
    "Exact in-game Greek-letter Base Skill labels are recorded from in-game screenshots; clue-target Reception Room skills are preserved for manual hard-assignment use but treated as score-neutral in optimization.",
    "Shared Base Skill node costs, shared promotion tiers, and operator-specific Promotion IV material overrides are sourced from the Operator overview page and per-operator raw wiki pages.",
  ];

  await Promise.all([
    fs.writeFile(path.join(BUNDLE_DIR, "progression.json"), `${JSON.stringify(progressionDoc, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(BUNDLE_DIR, "sources.json"), `${JSON.stringify(sourcesDoc, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(BUNDLE_DIR, "gaps.json"), `${JSON.stringify(gapsDoc, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(BUNDLE_DIR, "manifest.json"), `${JSON.stringify(manifestDoc, null, 2)}\n`, "utf8"),
  ]);

  console.log(`Updated Promotion IV overrides for ${promotionOverrides.length} operators.`);
}

await main();
