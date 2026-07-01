import { getBackendInfo } from '../src/service/backend-info-service.js';

describe('backend info service', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  test('exposes enabled services for root and /api discovery', () => {
    process.env.ENABLE_STORAGE = 'true';
    process.env.ENABLE_DATA = 'true';
    process.env.ENABLE_AUTH = 'true';

    expect(getBackendInfo()).toEqual({
      ok: true,
      services: ['storage', 'data', 'auth'],
      version: 1,
    });
  });
});

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}
