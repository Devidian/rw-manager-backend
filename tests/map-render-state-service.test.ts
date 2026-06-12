import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MapRenderStateStore,
  mapRenderStatePath,
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
});
