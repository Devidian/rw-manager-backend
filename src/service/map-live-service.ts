import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { findServerById } from '../db/manager-store.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { getUserFromBearerToken } from './auth-token-service.js';
import type {
  MapClaim,
  MapGpsMarker,
  MapLayerCapabilities,
  MapLiveSnapshot,
  MapMarketplaceOffer,
  MapPlayer,
} from '../interfaces/map-layer.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { mapLiveSnapshotFromEntry } from './map-layer-service.js';
import { startWebSocketHeartbeat, runWebSocketHeartbeat } from './websocket-heartbeat-service.js';
import { registerWebSocketEndpoint } from './websocket-upgrade-router.js';
import {
  onlinePlayersFromEntry,
  refreshPluginDataForServer,
  type PluginDataCacheEntry,
} from './plugin-data-cache-service.js';
import { storedLiveStatusResponse } from './server-live-status-service.js';
import { publishServerLiveUpdate } from './server-live-update-service.js';

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
  subscribers: Map<WebSocket, MapLiveSubscriber>;
  sequence: number;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
}

interface MapLiveSubscriber {
  userSteamId?: string;
  snapshot?: MapLiveSnapshot;
}

export interface MapEntityDelta<T, TId extends string | number> {
  upserted: T[];
  removedIds: TId[];
}

export interface MapMarketplaceAreaDelta extends MapEntityDelta<MapMarketplaceOffer, number> {
  areaId: number;
}

export interface MapLiveChanges {
  capabilities?: { value: MapLayerCapabilities };
  claims?: MapEntityDelta<MapClaim, number>;
  players?: MapEntityDelta<MapPlayer, string>;
  gpsGlobalMarkers?: MapEntityDelta<MapGpsMarker, number>;
  marketplaceOffers?: { areas: MapMarketplaceAreaDelta[] };
}

export interface MapLayersChangedMessage {
  type: 'map.layers.changed';
  schemaVersion: 1;
  serverId: string;
  sequence: number;
  generatedAt: string;
  layers: MapLiveLayer[];
  changes: MapLiveChanges;
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
  const unregisterEndpoint = registerWebSocketEndpoint(server, LIVE_PATH, webSocketServer);
  const stopHeartbeat = startWebSocketHeartbeat(webSocketServer);

  webSocketServer.on('connection', (socket) => {
    let subscribedServerId: string | undefined;
    const subscribeTimeout = setTimeout(() => closeWithError(socket, 'subscribe_timeout'), SUBSCRIBE_TIMEOUT_MS);

    socket.once('message', (data) => {
      void parseAndAuthorizeSubscription(data)
        .then(async ({ message, userSteamId }) => {
          const serverConfig = await findServerById(message.serverId);
          if (!serverConfig) throw new MapLiveProtocolError('server_not_found');
          clearTimeout(subscribeTimeout);
          subscribedServerId = message.serverId;
          const subscription = subscriptionFor(subscriptions, message.serverId);
          subscription.subscribers.set(socket, { userSteamId });
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
      unregisterEndpoint();
      stopHeartbeat();
      for (const subscription of subscriptions.values()) {
        if (subscription.timer) clearTimeout(subscription.timer);
        for (const socket of subscription.subscribers.keys()) socket.close(1001, 'server_shutdown');
      }
      subscriptions.clear();
      webSocketServer.close();
    },
  };
}

export const runMapLiveHeartbeat = runWebSocketHeartbeat;

async function parseAndAuthorizeSubscription(
  data: RawData,
): Promise<{ message: SubscribeMessage; userSteamId?: string }> {
  const message = parseSubscribeMessage(data);
  const user = message.token
    ? await getUserFromBearerToken(`Bearer ${message.token}`)
    : null;
  if (AppConfig.enableAuth && AppConfig.forceAuth) {
    if (!user) throw new MapLiveProtocolError('unauthorized');
  }
  return { message, userSteamId: user?.steamId };
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
    if (!subscription.subscribers.size) return;
    subscription.running = true;
    try {
      const serverConfig = await findServerById(serverId);
      if (!serverConfig) throw new Error('SERVER_NOT_FOUND');
      const result = await refreshPluginDataForServer(serverConfig);
      if (result.entry) {
        publishLivePlayerStatus(serverId, serverConfig, result.entry);
        publishChanges(serverId, subscription, result.entry);
      }
    } catch (error) {
      defaultLogger.warn('Map live refresh failed:', {
        serverId,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
    } finally {
      subscription.running = false;
      if (subscription.subscribers.size) {
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

function publishLivePlayerStatus(
  serverId: string,
  serverConfig: ServerConfig,
  entry: PluginDataCacheEntry,
): void {
  const onlinePlayers = onlinePlayersFromEntry(entry);
  if (onlinePlayers === undefined) return;
  const livePlayers = onlinePlayers.map((player) => (
    player && typeof player === 'object'
      ? { ...(player as Record<string, unknown>), online: true }
      : player
  ));
  publishServerLiveUpdate(serverId, {
    ...storedLiveStatusResponse(serverConfig),
    onlinePlayers: livePlayers,
    lastChecked: new Date().toISOString() as ReturnType<typeof storedLiveStatusResponse>['lastChecked'],
  });
}

function publishChanges(
  serverId: string,
  subscription: ServerSubscription,
  entry: PluginDataCacheEntry,
): void {
  const generatedAt = new Date();
  const messages: Array<{ socket: WebSocket; layers: MapLiveLayer[]; changes: MapLiveChanges }> = [];
  for (const [socket, subscriber] of subscription.subscribers) {
    const next = mapLiveSnapshotFromEntry(entry, generatedAt, subscriber.userSteamId);
    const previous = subscriber.snapshot;
    subscriber.snapshot = next;
    if (!previous) continue;
    const changes = mapLiveChanges(previous, next);
    const layers = Object.keys(changes) as MapLiveLayer[];
    if (layers.length) messages.push({ socket, layers, changes });
  }
  if (!messages.length) return;
  subscription.sequence += 1;
  for (const { socket, layers, changes } of messages) {
    sendMapLiveDelta(socket, {
      type: 'map.layers.changed',
      schemaVersion: 1,
      serverId,
      sequence: subscription.sequence,
      generatedAt: generatedAt.toISOString(),
      layers,
      changes,
    });
  }
}

export function sendMapLiveDelta(socket: WebSocket, message: MapLayersChangedMessage): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.terminate();
    return;
  }
  socket.send(JSON.stringify(message));
}

export function mapLiveChanges(previous: MapLiveSnapshot, next: MapLiveSnapshot): MapLiveChanges {
  const changes: MapLiveChanges = {};
  if (!sameValue(previous.capabilities, next.capabilities)) {
    changes.capabilities = { value: next.capabilities };
  }
  const claims = entityDelta(previous.claims, next.claims, (item) => item.areaId);
  if (hasEntityChanges(claims)) changes.claims = claims;
  const players = entityDelta(previous.players, next.players, (item) => item.id);
  if (hasEntityChanges(players)) changes.players = players;
  const gpsGlobalMarkers = entityDelta(
    previous.gpsGlobalMarkers,
    next.gpsGlobalMarkers,
    (item) => item.id,
  );
  if (hasEntityChanges(gpsGlobalMarkers)) changes.gpsGlobalMarkers = gpsGlobalMarkers;

  const areaIds = new Set([
    ...Object.keys(previous.marketplaceOffers),
    ...Object.keys(next.marketplaceOffers),
  ]);
  const areas = [...areaIds]
    .map(Number)
    .filter((areaId) => Number.isSafeInteger(areaId) && areaId > 0)
    .sort((left, right) => left - right)
    .flatMap((areaId): MapMarketplaceAreaDelta[] => {
      const delta = entityDelta(
        previous.marketplaceOffers[String(areaId)] ?? [],
        next.marketplaceOffers[String(areaId)] ?? [],
        (item) => item.id,
      );
      return hasEntityChanges(delta) ? [{ areaId, ...delta }] : [];
    });
  if (areas.length) changes.marketplaceOffers = { areas };
  return changes;
}

function entityDelta<T, TId extends string | number>(
  previous: T[],
  next: T[],
  id: (item: T) => TId,
): MapEntityDelta<T, TId> {
  const previousById = new Map(previous.map((item) => [id(item), item]));
  const nextById = new Map(next.map((item) => [id(item), item]));
  return {
    upserted: next.filter((item) => !sameValue(previousById.get(id(item)), item)),
    removedIds: previous
      .map(id)
      .filter((itemId) => !nextById.has(itemId)),
  };
}

function hasEntityChanges<T, TId extends string | number>(delta: MapEntityDelta<T, TId>): boolean {
  return delta.upserted.length > 0 || delta.removedIds.length > 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function subscriptionFor(
  subscriptions: Map<string, ServerSubscription>,
  serverId: string,
): ServerSubscription {
  const existing = subscriptions.get(serverId);
  if (existing) return existing;
  const created: ServerSubscription = { subscribers: new Map(), sequence: 0, running: false };
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
  subscription.subscribers.delete(socket);
  if (!subscription.subscribers.size && !subscription.running) {
    if (subscription.timer) clearTimeout(subscription.timer);
    subscriptions.delete(serverId);
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
