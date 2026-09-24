import { resetNativePluginAccess } from './native-plugin-request-service.js';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { isIP } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  listServers,
  claimServerConnectorCredential,
  replaceServerConnectorCredential,
  replaceServerConnectorCredentialIfCurrent,
} from '../db/manager-store.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import {
  createGameConnectorCredential,
  decryptGameConnectorCredentialWithKeyRing,
  encryptGameConnectorCredential,
} from './game-connector-credential-service.js';
import { startWebSocketHeartbeat } from './websocket-heartbeat-service.js';
import { registerWebSocketEndpoint } from './websocket-upgrade-router.js';
import type {
  ConnectorAuthenticateRequest,
  ConnectorEventRequest,
  ConnectorFeaturesRequest,
  ConnectorProvisionRequest,
} from '../dto/game-connector-message.js';

const CONNECTOR_PATH = '/ws';
const MAX_MESSAGE_BYTES = 4096;
const PROVISION_TIMEOUT_MS = 10000;
const MAX_MESSAGES_PER_MINUTE = 120;

interface ConnectorSession {
  socket: WebSocket;
  events: string[];
  rateWindowStartedAt: number;
  messagesInRateWindow: number;
  lastEventSequence: number;
}

export type GameConnectorEventHandler = (serverId: string, event: string, data: unknown) => Promise<void> | void;
const eventHandlers = new Set<GameConnectorEventHandler>();

export function registerGameConnectorEventHandler(handler: GameConnectorEventHandler): () => void {
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}

export function hasActiveGameConnectorFeature(serverId: string, event: string): boolean {
  return activeSessions?.get(serverId)?.events.includes(event) ?? false;
}

/** Requests a credential reset only over the server's already authenticated connector session. */
export function requestGameConnectorCredentialReset(serverId: string): boolean {
  const session = activeSessions?.get(serverId);
  if (!session || session.socket.readyState !== WebSocket.OPEN) return false;
  send(session.socket, { type: 'connector.reset', schemaVersion: 1, reason: 'native_route_unauthorized' });
  return true;
}

/** Closes a session whose backing master-list catalog record was pruned. */
export function closeGameConnectorSession(serverId: string): void {
  const session = activeSessions?.get(serverId);
  if (!session) return;
  activeSessions?.delete(serverId);
  if (session.socket.readyState === WebSocket.OPEN) session.socket.close(1001, 'server_pruned');
}

let activeSessions: Map<string, ConnectorSession> | undefined;

export interface GameConnectorWebSocketService {
  close: () => void;
}

/**
 * Accepts only the first, tokenless provisioning frame. Regular authenticated
 * connector sessions are deliberately added in the following protocol phase.
 */
export function attachGameConnectorWebSocketService(server: HttpServer): GameConnectorWebSocketService {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const unregisterEndpoint = registerWebSocketEndpoint(server, CONNECTOR_PATH, webSocketServer);
  const stopHeartbeat = startWebSocketHeartbeat(webSocketServer);
  const sessions = new Map<string, ConnectorSession>();
  activeSessions = sessions;

  webSocketServer.on('connection', (socket, request) => {
    const timeout = setTimeout(() => closeWithError(socket, 'provision_timeout'), PROVISION_TIMEOUT_MS);
    socket.once('message', (data) => {
      void handleFirstMessage(request, data)
        .then(({ provisioned, serverId }) => {
          clearTimeout(timeout);
          if (provisioned) {
            sendThenClose(socket, { type: 'connector.provisioned', schemaVersion: 1, credential: provisioned }, 'provisioned');
            return;
          }
          const previous = sessions.get(serverId!);
          if (previous) previous.socket.close(1000, 'replaced');
          sessions.set(serverId!, { socket, events: [], rateWindowStartedAt: Date.now(), messagesInRateWindow: 0, lastEventSequence: 0 });
          resetNativePluginAccess(serverId!);
          send(socket, { type: 'connector.authenticated', schemaVersion: 1, serverId });
          socket.on('message', (message) => {
            void handleAuthenticatedMessage(socket, serverId!, sessions, message);
          });
        })
        .catch((error) => {
          clearTimeout(timeout);
          closeWithError(socket, error instanceof ConnectorProtocolError ? error.code : 'provision_failed');
        });
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      for (const [serverId, session] of sessions) if (session.socket === socket) sessions.delete(serverId);
    });
    socket.on('error', (error) => defaultLogger.debug('Game connector WebSocket error:', error.message));
  });

  return {
    close: () => {
      unregisterEndpoint();
      stopHeartbeat();
      for (const socket of webSocketServer.clients) socket.close(1001, 'server_shutdown');
      sessions.clear();
      if (activeSessions === sessions) activeSessions = undefined;
      webSocketServer.close();
    },
  };
}

async function handleFirstMessage(request: IncomingMessage, data: RawData): Promise<{ provisioned?: string; serverId?: string }> {
  const message = parseMessage(data);
  if (isConnectorProvisionRequest(message)
      && Number.isInteger(message.gamePort)
      && message.gamePort >= 1 && message.gamePort <= 65535) {
    return { provisioned: await provision(request, message.gamePort) };
  }
  if (isConnectorAuthenticateRequest(message) && message.credential.length <= 256) {
    return { serverId: await authenticate(message.credential) };
  }
  throw new ConnectorProtocolError('invalid_message');
}

async function provision(request: IncomingMessage, gamePort: number): Promise<string> {
  if (!AppConfig.gameConnectorCredentialKey) throw new ConnectorProtocolError('connector_not_configured');
  const peerIp = peerIpFromRequest(request);
  // The client-provided port is accepted only as a discriminator for the
  // proxy-authenticated peer IP; identity still comes from the fresh catalog.
  const candidates = (await listServers()).filter(
    (server) => server.ip === peerIp && server.port === gamePort,
  );
  if (candidates.length !== 1) throw new ConnectorProtocolError(candidates.length ? 'pairing_ambiguous' : 'server_not_found');
  const server = candidates[0];

  const credential = createGameConnectorCredential();
  const encrypted = encryptGameConnectorCredential(credential, AppConfig.gameConnectorCredentialKey);
  const stored = server.connectorCredential
    ? await replaceServerConnectorCredential(server.id, encrypted)
    : await claimServerConnectorCredential(server.id, encrypted);
  if (!stored) throw new ConnectorProtocolError('provision_failed');
  defaultLogger.log(`Game connector ${server.connectorCredential ? 'reprovisioned' : 'provisioned'} for server ${server.id}`);
  return credential;
}

async function authenticate(credential: string): Promise<string> {
  if (!AppConfig.gameConnectorCredentialKey || credential.length > 256) throw new ConnectorProtocolError('unauthorized');
  for (const server of await listServers()) {
    if (!server.connectorCredential) continue;
    const decrypted = decryptGameConnectorCredentialWithKeyRing(
      server.connectorCredential,
      [AppConfig.gameConnectorCredentialKey, ...AppConfig.gameConnectorPreviousCredentialKeys],
    );
    if (decrypted && constantTimeEquals(decrypted.credential, credential)) {
      if (decrypted.keyIndex > 0) {
        const reencrypted = encryptGameConnectorCredential(credential, AppConfig.gameConnectorCredentialKey);
        await replaceServerConnectorCredentialIfCurrent(server.id, server.connectorCredential, reencrypted);
      }
      return server.id;
    }
  }
  throw new ConnectorProtocolError('unauthorized');
}

async function handleAuthenticatedMessage(socket: WebSocket, serverId: string, sessions: Map<string, ConnectorSession>, data: RawData): Promise<void> {
  try {
    const message = parseMessage(data);
    const session = sessions.get(serverId);
    if (!session || session.socket !== socket) throw new ConnectorProtocolError('unauthorized');
    if (!consumeMessageAllowance(session)) throw new ConnectorProtocolError('rate_limited');
    if (isConnectorFeaturesRequest(message)
        && message.events.length <= 64 && message.events.every((event) => typeof event === 'string' && /^[a-z][A-Za-z0-9]{0,63}$/.test(event))) {
      session.events = [...new Set(message.events)];
      send(socket, { type: 'connector.features.accepted', schemaVersion: 1, events: session.events });
      return;
    }
    if (isConnectorEventRequest(message) && /^[a-z][A-Za-z0-9]{0,63}$/.test(message.event)
        && Number.isSafeInteger(message.sequence) && message.sequence > session.lastEventSequence
        && session.events.includes(message.event)) {
      session.lastEventSequence = message.sequence;
      for (const handler of eventHandlers) await handler(serverId, message.event, message.data);
      return;
    }
    throw new ConnectorProtocolError('invalid_message');
  } catch (error) {
    closeWithError(socket, error instanceof ConnectorProtocolError ? error.code : 'invalid_message');
  }
}

function consumeMessageAllowance(session: ConnectorSession): boolean {
  const now = Date.now();
  if (now - session.rateWindowStartedAt >= 60_000) {
    session.rateWindowStartedAt = now;
    session.messagesInRateWindow = 0;
  }
  session.messagesInRateWindow += 1;
  return session.messagesInRateWindow <= MAX_MESSAGES_PER_MINUTE;
}

function parseMessage(data: RawData): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(rawText(data));
  } catch {
    throw new ConnectorProtocolError('invalid_message');
  }
  if (!value || typeof value !== 'object') {
    throw new ConnectorProtocolError('invalid_message');
  }
  return value as Record<string, unknown>;
}

function isConnectorProvisionRequest(value: Record<string, unknown>): value is ConnectorProvisionRequest & Record<string, unknown> {
  return value.type === 'connector.provision' && value.schemaVersion === 1 && typeof value.gamePort === 'number';
}

function isConnectorAuthenticateRequest(value: Record<string, unknown>): value is ConnectorAuthenticateRequest & Record<string, unknown> {
  return value.type === 'connector.authenticate' && value.schemaVersion === 1 && typeof value.credential === 'string';
}

function isConnectorFeaturesRequest(value: Record<string, unknown>): value is ConnectorFeaturesRequest & Record<string, unknown> {
  return value.type === 'connector.features' && value.schemaVersion === 1 && Array.isArray(value.events)
    && value.events.every((event) => typeof event === 'string');
}

function isConnectorEventRequest(value: Record<string, unknown>): value is ConnectorEventRequest & Record<string, unknown> {
  return value.type === 'connector.event' && value.schemaVersion === 1 && typeof value.event === 'string'
    && typeof value.sequence === 'number' && 'data' in value;
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function peerIpFromRequest(request: IncomingMessage): string {
  const remoteAddress = normalizeIp(request.socket.remoteAddress);
  const trustedProxies = AppConfig.gameConnectorTrustedProxyIps.map(normalizeIp);
  if (!remoteAddress || !trustedProxies.includes(remoteAddress)) {
    throw new ConnectorProtocolError('untrusted_proxy');
  }
  const header = request.headers['x-real-ip'];
  const peerIp = typeof header === 'string' ? normalizeIp(header) : undefined;
  if (!peerIp) throw new ConnectorProtocolError('peer_ip_unavailable');
  return peerIp;
}

function normalizeIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.startsWith('::ffff:') ? value.slice(7) : value;
  return isIP(normalized) === 0 ? undefined : normalized;
}

function constantTimeEquals(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

/** Wait for the provisioning frame to flush before closing the one-shot socket. */
function sendThenClose(socket: WebSocket, value: unknown, reason: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(value), (error) => {
    if (error) {
      socket.terminate();
      return;
    }
    socket.close(1000, reason);
  });
}

function closeWithError(socket: WebSocket, code: string): void {
  send(socket, { type: 'error', schemaVersion: 1, code });
  socket.close(1008, code);
}

class ConnectorProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
