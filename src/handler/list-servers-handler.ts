import { Request, Response } from 'express';
import typia from 'typia';
import type { ListServersResponse } from '../dto/list-servers-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { listServers } from '../service/storage-service.js';
import { getCachedPluginData } from '../service/plugin-data-cache-service.js';
import { getCachedOZPluginLatestVersions } from '../service/oz-plugin-release-service.js';
import { getUserFromBearerToken } from '../service/auth-token-service.js';
import { managerAccess } from '../service/manager-access-service.js';

export async function listServersHandler(req: Request, res: Response) {
  const request = req as RequestWithUser;
  const user = request.user ?? await getUserFromBearerToken(req.header('authorization'));
  const masterOnly = req.query?.masterOnly === 'true';
  const dashboardIds = !masterOnly && user?.steamId ? new Set((await managerAccess(user.steamId)).serverIds) : new Set<string>();
  const servers = await listServers({
    userId: user?.id,
    userSteamId: user?.steamVerifiedAt ? user.steamId : undefined,
  });
  const latestOZToolsVersion = getCachedOZPluginLatestVersions()['OZ - Tools'];
  const response: ListServersResponse = {
    servers: servers.filter(server => !masterOnly || server.masterOnly).map((server) => {
      const inventory = getCachedPluginData(server.id);
      const ozTools = inventory?.plugins.find(
        (plugin) => plugin.valid && plugin.name?.trim().toLowerCase() === 'oz - tools',
      );
      return {
        ...server,
        ...(!user ? { onlinePlayers: undefined } : {}),
        dashboardVisible: !server.masterOnly && dashboardIds.has(server.id),
        canApprove: server.masterOnly === true && !!user?.steamVerifiedAt && !!user.steamId &&
          !!server.info && typeof server.info === 'object' &&
          (server.info as { contact?: unknown }).contact === user.steamId,
        canDelete: server.masterOnly !== true && !!user?.steamVerifiedAt && !!user.steamId &&
          !!server.info && typeof server.info === 'object' &&
          (server.info as { contact?: unknown }).contact === user.steamId,
        pluginListAvailable: inventory !== undefined,
        ozToolsInstalled: ozTools !== undefined,
        ...(ozTools?.version ? { ozToolsVersion: ozTools.version } : {}),
        ...(latestOZToolsVersion
          ? { latestOZToolsVersion }
          : {}),
      };
    }),
  };
  return res.json(typia.assert<ListServersResponse>(response));
}
