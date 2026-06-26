import type { MasterServerListSyncResult } from '../service/master-server-list-service.js';
import type { ServerDto } from './server-dto.js';

export interface MasterServerListRefreshResponse {
  result: MasterServerListSyncResult;
  servers: ServerDto[];
  errorMessage?: string | undefined;
}
