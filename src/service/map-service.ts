import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { GetServerMapResponse } from '../dto/get-server-map-response.js';
import type { MapBounds } from '../interfaces/map-bounds.js';
import type { MapMetadata } from '../interfaces/map-metadata.js';
import { AppConfig } from '../utils/app-config.js';
import { ServerConfig } from '../utils/server-config.js';

const MAP_SCHEMA_VERSION = 5;
const WORLD_KEY_PATTERN = /^[a-z0-9._-]+$/;
const INTEGER_PATTERN = /^-?\d+$/;

interface ProducerMetadata {
  schemaVersion?: unknown;
  worldKey?: unknown;
  worldName?: unknown;
  tileSize?: unknown;
  chunkSize?: unknown;
  pixelsPerBlock?: unknown;
  nativeTileSizeChunks?: unknown;
  minZoom?: unknown;
  nativeZoom?: unknown;
  generatedChunkBounds?: unknown;
  generatedTileBounds?: unknown;
  updatedAt?: unknown;
}

export class InvalidMapTileRequestError extends Error {}

export async function getServerMap(
  tileRoot: string | undefined = AppConfig.mapTileRoot,
  worldName?: string,
): Promise<GetServerMapResponse> {
  if (!tileRoot || !path.isAbsolute(tileRoot)) return { available: false };
  const activeWorldName = worldName ?? ServerConfig.getWorldName(AppConfig.rootPath);
  const worldKey = toWorldKey(activeWorldName);
  const worldRoot = mapWorldRoot(tileRoot, worldKey);
  let json: string;
  try {
    json = await readFile(path.join(worldRoot, 'metadata.json'), 'utf8');
  } catch (error) {
    if (isMissing(error)) return { available: false };
    throw error;
  }

  try {
    const producer = JSON.parse(json) as ProducerMetadata;
    const metadata = validateMetadata(producer, worldKey, activeWorldName);
    await stat(worldRoot);
    return { available: true, metadata };
  } catch {
    return { available: false };
  }
}

export async function resolveMapTile(
  worldKey: string,
  zoomValue: string,
  xValue: string,
  yValue: string,
  tileRoot: string | undefined = AppConfig.mapTileRoot,
  worldName?: string,
): Promise<string | null> {
  if (!WORLD_KEY_PATTERN.test(worldKey)) {
    throw new InvalidMapTileRequestError('Invalid world key');
  }
  const zoom = parseInteger(zoomValue);
  const x = parseInteger(xValue);
  const y = parseInteger(yValue);
  if (!tileRoot || !path.isAbsolute(tileRoot)) return null;
  const map = await getServerMap(tileRoot, worldName);
  if (!map.available || map.metadata.worldKey !== worldKey) return null;
  if (zoom < map.metadata.minZoom || zoom > map.metadata.nativeZoom) {
    throw new InvalidMapTileRequestError('Unsupported zoom');
  }

  const worldRoot = mapWorldRoot(tileRoot!, worldKey);
  const tilePath = path.join(worldRoot, String(zoom), String(x), `${y}.png`);
  try {
    const [realRoot, realTile] = await Promise.all([
      realpath(worldRoot),
      realpath(tilePath),
    ]);
    const relative = path.relative(realRoot, realTile);
    if (
      relative === '' ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      throw new InvalidMapTileRequestError('Tile escapes map root');
    }
    if (!(await stat(realTile)).isFile()) return null;
    return realTile;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export function toWorldKey(worldName: string): string {
  const key = worldName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return key === '' || key === '.' || key === '..' ? 'world' : key;
}

function mapWorldRoot(tileRoot: string, worldKey: string): string {
  return path.join(tileRoot, worldKey);
}

function validateMetadata(
  value: ProducerMetadata,
  expectedWorldKey: string,
  expectedWorldName: string,
): MapMetadata {
  if (
    value.schemaVersion !== MAP_SCHEMA_VERSION ||
    value.worldKey !== expectedWorldKey ||
    value.worldName !== expectedWorldName ||
    !isPositiveInteger(value.tileSize) ||
    !isPositiveInteger(value.chunkSize) ||
    !isPositiveInteger(value.pixelsPerBlock) ||
    !isPositiveInteger(value.nativeTileSizeChunks) ||
    !isNonNegativeInteger(value.minZoom) ||
    !isNonNegativeInteger(value.nativeZoom) ||
    value.minZoom > value.nativeZoom ||
    !isBounds(value.generatedChunkBounds) ||
    !isBounds(value.generatedTileBounds) ||
    typeof value.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    throw new Error('Invalid map metadata');
  }
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    worldKey: expectedWorldKey,
    worldName: value.worldName,
    tileSize: value.tileSize,
    chunkSize: value.chunkSize,
    pixelsPerBlock: value.pixelsPerBlock,
    nativeTileSizeChunks: value.nativeTileSizeChunks,
    minZoom: value.minZoom,
    nativeZoom: value.nativeZoom,
    generatedChunkBounds: value.generatedChunkBounds,
    generatedTileBounds: value.generatedTileBounds,
    updatedAt: value.updatedAt,
    tileUrl: `/api/data/server/map/tiles/${expectedWorldKey}/{z}/{x}/{y}.png`,
  };
}

function isBounds(value: unknown): value is MapBounds {
  if (value === null || typeof value !== 'object') return false;
  const bounds = value as Partial<MapBounds>;
  return (
    Number.isInteger(bounds.minX) &&
    Number.isInteger(bounds.minZ) &&
    Number.isInteger(bounds.maxX) &&
    Number.isInteger(bounds.maxZ) &&
    bounds.minX! <= bounds.maxX! &&
    bounds.minZ! <= bounds.maxZ!
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function parseInteger(value: string): number {
  if (!INTEGER_PATTERN.test(value)) {
    throw new InvalidMapTileRequestError('Invalid tile coordinate');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new InvalidMapTileRequestError('Invalid tile coordinate');
  }
  return number;
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
