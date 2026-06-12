import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { MapSourceChunk } from '../src/interfaces/map-source-chunk.js';
import { MapTileRenderer, textureColor } from '../src/service/map-tile-renderer.js';

describe('map tile renderer', () => {
  test('uses semantic terrain, wood, and stone map colors', () => {
    expect(textureColor(0)).toEqual([27, 88, 108, 255]);
    expect(textureColor(17)).toEqual([210, 183, 111, 255]);
    expect(textureColor(41)).toEqual([82, 118, 59, 255]);
    expect(textureColor(107)).toEqual([100, 65, 33, 255]);
    expect(textureColor(212)).toEqual([119, 120, 117, 255]);
    expect(textureColor(75)).toEqual([122, 116, 104, 255]);
  });

  test('renders signed native tiles with positive Z upward, transparency, pyramid, and schema-5 metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-renderer-'));
    const chunks = [
      chunk(-1, -1, 1),
      chunk(0, 0, 2),
      chunk(1, 1, 3),
    ];
    const renderer = new MapTileRenderer(
      root,
      { listChunks: () => chunks },
      () => Date.parse('2026-06-11T00:00:00.000Z'),
    );

    await renderer.render('New World', chunks);

    const negative = PNG.sync.read(
      await readFile(path.join(root, 'new-world', '8', '-1', '-1.png')),
    );
    expect(pixel(negative, 128, 0)).toEqual(textureColor(1));
    expect(pixel(negative, 0, 0)).toEqual([0, 0, 0, 0]);

    const positive = PNG.sync.read(
      await readFile(path.join(root, 'new-world', '8', '0', '0.png')),
    );
    expect(pixel(positive, 0, 255)).toEqual(textureColor(2));
    expect(pixel(positive, 128, 0)).toEqual(textureColor(3));
    expect(pixel(positive, 255, 255)).toEqual([0, 0, 0, 0]);

    const parent = PNG.sync.read(
      await readFile(path.join(root, 'new-world', '0', '0', '0.png')),
    );
    expect(parent.width).toBe(256);
    expect(parent.height).toBe(256);

    const metadata = JSON.parse(
      await readFile(path.join(root, 'new-world', 'metadata.json'), 'utf8'),
    );
    expect(metadata).toEqual({
      schemaVersion: 5,
      worldKey: 'new-world',
      worldName: 'New World',
      tileSize: 256,
      chunkSize: 32,
      pixelsPerBlock: 4,
      nativeTileSizeChunks: 2,
      minZoom: 0,
      nativeZoom: 8,
      generatedChunkBounds: { minX: -1, minZ: -1, maxX: 1, maxZ: 1 },
      generatedTileBounds: { minX: -1, minZ: -1, maxX: 0, maxZ: 0 },
      updatedAt: '2026-06-11T00:00:00.000Z',
    });
  }, 30000);
});

function chunk(chunkX: number, chunkZ: number, texture: number): MapSourceChunk {
  return {
    schemaVersion: 1,
    chunkX,
    chunkZ,
    heights: Buffer.alloc(4096),
    textures: Buffer.alloc(1024, texture),
    updatedAtMs: 1,
    contentHash: texture.toString(16).padStart(64, '0'),
    biome: null,
    region: null,
  };
}

function pixel(image: PNG, x: number, y: number): number[] {
  const index = (y * image.width + x) * 4;
  return [...image.data.subarray(index, index + 4)];
}
