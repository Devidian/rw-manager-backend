import { AppConfig } from '../src/utils/app-config.js';

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
    expect(AppConfig.enableStorage).toBe(false);
    expect(AppConfig.enableData).toBe(false);
    expect(AppConfig.enableAuth).toBe(false);
    expect(AppConfig.forceAuth).toBe(false);
    expect(AppConfig.defaultUserRole).toBe('user');
    expect(AppConfig.superAdminId).toBe('');
    expect(AppConfig.authSessionSecret).toBe('rw-manager-storage-session');
    expect(AppConfig.logLevel).toBe('debug');
    expect(AppConfig.enableLogColors).toBe(false);
    expect(AppConfig.logStyle).toBe('default');
  });

  test('reads valid environment overrides and ignores invalid enum values', () => {
    process.env.SERVER_ROOT = '/srv/rw';
    process.env.ENABLE_STORAGE = 'true';
    process.env.ENABLE_DATA = 'true';
    process.env.ENABLE_AUTH = 'true';
    process.env.FORCE_AUTH = 'true';
    process.env.DEFAULT_USER_ROLE = 'admin';
    process.env.SUPER_ADMIN_ID = 'steam-admin';
    process.env.AUTH_SESSION_SECRET = 'secret';
    process.env.LOG_LEVEL = 'warn';
    process.env.ENABLE_LOG_COLORS = 'true';
    process.env.LOG_STYLE = 'gcp';

    expect(AppConfig.rootPath).toBe('/srv/rw');
    expect(AppConfig.enableStorage).toBe(true);
    expect(AppConfig.enableData).toBe(true);
    expect(AppConfig.enableAuth).toBe(true);
    expect(AppConfig.forceAuth).toBe(true);
    expect(AppConfig.defaultUserRole).toBe('admin');
    expect(AppConfig.superAdminId).toBe('steam-admin');
    expect(AppConfig.authSessionSecret).toBe('secret');
    expect(AppConfig.logLevel).toBe('warn');
    expect(AppConfig.enableLogColors).toBe(true);
    expect(AppConfig.logStyle).toBe('gcp');

    process.env.DEFAULT_USER_ROLE = 'invalid';
    process.env.LOG_LEVEL = 'invalid';
    process.env.LOG_STYLE = 'invalid';

    expect(AppConfig.defaultUserRole).toBe('user');
    expect(AppConfig.logLevel).toBe('debug');
    expect(AppConfig.logStyle).toBe('default');
  });
});
