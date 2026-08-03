import {
  parseServerStatusSubscribeMessage,
  serverLiveStatusChanges,
  sendServerStatusChange,
} from '../src/service/server-status-live-service.js';
import {
  publishServerLiveUpdate,
  subscribeServerLiveUpdates,
} from '../src/service/server-live-update-service.js';
import { jest } from '@jest/globals';
import { WebSocket } from 'ws';

describe('server status live WebSocket contract', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  test('normalizes one bounded multi-server subscription', () => {
    process.env.SERVER_LIVE_MAX_SERVER_IDS = '3';
    expect(parseServerStatusSubscribeMessage(Buffer.from(JSON.stringify({
      type: 'server.status.subscribe',
      schemaVersion: 1,
      serverIds: [' server-b ', 'server-a', 'server-b'],
      token: 'secret',
    })))).toEqual({
      type: 'server.status.subscribe',
      schemaVersion: 1,
      serverIds: ['server-a', 'server-b'],
      token: 'secret',
    });
  });

  test('rejects oversized subscriptions and enforces set-servers after subscribe', () => {
    process.env.MAX_PINNED_SERVERS = '1';
    process.env.SERVER_LIVE_MAX_SERVER_IDS = '2';
    expect(() => parseServerStatusSubscribeMessage(Buffer.from(JSON.stringify({
      type: 'server.status.subscribe',
      schemaVersion: 1,
      serverIds: ['one', 'two', 'three'],
    })))).toThrow('server_limit_exceeded');
    expect(() => parseServerStatusSubscribeMessage(Buffer.from(JSON.stringify({
      type: 'server.status.subscribe',
      schemaVersion: 1,
      serverIds: [],
    })), true)).toThrow('invalid_message');
    for (const value of [
      null,
      { type: 'wrong', schemaVersion: 1, serverIds: [] },
      { type: 'server.status.subscribe', schemaVersion: 2, serverIds: [] },
      { type: 'server.status.subscribe', schemaVersion: 1, serverIds: 'one' },
      { type: 'server.status.subscribe', schemaVersion: 1, serverIds: [''] },
      { type: 'server.status.subscribe', schemaVersion: 1, serverIds: ['x'.repeat(201)] },
      { type: 'server.status.subscribe', schemaVersion: 1, serverIds: [], token: 1 },
    ]) expect(() => parseServerStatusSubscribeMessage(
      Buffer.from(JSON.stringify(value)),
    )).toThrow('invalid_message');
    expect(() => parseServerStatusSubscribeMessage(Buffer.from('{bad'))).toThrow('invalid_message');
    expect(() => parseServerStatusSubscribeMessage(Buffer.alloc(65537, 'x'))).toThrow('invalid_message');
  });

  test('accepts raw-data variants and a valid server-set replacement', () => {
    const subscribe = JSON.stringify({
      type: 'server.status.subscribe', schemaVersion: 1, serverIds: ['one'],
    });
    expect(parseServerStatusSubscribeMessage(subscribe as never).serverIds).toEqual(['one']);
    expect(parseServerStatusSubscribeMessage(
      new TextEncoder().encode(subscribe).buffer as never,
    ).serverIds).toEqual(['one']);
    expect(parseServerStatusSubscribeMessage([Buffer.from(subscribe)] as never).serverIds).toEqual(['one']);
    expect(parseServerStatusSubscribeMessage(Buffer.from(JSON.stringify({
      type: 'server.status.set-servers', schemaVersion: 1, serverIds: ['two'],
    })), true).serverIds).toEqual(['two']);
  });

  test('creates field deltas and removes disappeared optional values', () => {
    const previous = {
      status: 'online' as const,
      queryData: { playercount: 1 },
      infoData: { name: 'Server' },
      onlinePlayers: [{ uid: 'one' }],
      errorMessage: 'old',
      lastChecked: '2026-08-03T12:00:00.000Z',
    };
    const next = {
      status: 'offline' as const,
      queryData: { playercount: 0 },
      lastChecked: '2026-08-03T12:01:00.000Z',
    };
    expect(serverLiveStatusChanges(previous, next)).toEqual({
      changed: {
        status: 'offline',
        queryData: { playercount: 0 },
        lastChecked: '2026-08-03T12:01:00.000Z',
      },
      removedFields: ['infoData', 'onlinePlayers', 'errorMessage'],
    });
    expect(serverLiveStatusChanges(next, {
      ...next,
      lastChecked: '2026-08-03T12:02:00.000Z',
    })).toEqual({ changed: {}, removedFields: [] });
    expect(serverLiveStatusChanges(next, {
      ...next,
      infoData: { name: 'New' },
      onlinePlayers: [{ uid: 'two' }],
      errorMessage: 'failed',
      lastChecked: '2026-08-03T12:03:00.000Z',
    })).toEqual({
      changed: {
        infoData: { name: 'New' },
        onlinePlayers: [{ uid: 'two' }],
        errorMessage: 'failed',
        lastChecked: '2026-08-03T12:03:00.000Z',
      },
      removedFields: [],
    });
  });

  test('publishes normalized internal refresh updates to active listeners only', () => {
    const updates: string[] = [];
    const unsubscribe = subscribeServerLiveUpdates((update) => updates.push(update.serverId));
    publishServerLiveUpdate('server-a', {
      status: 'online',
      lastChecked: '2026-08-03T12:00:00.000Z',
    });
    unsubscribe();
    publishServerLiveUpdate('server-b', {
      status: 'offline',
      lastChecked: '2026-08-03T12:01:00.000Z',
    });
    expect(updates).toEqual(['server-a']);
  });

  test('drops closed and backpressured status-change sockets', () => {
    const closed = { readyState: WebSocket.CLOSED, send: jest.fn(), terminate: jest.fn() } as unknown as WebSocket;
    sendServerStatusChange(closed, {});
    expect(closed.send).not.toHaveBeenCalled();
    const blocked = {
      readyState: WebSocket.OPEN, bufferedAmount: 65537, send: jest.fn(), terminate: jest.fn(),
    } as unknown as WebSocket;
    sendServerStatusChange(blocked, {});
    expect(blocked.terminate).toHaveBeenCalled();
  });
});

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}
