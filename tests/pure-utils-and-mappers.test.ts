import { jest } from '@jest/globals';
import type { PrivateUser } from '../src/interfaces/app-user.js';
import type { ServerConfig } from '../src/interfaces/server-config.js';
import {
  mapDateTimeString,
} from '../src/mapper/date-time-mapper.js';
import { mapServerToDto } from '../src/mapper/server-mapper.js';
import {
  mapPrivateUserToDto,
  mapPublicUserToDto,
} from '../src/mapper/user-mapper.js';
import { normalizeSteamId } from '../src/utils/normalize-steam-id.js';
import {
  bufferToPosition,
  parseSpawnPacket,
} from '../src/utils/spawn-packet-decoder.js';

function createSpawnPacketBuffer(endMarker = 0xffff): Buffer {
  const buffer = Buffer.alloc(50);
  buffer.writeFloatLE(1.5, 0);
  buffer.writeFloatLE(2.5, 4);
  buffer.writeFloatLE(3.5, 8);
  buffer.writeFloatLE(4.5, 16);
  buffer.writeFloatLE(10, 24);
  buffer.writeFloatLE(20, 28);
  buffer.writeFloatLE(30, 32);
  buffer.writeUInt32LE(11, 36);
  buffer.writeUInt32LE(2, 40);
  buffer.writeUInt32LE(99, 44);
  buffer.writeUInt16LE(endMarker, 48);
  return buffer;
}

describe('pure utils and mappers', () => {
  test('mapDateTimeString converts Date instances to ISO strings', () => {
    const value = new Date('2024-01-01T12:00:00.000Z');

    expect(mapDateTimeString(value)).toBe('2024-01-01T12:00:00.000Z');
  });

  test('mapDateTimeString normalizes valid date strings and preserves invalid ones', () => {
    expect(mapDateTimeString('2024-01-01T12:00:00Z')).toBe(
      '2024-01-01T12:00:00.000Z',
    );
    expect(mapDateTimeString('not-a-date')).toBe('not-a-date');
  });

  test('user mappers convert domain users into dto shapes', () => {
    const user: PrivateUser = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'verified',
      role: 'admin',
      steamId: '76561198000000000',
      createdAt: new Date('2024-05-06T07:08:09.000Z'),
    };

    expect(mapPublicUserToDto(user)).toEqual({
      id: 'user-1',
      username: 'alice',
      state: 'verified',
      role: 'admin',
      steamId: '76561198000000000',
      createdAt: '2024-05-06T07:08:09.000Z',
    });

    expect(mapPrivateUserToDto(user)).toEqual({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'verified',
      role: 'admin',
      steamId: '76561198000000000',
      createdAt: '2024-05-06T07:08:09.000Z',
    });
  });

  test('mapServerToDto converts a server config into a server dto', () => {
    const server: ServerConfig = {
      id: 'server-1',
      label: 'Primary Server',
      queryUrl: 'https://query.example.com',
      backendUrl: 'https://backend.example.com',
      blocked: true,
      blockedAt: new Date('2024-01-02T00:00:00.000Z'),
      public: true,
      userId: 'user-1',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    expect(mapServerToDto(server)).toEqual({
      id: 'server-1',
      label: 'Primary Server',
      queryUrl: 'https://query.example.com',
      backendUrl: 'https://backend.example.com',
      status: 'unknown',
      blocked: true,
      blockedAt: '2024-01-02T00:00:00.000Z',
      public: true,
      userId: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
  });

  test('mapServerToDto includes cached live status fields', () => {
    const server: ServerConfig = {
      id: 'server-1',
      label: 'Primary Server',
      steamId: '76561198000000000',
      addr: '127.0.0.1:4255',
      version: '2026062601',
      name: 'Primary Server',
      ip: '127.0.0.1',
      port: 4255,
      region: 'EU',
      gm: 0,
      mods: false,
      password: false,
      whitelist: true,
      adminUid: '76561198000000001',
      queryUrl: 'https://query.example.com',
      data: { playercount: 2 },
      info: { shortname: 'Primary' },
      onlinePlayers: [{ uid: 'player-1' }],
      lastChecked: new Date('2024-01-01T00:00:00.000Z'),
      errorMessage: 'cached warning',
      public: true,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    expect(mapServerToDto(server)).toMatchObject({
      steamId: '76561198000000000',
      addr: '127.0.0.1:4255',
      version: '2026062601',
      name: 'Primary Server',
      ip: '127.0.0.1',
      port: 4255,
      region: 'EU',
      gm: 0,
      mods: false,
      password: false,
      whitelist: true,
      adminUid: '76561198000000001',
      status: 'online',
      queryData: { playercount: 2 },
      infoData: { shortname: 'Primary' },
      onlinePlayers: [{ uid: 'player-1' }],
      lastChecked: '2024-01-01T00:00:00.000Z',
      errorMessage: 'cached warning',
    });
  });

  test('mapServerToDto preserves explicit status and optional date fields', () => {
    const server: ServerConfig = {
      id: 'server-2',
      label: 'Secondary Server',
      mapUrl: 'https://map.example.com',
      status: 'offline',
      firstSeen: new Date('2024-01-02T00:00:00.000Z'),
      lastSeen: new Date('2024-01-03T00:00:00.000Z'),
      queryDataUpdatedAt: new Date('2024-01-04T00:00:00.000Z'),
      public: false,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    expect(mapServerToDto(server)).toMatchObject({
      status: 'offline',
      mapUrl: 'https://map.example.com',
      backendUrl: undefined,
      firstSeen: '2024-01-02T00:00:00.000Z',
      lastSeen: '2024-01-03T00:00:00.000Z',
      queryDataUpdatedAt: '2024-01-04T00:00:00.000Z',
    });
  });

  test('mapServerToDto drops invalid optional metadata from stored servers', () => {
    const server: ServerConfig = {
      id: 'server-3',
      label: 'Imported Server',
      queryUrl: 'https://query.example.com',
      addr: 123 as unknown as string,
      port: Number.NaN,
      gm: Number.POSITIVE_INFINITY,
      region: 7 as unknown as string,
      mods: 'false' as unknown as boolean,
      password: true,
      whitelist: false,
      mapUrl: '   ',
      backendUrl: 'also-not-a-url',
      errorMessage: { message: 'bad shape' } as unknown as string,
      onlinePlayers: { players: [] } as unknown as unknown[],
      public: true,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    expect(mapServerToDto(server)).toMatchObject({
      id: 'server-3',
      addr: undefined,
      port: undefined,
      gm: undefined,
      region: undefined,
      mods: undefined,
      password: true,
      whitelist: false,
      mapUrl: undefined,
      backendUrl: undefined,
      errorMessage: undefined,
      onlinePlayers: undefined,
    });
  });

  test('normalizeSteamId accepts trimmed uint64 values and rejects invalid input', () => {
    expect(normalizeSteamId(' 76561198000000000 ')).toBe(
      '76561198000000000',
    );
    expect(normalizeSteamId('abc')).toBeNull();
    expect(normalizeSteamId(123)).toBeNull();
    expect(normalizeSteamId('18446744073709551616')).toBeNull();
  });

  test('parseSpawnPacket decodes a binary packet', () => {
    expect(parseSpawnPacket(createSpawnPacketBuffer())).toEqual({
      transform: { a: 1.5, b: 2.5, c: 3.5, w: 4.5 },
      position: { x: 10, y: 20, z: 30 },
      entityId: 11,
      spawnType: 2,
      playerId: 99,
    });
  });

  test('parseSpawnPacket validates inputs and buffer size', () => {
    expect(() => parseSpawnPacket('bad' as unknown as Buffer)).toThrow(
      'Input must be a Buffer',
    );
    expect(() => parseSpawnPacket(Buffer.alloc(10))).toThrow(
      'Buffer too short to be a valid spawn packet',
    );
  });

  test('parseSpawnPacket warns on missing marker and bufferToPosition extracts positions', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const buffer = createSpawnPacketBuffer(0x0000);

    expect(bufferToPosition(buffer)).toEqual({ x: 10, y: 20, z: 30 });
    expect(bufferToPosition(undefined)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'Spawn packet missing expected FFFF end marker.',
    );

    warnSpy.mockRestore();
  });
});
