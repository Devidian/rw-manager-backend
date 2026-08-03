import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';

interface UpgradeRouter {
  endpoints: Map<string, WebSocketServer>;
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

const routers = new WeakMap<HttpServer, UpgradeRouter>();

export function registerWebSocketEndpoint(
  server: HttpServer,
  path: string,
  webSocketServer: WebSocketServer,
): () => void {
  const router = upgradeRouterFor(server);
  if (router.endpoints.has(path)) throw new Error(`WebSocket endpoint already registered: ${path}`);
  router.endpoints.set(path, webSocketServer);
  return () => {
    router.endpoints.delete(path);
    if (!router.endpoints.size) {
      server.off('upgrade', router.handleUpgrade);
      routers.delete(server);
    }
  };
}

function upgradeRouterFor(server: HttpServer): UpgradeRouter {
  const existing = routers.get(server);
  if (existing) return existing;
  const endpoints = new Map<string, WebSocketServer>();
  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const webSocketServer = endpoints.get(requestUrlPath(request) ?? '');
    if (!webSocketServer) {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit('connection', client, request);
    });
  };
  const created = { endpoints, handleUpgrade };
  routers.set(server, created);
  server.on('upgrade', handleUpgrade);
  return created;
}

function requestUrlPath(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}
