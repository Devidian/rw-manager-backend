export interface MapRenderState {
  worldName: string;
  chunkX: number;
  chunkZ: number;
  sourceUpdatedAtMs: number;
  renderedHash: string | null;
  renderedAtMs: number | null;
}
