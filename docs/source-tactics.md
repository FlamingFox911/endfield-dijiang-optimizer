# Source Tactics

This document records how public catalog data is obtained at the domain level, so future sync work does not need to rediscover the access pattern.

## endfieldtools.dev extracted data

- Use for:
  - automatic roster discovery
  - operator rarity and profession
  - translated Base Skill names and ranks
  - Dijiang room, effect, target, and value parameters
  - public character portraits
  - Elite IV operator-specific material IDs
  - new rarity-5 Growth Chamber item identities and icons
- Preferred tactic:
  - fetch `localdb/optimized/characters/characters-list.json`
  - fetch each released character from `localdb/optimized/characters/details/{charId}.json`
  - fetch `localdb/optimized/factory/factory-data.json` for rare resource discovery
  - resolve English text through the modular `core`, `characters`, and `factory` i18n tables
  - run `npm run sync:live-roster`, which applies the same effect and material mappings used by the curated snapshots
- Safety rule:
  - unknown professions, rooms, effect types, targets, rank shapes, or material IDs produce a warning and leave that operator on the bundled fallback
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
  - security or policy statements
- Preferred tactic:
  - normal browser or HTTP fetch is acceptable
  - cite the official page directly

## local-user-supplied

- Use for:
  - manual overrides from in-game verification
  - corrections where public sites are incomplete or wrong
- Preferred tactic:
  - record the override explicitly in catalog source metadata
  - leave a note explaining what was verified manually
