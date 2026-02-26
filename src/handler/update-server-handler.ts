import { Request, Response } from 'express';
import typia from 'typia';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { ServerResponse } from '../dto/server-response.js';
import type { UpdateServerRequest } from '../dto/update-server-request.js';
import { patchServer } from '../service/storage-service.js';

export async function updateServerHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithUser;
    const serverId =
      typeof request.params.id === 'string'
        ? request.params.id
        : request.params.id[0];
    const body = typia.assert<UpdateServerRequest>(request.body ?? {});
    const server = await patchServer(serverId, body, {
      userId: request.user?.id,
      userSteamId: request.user?.steamId,
    });
    const response = typia.assert<ServerResponse>({ server });
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'SERVER_NOT_FOUND') {
      return res.status(404).json({ error: 'server not found' });
    }
    if (message === 'QUERY_URL_EXISTS') {
      return res.status(409).json({ error: 'queryUrl already exists for this user' });
    }
    if (message === 'FAILED_VERIFY_BACKEND_ADMINS') {
      return res.status(502).json({ error: 'failed to verify backend admins' });
    }
    if (message === 'NOT_BACKEND_ADMIN') {
      return res.status(403).json({ error: 'not a backend admin' });
    }
    if (message === 'QUERY_URL_NAME_REQUIRED') {
      return res.status(400).json({
        error:
          'queryUrl must return JSON with a non-empty name when backendUrl is provided',
      });
    }
    if (message === 'FAILED_VERIFY_BACKEND_CONFIG') {
      return res.status(502).json({ error: 'failed to verify backend config' });
    }
    if (message === 'QUERY_URL_NAME_MISMATCH') {
      return res
        .status(400)
        .json({ error: 'queryUrl.name must match backend config Server_Name' });
    }
    return res.status(400).json({ error: message });
  }
}
