import { jest } from '@jest/globals';
import type { ServerConfig } from '../src/interfaces/server-config.js';

const candidate: ServerConfig = {
  id: 'server-candidate', label: 'Old name', ip: '203.0.113.1', port: 4255,
  queryUrl: 'http://203.0.113.1:4254', public: true, createdAt: new Date(),
  info: { contact: '777' },
};
const lookup = jest.fn<(id: string) => ServerConfig | undefined>();
const findStored = jest.fn<(id: string) => Promise<ServerConfig | undefined>>();
const insert = jest.fn<(server: ServerConfig, ip: string, port: number) => Promise<boolean>>();
const remove = jest.fn();
const suppressed = jest.fn<() => Promise<boolean>>();

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  findServerById: findStored, insertMasterServerIfAbsent: insert,
}));
jest.unstable_mockModule('../src/service/master-only-cache-service.js', () => ({
  cachedMasterById: lookup, removeCachedMasterEndpoint: remove,
}));
jest.unstable_mockModule('../src/service/server-suppression-service.js', () => ({
  isServerSuppressed: suppressed,
}));
const { approveMasterServer } = await import('../src/service/master-server-approval-service.js');

describe('approving entries from the master list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lookup.mockReturnValue(candidate);
    findStored.mockResolvedValue(undefined);
    insert.mockResolvedValue(true);
    suppressed.mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  test('verifies current contact and inserts the cached server under its existing ID', async () => {
    const fetchInfo = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ contact: '777', name: 'Current Name' }));
    await expect(approveMasterServer(candidate.id, '777')).resolves.toMatchObject({
      id: candidate.id, label: 'Current Name', dashboardVisible: true,
    });
    expect(fetchInfo).toHaveBeenCalledWith(new URL('http://203.0.113.1:4254/info'), expect.objectContaining({ redirect: 'error' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: candidate.id, label: 'Current Name' }), candidate.ip, candidate.port);
    expect(remove).toHaveBeenCalledWith(candidate.ip, candidate.port);
  });

  test('distinguishes a changed contact from an unavailable server', async () => {
    const fetchInfo = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ contact: '888' }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(approveMasterServer(candidate.id, '777')).rejects.toMatchObject({ status: 403, code: 'SERVER_CONTACT_MISMATCH' });
    await expect(approveMasterServer(candidate.id, '777')).rejects.toMatchObject({ status: 502, code: 'SERVER_INFO_UNAVAILABLE' });
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    expect(insert).not.toHaveBeenCalled();
  });

  test('distinguishes a stale master list entry from an already approved server', async () => {
    lookup.mockReturnValue(undefined);
    await expect(approveMasterServer(candidate.id, '777')).rejects.toMatchObject({ status: 404, code: 'MASTER_SERVER_NO_LONGER_LISTED' });
    findStored.mockResolvedValue(candidate);
    await expect(approveMasterServer(candidate.id, '777')).rejects.toMatchObject({ status: 409, code: 'SERVER_ALREADY_APPROVED' });
    expect(insert).not.toHaveBeenCalled();
  });

  test('does not write a suppressed server or replace an existing record after a concurrent insert', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ contact: '777' }));
    suppressed.mockResolvedValueOnce(true);
    insert.mockResolvedValueOnce(false);
    await expect(approveMasterServer(candidate.id, '777')).rejects.toMatchObject({ status: 409, code: 'SERVER_SUPPRESSED' });
    expect(insert).not.toHaveBeenCalled();
    await expect(approveMasterServer(candidate.id, '777')).rejects.toMatchObject({ status: 409, code: 'SERVER_ALREADY_APPROVED' });
    expect(remove).not.toHaveBeenCalled();
  });
});
