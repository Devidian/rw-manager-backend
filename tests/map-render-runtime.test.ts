import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startMapRenderer } from '../src/service/map-render-runtime.js';

describe('map render runtime', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('stays disabled by default', () => {
    delete process.env.ENABLE_MAP_RENDERER;
    expect(startMapRenderer()).toBeNull();
  });

  test('does not prevent startup when the enabled renderer source is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-runtime-missing-'));
    await writeFile(path.join(root, 'server.properties'), 'World_Name=Missing World\n');
    process.env.ENABLE_MAP_RENDERER = 'true';
    process.env.SERVER_ROOT = root;
    process.env.MAP_TILE_ROOT = path.join(root, 'tiles');

    expect(startMapRenderer()).toBeNull();
  });
});
