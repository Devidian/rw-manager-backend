import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapGlobalMarketplaceOffersResponse } from '../dto/get-map-global-marketplace-offers-response.js';
import { getMapGlobalMarketplaceOffers } from '../service/map-layer-service.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';

export async function getMapGlobalMarketplaceOffersHandler(req: Request, res: Response) {
  try {
    const server = await prepareServerRoute(req);
    const items = server ? await getMapGlobalMarketplaceOffers(undefined, server.id) : await getMapGlobalMarketplaceOffers();
    const response: GetMapGlobalMarketplaceOffersResponse = {
      schemaVersion: 1,
      available: items !== null,
      items: items ?? [],
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetMapGlobalMarketplaceOffersResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
