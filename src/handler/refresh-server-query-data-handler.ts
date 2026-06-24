import { Request, Response } from 'express';
import typia from 'typia';
import type { MasterServerListRefreshResponse } from '../dto/master-server-list-refresh-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { refreshAllServerQueryData } from '../service/master-server-list-service.js';
import { AppConfig } from '../utils/app-config.js';

export async function refreshServerQueryDataHandler(req: Request, res: Response) {
  try {
    const user = (req as RequestWithUser).user;
    if (!AppConfig.superAdminId || user?.steamId !== AppConfig.superAdminId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const response: MasterServerListRefreshResponse = {
      result: await refreshAllServerQueryData(),
    };
    return res.json(typia.assert<MasterServerListRefreshResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(400).json({ error: message });
  }
}
