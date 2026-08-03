import {
  mapLiveChanges,
  parseSubscribeMessage,
  runMapLiveHeartbeat,
} from '../src/service/map-live-service.js';
import type { MapLiveSnapshot } from '../src/interfaces/map-layer.js';
import { WebSocket } from 'ws';

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

  test('emits only changed and removed entities instead of whole layers', () => {
    const first = snapshot();
    const next = snapshot();
    next.players = [
      { ...next.players[0], x: 12 },
      { id: 'two', name: 'Two', x: 4, z: 5, state: 'online', lastSeen: '2026-08-03T12:00:00.000Z' },
    ];
    next.claims = [];
    next.marketplaceOffers['7'] = [
      { ...next.marketplaceOffers['7'][0], amount: 3 },
      { id: 2, itemName: 'Stone', itemVariant: 0, amount: 1, price: 2, currency: 'Coins', sellerName: 'Two', createdAt: '2026-08-03T12:00:00.000Z' },
    ];

    expect(mapLiveChanges(first, next)).toEqual({
      claims: { upserted: [], removedIds: [1] },
      players: {
        upserted: [next.players[0], next.players[1]],
        removedIds: [],
      },
      marketplaceOffers: {
        areas: [{
          areaId: 7,
          upserted: next.marketplaceOffers['7'],
          removedIds: [],
        }],
      },
    });
  });

  test('pings responsive sockets and terminates peers that miss the next pong', () => {
    let pingCount = 0;
    let terminateCount = 0;
    const socket = {
      readyState: WebSocket.OPEN,
      ping: () => { pingCount += 1; },
      terminate: () => { terminateCount += 1; },
    } as unknown as WebSocket;
    const aliveSockets = new WeakSet<WebSocket>([socket]);

    runMapLiveHeartbeat([socket], aliveSockets);
    expect(pingCount).toBe(1);
    expect(terminateCount).toBe(0);

    runMapLiveHeartbeat([socket], aliveSockets);
    expect(terminateCount).toBe(1);
  });
});

function snapshot(): MapLiveSnapshot {
  return {
    capabilities: {
      schemaVersion: 1,
      worldName: 'World',
      sectorSizeChunks: 256,
      chunkSizeBlocks: 32,
      sectorSizeBlocks: 8192,
      recentPlayerDays: 30,
      claims: true,
      claimSales: true,
      renewZones: true,
      marketplace: true,
      shop: false,
      players: true,
      gpsGlobalMarkers: true,
    },
    claims: [{
      areaId: 1,
      name: 'Claim',
      permission: 'ozlc-guest',
      minX: 0,
      minZ: 0,
      width: 32,
      depth: 32,
      borderColor: '#FFFFFFFF',
      fillColor: '#FFFFFF50',
      forSale: false,
      renewZone: false,
      marketplace: true,
      shop: false,
    }],
    players: [{
      id: 'one',
      name: 'One',
      x: 1,
      z: 2,
      state: 'online',
      lastSeen: '2026-08-03T12:00:00.000Z',
    }],
    gpsGlobalMarkers: [],
    marketplaceOffers: {
      '7': [{
        id: 1,
        itemName: 'Wood',
        itemVariant: 0,
        amount: 2,
        price: 4,
        currency: 'Coins',
        sellerName: 'One',
        createdAt: '2026-08-03T12:00:00.000Z',
      }],
    },
  };
}
