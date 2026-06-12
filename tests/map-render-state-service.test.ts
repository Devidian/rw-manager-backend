import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MapRenderStateStore,
  mapRenderStatePath,
  requiredMapTileRoot,
} from '../src/service/map-render-state-service.js';

describe('map render state service', () => {
  test('stores observed and rendered state separately', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-state-'));
    const statePath = path.join(root, 'state.db');
    const store = new MapRenderStateStore(statePath);

    store.markObserved('New World', -44, -50, 1000);
    expect(store.getWorldState('New World').get('-44,-50')).toEqual({
      worldName: 'New World',
      chunkX: -44,
      chunkZ: -50,
      sourceUpdatedAtMs: 1000,
      renderedHash: null,
      renderedAtMs: null,
    });

    store.markRendered('New World', -44, -50, 2000, 'a'.repeat(64), 3000);
    expect(store.getWorldState('New World').get('-44,-50')).toEqual({
      worldName: 'New World',
      chunkX: -44,
      chunkZ: -50,
      sourceUpdatedAtMs: 2000,
      renderedHash: 'a'.repeat(64),
      renderedAtMs: 3000,
    });
    store.close();
  });

  test('uses the documented state path', () => {
    expect(mapRenderStatePath('/tiles')).toBe(path.join('/tiles', '.state', 'rendering.db'));
  });

  test('stores a rendered batch and validates the configured tile root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-state-batch-'));
    const store = new MapRenderStateStore(path.join(root, 'state.db'));
    store.markRenderedBatch(
      'New World',
      [
        { chunkX: 1, chunkZ: 2, sourceUpdatedAtMs: 100, renderedHash: 'a'.repeat(64) },
        { chunkX: 3, chunkZ: 4, sourceUpdatedAtMs: 200, renderedHash: 'b'.repeat(64) },
      ],
      300,
    );
    expect(store.getWorldState('New World').size).toBe(2);
    store.close();

    const previous = process.env.MAP_TILE_ROOT;
    process.env.MAP_TILE_ROOT = root;
    expect(requiredMapTileRoot()).toBe(root);
    process.env.MAP_TILE_ROOT = 'relative';
    expect(() => requiredMapTileRoot()).toThrow('MAP_TILE_ROOT must be an absolute path');
    if (previous === undefined) delete process.env.MAP_TILE_ROOT;
    else process.env.MAP_TILE_ROOT = previous;
  });
});
