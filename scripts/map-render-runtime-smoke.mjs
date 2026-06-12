import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MapRenderPoller } from '../dist/service/map-render-poller.js';
import { MapRenderStateStore } from '../dist/service/map-render-state-service.js';
import { MapSourceReader } from '../dist/service/map-source-service.js';
import { MapTileRenderer } from '../dist/service/map-tile-renderer.js';

const sourceArgument = process.argv.slice(2).find((argument) => argument !== '--');
if (!sourceArgument) {
  console.error('Usage: npm run smoke:map-render -- /path/to/<world>.db');
  process.exit(1);
}

const sourcePath = path.resolve(sourceArgument);
const worldName = path.basename(sourcePath, '.db');
const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'rw-map-smoke-'));
const serverRoot = path.join(runtimeRoot, 'server');
const tileRoot = path.join(runtimeRoot, 'tiles');
const pluginRoot = path.join(serverRoot, 'Plugins', 'OZAdminUtils');

try {
  await mkdir(pluginRoot, { recursive: true });
  await copyFile(sourcePath, path.join(pluginRoot, `${worldName}.db`));
  for (const suffix of ['-wal', '-shm']) {
    await copyIfPresent(`${sourcePath}${suffix}`, path.join(pluginRoot, `${worldName}.db${suffix}`));
  }

  const source = new MapSourceReader(worldName, path.join(pluginRoot, `${worldName}.db`));
  const expectedNativeTiles = new Map(
    source.listChunks().map((chunk) => {
      const x = Math.floor(chunk.chunkX / 2);
      const z = Math.floor(chunk.chunkZ / 2);
      return [`${x},${z}`, [x, z]];
    }),
  );
  source.close();

  const first = await pollOnce(serverRoot, tileRoot, worldName);
  if (first.rendered === 0) throw new Error('Initial poll rendered no chunks');

  const metadataPath = path.join(tileRoot, worldKey(worldName), 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (metadata.schemaVersion !== 5 || metadata.nativeTileSizeChunks !== 2) {
    throw new Error('Published metadata is not schema 5');
  }
  for (const [x, z] of expectedNativeTiles.values()) {
    await stat(path.join(tileRoot, metadata.worldKey, '8', String(x), `${z}.png`));
  }

  const restarted = await pollOnce(serverRoot, tileRoot, worldName);
  if (restarted.candidates !== 0 || restarted.rendered !== 0) {
    throw new Error('Restart reprocessed already rendered source rows');
  }

  console.log(JSON.stringify({
    worldName,
    renderedChunks: first.rendered,
    nativeTileCount: expectedNativeTiles.size,
    generatedChunkBounds: metadata.generatedChunkBounds,
    generatedTileBounds: metadata.generatedTileBounds,
    restartCandidates: restarted.candidates,
  }));
} finally {
  await rm(runtimeRoot, { recursive: true, force: true });
}

async function pollOnce(serverRoot, tileRoot, worldName) {
  const source = new MapSourceReader(
    worldName,
    path.join(serverRoot, 'Plugins', 'OZAdminUtils', `${worldName}.db`),
  );
  const state = new MapRenderStateStore(path.join(tileRoot, '.state', 'rendering.db'));
  const poller = new MapRenderPoller(
    worldName,
    source,
    state,
    new MapTileRenderer(tileRoot, source),
  );
  try {
    return await poller.pollOnce();
  } finally {
    poller.stop();
  }
}

async function copyIfPresent(source, target) {
  try {
    await copyFile(source, target);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function worldKey(value) {
  const key = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return key === '' || key === '.' || key === '..' ? 'world' : key;
}
