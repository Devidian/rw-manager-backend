import { Request, Response } from 'express';
import typia from 'typia';
import { getServerAdminList } from '../service/server-config-service.js';
import type { GetServerAdminListResponse } from '../dto/get-server-admin-list-response.js';

export function getServerAdminListHandler(_req: Request, res: Response) {
  try {
    const response: GetServerAdminListResponse = { admins: getServerAdminList() };
    return res.json(typia.assert<GetServerAdminListResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(400).json({ error: message });
  }
}
