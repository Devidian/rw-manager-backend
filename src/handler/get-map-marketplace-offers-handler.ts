import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapMarketplaceOffersResponse } from '../dto/get-map-marketplace-offers-response.js';
import { getMapMarketplaceOffers } from '../service/map-layer-service.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';

export async function getMapMarketplaceOffersHandler(req: Request, res: Response) {
  const areaId = Number(req.params.areaId);
  if (!Number.isSafeInteger(areaId) || areaId <= 0) {
    return res.status(400).json({ error: 'areaId must be a positive integer' });
  }
  try {
    const server = await prepareServerRoute(req);
    const items = server
      ? await getMapMarketplaceOffers(areaId, undefined, server.id)
      : await getMapMarketplaceOffers(areaId);
    const response: GetMapMarketplaceOffersResponse = {
      schemaVersion: 1,
      available: items !== null,
      areaId,
      items: items ?? [],
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetMapMarketplaceOffersResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
