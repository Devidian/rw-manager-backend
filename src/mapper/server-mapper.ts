import type { ServerDto } from '../dto/server-dto.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { mapDateTimeString } from './date-time-mapper.js';

export function mapServerToDto(server: ServerConfig): ServerDto {
  return {
    id: server.id,
    label: server.label,
    queryUrl: server.queryUrl as ServerDto['queryUrl'],
    backendUrl: server.backendUrl as ServerDto['backendUrl'],
    public: server.public,
    createdAt: mapDateTimeString(server.createdAt) as ServerDto['createdAt'],
    userId: server.userId,
  };
}
