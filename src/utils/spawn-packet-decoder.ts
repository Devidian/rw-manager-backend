export interface SpawnPacket {
  transform: {
    a: number;
    b: number;
    c: number;
    w: number;
  };
  position: {
    x: number;
    y: number;
    z: number;
  };
  entityId: number;
  spawnType: number; // 2 = Primary, 1/3 = Secondary
  playerId: number;
}

export function parseSpawnPacket(buffer: Buffer): SpawnPacket {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Input must be a Buffer');
  }

  if (buffer.length < 50) {
    throw new Error('Buffer too short to be a valid spawn packet');
  }

  // Header / Transform-Matrix-Teile
  const a = buffer.readFloatLE(0);
  const b = buffer.readFloatLE(4);
  const c = buffer.readFloatLE(8);

  // Skip 12–15 (uint32)
  const w = buffer.readFloatLE(16);

  // Position / XYZ
  const x = buffer.readFloatLE(24);
  const y = buffer.readFloatLE(28);
  const z = buffer.readFloatLE(32);

  // IDs
  const entityId = buffer.readUInt32LE(36);
  const spawnType = buffer.readUInt32LE(40);
  const playerId = buffer.readUInt32LE(44);

  // Optional: Check end marker
  const endMarker = buffer.readUInt16LE(48);
  if (endMarker !== 0xffff) {
    console.warn('Spawn packet missing expected FFFF end marker.');
  }

  return {
    transform: { a, b, c, w },
    position: { x, y, z },
    entityId,
    spawnType,
    playerId,
  };
}

export function bufferToPosition(
  buffer: Buffer,
): SpawnPacket['position'] | undefined {
  if (!buffer) return undefined;
  return parseSpawnPacket(buffer).position;
}
