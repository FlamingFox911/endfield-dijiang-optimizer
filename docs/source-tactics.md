# Source Tactics

This document records how public catalog data is obtained at the domain level, so future sync work does not need to rediscover the access pattern.

## wiki.skport.com official wiki

- Use as the primary source for:
  - automatic operator roster discovery
  - operator rarity, class, portrait, and publication state
  - both Dijiang Base Skill tables, Greek ranks, effects, values, and unlock tiers
  - Promotion IV operator-specific materials
- Preferred tactic:
  - request a public anonymous token from `https://zonai.skport.com/web/v1/auth/refresh`
  - sign the official wiki API requests using the same timestamped HMAC-SHA256 and MD5 flow as the public site client
  - fetch catalog metadata from `/web/v1/wiki/item/catalog?typeMainId=1`
  - fetch each released operator from `/web/v1/wiki/item/info?id={itemId}`
  - parse the structured document tables rather than rendered HTML
  - recognize `Talent Effect`, `Talent effect`, `Base Skill Effect`, and `Advancement Effect` table variants by their two ranked assignment rows, and normalize non-breaking whitespace before facility matching
  - download official portrait originals without a cross-site referrer, resize them to 256 pixels, encode them as quality-84 WebP, and publish content-addressed files with the Pages artifact
  - run `npm run sync:live-roster`; no browser binary or user login is required
- Safety rule:
  - `robots.txt` currently resolves to the wiki application shell rather than publishing crawler restrictions; keep detail requests in small batches anyway
  - unsupported descriptions, missing operator fields, incomplete promotion costs, or unknown table shapes produce a warning that blocks a scheduled deployment
  - an operator without exactly two supported official Base Skill tables produces a warning; operator fields are never mixed with a secondary source
  - the browser app never calls SKPORT directly; it reads only the validated same-origin generated overlay

## endfieldtools.dev extracted data

- Use for:
  - new rarity-5 Growth Chamber cultivation item identities, families, and icons
  - a whole-roster contingency only when the official SKPORT service is unavailable
- Preferred tactic:
  - normally fetch only `localdb/optimized/factory/factory-data.json` plus its English translation tables for cultivation-recipe discovery
  - fetch `localdb/optimized/characters/characters-list.json` and each `localdb/optimized/characters/details/{charId}.json` only for the whole-roster outage fallback
  - resolve English text through the modular `core`, `characters`, and `factory` i18n tables
  - run `npm run sync:live-roster`, which applies the same effect and material mappings used by the curated snapshots
- Safety rule:
  - unknown resource families or missing material names produce a warning and retain the bundled catalog
  - live Base Skill icon paths are not trusted; the merge resolves each effect to bundled local artwork
  - new rare-resource timings remain provisional until directly verified in game
  - the browser accepts only the validated same-origin generated document; it does not contact an account API or third-party site directly

## endfield.wiki.gg

- Use for:
  - operator Base Skill tables
  - facility icons shown in Base Skill headers
  - promotion override source pages
  - general public wiki reference pages
- Preferred tactic for structured page content:
  - use Playwright Chromium instead of `curl`, `Invoke-WebRequest`, or plain Node `fetch`
  - set a normal desktop user agent
  - unset `navigator.webdriver`
  - create a fresh browser context and page per operator page
  - retry when the page returns the Cloudflare interstitial or a partial DOM
- Why:
  - direct non-browser requests are more likely to be blocked
  - reusing one browser page across many operator requests caused later pages to stall on `Just a moment...`
- Base Skill icon extraction rule:
  - open the operator page
  - read only the `Base Skills` section
  - stop before `Base Skill upgrades`
  - for each Base Skill table, take the icon beside the Base Skill name
  - if that icon is missing, use the facility icon from the same header row
- Asset download rule:
  - download image bytes through the active Playwright page context instead of a separate raw HTTP client
  - keep attribution with both the operator page URL and the source image URL

## cdn.perlica.moe

- Use for:
  - operator portrait assets
- Preferred tactic:
  - direct HTTP download is sufficient
  - no browser automation is required
- Notes:
  - portrait paths follow the existing CDN structure under `images/operators/portraits/`
  - keep the CDN URL in asset attribution

## game8.co

- Use for:
  - secondary guide/reference material
  - recipe and facility cross-checking when the wiki is incomplete
- Preferred tactic:
  - treat as a manual reference source first
  - only automate if a future sync task truly depends on it
- Notes:
  - do not treat this domain as the primary source when a wiki or official source is available

## endfield.gryphline.com

- Use for:
  - official announcements
  - announced operator availability dates used by `catalogs/live-sync-policy.json`
  - security or policy statements
- Preferred tactic:
  - normal browser or HTTP fetch is acceptable
  - cite the official page directly
- Sync rule:
  - release information controls whether scheduled catalog checks use burst, daily, or weekly cadence
  - an operator is considered covered only when its normalized live definition is published without sync warnings
  - official announcements do not provide Dijiang effect values; the official SKPORT wiki is the primary structured source for those values
  - the weekly fallback remains active between known releases so an unannounced upstream change is still discovered

## local-user-supplied

- Use for:
  - manual overrides from in-game verification
  - corrections where public sites are incomplete or wrong
- Preferred tactic:
  - record the override explicitly in catalog source metadata
  - leave a note explaining what was verified manually
