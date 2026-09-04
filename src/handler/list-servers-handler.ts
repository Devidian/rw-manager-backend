import { Request, Response } from 'express';
import typia from 'typia';
import type { ListServersResponse } from '../dto/list-servers-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { listServers } from '../service/storage-service.js';
import { getCachedPluginData } from '../service/plugin-data-cache-service.js';

export async function listServersHandler(req: Request, res: Response) {
  const request = req as RequestWithUser;
  const servers = await listServers({
    userId: request.user?.id,
    userSteamId: request.user?.steamId,
  });
  const response: ListServersResponse = {
    servers: servers.map((server) => {
      const inventory = getCachedPluginData(server.id);
      return {
        ...server,
        pluginListAvailable: inventory !== undefined,
        ozToolsInstalled: inventory?.plugins.some(
          (plugin) => plugin.valid && plugin.name?.trim().toLowerCase() === 'oz - tools',
        ) ?? false,
      };
    }),
  };
  return res.json(typia.assert<ListServersResponse>(response));
}
