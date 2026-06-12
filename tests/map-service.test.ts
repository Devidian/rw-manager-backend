import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  InvalidMapTileRequestError,
  getServerMap,
  resolveMapTile,
  toWorldKey,
} from '../src/service/map-service.js';

describe('map service', () => {
  test('normalizes world keys using the producer contract', () => {
    expect(toWorldKey('New World')).toBe('new-world');
    expect(toWorldKey(' . ')).toBe('world');
  });

  test('returns unavailable for absent, malformed, and incompatible maps', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-absent-'));
    await expect(getServerMap(root, 'New World')).resolves.toEqual({
      available: false,
    });

    const mapRoot = await createMapRoot(root);
    await writeFile(path.join(mapRoot, 'metadata.json'), '{broken');
    await expect(getServerMap(root, 'New World')).resolves.toEqual({
      available: false,
    });

    await writeFile(
      path.join(mapRoot, 'metadata.json'),
      JSON.stringify(metadata({ schemaVersion: 3 })),
    );
    await expect(getServerMap(root, 'New World')).resolves.toEqual({
      available: false,
    });
  });

  test('returns unavailable without a configured backend tile root', async () => {
    await expect(getServerMap(undefined, 'New World')).resolves.toEqual({
      available: false,
    });
    await expect(
      resolveMapTile('new-world', '8', '0', '0', undefined, 'New World'),
    ).resolves.toBeNull();
  });

  test('returns validated schema-5 metadata with the backend tile URL', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-valid-'));
    const mapRoot = await createMapRoot(root);
    await writeFile(
      path.join(mapRoot, 'metadata.json'),
      JSON.stringify(metadata()),
    );

    await expect(getServerMap(root, 'New World')).resolves.toEqual({
      available: true,
      metadata: {
        ...metadata(),
        tileUrl:
          '/api/data/server/map/tiles/new-world/{z}/{x}/{y}.png',
      },
    });
  });

  test('rejects schema-5 metadata with invalid contract fields', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-invalid-'));
    const mapRoot = await createMapRoot(root);
    const invalidValues = [
      { worldKey: 'other-world' },
      { worldName: 'Other World' },
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
        JSON.stringify(metadata(invalid)),
      );
      await expect(getServerMap(root, 'New World')).resolves.toEqual({
        available: false,
      });
    }
  });

  test('resolves existing positive and negative tile coordinates', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-tile-'));
    const mapRoot = await createMapRoot(root);
    await writeFile(
      path.join(mapRoot, 'metadata.json'),
      JSON.stringify(metadata()),
    );
    const tile = path.join(mapRoot, '8', '-2', '3.png');
    await mkdir(path.dirname(tile), { recursive: true });
    await writeFile(tile, 'png');

    await expect(
      resolveMapTile('new-world', '8', '-2', '3', root, 'New World'),
    ).resolves.toBe(await realpath(tile));
    await expect(
      resolveMapTile('new-world', '8', '-2', '4', root, 'New World'),
    ).resolves.toBeNull();
  });

  test('rejects invalid coordinates, unsupported zoom, and symlink escape', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-secure-'));
    const mapRoot = await createMapRoot(root);
    await writeFile(
      path.join(mapRoot, 'metadata.json'),
      JSON.stringify(metadata()),
    );

    await expect(
      resolveMapTile('new-world', 'x', '0', '0', root, 'New World'),
    ).rejects.toBeInstanceOf(InvalidMapTileRequestError);
    await expect(
      resolveMapTile('../new-world', '8', '0', '0', root, 'New World'),
    ).rejects.toBeInstanceOf(InvalidMapTileRequestError);
    await expect(
      resolveMapTile(
        'new-world',
        '8',
        '9007199254740992',
        '0',
        root,
        'New World',
      ),
    ).rejects.toBeInstanceOf(InvalidMapTileRequestError);
    await expect(
      resolveMapTile('new-world', '9', '0', '0', root, 'New World'),
    ).rejects.toBeInstanceOf(InvalidMapTileRequestError);
    await expect(
      resolveMapTile('other-world', '8', '0', '0', root, 'New World'),
    ).resolves.toBeNull();

    const outside = path.join(root, 'outside.png');
    await writeFile(outside, 'outside');
    await mkdir(path.join(mapRoot, '8', '0'), { recursive: true });
    await symlink(outside, path.join(mapRoot, '8', '0', '0.png'));
    await expect(
      resolveMapTile('new-world', '8', '0', '0', root, 'New World'),
    ).rejects.toBeInstanceOf(InvalidMapTileRequestError);
  });
});

async function createMapRoot(root: string): Promise<string> {
  const mapRoot = path.join(root, 'new-world');
  await mkdir(mapRoot, { recursive: true });
  return mapRoot;
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    worldKey: 'new-world',
    worldName: 'New World',
    tileSize: 256,
    chunkSize: 32,
    pixelsPerBlock: 4,
    nativeTileSizeChunks: 2,
    minZoom: 0,
    nativeZoom: 8,
    generatedChunkBounds: { minX: 0, minZ: 0, maxX: 3, maxZ: 3 },
    generatedTileBounds: { minX: 0, minZ: 0, maxX: 31, maxZ: 31 },
    updatedAt: '2026-06-09T07:00:00Z',
    ...overrides,
  };
}
