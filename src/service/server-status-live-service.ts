import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ServerLiveStatusResponse } from '../dto/server-live-status-response.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { getUserFromBearerToken } from './auth-token-service.js';
import { getStoredServerLiveStatus } from './server-live-status-service.js';
import { subscribeServerLiveUpdates } from './server-live-update-service.js';
import { startWebSocketHeartbeat } from './websocket-heartbeat-service.js';
import { registerWebSocketEndpoint } from './websocket-upgrade-router.js';

interface SubscribeMessage {
  type: 'server.status.subscribe' | 'server.status.set-servers';
  schemaVersion: 1;
  serverIds: string[];
  token?: string;
}

interface SubscriberState {
  serverIds: Set<string>;
  snapshots: Map<string, ServerLiveStatusResponse>;
  sequence: number;
}

export interface ServerLiveStatusChanges {
  changed: Partial<ServerLiveStatusResponse>;
  removedFields: Array<'queryData' | 'infoData' | 'onlinePlayers' | 'errorMessage'>;
}

export interface ServerStatusLiveService {
  close: () => void;
}

const LIVE_PATH = '/api/storage/server-live';
const MAX_MESSAGE_BYTES = 65536;
const MAX_BUFFERED_BYTES = 65536;
const SUBSCRIBE_TIMEOUT_MS = 10000;

export function attachServerStatusLiveService(server: HttpServer): ServerStatusLiveService {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const subscribers = new Map<WebSocket, SubscriberState>();
  const unregisterEndpoint = registerWebSocketEndpoint(server, LIVE_PATH, webSocketServer);
  const stopHeartbeat = startWebSocketHeartbeat(webSocketServer);

  webSocketServer.on('connection', (socket) => {
    let subscribed = false;
    let updates = Promise.resolve();
    const subscribeTimeout = setTimeout(
      () => closeWithError(socket, 'subscribe_timeout'),
      SUBSCRIBE_TIMEOUT_MS,
    );

    socket.on('message', (data) => {
      updates = updates.then(async () => {
        const message = parseServerStatusSubscribeMessage(data, subscribed);
        if (!subscribed) await authorize(message.token);
        const snapshotItems = await snapshotItemsFor(message.serverIds);
        const state = subscribers.get(socket) ?? {
          serverIds: new Set<string>(),
          snapshots: new Map<string, ServerLiveStatusResponse>(),
          sequence: 0,
        };
        state.serverIds = new Set(message.serverIds);
        state.snapshots = new Map(snapshotItems.map((item) => [item.serverId, item.value]));
        subscribers.set(socket, state);
        subscribed = true;
        clearTimeout(subscribeTimeout);
        send(socket, {
          type: 'server.status.subscribed',
          schemaVersion: 1,
          serverIds: message.serverIds,
          maxServerIds: AppConfig.serverLiveMaxServerIds,
          generatedAt: new Date().toISOString(),
        });
        send(socket, {
          type: 'server.status.snapshot',
          schemaVersion: 1,
          items: snapshotItems,
          generatedAt: new Date().toISOString(),
        });
      }).catch((error) => {
        const code = protocolErrorCode(error);
        if (!subscribed) {
          clearTimeout(subscribeTimeout);
          closeWithError(socket, code);
        } else {
          send(socket, { type: 'error', schemaVersion: 1, code });
        }
      });
    });

    socket.on('close', () => {
      clearTimeout(subscribeTimeout);
      subscribers.delete(socket);
    });
    socket.on('error', (error) => {
      defaultLogger.debug('Server status live WebSocket error:', error.message);
    });
  });

  const unsubscribeUpdates = subscribeServerLiveUpdates(({ serverId, value }) => {
    for (const [socket, state] of subscribers) {
      if (!state.serverIds.has(serverId)) continue;
      const previous = state.snapshots.get(serverId);
      state.snapshots.set(serverId, value);
      if (!previous) continue;
      const changes = serverLiveStatusChanges(previous, value);
      if (!Object.keys(changes.changed).length && !changes.removedFields.length) continue;
      state.sequence += 1;
      sendServerStatusChange(socket, {
        type: 'server.status.changed',
        schemaVersion: 1,
        serverId,
        sequence: state.sequence,
        generatedAt: new Date().toISOString(),
        ...changes,
      });
    }
  });

  return {
    close: () => {
      unregisterEndpoint();
      stopHeartbeat();
      unsubscribeUpdates();
      for (const socket of subscribers.keys()) socket.close(1001, 'server_shutdown');
      subscribers.clear();
      webSocketServer.close();
    },
  };
}

export function sendServerStatusChange(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.terminate();
    return;
  }
  send(socket, message);
}

export function parseServerStatusSubscribeMessage(data: RawData, subscribed = false): SubscribeMessage {
  const text = rawDataText(data);
  if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) throw new ServerStatusProtocolError('invalid_message');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ServerStatusProtocolError('invalid_message');
  }
  if (!value || typeof value !== 'object') throw new ServerStatusProtocolError('invalid_message');
  const item = value as Record<string, unknown>;
  const expectedType = subscribed ? 'server.status.set-servers' : 'server.status.subscribe';
  if (
    item.type !== expectedType ||
    item.schemaVersion !== 1 ||
    !Array.isArray(item.serverIds) ||
    item.serverIds.length > AppConfig.serverLiveMaxServerIds ||
    !item.serverIds.every((serverId) =>
      typeof serverId === 'string' && !!serverId.trim() && serverId.length <= 200) ||
    (item.token !== undefined && typeof item.token !== 'string')
  ) throw new ServerStatusProtocolError(
    Array.isArray(item.serverIds) &&
      item.serverIds.length > AppConfig.serverLiveMaxServerIds
      ? 'server_limit_exceeded'
      : 'invalid_message',
  );
  const serverIds = [...new Set((item.serverIds as string[]).map((serverId) => serverId.trim()))].sort();
  return {
    type: expectedType,
    schemaVersion: 1,
    serverIds,
    ...(typeof item.token === 'string' && item.token ? { token: item.token } : {}),
  };
}

export function serverLiveStatusChanges(
  previous: ServerLiveStatusResponse,
  next: ServerLiveStatusResponse,
): ServerLiveStatusChanges {
  const changed: Partial<ServerLiveStatusResponse> = {};
  const removedFields: ServerLiveStatusChanges['removedFields'] = [];
  const optionalFields = ['queryData', 'infoData', 'onlinePlayers', 'errorMessage'] as const;
  if (previous.status !== next.status) changed.status = next.status;
  for (const field of optionalFields) {
    if (next[field] === undefined && previous[field] !== undefined) {
      removedFields.push(field);
    } else if (!sameValue(previous[field], next[field]) && next[field] !== undefined) {
      assignOptionalField(changed, field, next[field]);
    }
  }
  if (Object.keys(changed).length || removedFields.length) changed.lastChecked = next.lastChecked;
  return { changed, removedFields };
}

async function authorize(token: string | undefined): Promise<void> {
  const user = token ? await getUserFromBearerToken(`Bearer ${token}`) : null;
  if (AppConfig.enableAuth && AppConfig.forceAuth && !user) {
    throw new ServerStatusProtocolError('unauthorized');
  }
}

async function snapshotItemsFor(
  serverIds: string[],
): Promise<Array<{ serverId: string; value: ServerLiveStatusResponse }>> {
  return Promise.all(serverIds.map(async (serverId) => ({
    serverId,
    value: await getStoredServerLiveStatus(serverId),
  })));
}

function assignOptionalField(
  target: Partial<ServerLiveStatusResponse>,
  field: 'queryData' | 'infoData' | 'onlinePlayers' | 'errorMessage',
  value: unknown,
): void {
  if (field === 'onlinePlayers' && Array.isArray(value)) target.onlinePlayers = value;
  else if (field === 'errorMessage' && typeof value === 'string') target.errorMessage = value;
  else if (field === 'queryData') target.queryData = value;
  else if (field === 'infoData') target.infoData = value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function rawDataText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function closeWithError(socket: WebSocket, code: string): void {
  send(socket, { type: 'error', schemaVersion: 1, code });
  socket.close(code === 'unauthorized' ? 1008 : 1003, code);
}

function protocolErrorCode(error: unknown): string {
  if (error instanceof ServerStatusProtocolError) return error.code;
  if (error instanceof Error && ['SERVER_NOT_FOUND', 'QUERY_URL_MISSING'].includes(error.message)) {
    return error.message.toLowerCase();
  }
  return 'internal_error';
}

class ServerStatusProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
