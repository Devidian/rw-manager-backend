import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { ServerConfig } from '../utils/server-config.js';
import { MapRenderPoller } from './map-render-poller.js';
import { MapRenderStateStore, requiredMapTileRoot } from './map-render-state-service.js';
import { MapSourceReader } from './map-source-service.js';
import { MapTileRenderer } from './map-tile-renderer.js';

export function startMapRenderer(): MapRenderPoller | null {
  if (!AppConfig.enableMapRenderer) return null;

  let source: MapSourceReader | undefined;
  let state: MapRenderStateStore | undefined;
  try {
    const serverConfigPath = path.join(AppConfig.rootPath, 'server.properties');
    if (!existsSync(serverConfigPath)) {
      defaultLogger.debug('Map renderer unavailable: Rising World server configuration not found');
      return null;
    }
    const worldName = ServerConfig.getWorldName();
    const sourcePath = path.join(
      AppConfig.rootPath,
      'Plugins',
      'OZAdminUtils',
      `${worldName}.db`,
    );
    if (!existsSync(sourcePath)) {
      defaultLogger.debug('Map renderer unavailable: OZAdminUtils map source not found');
      return null;
    }
    const tileRoot = requiredMapTileRoot();
    source = new MapSourceReader(worldName, sourcePath);
    state = new MapRenderStateStore();
    const poller = new MapRenderPoller(
      worldName,
      source,
      state,
      new MapTileRenderer(tileRoot, source),
    );
    poller.start();
    defaultLogger.log(`Map renderer started for world "${worldName}"`);
    return poller;
  } catch (error) {
    source?.close();
    state?.close();
    defaultLogger.error('Map renderer initialization failed:', error);
    return null;
  }
}
