import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const getMapLayerCapabilitiesMock = jest.fn(async () => ({
  schemaVersion: 1, worldName: 'World', sectorSizeChunks: 256, chunkSizeBlocks: 32,
  sectorSizeBlocks: 8192, recentPlayerDays: 7, claims: true, claimSales: true,
  renewZones: true, marketplace: true, shop: true, players: true,
  gpsGlobalMarkers: true, playerHistory: true, marketCriers: true, shopTraders: true,
}));
jest.unstable_mockModule('../src/service/map-layer-service.js', () => ({ getMapLayerCapabilities: getMapLayerCapabilitiesMock }));
const authState = { uid: undefined as string | undefined };
jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({
  getUserFromBearerToken: async () => authState.uid ? { steamId: authState.uid, steamVerifiedAt: new Date() } : null,
}));
jest.unstable_mockModule('../src/handler/server-route-context.js', () => ({
  prepareServerRoute: async () => ({ id: 'server-1' }), serverRouteError: (error: Error) => ({ status: 500, error: error.message }),
}));
jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => {
  const entry = { data: { 'ozadminutils.playerlist': {
    consentVersion: 1, players: [{ uid: 'manager-only' }, { uid: 'both' }], mapViewerUids: ['map-only', 'both'],
  } } };
  return { getCachedPluginData: () => entry, getFirstCachedPluginData: () => entry };
});
jest.unstable_mockModule('typia', () => ({ default: { assert: (value: unknown) => value } }));

const { getMapLayerCapabilitiesHandler } = await import('../src/handler/get-map-layer-capabilities-handler.js');

test('guest capabilities retain sectors but disable all data overlays', async () => {
  const json = jest.fn();
  const response = { json, setHeader: jest.fn() } as unknown as Response;
  await getMapLayerCapabilitiesHandler({ header: () => undefined } as unknown as Request, response);
  expect(json).toHaveBeenCalledWith(expect.objectContaining({
    sectorSizeBlocks: 8192, claims: false, players: false, marketplace: false,
    gpsGlobalMarkers: false, playerHistory: false,
  }));
});


test.each([
  ['manager-only', true, false],
  ['map-only', false, true],
  ['both', true, true],
])('checks each purpose separately for %s', async (uid, manager, players) => {
  authState.uid = uid;
  try {
    const json = jest.fn();
    const response = { json, setHeader: jest.fn() } as unknown as Response;
    await getMapLayerCapabilitiesHandler({ header: () => 'Bearer token' } as unknown as Request, response);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      claims: manager, gpsGlobalMarkers: manager, playerHistory: manager,
      marketCriers: manager, shopTraders: manager, players,
    }));
  } finally {
    authState.uid = undefined;
  }
});
