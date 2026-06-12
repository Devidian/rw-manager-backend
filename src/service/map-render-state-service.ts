import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { MapRenderState } from '../interfaces/map-render-state.js';
import { AppConfig } from '../utils/app-config.js';

interface StateRow {
  world_name: string;
  chunk_x: number;
  chunk_z: number;
  source_updated_at_ms: number;
  rendered_hash: string | null;
  rendered_at_ms: number | null;
}

export class MapRenderStateStore {
  private readonly database: Database.Database;

  constructor(statePath: string = mapRenderStatePath(requiredMapTileRoot())) {
    mkdirSync(path.dirname(statePath), { recursive: true });
    this.database = new Database(statePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('busy_timeout = 5000');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS map_render_state_v1 (
        world_name TEXT NOT NULL,
        chunk_x INTEGER NOT NULL,
        chunk_z INTEGER NOT NULL,
        source_updated_at_ms INTEGER NOT NULL,
        rendered_hash TEXT,
        rendered_at_ms INTEGER,
        PRIMARY KEY (world_name, chunk_x, chunk_z)
      );
    `);
  }

  getWorldState(worldName: string): Map<`${number},${number}`, MapRenderState> {
    const rows = this.database
      .prepare(`
        SELECT world_name, chunk_x, chunk_z, source_updated_at_ms,
               rendered_hash, rendered_at_ms
        FROM map_render_state_v1
        WHERE world_name = ?
      `)
      .all(worldName) as StateRow[];
    return new Map(rows.map((row) => [key(row.chunk_x, row.chunk_z), fromRow(row)]));
  }

  markObserved(worldName: string, chunkX: number, chunkZ: number, sourceUpdatedAtMs: number): void {
    this.database
      .prepare(`
        INSERT INTO map_render_state_v1 (
          world_name, chunk_x, chunk_z, source_updated_at_ms, rendered_hash, rendered_at_ms
        ) VALUES (?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(world_name, chunk_x, chunk_z) DO UPDATE SET
          source_updated_at_ms = excluded.source_updated_at_ms
      `)
      .run(worldName, chunkX, chunkZ, sourceUpdatedAtMs);
  }

  markRendered(
    worldName: string,
    chunkX: number,
    chunkZ: number,
    sourceUpdatedAtMs: number,
    renderedHash: string,
    renderedAtMs: number,
  ): void {
    this.database
      .prepare(`
        INSERT INTO map_render_state_v1 (
          world_name, chunk_x, chunk_z, source_updated_at_ms, rendered_hash, rendered_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(world_name, chunk_x, chunk_z) DO UPDATE SET
          source_updated_at_ms = excluded.source_updated_at_ms,
          rendered_hash = excluded.rendered_hash,
          rendered_at_ms = excluded.rendered_at_ms
      `)
      .run(worldName, chunkX, chunkZ, sourceUpdatedAtMs, renderedHash, renderedAtMs);
  }

  markRenderedBatch(
    worldName: string,
    chunks: Array<{
      chunkX: number;
      chunkZ: number;
      sourceUpdatedAtMs: number;
      renderedHash: string;
    }>,
    renderedAtMs: number,
  ): void {
    const mark = this.database.transaction(() => {
      for (const chunk of chunks) {
        this.markRendered(
          worldName,
          chunk.chunkX,
          chunk.chunkZ,
          chunk.sourceUpdatedAtMs,
          chunk.renderedHash,
          renderedAtMs,
        );
      }
    });
    mark();
  }

  close(): void {
    this.database.close();
  }
}

export function mapRenderStatePath(tileRoot: string): string {
  return path.join(tileRoot, '.state', 'rendering.db');
}

export function requiredMapTileRoot(): string {
  if (!AppConfig.mapTileRoot || !path.isAbsolute(AppConfig.mapTileRoot)) {
    throw new Error('MAP_TILE_ROOT must be an absolute path when map renderer is enabled');
  }
  return AppConfig.mapTileRoot;
}

function key(chunkX: number, chunkZ: number): `${number},${number}` {
  return `${chunkX},${chunkZ}`;
}

function fromRow(row: StateRow): MapRenderState {
  return {
    worldName: row.world_name,
    chunkX: row.chunk_x,
    chunkZ: row.chunk_z,
    sourceUpdatedAtMs: row.source_updated_at_ms,
    renderedHash: row.rendered_hash,
    renderedAtMs: row.rendered_at_ms,
  };
}
