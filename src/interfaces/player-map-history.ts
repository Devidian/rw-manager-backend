export interface PlayerMapHistorySector {
  sectorX: number;
  sectorZ: number;
  bitmap: string;
  updatedAtMs: number;
}

export interface PlayerMapHistory {
  schemaVersion: 1;
  sectorSizeChunks: 256;
  items: PlayerMapHistorySector[];
}
