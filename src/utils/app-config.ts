import { env } from 'node:process';

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
