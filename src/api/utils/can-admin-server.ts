import { AppConfig } from '../../utils/app-config.js';
import { defaultLogger } from '../../utils/logger.js';

export async function fetchBackendAdmins(
  backendUrl: string,
): Promise<string[] | null> {
  try {
    const adminsUrl = new URL('api/data/server/admins', backendUrl).toString();
    defaultLogger.debug(`Fetching backend admins from ${adminsUrl}`);
    const response = await fetch(adminsUrl);
    defaultLogger.debug(`Backend admins response: ${response.status}`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { admins?: unknown };
    defaultLogger.debug(`Backend admins payload: ${JSON.stringify(payload)}`);
    if (
      !Array.isArray(payload.admins) ||
      payload.admins.some((admin) => typeof admin !== 'string')
    ) {
      return null;
    }
    return payload.admins;
  } catch {
    return null;
  }
}

export async function canAdminServer(
  backendUrl: string | undefined,
  userSteamId?: string,
) {
  if (!AppConfig.enableAuth || !backendUrl || !userSteamId) return false;
  const admins = await fetchBackendAdmins(backendUrl);
  if (!admins) return false;
  return admins.includes(userSteamId);
}
