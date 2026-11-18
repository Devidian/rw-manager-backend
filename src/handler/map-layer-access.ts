import type { PrivateUser } from '../interfaces/app-user.js';
import { mapLayerAccess } from '../service/map-layer-access.js';
import { getCachedPluginData, getFirstCachedPluginData } from '../service/plugin-data-cache-service.js';

export function requestMapLayerAccess(user: PrivateUser | null | undefined, serverId?: string) {
  if (!user?.steamVerifiedAt || !user.steamId) return mapLayerAccess(undefined, undefined);
  const entry = serverId ? getCachedPluginData(serverId) : getFirstCachedPluginData();
  return mapLayerAccess(entry, user.steamId);
}
