import type { Request } from 'express';
import type { ServerConfig } from '../interfaces/server-config.js';

export function serverIdFromRequest(req: Request): string | undefined {
  const raw = req.params?.id;
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

export async function prepareServerRoute(req: Request): Promise<ServerConfig | undefined> {
  const serverId = serverIdFromRequest(req);
  if (!serverId) return undefined;
  const [{ findServerById }, { ensurePluginDataForServer }] = await Promise.all([
    import('../db/manager-store.js'),
    import('../service/plugin-data-cache-service.js'),
  ]);
  const server = await findServerById(serverId);
  if (!server) throw new Error('SERVER_NOT_FOUND');
  await ensurePluginDataForServer(server);
  return server;
}

export function serverRouteError(error: unknown): { status: number; error: string } {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  if (message === 'SERVER_NOT_FOUND') return { status: 404, error: 'server not found' };
  return { status: 500, error: message };
}
