import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const generateApiTokenMock = jest.fn<() => Promise<string>>();

jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/service/auth-service.js', () => ({
  generateApiToken: generateApiTokenMock,
}));

const { generateApiTokenHandler } = await import('../src/handler/generate-api-token-handler.js');

describe('generate-api-token-handler', () => {
  beforeEach(() => {
    generateApiTokenMock.mockReset().mockResolvedValue('plain-token');
  });

  test('returns a generated api token only for authenticated users', async () => {
    const missingResponse = createResponse();
    await generateApiTokenHandler(request(), missingResponse.res);
    expect(missingResponse.status).toHaveBeenCalledWith(401);
    expect(generateApiTokenMock).not.toHaveBeenCalled();

    const response = createResponse();
    await generateApiTokenHandler(request({ id: 'user-1' }), response.res);
    expect(generateApiTokenMock).toHaveBeenCalledWith('user-1');
    expect(response.json).toHaveBeenCalledWith({ apiToken: 'plain-token' });
  });

  test('maps service failures to safe HTTP responses', async () => {
    generateApiTokenMock.mockRejectedValueOnce(new Error('USER_NOT_FOUND'));
    const notFoundResponse = createResponse();
    await generateApiTokenHandler(request({ id: 'missing' }), notFoundResponse.res);
    expect(notFoundResponse.status).toHaveBeenCalledWith(404);
    expect(notFoundResponse.json).toHaveBeenCalledWith({ error: 'user not found' });

    generateApiTokenMock.mockRejectedValueOnce('unknown');
    const unknownResponse = createResponse();
    await generateApiTokenHandler(request({ id: 'user-1' }), unknownResponse.res);
    expect(unknownResponse.status).toHaveBeenCalledWith(400);
    expect(unknownResponse.json).toHaveBeenCalledWith({ error: 'UNKNOWN_ERROR' });
  });
});

function request(user?: { id: string }) {
  return { user } as unknown as Request;
}

function createResponse() {
  const response = {
    json: jest.fn(),
    status: jest.fn(),
  };
  for (const method of Object.values(response)) method.mockReturnValue(response);
  return { ...response, res: response as unknown as Response };
}
