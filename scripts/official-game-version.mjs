// Shared with the dependency-free scheduled heartbeat. These are the public CMS
// endpoints used by the official website, not an account or third-party API.
const NEWS_API = "https://web-news.gryphline.com/api/bulletin";
const NEWS_APP_CODE = "arknights_endfield_official";
const NEWS_PAGE_SIZE = 30;
const MAX_NEWS_PAGES = 3;
const VERSION_NOTES_TITLE = /^\[([^\[\]]+)\]\s+Version Update Notes$/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function normalizeText(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:#(\d+)|#x([a-f\d]+)|([a-z]+));/gi, (entity, decimal, hex, named) => {
      if (decimal || hex) {
        const code = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return ({ amp: "&", nbsp: " ", ndash: "–", mdash: "—", quot: '"', apos: "'" })[named.toLowerCase()] ?? entity;
    })
    .replace(/[\t\r\f ]+/g, " ")
    .trim();
}

function readVersionName(title) {
  return typeof title === "string" ? VERSION_NOTES_TITLE.exec(normalizeText(title))?.[1]?.trim() : undefined;
}

function timestamp(parts, offsetMinutes) {
  const [monthName, dayText, yearText, hourText, minuteText] = parts;
  const name = monthName.toLowerCase();
  const month = MONTHS.findIndex((value) => value === name || value.slice(0, 3) === name || (value === "september" && name === "sept"));
  const [day, year, hour, minute] = [dayText, yearText, hourText, minuteText].map(Number);
  const local = new Date(Date.UTC(year, month, day, hour, minute));
  if (month < 0 || local.getUTCFullYear() !== year || local.getUTCMonth() !== month
    || local.getUTCDate() !== day || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute) {
    throw new Error("Official version maintenance contains an invalid date or time.");
  }
  return local.getTime() - offsetMinutes * 60_000;
}

export function parseOfficialGameVersionAnnouncement(bulletin, at = new Date()) {
  const gameVersion = readVersionName(bulletin?.title);
  if (!gameVersion) return undefined; // Never infer a release from a preview or pre-download notice.
  if (typeof bulletin.cid !== "string" || !/^\d+$/.test(bulletin.cid) || typeof bulletin.data !== "string") {
    throw new Error("Official version update notes have incomplete content.");
  }
  const text = normalizeText(bulletin.data);
  const heading = /(?:Update\s*&\s*Maintenance Time|Version Maintenance Time)/i.exec(text);
  const maintenance = heading && /^\s*Asia Server:\s*([a-z]+)\.?\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*[–—-]\s*([a-z]+)\.?\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*\(UTC([+-])(\d{1,2})(?::(\d{2}))?\)/i
    .exec(text.slice(heading.index + heading[0].length));
  if (!maintenance) throw new Error("Official version update notes have no recognizable maintenance window.");
  const offsetHours = Number(maintenance[12]);
  const offsetMinutesPart = Number(maintenance[13] ?? 0);
  if (offsetHours > 14 || offsetMinutesPart > 59 || (offsetHours === 14 && offsetMinutesPart !== 0)) {
    throw new Error("Official version maintenance contains an invalid UTC offset.");
  }
  const offset = (maintenance[11] === "+" ? 1 : -1) * (offsetHours * 60 + offsetMinutesPart);
  const start = timestamp(maintenance.slice(1, 6), offset);
  const end = timestamp(maintenance.slice(6, 11), offset);
  if (end < start) throw new Error("Official version maintenance ends before it starts.");
  if (end > at.getTime()) return undefined;
  return {
    gameVersion,
    gameVersionReleasedAt: new Date(end).toISOString(),
    gameVersionSourceUrl: `https://endfield.gryphline.com/en-us/news/${bulletin.cid}`,
  };
}

async function fetchNews(pathname, parameters = {}) {
  const url = new URL(`${NEWS_API}${pathname}`);
  url.search = new URLSearchParams({ lang: "en-us", code: NEWS_APP_CODE, ...parameters }).toString();
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "endfield-dijiang-optimizer-version-sync/0.1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Official news returned HTTP ${response.status}.`);
  const document = await response.json();
  if (document?.code !== 0 || !document.data) throw new Error("Official news returned an invalid response.");
  return document.data;
}

export async function fetchOfficialGameVersion(at = new Date()) {
  try {
    for (let page = 1; page <= MAX_NEWS_PAGES; page += 1) {
      const listing = await fetchNews("", { page: String(page), pageSize: String(NEWS_PAGE_SIZE), "tabs[]": "notices" });
      if (!Array.isArray(listing.list)) throw new Error("Official news listing is missing.");
      const releases = [];
      const candidates = listing.list.filter((item) => (
        readVersionName(item?.title) && /^\d+$/.test(item.cid)
        && typeof item.displayTime === "number" && Number.isFinite(item.displayTime)
        && item.displayTime * 1_000 <= at.getTime()
      ));
      for (const item of candidates) {
        const detail = await fetchNews(`/${item.cid}`);
        if (detail.cid !== item.cid || readVersionName(detail.title) !== readVersionName(item.title)) {
          throw new Error("Official version detail does not match its listing.");
        }
        const release = parseOfficialGameVersionAnnouncement(detail, at);
        if (release) releases.push(release);
      }
      if (releases.length > 0) {
        return releases.sort((left, right) => Date.parse(right.gameVersionReleasedAt) - Date.parse(left.gameVersionReleasedAt))[0];
      }
      if (listing.list.length < NEWS_PAGE_SIZE || page * NEWS_PAGE_SIZE >= listing.total) break;
    }
    throw new Error("No released version update notes were found in recent official notices.");
  } catch (error) {
    // Metadata outages must not block healthy operator updates or erase a known version.
    console.warn(`Could not determine the official game version; retaining the last confirmed version. ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function resolveCurrentGameVersion(official, previous, policy, at = new Date()) {
  const effective = (release) => release && typeof release.gameVersion === "string" && release.gameVersion.trim()
    && Number.isFinite(Date.parse(release.gameVersionReleasedAt)) && Date.parse(release.gameVersionReleasedAt) <= at.getTime();
  const policyVersion = (policy?.operatorReleases ?? [])
    .map((release) => ({
      gameVersion: release.gameVersion,
      gameVersionReleasedAt: release.releaseAt,
      ...(/^https:\/\//.test(release.sourceUrl) ? { gameVersionSourceUrl: release.sourceUrl } : {}),
    }))
    .filter(effective)
    .sort((left, right) => Date.parse(right.gameVersionReleasedAt) - Date.parse(left.gameVersionReleasedAt))[0];
  const candidate = effective(official) ? official : undefined;
  if (previous?.gameVersion) {
    const saved = {
      gameVersion: previous.gameVersion,
      ...(previous.gameVersionReleasedAt ? { gameVersionReleasedAt: previous.gameVersionReleasedAt } : {}),
      ...(previous.gameVersionSourceUrl ? { gameVersionSourceUrl: previous.gameVersionSourceUrl } : {}),
    };
    if (!candidate || (effective(saved) && Date.parse(saved.gameVersionReleasedAt) >= Date.parse(candidate.gameVersionReleasedAt))) {
      return saved;
    }
    // For legacy overlays without a release timestamp, trust freshly fetched
    // official notes. The manual policy never overwrites a saved version.
  }
  return candidate ?? policyVersion;
}
