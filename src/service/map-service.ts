import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { GetServerMapResponse } from '../dto/get-server-map-response.js';
import type { MapBounds } from '../interfaces/map-bounds.js';
import type { MapMetadata } from '../interfaces/map-metadata.js';
import { AppConfig } from '../utils/app-config.js';

const RENDERER_MAP_SCHEMA_VERSION = 6;

interface ProducerMetadata {
  schemaVersion?: unknown;
  serverId?: unknown;
  displayName?: unknown;
  tileSize?: unknown;
  chunkSize?: unknown;
  pixelsPerBlock?: unknown;
  nativeTileSizeChunks?: unknown;
  minZoom?: unknown;
  nativeZoom?: unknown;
  generatedChunkBounds?: unknown;
  generatedTileBounds?: unknown;
  updatedAt?: unknown;
  tileUrl?: unknown;
}

export async function getServerMap(
  tileRoot: string | undefined = AppConfig.mapTileRoot,
  worldName?: string,
  serverId: string | undefined = AppConfig.mapServerId,
  publicTileRootUrl: string | undefined = AppConfig.mapTileRootUrl,
): Promise<GetServerMapResponse> {
  void worldName;
  if (!tileRoot || !path.isAbsolute(tileRoot) || !serverId) return { available: false };
  return getRendererServerMap(tileRoot, serverId, publicTileRootUrl);
}

async function getRendererServerMap(
  tileRoot: string,
  serverId: string,
  publicTileRootUrl: string | undefined,
): Promise<GetServerMapResponse> {
  const serverRoot = path.join(tileRoot, serverId);
  let json: string;
  try {
    json = await readFile(path.join(serverRoot, 'metadata.json'), 'utf8');
  } catch (error) {
    if (isMissing(error)) return { available: false };
    throw error;
  }

  try {
    const producer = JSON.parse(json) as ProducerMetadata;
    const metadata = validateRendererMetadata(producer, serverId, publicTileRootUrl);
    await stat(serverRoot);
    return { available: true, metadata };
  } catch {
    return { available: false };
  }
}

function validateRendererMetadata(
  value: ProducerMetadata,
  expectedServerId: string,
  publicTileRootUrl: string | undefined,
): MapMetadata {
  if (
    value.schemaVersion !== RENDERER_MAP_SCHEMA_VERSION ||
    value.serverId !== expectedServerId ||
    typeof value.displayName !== 'string' ||
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
    Number.isNaN(Date.parse(value.updatedAt)) ||
    typeof value.tileUrl !== 'string' ||
    !value.tileUrl.startsWith(`/${expectedServerId}/`)
  ) {
    throw new Error('Invalid renderer map metadata');
  }
  return {
    schemaVersion: RENDERER_MAP_SCHEMA_VERSION,
    serverId: expectedServerId,
    displayName: value.displayName,
    worldKey: expectedServerId,
    worldName: value.displayName,
    tileSize: value.tileSize,
    chunkSize: value.chunkSize,
    pixelsPerBlock: value.pixelsPerBlock,
    nativeTileSizeChunks: value.nativeTileSizeChunks,
    minZoom: value.minZoom,
    nativeZoom: value.nativeZoom,
    generatedChunkBounds: value.generatedChunkBounds,
    generatedTileBounds: value.generatedTileBounds,
    updatedAt: value.updatedAt,
    tileUrl: publicRendererTileUrl(value.tileUrl, publicTileRootUrl),
  };
}

function publicRendererTileUrl(tileUrl: string, rootUrl: string | undefined): string {
  if (!rootUrl) return tileUrl;
  return `${rootUrl.replace(/\/+$/, '')}/${tileUrl.replace(/^\/+/, '')}`;
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

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
