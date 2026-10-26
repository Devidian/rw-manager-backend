import { AppConfig } from '../utils/app-config.js';

const STEAM_PLAYER_SUMMARIES_URL = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/';

/** Optional display name lookup. Authentication must not depend on Steam's profile API. */
export async function getSteamPersonaName(steamId: string): Promise<string | undefined> {
  const apiKey = AppConfig.steamApiKey;
  if (!apiKey || !/^\d{17}$/.test(steamId)) return undefined;

  try {
    const url = new URL(STEAM_PLAYER_SUMMARIES_URL);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', steamId);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;
    const payload: unknown = await response.json();
    const player = (payload as {
      response?: { players?: Array<{ steamid?: unknown; personaname?: unknown }> };
    }).response?.players?.[0];
    return player?.steamid === steamId &&
      typeof player.personaname === 'string' && player.personaname.trim()
      ? player.personaname.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
