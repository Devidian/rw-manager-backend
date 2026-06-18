import type { MapClaim } from '../interfaces/map-layer.js';

export interface GetMapClaimsResponse {
  schemaVersion: 1;
  available: boolean;
  items: MapClaim[];
}
