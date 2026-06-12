import Database from 'better-sqlite3';
import path from 'node:path';
import type { MapSourceChunk } from '../interfaces/map-source-chunk.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';

const SOURCE_SCHEMA_VERSION = 1;
const HEIGHT_BYTES = 4096;
const TEXTURE_BYTES = 1024;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

interface SourceRow {
  schema_version: unknown;
  chunk_x: unknown;
  chunk_z: unknown;
  heights: unknown;
  textures: unknown;
  updated_at_ms: unknown;
  content_hash: unknown;
  biome: unknown;
  region: unknown;
}

export class InvalidMapSourceRowError extends Error {}

export class MapSourceReader {
  private readonly database: Database.Database;

  constructor(
    readonly worldName: string,
    sourcePath: string = mapSourcePath(AppConfig.rootPath, worldName),
  ) {
    this.database = new Database(sourcePath, {
      readonly: true,
      fileMustExist: true,
    });
    this.database.pragma('busy_timeout = 5000');
  }

  listChunks(): MapSourceChunk[] {
    const rows = this.database
      .prepare(`
        SELECT schema_version, chunk_x, chunk_z, heights, textures,
               updated_at_ms, content_hash, biome, region
        FROM map_chunks_v1
        ORDER BY updated_at_ms, chunk_x, chunk_z
      `)
      .all() as SourceRow[];
    return rows.flatMap((row) => {
      try {
        return [decodeMapSourceRow(row)];
      } catch (error) {
        defaultLogger.warn('Ignoring invalid map source row:', error);
        return [];
      }
    });
  }

  close(): void {
    this.database.close();
  }
}

export function mapSourcePath(rootPath: string, worldName: string): string {
  return path.join(rootPath, 'Plugins', 'OZAdminUtils', `${worldName}.db`);
}

export function decodeMapSourceRow(row: SourceRow): MapSourceChunk {
  if (
    row.schema_version !== SOURCE_SCHEMA_VERSION ||
    !Number.isSafeInteger(row.chunk_x) ||
    !Number.isSafeInteger(row.chunk_z) ||
    !Buffer.isBuffer(row.heights) ||
    row.heights.length !== HEIGHT_BYTES ||
    !Buffer.isBuffer(row.textures) ||
    row.textures.length !== TEXTURE_BYTES ||
    !Number.isSafeInteger(row.updated_at_ms) ||
    (row.updated_at_ms as number) < 0 ||
    typeof row.content_hash !== 'string' ||
    !HASH_PATTERN.test(row.content_hash) ||
    !isNullableInteger(row.biome) ||
    !isNullableInteger(row.region)
  ) {
    throw new InvalidMapSourceRowError('Invalid map source row');
  }
  return {
    schemaVersion: SOURCE_SCHEMA_VERSION,
    chunkX: row.chunk_x as number,
    chunkZ: row.chunk_z as number,
    heights: Buffer.from(row.heights),
    textures: Buffer.from(row.textures),
    updatedAtMs: row.updated_at_ms as number,
    contentHash: row.content_hash,
    biome: row.biome as number | null,
    region: row.region as number | null,
  };
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value);
}
