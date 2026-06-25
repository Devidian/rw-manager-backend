import { env } from 'node:process';
import { resolve } from 'node:path';

export class AppConfig {
  private static readonly validRoles = ['guest', 'user', 'admin'] as const;
  private static readonly validLogLevels = [
    'debug',
    'info',
    'warn',
    'error',
    'critical',
    'off',
    'verbose',
    'all',
  ] as const;
  private static readonly validLogStyles = ['default', 'detailed', 'gcp'] as const;

  static get rootPath(): string {
    return env.SERVER_ROOT ?? '/appdata/rising-world/dedicated-server';
  }
  static get dataRoot(): string {
    return env.APP_DATA_ROOT ?? resolve('data');
  }
  static get enableStorage(): boolean {
    return (env.ENABLE_STORAGE ?? 'false') === 'true';
  }
  static get enableData(): boolean {
    return (env.ENABLE_DATA ?? 'false') === 'true';
  }
  static get enableAuth(): boolean {
    return (env.ENABLE_AUTH ?? 'false') === 'true';
  }
  static get forceAuth(): boolean {
    return (env.FORCE_AUTH ?? 'false') === 'true';
  }
  static get enableMapRenderer(): boolean {
    return (env.ENABLE_MAP_RENDERER ?? 'false') === 'true';
  }
  static get mapTileRoot(): string | undefined {
    return env.MAP_TILE_ROOT;
  }
  static get mapRenderIntervalMs(): number {
    return AppConfig.boundedInteger(env.MAP_RENDER_INTERVAL_MS, 30000, 1000, Number.MAX_SAFE_INTEGER);
  }
  static get mapRenderBatchSize(): number {
    return AppConfig.boundedInteger(env.MAP_RENDER_BATCH_SIZE, 256, 1, 4096);
  }
  static get mapRecentPlayerDays(): number {
    return AppConfig.boundedInteger(env.MAP_RECENT_PLAYER_DAYS, 7, 1, 3650);
  }
  static get masterServerListUrl(): string {
    return env.MASTER_SERVER_LIST_URL ?? 'https://api.rising-world.net/v5/serverlist';
  }
  static get masterServerListRefreshIntervalMs(): number {
    return AppConfig.boundedInteger(
      env.MASTER_SERVER_LIST_REFRESH_INTERVAL_MS,
      300000,
      60000,
      Number.MAX_SAFE_INTEGER,
    );
  }
  static get serverQueryRefreshIntervalMs(): number {
    return AppConfig.boundedInteger(
      env.SERVER_QUERY_REFRESH_INTERVAL_MS,
      86400000,
      60000,
      Number.MAX_SAFE_INTEGER,
    );
  }
  static get liveQueryProxyCacheTtlMs(): number {
    return AppConfig.boundedInteger(
      env.LIVE_QUERY_PROXY_CACHE_TTL_MS,
      5000,
      1000,
      60000,
    );
  }
  static get liveQueryProxyTimeoutMs(): number {
    return AppConfig.boundedInteger(
      env.LIVE_QUERY_PROXY_TIMEOUT_MS,
      8000,
      1000,
      30000,
    );
  }
  static get mongoUri(): string | undefined {
    return env.MONGODB_URI?.trim() || env.MONGO_URI?.trim() || undefined;
  }
  static get mongoDatabaseName(): string {
    return env.MONGODB_DATABASE?.trim() || 'rw-manager';
  }
  static get mongoConnectTimeoutMs(): number {
    return AppConfig.boundedInteger(
      env.MONGODB_CONNECT_TIMEOUT_MS,
      5000,
      1000,
      30000,
    );
  }
  static get defaultUserRole(): 'guest' | 'user' | 'admin' {
    const value = env.DEFAULT_USER_ROLE;
    return AppConfig.validRoles.find((item) => item === value) ?? 'user';
  }
  static get superAdminId(): string {
    return env.SUPER_ADMIN_ID ?? '';
  }
  static get authSessionSecret(): string {
    return env.AUTH_SESSION_SECRET ?? 'rw-manager-storage-session';
  }
  static get logLevel():
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'
    | 'critical'
    | 'off'
    | 'verbose'
    | 'all' {
    const value = env.LOG_LEVEL;
    return AppConfig.validLogLevels.find((item) => item === value) ?? 'debug';
  }
  static get enableLogColors(): boolean {
    return (env.ENABLE_LOG_COLORS ?? 'false') === 'true';
  }
  static get logStyle(): 'default' | 'detailed' | 'gcp' {
    const value = env.LOG_STYLE;
    return AppConfig.validLogStyles.find((item) => item === value) ?? 'default';
  }

  private static boundedInteger(
    value: string | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
      ? parsed
      : fallback;
  }
}
