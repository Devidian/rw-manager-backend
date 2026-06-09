import { jest } from '@jest/globals';
import {
  canAdminServer,
  fetchBackendAdmins,
} from '../src/service/can-admin-server-service.js';

describe('can-admin-server-service', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, snapshot);
  }

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  test('fetchBackendAdmins returns admins from a valid backend response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ admins: ['steam-1', 'steam-2'] }),
    }) as typeof fetch;

    await expect(fetchBackendAdmins('https://backend.example.com')).resolves.toEqual([
      'steam-1',
      'steam-2',
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://backend.example.com/api/data/server/admins',
    );
  });

  test('fetchBackendAdmins returns null for bad status, invalid payloads, and thrown fetches', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ admins: ['steam-1', 2] }),
    }).mockRejectedValueOnce(new Error('network')) as typeof fetch;

    await expect(fetchBackendAdmins('https://backend.example.com')).resolves.toBeNull();
    await expect(fetchBackendAdmins('https://backend.example.com')).resolves.toBeNull();
    await expect(fetchBackendAdmins('https://backend.example.com')).resolves.toBeNull();
  });

  test('canAdminServer rejects missing auth context and accepts valid admins', async () => {
    process.env.ENABLE_AUTH = 'false';
    await expect(
      canAdminServer('https://backend.example.com', 'steam-1'),
    ).resolves.toBe(false);

    process.env.ENABLE_AUTH = 'true';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ admins: ['steam-1'] }),
    }) as typeof fetch;

    await expect(
      canAdminServer('https://backend.example.com', 'steam-1'),
    ).resolves.toBe(true);
    await expect(
      canAdminServer('https://backend.example.com', 'steam-2'),
    ).resolves.toBe(false);
    await expect(canAdminServer(undefined, 'steam-1')).resolves.toBe(false);
    await expect(
      canAdminServer('https://backend.example.com', undefined),
    ).resolves.toBe(false);
  });
});
