import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { GetServerMapResponse } from '../dto/get-server-map-response.js';
import type { MapBounds } from '../interfaces/map-bounds.js';
import type { MapMetadata } from '../interfaces/map-metadata.js';
import { AppConfig } from '../utils/app-config.js';

const RENDERER_MAP_SCHEMA_VERSION = 6;
const REMOTE_METADATA_MAX_BYTES = 256 * 1024;
const REMOTE_METADATA_TIMEOUT_MS = 5000;

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
  if (!serverId) return { available: false };
  if (tileRoot && path.isAbsolute(tileRoot)) {
    const local = await getRendererServerMap(tileRoot, serverId, publicTileRootUrl);
    if (local.available) return local;
  }
  return publicTileRootUrl
    ? getRemoteRendererServerMap(publicTileRootUrl, serverId)
    : { available: false };
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

async function getRemoteRendererServerMap(
  mapUrl: string,
  serverId: string,
): Promise<GetServerMapResponse> {
  let metadataUrl: URL;
  try {
    const rootUrl = new URL(mapUrl);
    if (!['http:', 'https:'].includes(rootUrl.protocol) || rootUrl.username || rootUrl.password) {
      return { available: false };
    }
    metadataUrl = new URL(`${rootUrl.toString().replace(/\/+$/, '')}/metadata.json`);
  } catch {
    return { available: false };
  }

  try {
    const response = await fetch(metadataUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(REMOTE_METADATA_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok || Number(response.headers.get('content-length')) > REMOTE_METADATA_MAX_BYTES) {
      await response.body?.cancel();
      return { available: false };
    }
    const producer = JSON.parse(await readBoundedBody(response)) as ProducerMetadata;
    const metadata = validateRendererMetadata(producer, serverId, undefined);
    metadata.tileUrl = `${metadataUrl.origin}${producer.tileUrl as string}`;
    return { available: true, metadata };
  } catch {
    return { available: false };
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) throw new Error('Missing metadata body');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REMOTE_METADATA_MAX_BYTES) throw new Error('Metadata response too large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (!size) throw new Error('Empty metadata body');
  return Buffer.concat(chunks).toString('utf8');
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
