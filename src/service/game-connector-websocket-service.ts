import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { isIP } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { listServers, saveServer } from '../db/manager-store.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import {
  createGameConnectorCredential,
  decryptGameConnectorCredential,
  encryptGameConnectorCredential,
} from './game-connector-credential-service.js';
import { startWebSocketHeartbeat } from './websocket-heartbeat-service.js';
import { registerWebSocketEndpoint } from './websocket-upgrade-router.js';

const CONNECTOR_PATH = '/ws';
const MAX_MESSAGE_BYTES = 4096;
const PROVISION_TIMEOUT_MS = 10000;

interface FeaturesMessage {
  type: 'connector.features';
  schemaVersion: 1;
  events: string[];
}

interface ConnectorSession {
  socket: WebSocket;
  events: string[];
}

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

  webSocketServer.on('connection', (socket, request) => {
    const timeout = setTimeout(() => closeWithError(socket, 'provision_timeout'), PROVISION_TIMEOUT_MS);
    socket.once('message', (data) => {
      void handleFirstMessage(request, data)
        .then(({ provisioned, serverId }) => {
          clearTimeout(timeout);
          if (provisioned) {
            send(socket, { type: 'connector.provisioned', schemaVersion: 1, credential: provisioned });
            socket.close(1000, 'provisioned');
            return;
          }
          const previous = sessions.get(serverId!);
          if (previous) previous.socket.close(1000, 'replaced');
          sessions.set(serverId!, { socket, events: [] });
          send(socket, { type: 'connector.authenticated', schemaVersion: 1, serverId });
          socket.on('message', (message) => handleAuthenticatedMessage(socket, serverId!, sessions, message));
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
      webSocketServer.close();
    },
  };
}

async function handleFirstMessage(request: IncomingMessage, data: RawData): Promise<{ provisioned?: string; serverId?: string }> {
  const message = parseMessage(data);
  if (message.type === 'connector.provision' && message.schemaVersion === 1
      && typeof message.gamePort === 'number' && Number.isInteger(message.gamePort)
      && message.gamePort >= 1 && message.gamePort <= 65535) {
    return { provisioned: await provision(request, message.gamePort) };
  }
  if (message.type === 'connector.authenticate' && message.schemaVersion === 1 && typeof message.credential === 'string') {
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
  if (server.connectorCredential) throw new ConnectorProtocolError('already_paired');

  const credential = createGameConnectorCredential();
  server.connectorCredential = encryptGameConnectorCredential(credential, AppConfig.gameConnectorCredentialKey);
  await saveServer(server);
  defaultLogger.log(`Game connector provisioned for server ${server.id}`);
  return credential;
}

async function authenticate(credential: string): Promise<string> {
  if (!AppConfig.gameConnectorCredentialKey || credential.length > 256) throw new ConnectorProtocolError('unauthorized');
  for (const server of await listServers()) {
    if (!server.connectorCredential) continue;
    const expected = decryptGameConnectorCredential(server.connectorCredential, AppConfig.gameConnectorCredentialKey);
    if (expected && constantTimeEquals(expected, credential)) return server.id;
  }
  throw new ConnectorProtocolError('unauthorized');
}

function handleAuthenticatedMessage(socket: WebSocket, serverId: string, sessions: Map<string, ConnectorSession>, data: RawData): void {
  try {
    const message = parseMessage(data) as unknown as FeaturesMessage;
    if (message.type !== 'connector.features' || message.schemaVersion !== 1 || !Array.isArray(message.events) || message.events.length > 64 || !message.events.every((event) => typeof event === 'string' && /^[a-z][A-Za-z0-9]{0,63}$/.test(event))) {
      throw new ConnectorProtocolError('invalid_message');
    }
    const session = sessions.get(serverId);
    if (!session || session.socket !== socket) throw new ConnectorProtocolError('unauthorized');
    session.events = [...new Set(message.events)];
    send(socket, { type: 'connector.features.accepted', schemaVersion: 1, events: session.events });
  } catch (error) {
    closeWithError(socket, error instanceof ConnectorProtocolError ? error.code : 'invalid_message');
  }
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

function closeWithError(socket: WebSocket, code: string): void {
  send(socket, { type: 'error', schemaVersion: 1, code });
  socket.close(1008, code);
}

class ConnectorProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
