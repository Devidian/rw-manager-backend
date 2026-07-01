import { findServerById } from '../db/manager-store.js';
import type { GetServerMapResponse } from '../dto/get-server-map-response.js';
import { getServerMap } from './map-service.js';

function serverTileRootUrl(mapUrl: string | undefined): string | undefined {
  if (!mapUrl) return undefined;
  try {
    return new URL(mapUrl).toString();
  } catch {
    return undefined;
  }
}

export async function getStoredServerMap(serverId: string): Promise<GetServerMapResponse> {
  const server = await findServerById(serverId);
  if (!server) throw new Error('SERVER_NOT_FOUND');
  return getServerMap(undefined, undefined, server.id, serverTileRootUrl(server.mapUrl));
}
