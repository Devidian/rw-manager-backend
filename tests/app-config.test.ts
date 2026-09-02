import { AppConfig } from '../src/utils/app-config.js';
import path from 'node:path';

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe('AppConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  test('uses documented defaults when no environment variable is set', () => {
    restoreEnv({});

    expect(AppConfig.rootPath).toBe('/appdata/rising-world/dedicated-server');
    expect(AppConfig.dataRoot).toBe(path.resolve('data'));
    expect(AppConfig.enableStorage).toBe(false);
    expect(AppConfig.enableData).toBe(false);
    expect(AppConfig.enableAuth).toBe(false);
    expect(AppConfig.forceAuth).toBe(false);
    expect(AppConfig.mapTileRoot).toBeUndefined();
    expect(AppConfig.mapTileRootUrl).toBeUndefined();
    expect(AppConfig.mapServerId).toBeUndefined();
    expect(AppConfig.masterServerListRefreshIntervalMs).toBe(60000);
    expect(AppConfig.serverQueryRefreshIntervalMs).toBe(600000);
    expect(AppConfig.serverInfoRefreshOnStartupMs).toBe(600000);
    expect(AppConfig.playerListRefreshIntervalMs).toBe(180000);
    expect(AppConfig.activePlayerListRefreshIntervalMs).toBe(30000);
    expect(AppConfig.playerListRefreshConcurrency).toBe(20);
    expect(AppConfig.playerListTimeoutMs).toBe(5000);
    expect(AppConfig.pluginDataRefreshIntervalMs).toBe(60000);
    expect(AppConfig.pluginDataCacheTtlMs).toBe(300000);
    expect(AppConfig.mapPlayerLayerCacheTtlMs).toBe(30000);
    expect(AppConfig.maxPinnedServers).toBe(50);
    expect(AppConfig.serverLiveMaxServerIds).toBe(1000);
    expect(AppConfig.masterServerListTimeoutMs).toBe(8000);
    expect(AppConfig.defaultUserRole).toBe('user');
    expect(AppConfig.superAdminId).toBe('');
    expect(AppConfig.authSessionSecret).toBe('rw-manager-storage-session');
    expect(AppConfig.logLevel).toBe('debug');
    expect(AppConfig.enableLogColors).toBe(false);
    expect(AppConfig.logStyle).toBe('default');
  });

  test('reads valid environment overrides and ignores invalid enum values', () => {
    process.env.SERVER_ROOT = '/srv/rw';
    process.env.APP_DATA_ROOT = '/srv/rwman';
    process.env.ENABLE_STORAGE = 'true';
    process.env.ENABLE_DATA = 'true';
    process.env.ENABLE_AUTH = 'true';
    process.env.FORCE_AUTH = 'true';
    process.env.MAP_TILE_ROOT = '/srv/map-tiles';
    process.env.MAP_TILE_ROOT_URL = 'https://tiles.example.com/maps';
    process.env.MAP_SERVER_ID = 'server-f8e7fa9ca73fd4b4943db61a';
    process.env.MASTER_SERVER_LIST_REFRESH_INTERVAL_MS = '120000';
    process.env.SERVER_QUERY_REFRESH_INTERVAL_MS = '120000';
    process.env.SERVER_INFO_REFRESH_ON_STARTUP_MS = '120000';
    process.env.PLAYERLIST_REFRESH_INTERVAL_MS = '10000';
    process.env.ACTIVE_PLAYERLIST_REFRESH_INTERVAL_MS = '15000';
    process.env.PLAYERLIST_REFRESH_CONCURRENCY = '25';
    process.env.PLAYERLIST_TIMEOUT_MS = '2000';
    process.env.PLUGIN_DATA_REFRESH_INTERVAL_MS = '30000';
    process.env.PLUGIN_DATA_CACHE_TTL_MS = '120000';
    process.env.MAP_PLAYER_LAYER_CACHE_TTL_MS = '45000';
    process.env.MAX_PINNED_SERVERS = '75';
    process.env.SERVER_LIVE_MAX_SERVER_IDS = '90';
    process.env.MASTER_SERVER_LIST_TIMEOUT_MS = '12000';
    process.env.DEFAULT_USER_ROLE = 'admin';
    process.env.SUPER_ADMIN_ID = 'steam-admin';
    process.env.AUTH_SESSION_SECRET = 'secret';
    process.env.LOG_LEVEL = 'warn';
    process.env.ENABLE_LOG_COLORS = 'true';
    process.env.LOG_STYLE = 'gcp';

    expect(AppConfig.rootPath).toBe('/srv/rw');
    expect(AppConfig.dataRoot).toBe('/srv/rwman');
    expect(AppConfig.enableStorage).toBe(true);
    expect(AppConfig.enableData).toBe(true);
    expect(AppConfig.enableAuth).toBe(true);
    expect(AppConfig.forceAuth).toBe(true);
    expect(AppConfig.maxPinnedServers).toBe(75);
    expect(AppConfig.serverLiveMaxServerIds).toBe(90);
    expect(AppConfig.mapTileRoot).toBe('/srv/map-tiles');
    expect(AppConfig.mapTileRootUrl).toBe('https://tiles.example.com/maps');
    expect(AppConfig.mapServerId).toBe('server-f8e7fa9ca73fd4b4943db61a');
    expect(AppConfig.masterServerListRefreshIntervalMs).toBe(120000);
    expect(AppConfig.serverQueryRefreshIntervalMs).toBe(120000);
    expect(AppConfig.serverInfoRefreshOnStartupMs).toBe(120000);
    expect(AppConfig.playerListRefreshIntervalMs).toBe(10000);
    expect(AppConfig.activePlayerListRefreshIntervalMs).toBe(15000);
    expect(AppConfig.playerListRefreshConcurrency).toBe(25);
    expect(AppConfig.playerListTimeoutMs).toBe(2000);
    expect(AppConfig.pluginDataRefreshIntervalMs).toBe(30000);
    expect(AppConfig.pluginDataCacheTtlMs).toBe(120000);
    expect(AppConfig.mapPlayerLayerCacheTtlMs).toBe(45000);
    expect(AppConfig.masterServerListTimeoutMs).toBe(12000);
    expect(AppConfig.defaultUserRole).toBe('admin');
    expect(AppConfig.superAdminId).toBe('steam-admin');
    expect(AppConfig.authSessionSecret).toBe('secret');
    expect(AppConfig.logLevel).toBe('warn');
    expect(AppConfig.enableLogColors).toBe(true);
    expect(AppConfig.logStyle).toBe('gcp');

    process.env.DEFAULT_USER_ROLE = 'invalid';
    process.env.LOG_LEVEL = 'invalid';
    process.env.LOG_STYLE = 'invalid';
    process.env.MAP_TILE_ROOT_URL = 'not a url';
    process.env.MASTER_SERVER_LIST_REFRESH_INTERVAL_MS = '59999';
    process.env.SERVER_QUERY_REFRESH_INTERVAL_MS = '59999';
    process.env.SERVER_INFO_REFRESH_ON_STARTUP_MS = '59999';
    process.env.PLAYERLIST_REFRESH_INTERVAL_MS = '4999';
    process.env.ACTIVE_PLAYERLIST_REFRESH_INTERVAL_MS = '4999';
    process.env.PLAYERLIST_REFRESH_CONCURRENCY = '0';
    process.env.PLAYERLIST_TIMEOUT_MS = '999';
    process.env.PLUGIN_DATA_REFRESH_INTERVAL_MS = '9999';
    process.env.PLUGIN_DATA_CACHE_TTL_MS = '59999';
    process.env.MAP_PLAYER_LAYER_CACHE_TTL_MS = '4999';
    process.env.MASTER_SERVER_LIST_TIMEOUT_MS = '999';

    expect(AppConfig.defaultUserRole).toBe('user');
    expect(AppConfig.logLevel).toBe('debug');
    expect(AppConfig.logStyle).toBe('default');
    expect(AppConfig.mapTileRootUrl).toBeUndefined();
    expect(AppConfig.masterServerListRefreshIntervalMs).toBe(60000);
    expect(AppConfig.serverQueryRefreshIntervalMs).toBe(600000);
    expect(AppConfig.serverInfoRefreshOnStartupMs).toBe(600000);
    expect(AppConfig.playerListRefreshIntervalMs).toBe(180000);
    expect(AppConfig.activePlayerListRefreshIntervalMs).toBe(30000);
    expect(AppConfig.playerListRefreshConcurrency).toBe(20);
    expect(AppConfig.playerListTimeoutMs).toBe(5000);
    expect(AppConfig.pluginDataRefreshIntervalMs).toBe(60000);
    expect(AppConfig.pluginDataCacheTtlMs).toBe(300000);
    expect(AppConfig.mapPlayerLayerCacheTtlMs).toBe(30000);
    expect(AppConfig.masterServerListTimeoutMs).toBe(8000);
  });
});
