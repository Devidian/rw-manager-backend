import type { MapBounds } from './map-bounds.js';

export interface MapMetadata {
  schemaVersion: 6;
  serverId?: string;
  displayName?: string;
  worldKey: string;
  worldName: string;
  tileSize: number;
  chunkSize: number;
  pixelsPerBlock: number;
  nativeTileSizeChunks: number;
  minZoom: number;
  nativeZoom: number;
  generatedChunkBounds: MapBounds;
  generatedTileBounds: MapBounds;
  updatedAt: string;
  tileUrl: string;
}
