import { MAX_UINT64 } from './router.js';

export function normalizeSteamId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const steamId = value.trim();
  if (!/^\d+$/.test(steamId)) return null;
  const parsed = BigInt(steamId);
  if (parsed < 0n || parsed > MAX_UINT64) return null;
  return steamId;
}
