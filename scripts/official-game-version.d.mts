export interface GameVersionInfo {
  gameVersion: string;
  gameVersionReleasedAt?: string;
  gameVersionSourceUrl?: string;
}

export interface OfficialGameVersion extends GameVersionInfo {
  gameVersionReleasedAt: string;
  gameVersionSourceUrl: string;
}

export interface GameVersionPolicy {
  operatorReleases?: Array<{ releaseAt?: string; gameVersion?: string; sourceUrl?: string }>;
}

export function parseOfficialGameVersionAnnouncement(bulletin: unknown, at?: Date): OfficialGameVersion | undefined;
export function fetchOfficialGameVersion(at?: Date): Promise<OfficialGameVersion | undefined>;
export function resolveCurrentGameVersion(
  official: OfficialGameVersion | undefined,
  previous: Partial<GameVersionInfo> | undefined,
  policy: GameVersionPolicy,
  at?: Date,
): GameVersionInfo | undefined;
