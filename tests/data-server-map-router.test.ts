import express from 'express';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import dataServerRouter from '../src/router/data-server-router.js';
import { getServerMap, resolveMapTile } from '../src/service/map-service.js';

describe('server map routes', () => {
  test('serves an existing PNG tile through the documented route', async () => {
    const root = await mkdtemp('/tmp/rw-map-route-');
    process.env.SERVER_ROOT = root;
    process.env.MAP_TILE_ROOT = path.join(root, 'map-tiles');
    await writeFile(
      path.join(root, 'server.properties'),
      'World_Name=New World\n',
    );
    const mapRoot = path.join(process.env.MAP_TILE_ROOT, 'new-world');
    await mkdir(path.join(mapRoot, '8', '0'), { recursive: true });
    await mkdir(path.join(root, 'Plugins', 'OZAdminUtils'), { recursive: true });
    await writeFile(
      path.join(root, 'Plugins', 'OZAdminUtils', 'plugin.yml'),
      'name: "OZ - Admin Utils"\nversion: "0.6.0"\n',
    );
    await writeFile(
      path.join(mapRoot, 'metadata.json'),
      JSON.stringify(metadata()),
    );
    await writeFile(path.join(mapRoot, '8', '0', '0.png'), 'png-data');

    await expect(getServerMap()).resolves.toMatchObject({ available: true });
    await expect(
      resolveMapTile('new-world', '8', '0', '0'),
    ).resolves.not.toBeNull();

    const app = express();
    app.use('/api/data', dataServerRouter);
    const response = await request(app).get(
      '/api/data/server/map/tiles/new-world/8/0/0.png',
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cache-control']).toBe(
      'public, max-age=60, must-revalidate',
    );

    const nonPngResponse = await request(app).get(
      '/api/data/server/map/tiles/new-world/8/0/0.jpg',
    );
    expect(nonPngResponse.status).toBe(400);
  });
});

function metadata() {
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
  };
}
