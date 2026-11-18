import { jest } from '@jest/globals';

const servers = [{ id: 'stored', queryUrl: 'https://stored.example',
  knownPlayers: [{ uid: '76561198000000001' }], info: { contact: '76561198000000002' } }];
const masterServers: Array<{ id: string; queryUrl: string; info: { contact: string }; masterOnly: true }> = [];
const listServersMock = jest.fn(async () => servers);
const listUsersMock = jest.fn(async () => [{ id: 'account-1', steamId: '76561198000000003', managerServerIds: ['stored'] }]);
const findUserBySteamIdMock = jest.fn(async (_steamId: string): Promise<{ id: string } | undefined> => ({ id: 'account-1' }));
const deleteUserOnlyMock = jest.fn(async () => true);
const getCachedPluginDataMock = jest.fn((_id: string): { data: Record<string, unknown> } | undefined => undefined);
const fetchMock = jest.fn<typeof fetch>();

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  listServers: listServersMock, listUsers: listUsersMock, deleteUserOnly: deleteUserOnlyMock,
  findUserBySteamId: findUserBySteamIdMock,
}));
jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => ({ getCachedPluginData: getCachedPluginDataMock }));
jest.unstable_mockModule('../src/service/master-only-cache-service.js', () => ({ cachedMasterServers: () => masterServers }));

const { managerAccess, reconcileManagerAccounts, revokeManagerAccountIfDenied }
  = await import('../src/service/manager-access-service.js');

describe('manager access', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = fetchMock;
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ contact: '76561198000000002' }) } as Response);
    getCachedPluginDataMock.mockReset();
    deleteUserOnlyMock.mockClear();
    findUserBySteamIdMock.mockClear();
    masterServers.length = 0;
  });
  afterAll(() => { globalThis.fetch = originalFetch; });

  test('accepts only a valid cached plugin export player', async () => {
    getCachedPluginDataMock.mockReturnValue({ data: { 'ozadminutils.playerlist': {
      players: [{ uid: '76561198000000001' }],
    } } });
    await expect(managerAccess('76561198000000001')).resolves.toEqual({
      serverIds: ['stored'], confirmedDenied: false, preserveExisting: false,
    });
  });

  test('verifies contact live and denies a confirmed nonmember', async () => {
    getCachedPluginDataMock.mockReturnValue({ data: { 'ozadminutils.playerlist': { players: [] } } });
    await expect(managerAccess('76561198000000002')).resolves.toEqual({ serverIds: ['stored'], confirmedDenied: false, preserveExisting: false });
    await expect(managerAccess('76561198000000003')).resolves.toEqual({ serverIds: [], confirmedDenied: true, preserveExisting: false });
  });

  test('checks all stored contacts live for a new Steam login', async () => {
    getCachedPluginDataMock.mockReturnValue({ data: { 'ozadminutils.playerlist': { players: [] } } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ contact: '76561198000000003' }) } as Response);
    await expect(managerAccess('76561198000000003', [], true)).resolves.toEqual({
      serverIds: ['stored'], confirmedDenied: false, preserveExisting: false,
    });
  });

  test('accepts a live verified contact from the ephemeral master cache', async () => {
    masterServers.push({ id: 'master-only', queryUrl: 'https://master.example', masterOnly: true,
      info: { contact: '76561198000000004' } });
    fetchMock.mockImplementation(async (input) => ({ ok: true,
      json: async () => ({ contact: String(input).includes('master.example')
        ? '76561198000000004' : '76561198000000002' }),
    } as Response));
    await expect(managerAccess('76561198000000004')).resolves.toEqual({
      serverIds: ['master-only'], confirmedDenied: false, preserveExisting: false,
    });
  });

  test('preserves confirmed members during source outage', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(managerAccess('76561198000000001', ['stored'])).resolves.toEqual({ serverIds: [], confirmedDenied: false, preserveExisting: true });
    await expect(managerAccess('76561198000000002', ['stored'])).resolves.toEqual({ serverIds: [], confirmedDenied: false, preserveExisting: true });
  });

  test('removes a confirmed ineligible account during reconciliation', async () => {
    getCachedPluginDataMock.mockReturnValue({ data: { 'ozadminutils.playerlist': { players: [] } } });
    await expect(reconcileManagerAccounts()).resolves.toBe(1);
    expect(deleteUserOnlyMock).toHaveBeenCalledWith('account-1');
  });

  test('preserves account eligibility until an unavailable matching contact can be verified', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await expect(managerAccess('76561198000000002')).resolves.toEqual({
      serverIds: [], confirmedDenied: false, preserveExisting: true,
    });
  });

  test('checks uppercase exported UIDs but never matches malformed rows or numeric contact values', async () => {
    getCachedPluginDataMock.mockReturnValue({ data: { 'ozadminutils.playerlist': {
      players: [null, false, '76561198000000003', { UID: '76561198000000001' }],
    } } });
    fetchMock.mockResolvedValue(Response.json({ contact: 17 }));
    await expect(managerAccess('76561198000000001')).resolves.toMatchObject({ serverIds: ['stored'] });
    await expect(managerAccess('76561198000000002')).resolves.toMatchObject({ confirmedDenied: true });
  });

  test('deletes only an existing, confirmed ineligible account', async () => {
    getCachedPluginDataMock.mockReturnValue({ data: { 'ozadminutils.playerlist': { players: [] } } });
    await expect(revokeManagerAccountIfDenied('76561198000000002')).resolves.toBe(false);
    expect(findUserBySteamIdMock).not.toHaveBeenCalled();
    findUserBySteamIdMock.mockResolvedValueOnce(undefined);
    await expect(revokeManagerAccountIfDenied('76561198000000003')).resolves.toBe(false);
    expect(deleteUserOnlyMock).not.toHaveBeenCalled();
    await expect(revokeManagerAccountIfDenied('76561198000000003')).resolves.toBe(true);
    expect(deleteUserOnlyMock).toHaveBeenCalledWith('account-1');
  });
});
