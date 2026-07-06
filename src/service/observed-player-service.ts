import type { DbPlayer } from '../interfaces/game-player.js';

const STEAM_ID_PATTERN = /^\d{17}$/;

export function platformFromUid(uid: string): 'Steam' | 'Standalone' {
  return STEAM_ID_PATTERN.test(uid) ? 'Steam' : 'Standalone';
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function observedPlayerFromValue(value: unknown, observedAt: Date | string): DbPlayer | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const uid = stringField(record, 'uid', 'UID');
  if (!uid) return null;
  const name = stringField(record, 'name', 'Name');
  const lastseen = Math.floor(new Date(observedAt).getTime() / 1000);
  return {
    uid,
    ...(name ? { name } : {}),
    ...(typeof record.id === 'number' && Number.isFinite(record.id) ? { id: record.id } : {}),
    platform: platformFromUid(uid),
    ...(Number.isFinite(lastseen) ? { lastseen, firstseen: lastseen } : {}),
  };
}

export function observedPlayersFromValues(values: unknown[] | undefined, observedAt: Date | string): DbPlayer[] {
  if (!values) return [];
  return values.flatMap((value): DbPlayer[] => {
    const player = observedPlayerFromValue(value, observedAt);
    return player ? [player] : [];
  });
}

export function mergeKnownPlayers(
  existing: DbPlayer[] | undefined,
  observed: DbPlayer[],
): DbPlayer[] | undefined {
  if (!existing?.length && !observed.length) return existing;

  const byUid = new Map<string, DbPlayer>();
  for (const player of existing ?? []) {
    if (player.uid) byUid.set(player.uid, player);
  }
  for (const player of observed) {
    const current = byUid.get(player.uid);
    byUid.set(player.uid, {
      ...current,
      ...player,
      name: player.name ?? current?.name,
      firstseen: current?.firstseen ?? player.firstseen,
    });
  }
  return [...byUid.values()];
}
