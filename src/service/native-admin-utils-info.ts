export interface NativeAdminUtilsInfo {
  mapUrl: string;
  adminUid: string;
  admins: string[];
}

const MAX_UNSIGNED_LONG = 18_446_744_073_709_551_615n;

export function parseNativeAdminUtilsInfo(payload: unknown): NativeAdminUtilsInfo | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = payload as Record<string, unknown>;
  if (value.schemaVersion !== 1) return undefined;
  const mapUrl = httpUrl(value.mapUrl);
  const adminUid = uid(value.adminUid);
  if (!mapUrl || !adminUid || !Array.isArray(value.admins)) return undefined;
  const admins = [...new Set([adminUid, ...value.admins.flatMap((entry) => {
    const normalized = uid(entry);
    return normalized ? [normalized] : [];
  })])];
  return { mapUrl, adminUid, admins };
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function uid(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value.trim())) return undefined;
  return BigInt(value.trim()) <= MAX_UNSIGNED_LONG ? value.trim() : undefined;
}
