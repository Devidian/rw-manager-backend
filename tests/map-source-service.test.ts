import Database from 'better-sqlite3';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MapSourceReader,
  decodeMapSourceRow,
  mapSourcePath,
} from '../src/service/map-source-service.js';

describe('map source service', () => {
  test('resolves the active world source database path', () => {
    expect(mapSourcePath('/srv/rw', 'New World')).toBe(
      path.join('/srv/rw', 'Plugins', 'OZAdminUtils', 'New World.db'),
    );
  });

  test('reads valid source rows and isolates malformed rows', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-source-'));
    const sourcePath = path.join(root, 'source.db');
    const database = new Database(sourcePath);
    createSourceTable(database);
    insertRow(database, -44, -50, 1000, 'a'.repeat(64));
    database
      .prepare(`
        INSERT INTO map_chunks_v1
          (schema_version, chunk_x, chunk_z, heights, textures, updated_at_ms, content_hash, biome, region)
        VALUES (2, 0, 0, ?, ?, 1001, ?, NULL, NULL)
      `)
      .run(Buffer.alloc(4096), Buffer.alloc(1024), 'b'.repeat(64));
    database.close();

    const reader = new MapSourceReader('New World', sourcePath);
    expect(reader.listChunks()).toEqual([
      {
        schemaVersion: 1,
        chunkX: -44,
        chunkZ: -50,
        heights: Buffer.alloc(4096),
        textures: Buffer.alloc(1024),
        updatedAtMs: 1000,
        contentHash: 'a'.repeat(64),
        biome: null,
        region: null,
      },
    ]);
    reader.close();
  });

  test('rejects invalid blob sizes and hashes', () => {
    const valid = {
      schema_version: 1,
      chunk_x: 1,
      chunk_z: 2,
      heights: Buffer.alloc(4096),
      textures: Buffer.alloc(1024),
      updated_at_ms: 1000,
      content_hash: 'a'.repeat(64),
      biome: null,
      region: null,
    };
    expect(() => decodeMapSourceRow({ ...valid, heights: Buffer.alloc(1) })).toThrow(
      'Invalid map source row',
    );
    expect(() => decodeMapSourceRow({ ...valid, content_hash: 'INVALID' })).toThrow(
      'Invalid map source row',
    );
  });
});

function createSourceTable(database: Database.Database): void {
  database.exec(`
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
}

function insertRow(
  database: Database.Database,
  chunkX: number,
  chunkZ: number,
  updatedAtMs: number,
  hash: string,
): void {
  database
    .prepare(`
      INSERT INTO map_chunks_v1
        (schema_version, chunk_x, chunk_z, heights, textures, updated_at_ms, content_hash, biome, region)
      VALUES (1, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `)
    .run(chunkX, chunkZ, Buffer.alloc(4096), Buffer.alloc(1024), updatedAtMs, hash);
}
