import { createHash } from 'node:crypto';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { findServerById } from '../db/manager-store.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { getUserFromBearerToken } from './auth-token-service.js';
import {
  refreshPluginDataForServer,
  type PluginDataCacheEntry,
} from './plugin-data-cache-service.js';

export type MapLiveLayer =
  | 'capabilities'
  | 'claims'
  | 'players'
  | 'gpsGlobalMarkers'
  | 'marketplaceOffers';

interface SubscribeMessage {
  type: 'subscribe';
  schemaVersion: 1;
  serverId: string;
  token?: string;
}

interface ServerSubscription {
  sockets: Set<WebSocket>;
  fingerprints?: Record<MapLiveLayer, string>;
  sequence: number;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
}

export interface MapLiveService {
  close: () => void;
}

const LIVE_PATH = '/api/storage/map-live';
const MAX_MESSAGE_BYTES = 8192;
const MAX_BUFFERED_BYTES = 65536;
const SUBSCRIBE_TIMEOUT_MS = 10000;

export function attachMapLiveService(server: HttpServer): MapLiveService {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const subscriptions = new Map<string, ServerSubscription>();

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (requestUrlPath(request) !== LIVE_PATH) {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit('connection', client, request);
    });
  };
  server.on('upgrade', upgrade);

  webSocketServer.on('connection', (socket) => {
    let subscribedServerId: string | undefined;
    const subscribeTimeout = setTimeout(() => closeWithError(socket, 'subscribe_timeout'), SUBSCRIBE_TIMEOUT_MS);

    socket.once('message', (data) => {
      void parseAndAuthorizeSubscription(data)
        .then(async (message) => {
          const serverConfig = await findServerById(message.serverId);
          if (!serverConfig) throw new MapLiveProtocolError('server_not_found');
          clearTimeout(subscribeTimeout);
          subscribedServerId = message.serverId;
          const subscription = subscriptionFor(subscriptions, message.serverId);
          subscription.sockets.add(socket);
          send(socket, {
            type: 'subscribed',
            schemaVersion: 1,
            serverId: message.serverId,
            generatedAt: new Date().toISOString(),
          });
          startServerLoop(message.serverId, subscription, subscriptions);
        })
        .catch((error) => {
          clearTimeout(subscribeTimeout);
          closeWithError(socket, protocolErrorCode(error));
        });
    });

    socket.on('close', () => {
      clearTimeout(subscribeTimeout);
      if (subscribedServerId) removeSubscriber(subscriptions, subscribedServerId, socket);
    });
    socket.on('error', (error) => {
      defaultLogger.debug('Map live WebSocket error:', error.message);
    });
  });

  return {
    close: () => {
      server.off('upgrade', upgrade);
      for (const subscription of subscriptions.values()) {
        if (subscription.timer) clearTimeout(subscription.timer);
        for (const socket of subscription.sockets) socket.close(1001, 'server_shutdown');
      }
      subscriptions.clear();
      webSocketServer.close();
    },
  };
}

async function parseAndAuthorizeSubscription(data: RawData): Promise<SubscribeMessage> {
  const message = parseSubscribeMessage(data);
  if (AppConfig.enableAuth && AppConfig.forceAuth) {
    const user = await getUserFromBearerToken(
      message.token ? `Bearer ${message.token}` : undefined,
    );
    if (!user) throw new MapLiveProtocolError('unauthorized');
  }
  return message;
}

export function parseSubscribeMessage(data: RawData): SubscribeMessage {
  const text = rawDataText(data);
  if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) throw new MapLiveProtocolError('invalid_message');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MapLiveProtocolError('invalid_message');
  }
  if (!value || typeof value !== 'object') throw new MapLiveProtocolError('invalid_message');
  const item = value as Record<string, unknown>;
  if (
    item.type !== 'subscribe' ||
    item.schemaVersion !== 1 ||
    typeof item.serverId !== 'string' ||
    !item.serverId.trim() ||
    item.serverId.length > 200 ||
    (item.token !== undefined && typeof item.token !== 'string')
  ) throw new MapLiveProtocolError('invalid_message');
  return {
    type: 'subscribe',
    schemaVersion: 1,
    serverId: item.serverId,
    ...(typeof item.token === 'string' && item.token ? { token: item.token } : {}),
  };
}

function startServerLoop(
  serverId: string,
  subscription: ServerSubscription,
  subscriptions: Map<string, ServerSubscription>,
): void {
  if (subscription.running || subscription.timer) return;
  const run = async () => {
    if (!subscription.sockets.size) return;
    subscription.running = true;
    try {
      const serverConfig = await findServerById(serverId);
      if (!serverConfig) throw new Error('SERVER_NOT_FOUND');
      const result = await refreshPluginDataForServer(serverConfig);
      if (result.entry) publishChanges(serverId, subscription, result.entry);
    } catch (error) {
      defaultLogger.warn('Map live refresh failed:', {
        serverId,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
    } finally {
      subscription.running = false;
      if (subscription.sockets.size) {
        subscription.timer = setTimeout(() => {
          subscription.timer = undefined;
          void run();
        }, AppConfig.mapLiveRefreshIntervalMs);
      } else {
        subscriptions.delete(serverId);
      }
    }
  };
  void run();
}

function publishChanges(
  serverId: string,
  subscription: ServerSubscription,
  entry: PluginDataCacheEntry,
): void {
  const next = mapLayerFingerprints(entry);
  const previous = subscription.fingerprints;
  subscription.fingerprints = next;
  if (!previous) return;
  const layers = (Object.keys(next) as MapLiveLayer[])
    .filter((layer) => next[layer] !== previous[layer]);
  if (!layers.length) return;
  subscription.sequence += 1;
  const payload = JSON.stringify({
    type: 'map.layers.changed',
    schemaVersion: 1,
    serverId,
    sequence: subscription.sequence,
    generatedAt: new Date().toISOString(),
    layers,
  });
  for (const socket of subscription.sockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate();
      continue;
    }
    socket.send(payload);
  }
}

export function mapLayerFingerprints(
  entry: PluginDataCacheEntry,
): Record<MapLiveLayer, string> {
  const data = entry.data;
  const marketplaceOffers = Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => key.startsWith('ozmarketplace.offers.'))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    capabilities: fingerprint({ plugins: entry.plugins, keys: Object.keys(data).sort() }),
    claims: fingerprint({
      worldAreas: data['ozadminutils.worldAreas'],
      claimSales: data['ozlandclaim.claimSales'],
      renewZones: data['ozlandclaim.renewZones'],
      marketplaceZones: data['ozmarketplace.zones'],
      shopZones: data['ozshop.zones'],
    }),
    players: fingerprint({
      playerlist: data['ozadminutils.playerlist'],
      onlinePlayers: data.__onlinePlayers,
    }),
    gpsGlobalMarkers: fingerprint(data['ozgps.globalMarkers']),
    marketplaceOffers: fingerprint(marketplaceOffers),
  };
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(withoutVolatileMetadata(value)) ?? 'undefined';
  return createHash('sha256').update(serialized).digest('base64url');
}

function withoutVolatileMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatileMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'generatedAt' && key !== 'generatedAtMs')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, withoutVolatileMetadata(item)]));
}

function subscriptionFor(
  subscriptions: Map<string, ServerSubscription>,
  serverId: string,
): ServerSubscription {
  const existing = subscriptions.get(serverId);
  if (existing) return existing;
  const created: ServerSubscription = { sockets: new Set(), sequence: 0, running: false };
  subscriptions.set(serverId, created);
  return created;
}

function removeSubscriber(
  subscriptions: Map<string, ServerSubscription>,
  serverId: string,
  socket: WebSocket,
): void {
  const subscription = subscriptions.get(serverId);
  if (!subscription) return;
  subscription.sockets.delete(socket);
  if (!subscription.sockets.size && !subscription.running) {
    if (subscription.timer) clearTimeout(subscription.timer);
    subscriptions.delete(serverId);
  }
}

function requestUrlPath(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
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
  return error instanceof MapLiveProtocolError ? error.code : 'internal_error';
}

class MapLiveProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
