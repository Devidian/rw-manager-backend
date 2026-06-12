import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { MapBounds } from '../interfaces/map-bounds.js';
import type { MapSourceChunk } from '../interfaces/map-source-chunk.js';
import { defaultLogger } from '../utils/logger.js';
import type { MapRenderProcessor } from './map-render-poller.js';
import type { MapSourceReader } from './map-source-service.js';
import { toWorldKey } from './map-service.js';
import { textureColor, type MapColor } from './map-texture-palette.js';

const TILE_SIZE = 256;
const CHUNK_SIZE = 32;
const PIXELS_PER_BLOCK = 4;
const CHUNK_PIXELS = CHUNK_SIZE * PIXELS_PER_BLOCK;
const NATIVE_TILE_SIZE_CHUNKS = 2;
const MIN_ZOOM = 0;
const NATIVE_ZOOM = 8;

export class MapTileRenderer implements MapRenderProcessor {
  constructor(
    private readonly tileRoot: string,
    private readonly source: Pick<MapSourceReader, 'listChunks'>,
    private readonly clock: () => number = Date.now,
  ) {}

  async render(worldName: string, changedChunks: MapSourceChunk[]): Promise<void> {
    const chunks = this.source.listChunks();
    const chunksByCoordinate = new Map(
      chunks.map((chunk) => [coordinateKey(chunk.chunkX, chunk.chunkZ), chunk]),
    );
    const nativeTiles = uniqueCoordinates(
      changedChunks.map((chunk) => [
        floorDiv(chunk.chunkX, NATIVE_TILE_SIZE_CHUNKS),
        floorDiv(chunk.chunkZ, NATIVE_TILE_SIZE_CHUNKS),
      ]),
    );
    const worldRoot = path.join(this.tileRoot, toWorldKey(worldName));

    for (const [tileX, tileZ] of nativeTiles) {
      const image = transparentTile();
      for (let offsetZ = 0; offsetZ < NATIVE_TILE_SIZE_CHUNKS; offsetZ += 1) {
        for (let offsetX = 0; offsetX < NATIVE_TILE_SIZE_CHUNKS; offsetX += 1) {
          const chunk = chunksByCoordinate.get(
            coordinateKey(
              tileX * NATIVE_TILE_SIZE_CHUNKS + offsetX,
              tileZ * NATIVE_TILE_SIZE_CHUNKS + offsetZ,
            ),
          );
          if (chunk) renderChunk(image, chunk, offsetX, offsetZ);
        }
      }
      await writePngAtomic(tilePath(worldRoot, NATIVE_ZOOM, tileX, tileZ), image);
    }

    let affected = nativeTiles;
    for (let zoom = NATIVE_ZOOM - 1; zoom >= MIN_ZOOM; zoom -= 1) {
      affected = uniqueCoordinates(
        affected.map(([x, z]) => [floorDiv(x, 2), floorDiv(z, 2)]),
      );
      for (const [tileX, tileZ] of affected) {
        await rebuildParent(worldRoot, zoom, tileX, tileZ);
      }
    }

    await writeMetadata(worldRoot, worldName, chunks, this.clock());
    defaultLogger.debug(
      `Rendered ${changedChunks.length} changed map chunks into ${nativeTiles.length} native tiles`,
    );
  }
}

export { textureColor } from './map-texture-palette.js';

function renderChunk(
  image: PNG,
  chunk: MapSourceChunk,
  offsetX: number,
  offsetZ: number,
): void {
  for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      const sourceIndex = localZ * CHUNK_SIZE + localX;
      const color = textureColor(
        chunk.textures[sourceIndex],
        chunk.heights.readFloatLE(sourceIndex * Float32Array.BYTES_PER_ELEMENT),
      );
      const worldPixelX = offsetX * CHUNK_PIXELS + localX * PIXELS_PER_BLOCK;
      const worldPixelZ = offsetZ * CHUNK_PIXELS + localZ * PIXELS_PER_BLOCK;
      for (let pixelZ = 0; pixelZ < PIXELS_PER_BLOCK; pixelZ += 1) {
        for (let pixelX = 0; pixelX < PIXELS_PER_BLOCK; pixelX += 1) {
          setPixel(
            image,
            worldPixelX + pixelX,
            TILE_SIZE - 1 - (worldPixelZ + pixelZ),
            color,
          );
        }
      }
    }
  }
}

async function rebuildParent(
  worldRoot: string,
  zoom: number,
  tileX: number,
  tileZ: number,
): Promise<void> {
  const parent = transparentTile();
  for (let offsetZ = 0; offsetZ < 2; offsetZ += 1) {
    for (let offsetX = 0; offsetX < 2; offsetX += 1) {
      const child = await readPng(
        tilePath(worldRoot, zoom + 1, tileX * 2 + offsetX, tileZ * 2 + offsetZ),
      );
      if (!child) continue;
      const targetX = offsetX * (TILE_SIZE / 2);
      const targetY = (1 - offsetZ) * (TILE_SIZE / 2);
      for (let y = 0; y < TILE_SIZE / 2; y += 1) {
        for (let x = 0; x < TILE_SIZE / 2; x += 1) {
          copyPixel(child, x * 2, y * 2, parent, targetX + x, targetY + y);
        }
      }
    }
  }
  await writePngAtomic(tilePath(worldRoot, zoom, tileX, tileZ), parent);
}

async function writeMetadata(
  worldRoot: string,
  worldName: string,
  chunks: MapSourceChunk[],
  updatedAtMs: number,
): Promise<void> {
  if (chunks.length === 0) return;
  const chunkBounds = bounds(chunks.map((chunk) => [chunk.chunkX, chunk.chunkZ]));
  const tileBounds = bounds(
    chunks.map((chunk) => [
      floorDiv(chunk.chunkX, NATIVE_TILE_SIZE_CHUNKS),
      floorDiv(chunk.chunkZ, NATIVE_TILE_SIZE_CHUNKS),
    ]),
  );
  const metadata = {
    schemaVersion: 5,
    worldKey: toWorldKey(worldName),
    worldName,
    tileSize: TILE_SIZE,
    chunkSize: CHUNK_SIZE,
    pixelsPerBlock: PIXELS_PER_BLOCK,
    nativeTileSizeChunks: NATIVE_TILE_SIZE_CHUNKS,
    minZoom: MIN_ZOOM,
    nativeZoom: NATIVE_ZOOM,
    generatedChunkBounds: chunkBounds,
    generatedTileBounds: tileBounds,
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
  await writeAtomic(
    path.join(worldRoot, 'metadata.json'),
    Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`),
  );
}

function bounds(coordinates: Array<[number, number]>): MapBounds {
  return coordinates.reduce<MapBounds>(
    (result, [x, z]) => ({
      minX: Math.min(result.minX, x),
      minZ: Math.min(result.minZ, z),
      maxX: Math.max(result.maxX, x),
      maxZ: Math.max(result.maxZ, z),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  );
}

function transparentTile(): PNG {
  return new PNG({ width: TILE_SIZE, height: TILE_SIZE, colorType: 6 });
}

async function readPng(filePath: string): Promise<PNG | null> {
  try {
    return PNG.sync.read(await readFile(filePath));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function writePngAtomic(filePath: string, image: PNG): Promise<void> {
  await writeAtomic(
    filePath,
    PNG.sync.write(image, { deflateLevel: 3, deflateStrategy: 3 }),
  );
}

async function writeAtomic(filePath: string, content: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, content);
  await rename(temporaryPath, filePath);
}

function tilePath(worldRoot: string, zoom: number, x: number, z: number): string {
  return path.join(worldRoot, String(zoom), String(x), `${z}.png`);
}

function uniqueCoordinates(coordinates: Array<[number, number]>): Array<[number, number]> {
  return [...new Map(coordinates.map(([x, z]) => [`${x},${z}`, [x, z] as [number, number]])).values()];
}

function coordinateKey(x: number, z: number): `${number},${number}` {
  return `${x},${z}`;
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function setPixel(image: PNG, x: number, y: number, color: MapColor): void {
  const index = (y * image.width + x) * 4;
  image.data[index] = color[0];
  image.data[index + 1] = color[1];
  image.data[index + 2] = color[2];
  image.data[index + 3] = color[3];
}

function copyPixel(source: PNG, sourceX: number, sourceY: number, target: PNG, targetX: number, targetY: number): void {
  const sourceIndex = (sourceY * source.width + sourceX) * 4;
  const targetIndex = (targetY * target.width + targetX) * 4;
  source.data.copy(target.data, targetIndex, sourceIndex, sourceIndex + 4);
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT';
}
