import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const listServers = jest.fn();
const managerAccess = jest.fn();
const getCachedPluginData = jest.fn();
const getCachedOZPluginLatestVersions = jest.fn();
const getUserFromBearerToken = jest.fn();
jest.unstable_mockModule('typia', () => ({ default: { assert: (value: unknown) => value } }));
jest.unstable_mockModule('../src/service/storage-service.js', () => ({ listServers }));
jest.unstable_mockModule('../src/service/manager-access-service.js', () => ({ managerAccess }));
jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => ({ getCachedPluginData }));
jest.unstable_mockModule('../src/service/oz-plugin-release-service.js', () => ({ getCachedOZPluginLatestVersions }));
jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({ getUserFromBearerToken }));

const { listServersHandler } = await import('../src/handler/list-servers-handler.js');
const steamId = '76561198000000001';
const user = { id: 'test-user', steamId, steamVerifiedAt: new Date() };
const catalog = [
  { id: 'stored', info: { contact: steamId }, onlinePlayers: [{ name: 'exported' }] },
  { id: 'discovered', masterOnly: true, info: { contact: steamId }, masterOnlyPlayerNames: ['public label'] },
];

beforeEach(() => {
  jest.resetAllMocks();
  listServers.mockResolvedValue(catalog);
  managerAccess.mockResolvedValue({ serverIds: ['stored'] });
  getCachedOZPluginLatestVersions.mockReturnValue({});
});

async function read(query: Record<string, string> = {}, requestUser?: typeof user) {
  const json = jest.fn();
  const req = { query, user: requestUser, header: () => undefined } as unknown as Request;
  await listServersHandler(req, { json } as unknown as Response);
  return json.mock.calls[0][0];
}

test('discovery polling preserves server approval without recalculating dashboard access', async () => {
  getUserFromBearerToken.mockResolvedValue(user);
  expect(await read({ masterOnly: 'true' })).toEqual({ servers: [
    expect.objectContaining({
      id: 'discovered', dashboardVisible: false, canApprove: true, canDelete: false,
      masterOnlyPlayerNames: ['public label'],
    }),
  ] });
  expect(managerAccess).not.toHaveBeenCalled();
});

test('full catalog keeps stored server access and installed plugin metadata', async () => {
  getCachedPluginData.mockImplementation((id) => id === 'stored' ? {
    plugins: [{ valid: false }, { valid: true, name: ' OZ - Tools ', version: '1.2.3' }],
  } : undefined);
  getCachedOZPluginLatestVersions.mockReturnValue({ 'OZ - Tools': '1.2.4' });
  expect(await read({}, user)).toEqual({ servers: [
    expect.objectContaining({
      id: 'stored', dashboardVisible: true, canApprove: false, canDelete: true,
      onlinePlayers: [{ name: 'exported' }], ozToolsInstalled: true,
      ozToolsVersion: '1.2.3', latestOZToolsVersion: '1.2.4',
    }),
    expect.objectContaining({ id: 'discovered', dashboardVisible: false, canApprove: true }),
  ] });
  expect(managerAccess).toHaveBeenCalledWith(steamId);
});

test('guest catalog omits exported players and keeps transient labels', async () => {
  expect(await read()).toEqual({ servers: [
    expect.objectContaining({ id: 'stored', onlinePlayers: undefined, canDelete: false }),
    expect.objectContaining({ id: 'discovered', masterOnlyPlayerNames: ['public label'], canApprove: false }),
  ] });
});
