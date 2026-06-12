import type { Request, Response } from 'express';
import typia from 'typia';
import type { ListServerPluginsResponse } from '../dto/list-server-plugins-response.js';
import { listInstalledPlugins } from '../service/plugin-inventory-service.js';

export async function listServerPluginsHandler(_req: Request, res: Response) {
  try {
    const response: ListServerPluginsResponse = {
      items: await listInstalledPlugins(),
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<ListServerPluginsResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(500).json({ error: message });
  }
}
