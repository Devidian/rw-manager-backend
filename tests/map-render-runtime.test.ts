import Database from 'better-sqlite3';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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

  test('does not require a Rising World server root when renderer is enabled', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-runtime-no-server-'));
    process.env.ENABLE_MAP_RENDERER = 'true';
    process.env.SERVER_ROOT = path.join(root, 'missing-server');
    process.env.MAP_TILE_ROOT = path.join(root, 'tiles');

    expect(startMapRenderer()).toBeNull();
  });

  test('starts only when the Admin Utils source database exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-runtime-ready-'));
    const pluginRoot = path.join(root, 'Plugins', 'OZAdminUtils');
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(path.join(root, 'server.properties'), 'World_Name=New World\n');
    const source = new Database(path.join(pluginRoot, 'New World.db'));
    source.exec(`
      CREATE TABLE map_chunks_v1 (
        schema_version INTEGER NOT NULL,
        chunk_x INTEGER NOT NULL,
        chunk_z INTEGER NOT NULL,
        heights BLOB NOT NULL,
        textures BLOB NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        biome INTEGER,
        region INTEGER,
        PRIMARY KEY (chunk_x, chunk_z)
      );
    `);
    source.close();
    process.env.ENABLE_MAP_RENDERER = 'true';
    process.env.SERVER_ROOT = root;
    process.env.MAP_TILE_ROOT = path.join(root, 'tiles');

    const poller = startMapRenderer();
    expect(poller).not.toBeNull();
    poller?.stop();
  });
});
