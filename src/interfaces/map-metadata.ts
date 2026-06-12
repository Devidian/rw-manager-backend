import type { MapBounds } from './map-bounds.js';

export interface MapMetadata {
  schemaVersion: 5;
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
