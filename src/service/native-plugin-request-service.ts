import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { gameConnectorAuthorizationHeader } from './game-connector-credential-service.js';
import { resetServerConnectorCredential } from '../db/manager-store.js';
import { requestGameConnectorCredentialReset } from './game-connector-websocket-service.js';

type Result = { ok: true; data: unknown } | { ok: false; error: string };
interface Failure { credential?: string; until: number; attempts: number }
const failures = new Map<string, Failure>();
const requests = new Map<string, Promise<Result>>();

/** Reconnection or new credentials allow an immediate retry without erasing durable credentials. */
export function resetNativePluginAccess(serverId: string): void {
  failures.delete(serverId);
}

export async function fetchNativePluginJson(server: ServerConfig, url: string): Promise<Result> {
  // One initial request discovers access failure before sibling routes fan out.
  const pending = requests.get(server.id);
  if (pending) await pending;
  const failure = failures.get(server.id);
  if (failure && failure.credential === server.connectorCredential && failure.until > Date.now()) {
    return { ok: false, error: 'NATIVE_ACCESS_BACKOFF' };
  }
  const request = fetchRoute(server, url);
  requests.set(server.id, request);
  try { return await request; }
  finally { if (requests.get(server.id) === request) requests.delete(server.id); }
}

async function fetchRoute(server: ServerConfig, url: string): Promise<Result> {
  const context = { serverId: server.id, serverName: server.name ?? server.label,
    host: new URL(url).host, routePath: new URL(url).pathname };
  try {
    const authorization = gameConnectorAuthorizationHeader(server);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
      headers: authorization ? { Authorization: authorization } : undefined,
    });
    if (response.status === 401) {
      const recoveryRequested = authorization && requestGameConnectorCredentialReset(server.id)
        && await resetServerConnectorCredential(server.id, server.connectorCredential!);
      const previous = failures.get(server.id);
      const attempts = previous && previous.credential === server.connectorCredential ? previous.attempts + 1 : 1;
      const retryAfterMs = Math.min(30 * 60_000, 5 * 60_000 * 2 ** Math.min(attempts - 1, 3));
      if (failures.size >= 5000 && !failures.has(server.id)) failures.delete(failures.keys().next().value!);
      failures.set(server.id, { credential: server.connectorCredential, until: Date.now() + retryAfterMs, attempts });
      defaultLogger.warn('Native plugin access rejected; protected polling paused:', {
        ...context, status: 401, credentialAvailable: !!authorization, recoveryRequested, retryAfterMs,
      });
      return { ok: false, error: 'HTTP 401' };
    }
    if (!response.ok) {
      defaultLogger.warn('Native plugin route refresh failed:', { ...context, status: response.status });
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const data: unknown = await response.json();
    failures.delete(server.id);
    return { ok: true, data };
  } catch (error) {
    // Do not log arbitrary fetch errors, which can include credential-bearing URLs.
    defaultLogger.warn('Native plugin route request failed:', context);
    return { ok: false, error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' };
  }
}
