import type { MapGpsMarker } from '../interfaces/map-layer.js';

export interface GetMapGpsGlobalMarkersResponse {
  schemaVersion: 1;
  available: boolean;
  items: MapGpsMarker[];
}
