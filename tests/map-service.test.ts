import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getServerMap } from '../src/service/map-service.js';

describe('map service', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  test('returns unavailable for absent, malformed, and incompatible renderer maps', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-absent-'));
    await expect(getServerMap(root, 'New World', 'server-valid')).resolves.toEqual({
      available: false,
    });

    const mapRoot = await createRendererMapRoot(root, 'server-valid');
    await writeFile(path.join(mapRoot, 'metadata.json'), '{broken');
    await expect(getServerMap(root, 'New World', 'server-valid')).resolves.toEqual({
      available: false,
    });

    await writeFile(
      path.join(mapRoot, 'metadata.json'),
      JSON.stringify(rendererMetadata({ schemaVersion: 5, serverId: 'server-valid' })),
    );
    await expect(getServerMap(root, 'New World', 'server-valid')).resolves.toEqual({
      available: false,
    });
  });

  test('returns unavailable without a configured renderer tile root or server id', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-unconfigured-'));

    await expect(getServerMap(undefined, 'New World', 'server-valid')).resolves.toEqual({
      available: false,
    });
    await expect(getServerMap(root, 'New World', undefined)).resolves.toEqual({
      available: false,
    });
  });

  test('returns renderer schema-6 metadata with the public tile root URL', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-renderer-'));
    const serverId = 'server-f8e7fa9ca73fd4b4943db61a';
    process.env.MAP_SERVER_ID = serverId;
    process.env.MAP_TILE_ROOT_URL = 'https://tiles.example.com/maps/';
    const mapRoot = await createRendererMapRoot(root, serverId);
    await writeFile(
      path.join(mapRoot, 'metadata.json'),
      JSON.stringify(rendererMetadata({ serverId })),
    );

    await expect(getServerMap(root, 'Ignored World')).resolves.toEqual({
      available: true,
      metadata: {
        ...rendererMetadata({ serverId }),
        worldKey: serverId,
        worldName: 'New World',
        tileUrl:
          'https://tiles.example.com/maps/server-f8e7fa9ca73fd4b4943db61a/{z}/{x}/{y}.png',
      },
    });
  });

  test('rejects renderer metadata with invalid contract fields', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-renderer-invalid-'));
    const serverId = 'server-valid';
    const mapRoot = await createRendererMapRoot(root, serverId);
    const invalidValues = [
      { serverId: 'server-other' },
      { tileUrl: '/other/{z}/{x}/{y}.png' },
      { displayName: 7 },
      { tileSize: 0 },
      { chunkSize: 0 },
      { pixelsPerBlock: 0 },
      { nativeTileSizeChunks: 0 },
      { minZoom: -1 },
      { nativeZoom: -1 },
      { minZoom: 9, nativeZoom: 8 },
      { generatedChunkBounds: null },
      {
        generatedTileBounds: { minX: 1, minZ: 0, maxX: 0, maxZ: 1 },
      },
      { updatedAt: 'invalid' },
    ];

    for (const invalid of invalidValues) {
      await writeFile(
        path.join(mapRoot, 'metadata.json'),
        JSON.stringify(rendererMetadata({ serverId, ...invalid })),
      );
      await expect(getServerMap(root, 'Ignored World', serverId)).resolves.toEqual({
        available: false,
      });
    }
  });
});

async function createRendererMapRoot(root: string, serverId: string): Promise<string> {
  const mapRoot = path.join(root, serverId);
  await mkdir(mapRoot, { recursive: true });
  return mapRoot;
}

function rendererMetadata(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 6,
    serverId: 'server-f8e7fa9ca73fd4b4943db61a',
    displayName: 'New World',
    tileSize: 256,
    chunkSize: 32,
    pixelsPerBlock: 4,
    nativeTileSizeChunks: 2,
    minZoom: 0,
    nativeZoom: 8,
    generatedChunkBounds: { minX: 0, minZ: 0, maxX: 3, maxZ: 3 },
    generatedTileBounds: { minX: 0, minZ: 0, maxX: 31, maxZ: 31 },
    updatedAt: '2026-06-09T07:00:00Z',
    tileUrl: '/server-f8e7fa9ca73fd4b4943db61a/{z}/{x}/{y}.png',
    ...overrides,
  };
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}
