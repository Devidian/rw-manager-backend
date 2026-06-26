import type { ServerDto } from '../dto/server-dto.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { mapDateTimeString } from './date-time-mapper.js';

function mapServerStatus(server: ServerConfig): ServerDto['status'] {
  if (server.status) return server.status;
  if (server.data !== undefined) return 'online';
  return 'unknown';
}

function mapOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function mapOptionalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return undefined;
  }
}

function mapOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function mapServerToDto(server: ServerConfig): ServerDto {
  return {
    id: server.id,
    label: server.label,
    steamId: mapOptionalString(server.steamId),
    addr: mapOptionalString(server.addr),
    version: mapOptionalString(server.version),
    name: mapOptionalString(server.name),
    ip: mapOptionalString(server.ip),
    port: mapOptionalNumber(server.port),
    region: mapOptionalString(server.region),
    gm: mapOptionalNumber(server.gm),
    mods: mapOptionalBoolean(server.mods),
    password: mapOptionalBoolean(server.password),
    whitelist: mapOptionalBoolean(server.whitelist),
    adminUid: mapOptionalString(server.adminUid),
    queryUrl: server.queryUrl as ServerDto['queryUrl'],
    mapUrl: mapOptionalUrl(server.mapUrl) as ServerDto['mapUrl'],
    backendUrl: mapOptionalUrl(server.backendUrl ?? server.mapUrl) as ServerDto['backendUrl'],
    data: server.data,
    info: server.info,
    status: mapServerStatus(server),
    queryData: server.data,
    infoData: server.info,
    onlinePlayers: server.onlinePlayers,
    lastChecked: server.lastChecked
      ? mapDateTimeString(server.lastChecked) as ServerDto['lastChecked']
      : undefined,
    errorMessage: server.errorMessage,
    firstSeen: server.firstSeen
      ? mapDateTimeString(server.firstSeen) as ServerDto['firstSeen']
      : undefined,
    lastSeen: server.lastSeen
      ? mapDateTimeString(server.lastSeen) as ServerDto['lastSeen']
      : undefined,
    queryDataUpdatedAt: server.queryDataUpdatedAt
      ? mapDateTimeString(server.queryDataUpdatedAt) as ServerDto['queryDataUpdatedAt']
      : undefined,
    public: server.public,
    createdAt: mapDateTimeString(server.createdAt) as ServerDto['createdAt'],
    userId: server.userId,
  };
}
