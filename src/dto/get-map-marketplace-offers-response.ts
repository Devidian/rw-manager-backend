import type { MapMarketplaceOffer } from '../interfaces/map-layer.js';

export interface GetMapMarketplaceOffersResponse {
  schemaVersion: 1;
  available: boolean;
  areaId: number;
  items: MapMarketplaceOffer[];
}
