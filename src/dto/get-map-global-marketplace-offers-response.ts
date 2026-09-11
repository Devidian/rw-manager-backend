import type { MapMarketplaceOffer } from '../interfaces/map-layer.js';

export interface GetMapGlobalMarketplaceOffersResponse {
  schemaVersion: 1;
  available: boolean;
  items: MapMarketplaceOffer[];
}
