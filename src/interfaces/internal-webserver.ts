export interface ServerQueryResponse {
  version: string;
  legacy: boolean;
  ip: string;
  port: number;
  steamid: number;
  contact: string;
  name: string;
  map: string;
  os: string;
  uptime: number;
  visible: boolean;
  locked: boolean;
  whitelist: boolean;
  pvp: boolean;
  pve: boolean;
  gamemode: number; // 0=survival, 1=creative
  peaceful: boolean;
  maxplayers: number;
  playercount: number;
  mods: boolean;
  // Allow additional unknown fields from the API
  [key: string]: unknown;
}

export interface ServerInfoResponse {
  name: string;
  shortname: string;
  description: string;
  contact: string;
  headerimage: boolean;
}

export interface ServerPlayerListPlayer {
  id: number; // not related to player.id, just the id-slot of currently online players
  name: string; // player name
  uid: string; // player steamid (or standalone-id)
  platform: string; // e.g. 'Steam'
  ping: number;
}

export interface ServerPlayerListResponse {
  playercount: 0;
  players: ServerPlayerListPlayer[];
}
