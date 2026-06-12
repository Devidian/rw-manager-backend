import { jest } from '@jest/globals';
import type { MapRenderState } from '../src/interfaces/map-render-state.js';
import type { MapSourceChunk } from '../src/interfaces/map-source-chunk.js';
import { MapRenderPoller } from '../src/service/map-render-poller.js';

describe('map render poller', () => {
  test('renders changed candidates, advances unchanged candidates, and honors batch size', async () => {
    const rendered: MapSourceChunk[][] = [];
    const observed: Array<[number, number, number]> = [];
    const markedRendered: Array<[number, number, number, string, number]> = [];
    const state = new Map<`${number},${number}`, MapRenderState>([
      ['1,1', renderState(1, 1, 50, 'b'.repeat(64))],
    ]);
    const poller = new MapRenderPoller(
      'New World',
      { listChunks: () => [chunk(0, 0, 100, 'a'), chunk(1, 1, 100, 'b'), chunk(2, 2, 100, 'c')], close() {} },
      {
        getWorldState: () => state,
        markObserved: (_world, x, z, updated) => observed.push([x, z, updated]),
        markRenderedBatch: (_world, chunks, renderedAt) =>
          chunks.forEach(({ chunkX, chunkZ, sourceUpdatedAtMs, renderedHash }) =>
            markedRendered.push([chunkX, chunkZ, sourceUpdatedAtMs, renderedHash, renderedAt])),
        close() {},
      },
      { render: async (_world, chunks) => rendered.push(chunks) },
      30000,
      2,
      () => 5000,
    );

    await expect(poller.pollOnce()).resolves.toEqual({
      candidates: 2,
      rendered: 1,
      unchanged: 1,
    });
    expect(rendered).toEqual([[chunk(0, 0, 100, 'a')]]);
    expect(observed).toEqual([[1, 1, 100]]);
    expect(markedRendered).toEqual([[0, 0, 100, 'a'.repeat(64), 5000]]);
  });

  test('does not advance changed state when rendering fails', async () => {
    const markedRendered: unknown[] = [];
    const poller = new MapRenderPoller(
      'New World',
      { listChunks: () => [chunk(0, 0, 100, 'a')], close() {} },
      {
        getWorldState: () => new Map(),
        markObserved() {},
        markRenderedBatch: (...args) => markedRendered.push(args),
        close() {},
      },
      { render: async () => { throw new Error('render failed'); } },
    );

    await expect(poller.pollOnce()).rejects.toThrow('render failed');
    expect(markedRendered).toEqual([]);
  });

  test('stops resources only once', () => {
    let sourceClosed = 0;
    let stateClosed = 0;
    const poller = new MapRenderPoller(
      'New World',
      { listChunks: () => [], close: () => { sourceClosed += 1; } },
      {
        getWorldState: () => new Map(),
        markObserved() {},
        markRenderedBatch() {},
        close: () => { stateClosed += 1; },
      },
      { render: async () => {} },
    );

    poller.stop();
    poller.stop();

    expect(sourceClosed).toBe(1);
    expect(stateClosed).toBe(1);
  });

  test('does not overlap polls and schedules non-overlapping runtime polling', async () => {
    jest.useFakeTimers();
    let finishRender: (() => void) | undefined;
    let hasChunk = true;
    const closed: string[] = [];
    const poller = new MapRenderPoller(
      'New World',
      { listChunks: () => hasChunk ? [chunk(0, 0, 100, 'a')] : [], close: () => closed.push('source') },
      {
        getWorldState: () => new Map(),
        markObserved() {},
        markRenderedBatch() {},
        close: () => closed.push('state'),
      },
      { render: () => new Promise<void>((resolve) => { finishRender = resolve; }) },
      1000,
    );

    const first = poller.pollOnce();
    await expect(poller.pollOnce()).resolves.toEqual({ candidates: 0, rendered: 0, unchanged: 0 });
    finishRender?.();
    await first;

    hasChunk = false;
    poller.start();
    poller.start();
    await jest.advanceTimersByTimeAsync(0);
    poller.stop();
    expect(closed).toEqual(['source', 'state']);
    jest.useRealTimers();
  });
});

function chunk(chunkX: number, chunkZ: number, updatedAtMs: number, hashCharacter: string): MapSourceChunk {
  return {
    schemaVersion: 1,
    chunkX,
    chunkZ,
    heights: Buffer.alloc(4096),
    textures: Buffer.alloc(1024),
    updatedAtMs,
    contentHash: hashCharacter.repeat(64),
    biome: null,
    region: null,
  };
}

function renderState(
  chunkX: number,
  chunkZ: number,
  sourceUpdatedAtMs: number,
  renderedHash: string,
): MapRenderState {
  return {
    worldName: 'New World',
    chunkX,
    chunkZ,
    sourceUpdatedAtMs,
    renderedHash,
    renderedAtMs: 1,
  };
}
