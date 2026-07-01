import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const prepareServerRouteMock = jest.fn<() => Promise<{ id: string } | null>>();
const serverRouteErrorMock = jest.fn<(error: unknown) => { status: number; error: string }>();
const getUserFromBearerTokenMock = jest.fn<() => { role: string } | null>();
const getMapClaimsMock = jest.fn<(
  rootPath?: string,
  serverId?: string,
  currentUserSteamId?: string,
) => Promise<unknown[] | null>>();
const getMapPlayersMock = jest.fn<(
  includeLongTerm: boolean,
  rootPath?: string,
  now?: Date,
  serverId?: string,
) => Promise<unknown[] | null>>();
const getMapGpsGlobalMarkersMock = jest.fn<(
  rootPath?: string,
  serverId?: string,
) => Promise<unknown[] | null>>();
const getMapMarketplaceOffersMock = jest.fn<(
  areaId: number,
  rootPath?: string,
  serverId?: string,
) => Promise<unknown[] | null>>();

jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/handler/server-route-context.js', () => ({
  prepareServerRoute: prepareServerRouteMock,
  serverRouteError: serverRouteErrorMock,
}));
jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({
  getUserFromBearerToken: getUserFromBearerTokenMock,
}));
jest.unstable_mockModule('../src/service/map-layer-service.js', () => ({
  getMapClaims: getMapClaimsMock,
  getMapPlayers: getMapPlayersMock,
  getMapGpsGlobalMarkers: getMapGpsGlobalMarkersMock,
  getMapMarketplaceOffers: getMapMarketplaceOffersMock,
}));
jest.unstable_mockModule('../src/utils/app-config.js', () => ({
  AppConfig: { mapRecentPlayerDays: 7 },
}));

const { getMapClaimsHandler } = await import('../src/handler/get-map-claims-handler.js');
const { getMapPlayersHandler } = await import('../src/handler/get-map-players-handler.js');
const { getMapGpsGlobalMarkersHandler } = await import(
  '../src/handler/get-map-gps-global-markers-handler.js'
);
const { getMapMarketplaceOffersHandler } = await import(
  '../src/handler/get-map-marketplace-offers-handler.js'
);

describe('map layer handlers with server id routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prepareServerRouteMock.mockResolvedValue({ id: 'server-1' });
    serverRouteErrorMock.mockImplementation((error) => (
      error && typeof error === 'object' && 'status' in error && 'error' in error
        ? error as { status: number; error: string }
        : { status: 500, error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }
    ));
    getUserFromBearerTokenMock.mockReturnValue({ role: 'admin' });
    getMapClaimsMock.mockResolvedValue([{ areaId: 1 }]);
    getMapPlayersMock.mockResolvedValue([{ uid: 'player-1' }]);
    getMapGpsGlobalMarkersMock.mockResolvedValue([{ id: 2 }]);
    getMapMarketplaceOffersMock.mockResolvedValue([{ id: 3 }]);
  });

  test('passes route server ids into map layer service calls', async () => {
    const claimsResponse = createResponse();
    await getMapClaimsHandler(request(), claimsResponse.res);
    expect(getMapClaimsMock).toHaveBeenCalledWith(undefined, 'server-1', undefined);
    expect(claimsResponse.json).toHaveBeenCalledWith({
      schemaVersion: 1,
      available: true,
      items: [{ areaId: 1 }],
    });

    const playersResponse = createResponse();
    await getMapPlayersHandler(request(), playersResponse.res);
    expect(getMapPlayersMock).toHaveBeenCalledWith(true, undefined, expect.any(Date), 'server-1');

    const gpsResponse = createResponse();
    await getMapGpsGlobalMarkersHandler(request(), gpsResponse.res);
    expect(getMapGpsGlobalMarkersMock).toHaveBeenCalledWith(undefined, 'server-1');

    const offersResponse = createResponse();
    await getMapMarketplaceOffersHandler(request({ areaId: '42' }), offersResponse.res);
    expect(getMapMarketplaceOffersMock).toHaveBeenCalledWith(42, undefined, 'server-1');
  });

  test('maps route errors for server-specific layer requests', async () => {
    prepareServerRouteMock.mockRejectedValueOnce({ status: 404, error: 'Server not found' });

    const response = createResponse();
    await getMapGpsGlobalMarkersHandler(request(), response.res);

    expect(getMapGpsGlobalMarkersMock).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ error: 'Server not found' });
  });
});

function request(params: Record<string, string> = {}) {
  return {
    params,
    header: jest.fn().mockReturnValue('Bearer token'),
  } as unknown as Request;
}

function createResponse() {
  const response = {
    setHeader: jest.fn(),
    json: jest.fn(),
    status: jest.fn(),
  };
  for (const method of Object.values(response)) method.mockReturnValue(response);
  return { ...response, res: response as unknown as Response };
}
