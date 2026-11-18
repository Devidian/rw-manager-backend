import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const getMapLayerCapabilitiesMock = jest.fn<() => Promise<unknown>>();
const getMapClaimsMock = jest.fn<(
  rootPath?: string,
  serverId?: string,
  currentUserSteamId?: string,
) => Promise<unknown[] | null>>();
const getMapPlayersMock = jest.fn<(includeLongTerm: boolean) => Promise<unknown[] | null>>();
const getMapGpsGlobalMarkersMock = jest.fn<() => Promise<unknown[] | null>>();
const getMapMarketplaceOffersMock = jest.fn<(areaId: number) => Promise<unknown[] | null>>();
const getUserFromBearerTokenMock = jest.fn<() => { role: string } | null>();

jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => {
  const entry = { data: { 'ozadminutils.playerlist': {
    consentVersion: 1, players: [{ uid: 'steam-viewer' }], mapViewerUids: ['steam-viewer'],
  } } };
  return { getCachedPluginData: () => entry, getFirstCachedPluginData: () => entry };
});
jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/service/map-layer-service.js', () => ({
  getMapLayerCapabilities: getMapLayerCapabilitiesMock,
  getMapClaims: getMapClaimsMock,
  getMapPlayers: getMapPlayersMock,
  getMapGpsGlobalMarkers: getMapGpsGlobalMarkersMock,
  getMapMarketplaceOffers: getMapMarketplaceOffersMock,
}));
jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({
  getUserFromBearerToken: getUserFromBearerTokenMock,
}));
jest.unstable_mockModule('../src/utils/app-config.js', () => ({
  AppConfig: { mapRecentPlayerDays: 7, mapPlayerLayerCacheTtlMs: 30000 },
}));

const { getMapPlayersHandler } = await import('../src/handler/get-map-players-handler.js');
const { getMapClaimsHandler } = await import('../src/handler/get-map-claims-handler.js');
const { getMapLayerCapabilitiesHandler } = await import(
  '../src/handler/get-map-layer-capabilities-handler.js'
);
const { getMapMarketplaceOffersHandler } = await import(
  '../src/handler/get-map-marketplace-offers-handler.js'
);
const { getMapGpsGlobalMarkersHandler } = await import(
  '../src/handler/get-map-gps-global-markers-handler.js'
);

describe('map layer handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMapPlayersMock.mockResolvedValue([]);
    getMapGpsGlobalMarkersMock.mockResolvedValue([]);
    getMapMarketplaceOffersMock.mockResolvedValue([]);
  });

  test('requires map consent and includes long-term markers for a consenting player', async () => {
    const response = createResponse();
    await getMapPlayersHandler({ params: {} } as Request, response.res);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(getMapPlayersMock).not.toHaveBeenCalled();

    await getMapPlayersHandler(request(), response.res);
    expect(getMapPlayersMock).toHaveBeenCalledWith(true);
  });

  test('validates marketplace area IDs before querying plugin data', async () => {
    const response = createResponse();
    await getMapMarketplaceOffersHandler(request({ areaId: '../1' }), response.res);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(getMapMarketplaceOffersMock).not.toHaveBeenCalled();

    await getMapMarketplaceOffersHandler(request({ areaId: '42' }), response.res);
    expect(getMapMarketplaceOffersMock).toHaveBeenCalledWith(42);
  });

  test('returns capability and claim responses and handles service failures', async () => {
    const response = createResponse();
    getMapLayerCapabilitiesMock.mockResolvedValue({ schemaVersion: 1, players: true });
    await getMapLayerCapabilitiesHandler(request(), response.res);
    expect(response.json).toHaveBeenLastCalledWith(expect.objectContaining({ schemaVersion: 1, players: false }));

    getMapClaimsMock.mockResolvedValue(null);
    await getMapClaimsHandler(request(), response.res);
    expect(response.json).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      available: false,
      items: [],
    });

    getMapClaimsMock.mockResolvedValue([{ areaId: 1 }]);
    await getMapClaimsHandler(request(), response.res);
    expect(response.json).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      available: true,
      items: [{ areaId: 1 }],
    });

    getMapGpsGlobalMarkersMock.mockResolvedValue([{ id: 2 }]);
    await getMapGpsGlobalMarkersHandler(request(), response.res);
    expect(response.json).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      available: true,
      items: [{ id: 2 }],
    });

    getMapLayerCapabilitiesMock.mockRejectedValue(new Error('capability failed'));
    await getMapLayerCapabilitiesHandler(request(), response.res);
    expect(response.status).toHaveBeenLastCalledWith(500);
    expect(response.json).toHaveBeenLastCalledWith({ error: 'capability failed' });

    getMapLayerCapabilitiesMock.mockRejectedValue('unknown');
    await getMapLayerCapabilitiesHandler(request(), response.res);
    expect(response.json).toHaveBeenLastCalledWith({ error: 'UNKNOWN_ERROR' });

    getMapClaimsMock.mockRejectedValue('unknown');
    await getMapClaimsHandler(request(), response.res);
    expect(response.json).toHaveBeenLastCalledWith({ error: 'UNKNOWN_ERROR' });
  });

  test('returns unavailable layer payloads and service errors', async () => {
    const response = createResponse();
    getMapPlayersMock.mockResolvedValue(null);
    await getMapPlayersHandler(request(), response.res);
    expect(response.json).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      available: false,
      recentPlayerDays: 7,
      items: [],
    });

    getMapMarketplaceOffersMock.mockResolvedValue(null);
    await getMapMarketplaceOffersHandler(request({ areaId: '7' }), response.res);
    expect(response.json).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      available: false,
      areaId: 7,
      items: [],
    });

    getMapGpsGlobalMarkersMock.mockResolvedValue(null);
    await getMapGpsGlobalMarkersHandler(request(), response.res);
    expect(response.json).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      available: false,
      items: [],
    });

    getMapPlayersMock.mockRejectedValue(new Error('players failed'));
    await getMapPlayersHandler(request(), response.res);
    expect(response.status).toHaveBeenLastCalledWith(500);
    expect(response.json).toHaveBeenLastCalledWith({ error: 'players failed' });

    getMapMarketplaceOffersMock.mockRejectedValue('unknown');
    await getMapMarketplaceOffersHandler(request({ areaId: '8' }), response.res);
    expect(response.json).toHaveBeenLastCalledWith({ error: 'UNKNOWN_ERROR' });

    getMapGpsGlobalMarkersMock.mockRejectedValue('unknown');
    await getMapGpsGlobalMarkersHandler(request(), response.res);
    expect(response.json).toHaveBeenLastCalledWith({ error: 'UNKNOWN_ERROR' });
  });
});

function request(params: Record<string, string> = {}) {
  return {
    params,
    user: { role: 'user', steamId: 'steam-viewer', steamVerifiedAt: new Date() },
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
