import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const getServerLiveStatusMock = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/service/server-live-status-service.js', () => ({
  getServerLiveStatus: getServerLiveStatusMock,
}));

const { getServerLiveStatusHandler } = await import(
  '../src/handler/get-server-live-status-handler.js'
);

describe('get-server-live-status-handler', () => {
  beforeEach(() => {
    getServerLiveStatusMock.mockReset().mockResolvedValue({
      status: 'online',
      lastChecked: '2026-06-24T12:00:00.000Z',
    });
  });

  test('returns proxied live status payload', async () => {
    const response = createResponse();
    await getServerLiveStatusHandler(request('server-1'), response.res);

    expect(getServerLiveStatusMock).toHaveBeenCalledWith('server-1');
    expect(response.json).toHaveBeenCalledWith({
      status: 'online',
      lastChecked: '2026-06-24T12:00:00.000Z',
    });

    await getServerLiveStatusHandler(
      { params: { id: ['server-array'] } } as unknown as Request,
      createResponse().res,
    );
    expect(getServerLiveStatusMock).toHaveBeenLastCalledWith('server-array');
  });

  test('maps known service errors to HTTP responses', async () => {
    getServerLiveStatusMock.mockRejectedValueOnce(new Error('SERVER_NOT_FOUND'));
    const missingResponse = createResponse();
    await getServerLiveStatusHandler(request('missing'), missingResponse.res);
    expect(missingResponse.status).toHaveBeenCalledWith(404);

    getServerLiveStatusMock.mockRejectedValueOnce(new Error('QUERY_URL_MISSING'));
    const invalidResponse = createResponse();
    await getServerLiveStatusHandler(request('server-2'), invalidResponse.res);
    expect(invalidResponse.status).toHaveBeenCalledWith(400);
    expect(invalidResponse.json).toHaveBeenCalledWith({ error: 'queryUrl missing' });

    getServerLiveStatusMock.mockRejectedValueOnce('unknown');
    const unknownResponse = createResponse();
    await getServerLiveStatusHandler(request('server-3'), unknownResponse.res);
    expect(unknownResponse.status).toHaveBeenCalledWith(400);
    expect(unknownResponse.json).toHaveBeenCalledWith({ error: 'UNKNOWN_ERROR' });
  });
});

function request(id: string) {
  return { params: { id } } as unknown as Request;
}

function createResponse() {
  const response = {
    json: jest.fn(),
    status: jest.fn(),
  };
  for (const method of Object.values(response)) method.mockReturnValue(response);
  return { ...response, res: response as unknown as Response };
}
