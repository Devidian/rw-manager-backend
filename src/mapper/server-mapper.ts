import type { ServerDto } from '../dto/server-dto.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { mapDateTimeString } from './date-time-mapper.js';

export function mapServerToDto(server: ServerConfig): ServerDto {
  return {
    id: server.id,
    label: server.label,
    steamId: server.steamId,
    addr: server.addr,
    version: server.version,
    name: server.name,
    ip: server.ip,
    port: server.port,
    region: server.region,
    gm: server.gm,
    mods: server.mods,
    password: server.password,
    whitelist: server.whitelist,
    adminUid: server.adminUid,
    queryUrl: server.queryUrl as ServerDto['queryUrl'],
    mapUrl: server.mapUrl as ServerDto['mapUrl'],
    backendUrl: (server.backendUrl ?? server.mapUrl) as ServerDto['backendUrl'],
    data: server.data,
    info: server.info,
    status: server.status,
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
