import type { MapSourceChunk } from '../interfaces/map-source-chunk.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { MapRenderStateStore } from './map-render-state-service.js';
import { MapSourceReader } from './map-source-service.js';

export interface MapRenderProcessor {
  render(worldName: string, chunks: MapSourceChunk[]): Promise<void>;
}

export interface MapRenderPollResult {
  candidates: number;
  rendered: number;
  unchanged: number;
}

const RENDERER_VERSION = 'semantic-palette-v3';

export class MapRenderPoller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly worldName: string,
    private readonly source: Pick<MapSourceReader, 'listChunks' | 'close'>,
    private readonly state: Pick<MapRenderStateStore, 'getWorldState' | 'markObserved' | 'markRenderedBatch' | 'close'>,
    private readonly processor: MapRenderProcessor,
    private readonly intervalMs: number = AppConfig.mapRenderIntervalMs,
    private readonly batchSize: number = AppConfig.mapRenderBatchSize,
    private readonly clock: () => number = Date.now,
  ) {}

  async pollOnce(): Promise<MapRenderPollResult> {
    if (this.running) return { candidates: 0, rendered: 0, unchanged: 0 };
    this.running = true;
    try {
      const state = this.state.getWorldState(this.worldName);
      const candidates = this.source
        .listChunks()
        .filter((chunk) => {
          const rendered = state.get(key(chunk));
          return (
            chunk.updatedAtMs > (rendered?.sourceUpdatedAtMs ?? 0) ||
            rendered?.renderedHash !== renderHash(chunk)
          );
        })
        .slice(0, this.batchSize);
      const changed = candidates.filter(
        (chunk) => state.get(key(chunk))?.renderedHash !== renderHash(chunk),
      );
      const unchanged = candidates.filter(
        (chunk) => state.get(key(chunk))?.renderedHash === renderHash(chunk),
      );

      for (const chunk of unchanged) {
        this.state.markObserved(this.worldName, chunk.chunkX, chunk.chunkZ, chunk.updatedAtMs);
      }
      if (changed.length > 0) {
        await this.processor.render(this.worldName, changed);
        const renderedAtMs = this.clock();
        this.state.markRenderedBatch(
          this.worldName,
          changed.map((chunk) => ({
            chunkX: chunk.chunkX,
            chunkZ: chunk.chunkZ,
            sourceUpdatedAtMs: chunk.updatedAtMs,
            renderedHash: renderHash(chunk),
          })),
          renderedAtMs,
        );
      }
      return {
        candidates: candidates.length,
        rendered: changed.length,
        unchanged: unchanged.length,
      };
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.stopped || this.timer) return;
    const run = async () => {
      try {
        const result = await this.pollOnce();
        if (result.candidates > 0) defaultLogger.debug('Map render poll:', result);
      } catch (error) {
        defaultLogger.error('Map render poll failed:', error);
      } finally {
        if (!this.stopped) this.timer = setTimeout(run, this.intervalMs);
      }
    };
    this.timer = setTimeout(run, 0);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.source.close();
    this.state.close();
  }
}

function key(chunk: MapSourceChunk): `${number},${number}` {
  return `${chunk.chunkX},${chunk.chunkZ}`;
}

function renderHash(chunk: MapSourceChunk): string {
  return `${RENDERER_VERSION}:${chunk.contentHash}`;
}
