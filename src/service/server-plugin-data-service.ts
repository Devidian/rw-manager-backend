import type { DbPlayer } from '../interfaces/game-player.js';
import type { WorldServerConfig } from '../interfaces/world-server-config.js';
import {
  getCachedPluginData,
  getFirstCachedPluginData,
  type PluginDataCacheEntry,
} from './plugin-data-cache-service.js';

export function getCachedServerPlayers(serverId?: string): DbPlayer[] {
  const payload = cacheEntry(serverId)?.data['ozadminutils.playerlist'];
  if (!payload || typeof payload !== 'object') return [];
  const players = (payload as { players?: unknown }).players;
  if (!Array.isArray(players)) return [];
  return players.flatMap((player): DbPlayer[] => {
    const normalized = normalizeDbPlayer(player);
    return normalized ? [normalized] : [];
  });
}

export function getCachedServerConfig(serverId?: string): WorldServerConfig {
  const payload = cacheEntry(serverId)?.data['ozadminutils.serverConfig'];
  if (!payload || typeof payload !== 'object') return {};
  const config = (payload as { config?: unknown }).config;
  return config && typeof config === 'object' && !Array.isArray(config)
    ? config as WorldServerConfig
    : {};
}

export function getCachedServerAdminList(serverId?: string): string[] {
  const admins = getCachedServerConfig(serverId).Server_Admins;
  return typeof admins === 'string'
    ? admins.split(';').map((item) => item.trim()).filter(Boolean)
    : [];
}

export function getCachedServerName(serverId?: string): string {
  const name = getCachedServerConfig(serverId).Server_Name;
  return typeof name === 'string' ? name : '';
}

function cacheEntry(serverId?: string): PluginDataCacheEntry | undefined {
  return serverId ? getCachedPluginData(serverId) : getFirstCachedPluginData();
}

function normalizeDbPlayer(value: unknown): DbPlayer | null {
  if (!value || typeof value !== 'object') return null;
  const player = value as Record<string, unknown>;
  const id = numberOrNull(player.id);
  const uid = stringOrNull(player.uid);
  const name = stringOrNull(player.name);
  const posx = numberOrNull(player.posx);
  const posy = numberOrNull(player.posy);
  const posz = numberOrNull(player.posz);
  const rotx = numberOrNull(player.rotx);
  const roty = numberOrNull(player.roty);
  const rotz = numberOrNull(player.rotz);
  const rotw = numberOrNull(player.rotw);
  const platform = platformOrNull(player.platform);
  const permissiongroup = stringOrNull(player.permissiongroup);
  const health = numberOrNull(player.health);
  const hunger = numberOrNull(player.hunger);
  const thirst = numberOrNull(player.thirst);
  const brokenbones = numberOrNull(player.brokenbones);
  const temperature = numberOrNull(player.temperature);
  const dead = numberOrNull(player.dead);
  const flying = numberOrNull(player.flying);
  const lastspawn = numberOrNull(player.lastspawn);
  const lastusedmount = numberOrNull(player.lastusedmount);
  const lastusedvehicle = numberOrNull(player.lastusedvehicle);
  const playtime = numberOrNull(player.playtime);
  const firstseen = numberOrNull(player.firstseen);
  const lastseen = numberOrNull(player.lastseen);
  if (
    id === null ||
    uid === null ||
    name === null ||
    posx === null ||
    posy === null ||
    posz === null ||
    rotx === null ||
    roty === null ||
    rotz === null ||
    rotw === null ||
    platform === null ||
    permissiongroup === null ||
    health === null ||
    hunger === null ||
    thirst === null ||
    brokenbones === null ||
    temperature === null ||
    dead === null ||
    flying === null ||
    lastspawn === null ||
    lastusedmount === null ||
    lastusedvehicle === null ||
    playtime === null ||
    firstseen === null ||
    lastseen === null
  ) return null;
  return {
    id,
    uid,
    name,
    posx,
    posy,
    posz,
    rotx,
    roty,
    rotz,
    rotw,
    platform,
    permissiongroup,
    health,
    hunger,
    thirst,
    brokenbones,
    temperature,
    dead,
    flying,
    ...(typeof player.clothes === 'string' ? { clothes: player.clothes } : {}),
    ...spawnField('primaryspawn', player.primaryspawn),
    ...spawnField('secondaryspawn', player.secondaryspawn),
    ...spawnField('tertiaryspawn', player.tertiaryspawn),
    lastspawn,
    lastusedmount,
    lastusedvehicle,
    playtime,
    firstseen,
    lastseen,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function platformOrNull(value: unknown): string | number | null {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : null;
}

function spawnField(key: 'primaryspawn' | 'secondaryspawn' | 'tertiaryspawn', value: unknown) {
  const spawn = spawnOrNull(value);
  return spawn ? { [key]: spawn } : {};
}

function spawnOrNull(value: unknown): { x: number; y: number; z: number } | null {
  if (!value || typeof value !== 'object') return null;
  const spawn = value as Record<string, unknown>;
  const x = numberOrNull(spawn.x);
  const y = numberOrNull(spawn.y);
  const z = numberOrNull(spawn.z);
  return x === null || y === null || z === null ? null : { x, y, z };
}
