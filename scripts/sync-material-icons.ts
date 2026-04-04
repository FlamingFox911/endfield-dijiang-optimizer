import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

import type { AssetsDocument, CatalogManifest, ImageAsset } from "@endfield/domain";

const REPO_ROOT = process.cwd();
const BUNDLE_DIR = path.join(REPO_ROOT, "catalogs", "2026-03-29-v1.1-phase2");
const PROGRESSION_PATH = path.join(BUNDLE_DIR, "progression.json");
const ASSETS_PATH = path.join(BUNDLE_DIR, "assets.json");
const MANIFEST_PATH = path.join(BUNDLE_DIR, "manifest.json");
const MATERIAL_ASSET_DIR = path.join(BUNDLE_DIR, "assets", "materials");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const RETRIEVED_ON = process.env.CATALOG_RETRIEVED_ON ?? new Date().toISOString().slice(0, 10);
const RETRY_ATTEMPTS = 3;
const GENERATED_ASSET_ID_PATTERN = /^material-.*-icon$/;

function normalizeMaterialKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function formatItemLabel(itemId: string): string {
  if (itemId === "t-creds") {
    return "T-Creds";
  }

  return itemId.split(/[_-]/).map((part) => {
    if (part === "insp") {
      return "INSP";
    }
    if (/^[a-z]*\d+[a-z]*$/.test(part) || /^\d+$/.test(part)) {
      return part.toUpperCase();
    }
    return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
  }).join(" ");
}

function getMaterialPageUrl(itemId: string): string {
  return `https://endfield.wiki.gg/wiki/${encodeURIComponent(formatItemLabel(itemId).replace(/ /g, "_"))}`;
}

function getAssetExtension(url: string, contentType?: string | null): string {
  const fromPath = path.extname(new URL(url).pathname);
  if (fromPath) {
    return fromPath.toLowerCase();
  }
  if (contentType?.includes("webp")) {
    return ".webp";
  }
  return ".png";
}

function collectMaterialItemIds(value: unknown, itemIds = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMaterialItemIds(entry, itemIds);
    }
    return itemIds;
  }

  if (!value || typeof value !== "object") {
    return itemIds;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "itemId" && typeof entry === "string" && entry.length > 0) {
      itemIds.add(entry);
      continue;
    }
    collectMaterialItemIds(entry, itemIds);
  }

  return itemIds;
}

async function withRetries<T>(label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) {
        console.warn(`${label} failed on attempt ${attempt}/${RETRY_ATTEMPTS}; retrying.`);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed.`);
}

async function createBrowserPage() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();

  return { browser, context, page };
}

async function waitForWikiPage(page: import("playwright").Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.waitForTimeout(2_000);
    if (!(await page.title()).includes("Just a moment")) {
      return;
    }
  }
}

async function loadIndexedMaterialIconUrls(page: import("playwright").Page): Promise<Map<string, string>> {
  await page.goto("https://endfield.wiki.gg/wiki/Protoprism", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForWikiPage(page);

  const entries = await page.evaluate(() => Array.from(document.querySelectorAll("img"))
    .map((image) => {
      const src = image.getAttribute("src") ? new URL(image.getAttribute("src")!, document.baseURI).toString() : "";
      const filename = src ? new URL(src).pathname.split("/").pop() ?? "" : "";
      const normalizedAlt = image.alt.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const normalizedAltStem = image.alt.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const normalizedFilename = filename.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const normalizedFilenameStem = filename.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      return [normalizedAlt, normalizedAltStem, normalizedFilename, normalizedFilenameStem]
        .filter((key) => key.length > 0)
        .map((key) => [key, src] as const);
    })
    .flat()
    .filter((entry) => entry[1].includes("/images/")));

  return new Map(entries);
}

async function scrapeMaterialIconUrl(page: import("playwright").Page, itemId: string): Promise<{ pageUrl: string; iconUrl: string }> {
  const pageUrl = getMaterialPageUrl(itemId);
  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForWikiPage(page);

  const targetKey = normalizeMaterialKey(formatItemLabel(itemId));
  const iconUrl = await page.evaluate((expectedKey) => {
    const images = Array.from(document.querySelectorAll("img")).map((image) => {
      const src = image.getAttribute("src") ? new URL(image.getAttribute("src")!, document.baseURI).toString() : "";
      const filename = src ? new URL(src).pathname.split("/").pop() ?? "" : "";
      const normalizedAlt = image.alt.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const normalizedAltStem = image.alt.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const normalizedFilename = filename.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const normalizedFilenameStem = filename.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      return {
        src,
        score: (image.width * image.height) + (
          normalizedAlt === expectedKey || normalizedAltStem === expectedKey || normalizedFilename === expectedKey || normalizedFilenameStem === expectedKey
            ? 10_000
            : 0
        ),
      };
    }).filter((image) => image.src.includes("/images/"));

    images.sort((left, right) => right.score - left.score);
    return images[0]?.src;
  }, targetKey);

  if (!iconUrl) {
    throw new Error(`No material icon found on ${pageUrl}.`);
  }

  return { pageUrl, iconUrl };
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

function buildMaterialIconAsset(itemId: string, filename: string, sourceUrl: string, pageUrl: string): ImageAsset {
  return {
    id: `material-${itemId}-icon`,
    kind: "icon",
    path: `assets/materials/${filename}`,
    attribution: `Material icon from Endfield Talos Wiki page (${pageUrl}); source image ${sourceUrl}; retrieved ${RETRIEVED_ON}.`,
  };
}

async function syncMaterialIcons() {
  const [progressionRaw, assetsRaw, manifestRaw] = await Promise.all([
    fs.readFile(PROGRESSION_PATH, "utf8"),
    fs.readFile(ASSETS_PATH, "utf8"),
    fs.readFile(MANIFEST_PATH, "utf8"),
  ]);

  const itemIds = [...collectMaterialItemIds(JSON.parse(progressionRaw))].sort((left, right) => left.localeCompare(right));
  const assetsDoc = JSON.parse(assetsRaw) as AssetsDocument;
  const manifestDoc = JSON.parse(manifestRaw) as CatalogManifest;

  await fs.rm(MATERIAL_ASSET_DIR, { recursive: true, force: true });
  await fs.mkdir(MATERIAL_ASSET_DIR, { recursive: true });

  const preservedAssets = assetsDoc.assets.filter((asset) => !GENERATED_ASSET_ID_PATTERN.test(asset.id));
  const generatedAssets: ImageAsset[] = [];
  const { browser, context, page } = await createBrowserPage();

  try {
    const indexedIconUrls = await withRetries(
      "Loading indexed material icons",
      () => loadIndexedMaterialIconUrls(page),
    );

    for (const itemId of itemIds) {
      try {
        const indexedIconUrl = indexedIconUrls.get(normalizeMaterialKey(formatItemLabel(itemId)));
        const { pageUrl, iconUrl } = indexedIconUrl
          ? {
              pageUrl: "https://endfield.wiki.gg/wiki/Protoprism",
              iconUrl: indexedIconUrl,
            }
          : await withRetries(
              `Scraping material icon ${itemId}`,
              () => scrapeMaterialIconUrl(page, itemId),
            );
        const { bytes, contentType } = await withRetries(
          `Downloading material icon ${itemId}`,
          () => fetchImageBytes(page, iconUrl),
        );
        const filename = `${itemId}${getAssetExtension(iconUrl, contentType)}`;
        await fs.writeFile(path.join(MATERIAL_ASSET_DIR, filename), bytes);
        generatedAssets.push(buildMaterialIconAsset(itemId, filename, iconUrl, pageUrl));
      } catch (error) {
        console.warn(`Material icon sync skipped for '${itemId}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  assetsDoc.assets = [...preservedAssets, ...generatedAssets].sort((left, right) => left.id.localeCompare(right.id));
  manifestDoc.counts = {
    ...(manifestDoc.counts ?? {}),
    assets: assetsDoc.assets.length,
  };

  await Promise.all([
    fs.writeFile(ASSETS_PATH, `${JSON.stringify(assetsDoc, null, 2)}\n`, "utf8"),
    fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifestDoc, null, 2)}\n`, "utf8"),
  ]);

  console.log(`Generated ${generatedAssets.length} material icon asset record(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncMaterialIcons();
}
