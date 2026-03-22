import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";
import { chromium } from "playwright";

import type {
  AssetsDocument,
  CatalogManifest,
  FacilityKind,
  ImageAsset,
  OperatorsDocument,
} from "@endfield/domain";

const REPO_ROOT = process.cwd();
const BUNDLE_DIR = path.join(REPO_ROOT, "catalogs", "2026-03-20-v1.1-phase1");
const OPERATORS_PATH = path.join(BUNDLE_DIR, "operators.json");
const ASSETS_PATH = path.join(BUNDLE_DIR, "assets.json");
const MANIFEST_PATH = path.join(BUNDLE_DIR, "manifest.json");
const BASE_SKILL_ASSET_DIR = path.join(BUNDLE_DIR, "assets", "base-skills");
const FACILITY_ASSET_DIR = path.join(BUNDLE_DIR, "assets", "facilities");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const TODAY = "2026-03-22";
const RETRY_ATTEMPTS = 3;
const PLACEHOLDER_FACILITY_ICON_ID = "placeholder-facility-icon";
const GENERATED_ASSET_ID_PATTERNS = [
  /^skill-.*-icon$/,
  /^facility-(control_nexus|manufacturing_cabin|growth_chamber|reception_room)-icon$/,
];
const LEGACY_GENERATED_ASSET_IDS = new Set([
  "facility-control-nexus-icon",
  "facility-reception-room-icon",
]);
const FACILITY_TITLE_TO_KIND: Record<string, FacilityKind> = {
  "Control Nexus": "control_nexus",
  "Manufacturing Cabin": "manufacturing_cabin",
  "Growth Chamber": "growth_chamber",
  "Reception Room": "reception_room",
};

type OperatorRecord = OperatorsDocument["operators"][number];
type BaseSkillRecord = OperatorRecord["baseSkills"][number];

export interface ScrapedBaseSkillTable {
  name: string;
  skillIconUrl?: string;
  facilityIconUrl?: string;
  facilityLabel?: string;
  facilityKind?: FacilityKind;
}

function wikiPageName(name: string): string {
  return encodeURIComponent(name.replace(/ /g, "_"));
}

export function normalizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveImageUrl(src: string | null, pageUrl: string): string | undefined {
  if (!src) {
    return undefined;
  }

  return new URL(src, pageUrl).toString();
}

function getAssetExtension(url: string, contentType?: string | null): string {
  const pathname = new URL(url).pathname;
  const fromPath = path.extname(pathname);
  if (fromPath) {
    return fromPath.toLowerCase();
  }

  if (contentType?.includes("webp")) {
    return ".webp";
  }
  if (contentType?.includes("jpeg")) {
    return ".jpg";
  }
  if (contentType?.includes("svg")) {
    return ".svg";
  }

  return ".png";
}

function getFacilityKindFromLabel(label: string | undefined): FacilityKind | undefined {
  if (!label) {
    return undefined;
  }

  return FACILITY_TITLE_TO_KIND[label.trim()];
}

export function extractBaseSkillTablesFromHtml(html: string, pageUrl: string): ScrapedBaseSkillTable[] {
  const document = new JSDOM(html, { url: pageUrl }).window.document;
  const heading = document.querySelector("#Base_Skills")?.closest("h2");
  if (!heading) {
    throw new Error("Could not find the Base Skills section.");
  }

  const tables: ScrapedBaseSkillTable[] = [];
  let current: Element | null = heading.nextElementSibling;

  while (current) {
    if (current.matches("h2") || current.querySelector("#Base_Skill_upgrades")) {
      break;
    }

    if (current.matches("table.mrfz-wtable")) {
      const header = current.querySelector("tr th[colspan], tr th");
      if (!header) {
        current = current.nextElementSibling;
        continue;
      }

      const children = Array.from(header.children);
      const skillNameNode = children.find((child) => child.tagName === "SPAN" && (child as HTMLElement).style.float !== "right");
      const facilityNode = children.find((child) => child.tagName === "SPAN" && (child as HTMLElement).style.float === "right");
      const skillIconNode = children.find((child) => child.tagName === "IMG") as HTMLImageElement | undefined;
      const facilityLink = facilityNode?.querySelector("a");
      const facilityIconNode = facilityNode?.querySelector("img") as HTMLImageElement | null;
      const name = skillNameNode?.textContent?.trim() ?? "";

      if (!name) {
        throw new Error("Encountered a Base Skill table without a name.");
      }

      tables.push({
        name,
        skillIconUrl: resolveImageUrl(skillIconNode?.getAttribute("src") ?? null, pageUrl),
        facilityIconUrl: resolveImageUrl(facilityIconNode?.getAttribute("src") ?? null, pageUrl),
        facilityLabel: facilityLink?.getAttribute("title") ?? facilityIconNode?.getAttribute("alt") ?? undefined,
        facilityKind: getFacilityKindFromLabel(
          facilityLink?.getAttribute("title") ?? facilityIconNode?.getAttribute("alt") ?? undefined,
        ),
      });
    }

    current = current.nextElementSibling;
  }

  return tables;
}

export function reconcileScrapedBaseSkills(
  operator: Pick<OperatorRecord, "id"> & { baseSkills: Array<Pick<BaseSkillRecord, "id" | "name">> },
  scrapedTables: ScrapedBaseSkillTable[],
): Map<string, ScrapedBaseSkillTable> {
  if (operator.baseSkills.length !== scrapedTables.length) {
    throw new Error(
      `Operator '${operator.id}' expected ${operator.baseSkills.length} Base Skill table(s) but scraped ${scrapedTables.length}.`,
    );
  }

  const scrapedByName = new Map<string, ScrapedBaseSkillTable>();
  let hasUniqueNameMapping = true;
  for (const table of scrapedTables) {
    const key = normalizeSkillName(table.name);
    if (!key || scrapedByName.has(key)) {
      hasUniqueNameMapping = false;
      break;
    }
    scrapedByName.set(key, table);
  }

  if (hasUniqueNameMapping) {
    const mapped = new Map<string, ScrapedBaseSkillTable>();
    for (const skill of operator.baseSkills) {
      const match = scrapedByName.get(normalizeSkillName(skill.name));
      if (!match) {
        hasUniqueNameMapping = false;
        break;
      }
      mapped.set(skill.id, match);
    }

    if (hasUniqueNameMapping) {
      return mapped;
    }
  }

  if (scrapedTables.some((table) => !table.name.trim())) {
    throw new Error(`Operator '${operator.id}' could not reconcile scraped Base Skill tables by order because one or more names were blank.`);
  }

  return new Map(operator.baseSkills.map((skill, index) => [skill.id, scrapedTables[index]!]));
}

export function chooseResolvedSkillIconAssetId(skillAssetId?: string, facilityAssetId?: string): string {
  return skillAssetId ?? facilityAssetId ?? PLACEHOLDER_FACILITY_ICON_ID;
}

async function withRetries<T>(label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_ATTEMPTS) {
        break;
      }
      console.warn(`${label} failed on attempt ${attempt}/${RETRY_ATTEMPTS}; retrying.`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed.`);
}

async function fetchImageBytes(page: import("playwright").Page, url: string) {
  const result = await page.evaluate(async (targetUrl) => {
    const response = await fetch(targetUrl);
    const buffer = await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: Array.from(new Uint8Array(buffer)),
    };
  }, url);

  if (!result.ok) {
    throw new Error(`Image request failed with ${result.status} for ${url}.`);
  }

  return {
    bytes: Buffer.from(result.bytes),
    contentType: result.contentType,
  };
}

async function writeDownloadedAsset(
  page: import("playwright").Page,
  url: string,
  targetDirectory: string,
  targetBaseName: string,
): Promise<string> {
  const { bytes, contentType } = await fetchImageBytes(page, url);
  const extension = getAssetExtension(url, contentType);
  const filename = `${targetBaseName}${extension}`;
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.writeFile(path.join(targetDirectory, filename), bytes);
  return filename;
}

async function createBrowser() {
  return chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

async function createBrowserPage(browser: import("playwright").Browser) {
  const context = await browser.newContext({ userAgent: USER_AGENT });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  return { context, page: await context.newPage() };
}

async function scrapeOperatorBaseSkills(page: import("playwright").Page, operator: Pick<OperatorRecord, "id" | "name">) {
  const pageUrl = `https://endfield.wiki.gg/wiki/${wikiPageName(operator.name)}`;
  return withRetries(`Scraping ${operator.name}`, async () => {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    let hasBaseSkillsSection = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.waitForTimeout(6_000);
      hasBaseSkillsSection = await page.locator("#Base_Skills").count().then((count) => count > 0);
      if (hasBaseSkillsSection) {
        break;
      }

      if ((await page.title()).includes("Just a moment")) {
        await page.waitForTimeout(6_000);
      }
    }

    if (!hasBaseSkillsSection) {
      throw new Error(`Base Skills section did not appear for ${operator.name}.`);
    }

    const html = await page.content();
    return {
      pageUrl,
      tables: extractBaseSkillTablesFromHtml(html, page.url()),
    };
  });
}

function shouldReplaceGeneratedAsset(asset: ImageAsset): boolean {
  return LEGACY_GENERATED_ASSET_IDS.has(asset.id) || GENERATED_ASSET_ID_PATTERNS.some((pattern) => pattern.test(asset.id));
}

function buildSkillIconAsset(operatorId: string, skillId: string, filename: string, sourceUrl: string, pageUrl: string): ImageAsset {
  return {
    id: `skill-${operatorId}-${skillId}-icon`,
    kind: "icon",
    path: `assets/base-skills/${filename}`,
    attribution: `Base Skill icon from Endfield Talos Wiki page (${pageUrl}); source image ${sourceUrl}; retrieved ${TODAY}.`,
  };
}

function buildFacilityIconAsset(facilityKind: FacilityKind, filename: string, sourceUrl: string, pageUrl: string): ImageAsset {
  return {
    id: `facility-${facilityKind}-icon`,
    kind: "facility",
    path: `assets/facilities/${filename}`,
    attribution: `Facility icon from Endfield Talos Wiki page (${pageUrl}); source image ${sourceUrl}; retrieved ${TODAY}.`,
  };
}

async function main() {
  const [operatorsRaw, assetsRaw, manifestRaw] = await Promise.all([
    fs.readFile(OPERATORS_PATH, "utf8"),
    fs.readFile(ASSETS_PATH, "utf8"),
    fs.readFile(MANIFEST_PATH, "utf8"),
  ]);

  const operatorsDoc = JSON.parse(operatorsRaw) as OperatorsDocument;
  const assetsDoc = JSON.parse(assetsRaw) as AssetsDocument;
  const manifestDoc = JSON.parse(manifestRaw) as CatalogManifest;

  await Promise.all([
    fs.rm(BASE_SKILL_ASSET_DIR, { recursive: true, force: true }),
    fs.rm(FACILITY_ASSET_DIR, { recursive: true, force: true }),
  ]);

  const preservedAssets = assetsDoc.assets.filter((asset) => !shouldReplaceGeneratedAsset(asset));
  const generatedAssets: ImageAsset[] = [];
  const facilityAssetIdByKind = new Map<FacilityKind, string>();

  const browser = await createBrowser();

  try {
    for (const operator of operatorsDoc.operators) {
      const { context, page } = await createBrowserPage(browser);

      try {
        const { pageUrl, tables } = await scrapeOperatorBaseSkills(page, operator);
        const reconciledTables = reconcileScrapedBaseSkills(operator, tables);

        for (const skill of operator.baseSkills) {
          const table = reconciledTables.get(skill.id);
          if (!table) {
            throw new Error(`Operator '${operator.id}' has no scraped table for Base Skill '${skill.id}'.`);
          }

          let skillAssetId: string | undefined;
          if (table.skillIconUrl) {
            try {
              const filename = await withRetries(
                `Downloading skill icon ${operator.id}:${skill.id}`,
                () => writeDownloadedAsset(page, table.skillIconUrl!, BASE_SKILL_ASSET_DIR, `${operator.id}--${skill.id}`),
              );
              const asset = buildSkillIconAsset(operator.id, skill.id, filename, table.skillIconUrl, pageUrl);
              generatedAssets.push(asset);
              skillAssetId = asset.id;
            } catch (error) {
              console.warn(`Skill icon download failed for ${operator.id}:${skill.id}; falling back. ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          let facilityAssetId = facilityAssetIdByKind.get(skill.facilityKind);
          if (!facilityAssetId && table.facilityIconUrl) {
            try {
              const filename = await withRetries(
                `Downloading facility icon ${skill.facilityKind}`,
                () => writeDownloadedAsset(page, table.facilityIconUrl!, FACILITY_ASSET_DIR, skill.facilityKind),
              );
              const facilityAsset = buildFacilityIconAsset(skill.facilityKind, filename, table.facilityIconUrl, pageUrl);
              generatedAssets.push(facilityAsset);
              facilityAssetId = facilityAsset.id;
              facilityAssetIdByKind.set(skill.facilityKind, facilityAssetId);
            } catch (error) {
              console.warn(`Facility icon download failed for ${skill.facilityKind}; using placeholder. ${error instanceof Error ? error.message : String(error)}`);
              facilityAssetIdByKind.set(skill.facilityKind, PLACEHOLDER_FACILITY_ICON_ID);
            }
          } else if (!facilityAssetId && table.facilityKind && table.facilityKind !== skill.facilityKind) {
            console.warn(`Scraped facility '${table.facilityKind}' did not match catalog facility '${skill.facilityKind}' for ${operator.id}:${skill.id}.`);
          }

          skill.iconAssetId = chooseResolvedSkillIconAssetId(
            skillAssetId,
            facilityAssetId ?? facilityAssetIdByKind.get(skill.facilityKind),
          );
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  assetsDoc.assets = [...preservedAssets, ...generatedAssets].sort((left, right) => left.id.localeCompare(right.id));
  manifestDoc.counts = {
    ...(manifestDoc.counts ?? {}),
    assets: assetsDoc.assets.length,
  };

  await Promise.all([
    fs.writeFile(OPERATORS_PATH, `${JSON.stringify(operatorsDoc, null, 2)}\n`, "utf8"),
    fs.writeFile(ASSETS_PATH, `${JSON.stringify(assetsDoc, null, 2)}\n`, "utf8"),
    fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifestDoc, null, 2)}\n`, "utf8"),
  ]);

  console.log(`Updated Base Skill icon assignments for ${operatorsDoc.operators.length} operators.`);
  console.log(`Generated ${generatedAssets.length} icon asset record(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
