import { Request, Response } from 'express';
import typia from 'typia';
import type { MasterServerListRefreshResponse } from '../dto/master-server-list-refresh-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { refreshMasterServerList } from '../service/master-server-list-service.js';
import { listServers } from '../service/storage-service.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';

export async function refreshServerQueryDataHandler(req: Request, res: Response) {
  try {
    const startedAt = Date.now();
    defaultLogger.debug('Refresh query data request started');
    const user = (req as RequestWithUser).user;
    if (!AppConfig.superAdminId || user?.steamId !== AppConfig.superAdminId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    let errorMessage: string | undefined;
    const result = await refreshMasterServerList({ refreshQueryData: false }).catch((error: unknown) => {
      errorMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      defaultLogger.warn('Refresh query data request returning stored data after refresh failure:', error);
      return { fetched: 0, inserted: 0, updated: 0, refreshed: 0 };
    });
    const response: MasterServerListRefreshResponse = {
      result,
      servers: await listServers({
        userId: user?.id,
        userSteamId: user?.steamId,
      }),
      ...(errorMessage ? { errorMessage } : {}),
    };
    defaultLogger.debug('Refresh query data request completed:', {
      serverCount: response.servers.length,
      durationMs: Date.now() - startedAt,
      errorMessage,
    });
    return res.json(typia.assert<MasterServerListRefreshResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(400).json({ error: message });
  }
}
