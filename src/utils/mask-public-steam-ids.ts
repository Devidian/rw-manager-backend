const STEAM_ID = /(?<!\d)\d{17}(?!\d)/g;

export function maskPublicSteamIds(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(STEAM_ID, (id) => `${id[0]}${'*'.repeat(id.length - 2)}${id.at(-1)}`);
  }
  if (Array.isArray(value)) return value.map(maskPublicSteamIds);
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key.toLowerCase() === 'steamid' && typeof item === 'number'
        ? maskPublicSteamIds(String(item))
        : maskPublicSteamIds(item),
    ]));
  }
  return value;
}
