import {
  mapLayerFingerprints,
  parseSubscribeMessage,
} from '../src/service/map-live-service.js';
import type { PluginDataCacheEntry } from '../src/service/plugin-data-cache-service.js';

describe('map live WebSocket contract', () => {
  test('accepts one server-scoped subscribe message without requiring a token', () => {
    expect(parseSubscribeMessage(Buffer.from(JSON.stringify({
      type: 'subscribe',
      schemaVersion: 1,
      serverId: 'server-a',
    })))).toEqual({
      type: 'subscribe',
      schemaVersion: 1,
      serverId: 'server-a',
    });
  });

  test('rejects invalid or unbounded subscriptions', () => {
    expect(() => parseSubscribeMessage(Buffer.from('{}'))).toThrow('invalid_message');
    expect(() => parseSubscribeMessage(Buffer.from(JSON.stringify({
      type: 'subscribe',
      schemaVersion: 1,
      serverId: 'x'.repeat(201),
    })))).toThrow('invalid_message');
  });

  test('ignores volatile timestamps and separates logical layer changes', () => {
    const first = entry({
      'ozadminutils.worldAreas': { generatedAt: '2026-01-01', areas: [{ id: 1 }] },
      'ozadminutils.playerlist': { generatedAt: '2026-01-01', players: [{ uid: 'one', posx: 1 }] },
      'ozmarketplace.offers.1': { generatedAt: '2026-01-01', offers: [{ id: 1 }] },
    });
    const timestampsOnly = entry({
      'ozadminutils.worldAreas': { generatedAt: '2026-01-02', areas: [{ id: 1 }] },
      'ozadminutils.playerlist': { generatedAt: '2026-01-02', players: [{ uid: 'one', posx: 1 }] },
      'ozmarketplace.offers.1': { generatedAt: '2026-01-02', offers: [{ id: 1 }] },
    });
    expect(mapLayerFingerprints(timestampsOnly)).toEqual(mapLayerFingerprints(first));

    const moved = entry({
      ...timestampsOnly.data,
      'ozadminutils.playerlist': { generatedAt: '2026-01-03', players: [{ uid: 'one', posx: 2 }] },
    });
    const before = mapLayerFingerprints(first);
    const after = mapLayerFingerprints(moved);
    expect(after.players).not.toBe(before.players);
    expect(after.claims).toBe(before.claims);
    expect(after.marketplaceOffers).toBe(before.marketplaceOffers);
  });
});

function entry(data: Record<string, unknown>): PluginDataCacheEntry {
  return {
    serverId: 'server-a',
    refreshedAtMs: 1,
    expiresAtMs: 2,
    plugins: [{ name: 'ozadminutils', valid: true }],
    data,
  };
}
