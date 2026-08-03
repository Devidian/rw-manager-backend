import { WebSocket, type WebSocketServer } from 'ws';

const HEARTBEAT_INTERVAL_MS = 25000;

export function startWebSocketHeartbeat(webSocketServer: WebSocketServer): () => void {
  const aliveSockets = new WeakSet<WebSocket>();
  webSocketServer.on('connection', (socket) => {
    aliveSockets.add(socket);
    socket.on('pong', () => aliveSockets.add(socket));
  });
  const heartbeat = setInterval(
    () => runWebSocketHeartbeat(webSocketServer.clients, aliveSockets),
    HEARTBEAT_INTERVAL_MS,
  );
  heartbeat.unref();
  return () => clearInterval(heartbeat);
}

export function runWebSocketHeartbeat(
  sockets: Iterable<WebSocket>,
  aliveSockets: WeakSet<WebSocket>,
): void {
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    if (!aliveSockets.has(socket)) {
      socket.terminate();
      continue;
    }
    aliveSockets.delete(socket);
    socket.ping();
  }
}
