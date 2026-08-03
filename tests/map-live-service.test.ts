import {
  mapLiveChanges,
  parseSubscribeMessage,
  runMapLiveHeartbeat,
  sendMapLiveDelta,
} from '../src/service/map-live-service.js';
import type { MapLiveSnapshot } from '../src/interfaces/map-layer.js';
import { WebSocket } from 'ws';
import { jest } from '@jest/globals';

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
    for (const value of [
      null,
      { type: 'wrong', schemaVersion: 1, serverId: 'server-a' },
      { type: 'subscribe', schemaVersion: 2, serverId: 'server-a' },
      { type: 'subscribe', schemaVersion: 1, serverId: 1 },
      { type: 'subscribe', schemaVersion: 1, serverId: ' ' },
      { type: 'subscribe', schemaVersion: 1, serverId: 'server-a', token: 1 },
    ]) expect(() => parseSubscribeMessage(Buffer.from(JSON.stringify(value)))).toThrow('invalid_message');
    expect(() => parseSubscribeMessage(Buffer.from('{bad'))).toThrow('invalid_message');
    expect(() => parseSubscribeMessage(Buffer.alloc(8193, 'x'))).toThrow('invalid_message');
    expect(parseSubscribeMessage(Buffer.from(JSON.stringify({
      type: 'subscribe', schemaVersion: 1, serverId: 'server-a', token: 'token',
    })))).toMatchObject({ token: 'token' });
  });

  test('accepts all WebSocket raw-data representations', () => {
    const json = JSON.stringify({ type: 'subscribe', schemaVersion: 1, serverId: 'server-a' });
    expect(parseSubscribeMessage(json as never).serverId).toBe('server-a');
    expect(parseSubscribeMessage(new TextEncoder().encode(json).buffer as never).serverId).toBe('server-a');
    expect(parseSubscribeMessage([Buffer.from(json)] as never).serverId).toBe('server-a');
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
    runMapLiveHeartbeat([{ readyState: WebSocket.CLOSED } as WebSocket], aliveSockets);
  });

  test('covers capabilities, GPS, and marketplace removals', () => {
    const first = snapshot();
    const next = snapshot();
    next.capabilities = { ...next.capabilities, worldName: 'Changed' };
    next.gpsGlobalMarkers = [{ id: 4, name: 'Home', x: 1, z: 2 }];
    next.marketplaceOffers = { invalid: [], '0': [] };
    expect(mapLiveChanges(first, next)).toMatchObject({
      capabilities: { value: next.capabilities },
      gpsGlobalMarkers: { upserted: next.gpsGlobalMarkers, removedIds: [] },
      marketplaceOffers: { areas: [{ areaId: 7, upserted: [], removedIds: [1] }] },
    });
    expect(mapLiveChanges(next, next)).toEqual({});
  });

  test('drops closed and backpressured map delta sockets', () => {
    const message = {
      type: 'map.layers.changed' as const, schemaVersion: 1 as const, serverId: 'server-a',
      sequence: 1, generatedAt: '2026-08-03T12:00:00.000Z', layers: ['players' as const],
      changes: {},
    };
    const closed = { readyState: WebSocket.CLOSED, send: jest.fn(), terminate: jest.fn() } as unknown as WebSocket;
    sendMapLiveDelta(closed, message);
    expect(closed.send).not.toHaveBeenCalled();
    const blocked = {
      readyState: WebSocket.OPEN, bufferedAmount: 65537, send: jest.fn(), terminate: jest.fn(),
    } as unknown as WebSocket;
    sendMapLiveDelta(blocked, message);
    expect(blocked.terminate).toHaveBeenCalled();
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
