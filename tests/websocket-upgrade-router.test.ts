import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { jest } from '@jest/globals';
import { registerWebSocketEndpoint } from '../src/service/websocket-upgrade-router.js';

describe('shared WebSocket upgrade router', () => {
  test('routes multiple endpoints and keeps the remaining route registered', async () => {
    const server = http.createServer();
    const one = new WebSocketServer({ noServer: true });
    const two = new WebSocketServer({ noServer: true });
    const unregisterOne = registerWebSocketEndpoint(server, '/one', one);
    const unregisterTwo = registerWebSocketEndpoint(server, '/two', two);
    expect(() => registerWebSocketEndpoint(server, '/two', two)).toThrow('already registered');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    const base = `ws://127.0.0.1:${address.port}`;

    const firstConnection = connection(one);
    const first = await connect(`${base}/one?query=ignored`);
    await firstConnection;
    first.close();

    unregisterOne();
    const secondConnection = connection(two);
    const second = await connect(`${base}/two`);
    await secondConnection;
    second.close();

    await expect(connect(`${base}/unknown`)).rejects.toBeDefined();
    const destroy = jest.fn();
    server.emit('upgrade', { url: 'http://[invalid' }, { destroy }, Buffer.alloc(0));
    expect(destroy).toHaveBeenCalled();
    unregisterTwo();
    one.close();
    two.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

function connection(server: WebSocketServer): Promise<void> {
  return new Promise((resolve) => server.once('connection', () => resolve()));
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}
