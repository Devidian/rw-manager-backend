import { Request, Response } from 'express';
import typia from 'typia';
import type { ListServersResponse } from '../dto/list-servers-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { listServers } from '../service/storage-service.js';

export function listServersHandler(req: Request, res: Response) {
  const request = req as RequestWithUser;
  const response: ListServersResponse = {
    servers: listServers({
      userId: request.user?.id,
      userSteamId: request.user?.steamId,
    }),
  };
  return res.json(typia.assert<ListServersResponse>(response));
}
