import type { MapPlayer } from '../interfaces/map-layer.js';

export interface GetMapPlayersResponse {
  schemaVersion: 1;
  available: boolean;
  recentPlayerDays: number;
  items: MapPlayer[];
}
