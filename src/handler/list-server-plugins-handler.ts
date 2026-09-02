import type { Request, Response } from 'express';
import typia from 'typia';
import type { ListServerPluginsResponse } from '../dto/list-server-plugins-response.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';
import { getCachedPluginData, getFirstCachedPluginData } from '../service/plugin-data-cache-service.js';

export async function listServerPluginsHandler(req: Request, res: Response) {
  try {
    const server = await prepareServerRoute(req);
    const entry = server ? getCachedPluginData(server.id) : getFirstCachedPluginData();
    const response: ListServerPluginsResponse = {
      items: (entry?.plugins ?? []).flatMap((plugin) =>
        typeof plugin.valid === 'boolean' &&
        (plugin.name === undefined || typeof plugin.name === 'string') &&
        (plugin.version === undefined || typeof plugin.version === 'string')
          ? [{ name: plugin.name, version: plugin.version, valid: plugin.valid }]
          : [],
      ),
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<ListServerPluginsResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
