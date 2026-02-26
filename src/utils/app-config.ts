import { env } from 'node:process';

export class AppConfig {
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
  static get defaultUserRole(): 'guest' | 'user' | 'admin' {
    return (env.DEFAULT_USER_ROLE as any) ?? 'user';
  }
  static get superAdminId(): string {
    return (env.SUPER_ADMIN_ID as any) ?? '';
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
    return (env.LOG_LEVEL as any) ?? 'debug';
  }
  static get enableLogColors(): boolean {
    return (env.ENABLE_LOG_COLORS ?? 'false') === 'true';
  }
  static get logStyle(): 'default' | 'detailed' | 'gcp' {
    return (env.LOG_STYLE as any) ?? 'default';
  }
}
