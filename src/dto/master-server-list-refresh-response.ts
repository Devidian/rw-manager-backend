import type { MasterServerListSyncResult } from '../service/master-server-list-service.js';

export interface MasterServerListRefreshResponse {
  result: MasterServerListSyncResult;
}
