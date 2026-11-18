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
  const sourceId = server.mapSourceId ?? server.id;
  const root = serverTileRootUrl(server.mapUrl);
  // The renderer publishes each server below the tile root, not at its root.
  const sourceUrl = root && new URL(root).pathname.replace(/\/+$/, '').endsWith(`/${sourceId}`)
    ? root : root ? new URL(`${encodeURIComponent(sourceId)}/`, `${root.replace(/\/+$/, '')}/`).toString() : undefined;
  const result = await getServerMap(undefined, undefined, sourceId, sourceUrl);
  if (result.available) {
    result.metadata.serverId = server.id;
    result.metadata.worldKey = server.id;
  }
  return result;
}
