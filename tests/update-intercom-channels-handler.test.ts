import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const user = { id: 'user-1', username: 'alice', email: 'alice@example.com', pinnedServers: [], intercomChannels: ['global', 'web'] };
const updateUserMock = jest.fn<(_id: string, _patch: { intercomChannels: string[] }) => Promise<typeof user>>();

jest.unstable_mockModule('typia', () => ({ default: { assert: (value: unknown) => value } }));
jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  updateUser: updateUserMock,
  toPrivateUser: (value: typeof user) => value,
}));
jest.unstable_mockModule('../src/mapper/user-mapper.js', () => ({ mapPrivateUserToDto: (value: typeof user) => value }));

const { updateIntercomChannelsHandler } = await import('../src/handler/update-intercom-channels-handler.js');

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
}

function request(channels: unknown): Request {
  return { user: { id: 'user-1' }, body: { channels } } as unknown as Request;
}

describe('update intercom channels', () => {
  beforeEach(() => {
    updateUserMock.mockReset().mockImplementation(async (_id, patch) => ({ ...user, ...patch }));
  });

  test('normalizes and saves channels with the legacy defaults', async () => {
    const res = response();
    await updateIntercomChannelsHandler(request(['#Trade', ' TRADE ', 'market']), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(updateUserMock).not.toHaveBeenCalled();

    const valid = response();
    await updateIntercomChannelsHandler(request([' Trade ', 'trade', 'market']), valid);
    expect(updateUserMock).toHaveBeenCalledWith('user-1', { intercomChannels: ['global', 'web', 'trade', 'market'] });
    expect(valid.json).toHaveBeenCalledWith({ user: expect.objectContaining({ intercomChannels: ['global', 'web', 'trade', 'market'] }) });
  });

  test('rejects invalid or oversized channel names', async () => {
    for (const channels of [['bad channel'], ['x'.repeat(65)], Array(21).fill('trade')]) {
      const res = response();
      await updateIntercomChannelsHandler(request(channels), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
