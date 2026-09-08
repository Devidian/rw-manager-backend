import type { PlayerMapHistorySector } from '../interfaces/player-map-history.js';

export interface GetPlayerMapHistoryResponse {
  schemaVersion: 1;
  available: boolean;
  sectorSizeChunks: 256;
  items: PlayerMapHistorySector[];
}
