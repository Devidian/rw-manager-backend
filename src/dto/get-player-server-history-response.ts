export interface PlayerServerHistoryItem {
  serverId: string;
  label: string;
  status: 'online' | 'offline' | 'unknown';
  name?: string;
  playtime?: number;
  firstseen?: number;
  lastseen?: number;
}

export interface GetPlayerServerHistoryResponse {
  uid: string;
  items: PlayerServerHistoryItem[];
}
