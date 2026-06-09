import { decodeBlock } from 'lz4';
import fs from 'node:fs/promises';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import lz4napi from 'lz4-napi';
import { basename } from 'node:path';

const TILE_SIZE = 1024;
const BYTES_PER_PIXEL = 4;

const LZ4_MAGIC = Buffer.from([0x04, 0x22, 0x4d, 0x18]);

export interface SplitResult {
  heightmap: Buffer;
  biomemap: Buffer;
}

export async function splitCombinedFile(
  inputPath: string,
): Promise<SplitResult> {
  const file = await fs.readFile(inputPath);

  const positions: number[] = [];

  for (let i = 0; i < file.length - 4; i++) {
    if (
      file[i] === LZ4_MAGIC[0] &&
      file[i + 1] === LZ4_MAGIC[1] &&
      file[i + 2] === LZ4_MAGIC[2] &&
      file[i + 3] === LZ4_MAGIC[3]
    ) {
      positions.push(i);
    }
  }

  if (positions.length < 2) {
    throw new Error('Expected at least two LZ4 frames in file.');
  }

  const heightmapFrame = file.subarray(positions[0], positions[1]);

  const biomemapFrame = file.subarray(positions[1]);

  return {
    heightmap: heightmapFrame,
    biomemap: biomemapFrame,
  };
}

export async function test(
  inputPath: string,
  outputPath: string,
): Promise<number> {
  // const { heightmap, biomemap } =
  //     await splitCombinedFile(inputPath);
  const file = await fs.readFile(inputPath);
  console.log(`File size: ${file.length} bytes`);
  //   for (let i = 0; i < 12; i += 1) {
  //     console.log({
  //       [`${i * 4}-UI32`]: file.readUInt32LE(i * 4),
  //       [`${i * 4}-UI16`]: file.readUInt16LE(i * 2),
  //     });
  //   }

  const targetLength = file.readUInt32LE(0);
  console.log({ targetLength });

  let total = 0;
  let currentVal = 0;
  let offset = 4;
  do {
    currentVal = file.readUint8(offset++);
    total += currentVal;
    console.log({ currentVal, total });
  } while (currentVal == 255 || offset < 8);

  try {
    const uncompressed = await lz4napi.uncompress(file);
    console.log(`Uncompressed size: ${uncompressed.length} bytes`);
    writeFileSync(basename(inputPath) + '.raw', uncompressed);
  } catch (error) {}

  // const hm = await lz4napi.decompressFrame(file);

  // const hm = await lz4napi.uncompress(heightmap);
  // const bm = await lz4napi.uncompress(biomemap);

  // console.log("Heightmap size:", hm.length);
  // console.log("Biomemap size:", bm.length);

  //   writeFileSync(basename(outputPath) + '.raw',uncompressed);
  // to png
  //   const png = new PNG({
  //     width: TILE_SIZE,
  //     height: TILE_SIZE,
  //   });

  //   uncompressed.copy(png.data);
  //   await new Promise<void>((resolve, reject) => {
  //     png
  //       .pack()
  //       .pipe(createWriteStream(outputPath))
  //       .on('finish', resolve)
  //       .on('error', reject);
  //   });

  console.log('✔ Converted:', outputPath);
  return file.length;
}

export async function anal() {
  const a = await test('/appdata/rwman/response.bin', '');
  const b = await test(
    '/appdata/rising-world/dedicated-server/Worlds/Land of OZ/Map/0_0.biomes',
    '',
  );
  const c = await test(
    '/appdata/rising-world/dedicated-server/Worlds/Land of OZ/Map/0_0.tile',
    '',
  );

  console.log(b + c, '=', a);

  const heightmap =readRawHeightmap('0_0.tile.raw', 1024, 1024);
  saveHeightmapAsPNG(heightmap, '0_0.tile.hm.png');

  convertTile(
    '/appdata/rising-world/dedicated-server/Worlds/Land of OZ/Map/0_0.tile',
    '0_0.tile.png',
  );
  convertTile(
    '/appdata/rising-world/dedicated-server/Worlds/Land of OZ/Map/0_0.biomes',
    '0_0.biomes.png',
    256,
  );
}

export async function convertTile(
  inputPath: string,
  outputPath: string,
  size: number = TILE_SIZE,
): Promise<void> {
  const file = await fs.readFile(inputPath);

  const buffer = await lz4napi.uncompress(file);

  const png = new PNG({
    width: size,
    height: size,
  });

  buffer.copy(png.data);

  await new Promise<void>((resolve, reject) => {
    png
      .pack()
      .pipe(createWriteStream(outputPath))
      .on('finish', resolve)
      .on('error', reject);
  });

  console.log('✔ Converted:', outputPath);
}

export async function convertTileToPNG(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const file = await fs.readFile(inputPath);

  const totalUncompressedSize = file.readUInt32LE(0);
  const totalCompressedSize = file.readUInt32LE(4);

  const expectedSize = TILE_SIZE * TILE_SIZE * BYTES_PER_PIXEL;

  if (totalUncompressedSize !== expectedSize) {
    throw new Error('Unexpected total uncompressed size');
  }

  let offset = 8;

  const outputBuffer = Buffer.allocUnsafe(totalUncompressedSize);
  let outputOffset = 0;

  while (offset < file.length) {
    const compressedChunkSize = file.readUInt32LE(offset);
    const uncompressedChunkSize = file.readUInt32LE(offset + 4);

    offset += 8;

    const compressedChunk = file.subarray(offset, offset + compressedChunkSize);

    const tempBuffer = Buffer.allocUnsafe(uncompressedChunkSize);

    const decodedSize = decodeBlock(compressedChunk, tempBuffer);

    if (decodedSize !== uncompressedChunkSize) {
      throw new Error(
        `Chunk decode failed: ${decodedSize} vs ${uncompressedChunkSize}`,
      );
    }

    tempBuffer.copy(outputBuffer, outputOffset);

    outputOffset += uncompressedChunkSize;
    offset += compressedChunkSize;
  }

  if (outputOffset !== totalUncompressedSize) {
    throw new Error('Final size mismatch after chunk assembly');
  }

  const png = new PNG({
    width: TILE_SIZE,
    height: TILE_SIZE,
  });

  outputBuffer.copy(png.data);

  await new Promise<void>((resolve, reject) => {
    png
      .pack()
      .pipe(createWriteStream(outputPath))
      .on('finish', resolve)
      .on('error', reject);
  });

  console.log('✔ Converted:', outputPath);
}

/**
 * Reads a 32-bit float RAW file and converts it into a 2D heightmap array
 * @param filePath Path to the .raw file
 * @param width Width of the heightmap
 * @param height Height of the heightmap
 * @returns 2D array of floats [row][col]
 */
function readRawHeightmap(filePath: string, width: number, height: number): number[][] {
    const buffer = readFileSync(filePath);

    // 32-bit float = 4 bytes per pixel
    if (buffer.length !== width * height * 4) {
        throw new Error(`File size does not match expected dimensions: ${width}x${height}`);
    }

    const heightmap: number[][] = [];
    let offset = 0;

    for (let y = 0; y < height; y++) {
        const row: number[] = [];
        for (let x = 0; x < width; x++) {
            const value = buffer.readFloatLE(offset); // assuming little-endian
            row.push(value);
            offset += 4;
        }
        heightmap.push(row);
    }

    return heightmap;
}

/**
 * Converts a 2D heightmap to a grayscale PNG file
 * @param heightmap 2D array of floats [row][col]
 * @param outputFile Path to save the PNG
 */
function saveHeightmapAsPNG(heightmap: number[][], outputFile: string) {
    const height = heightmap.length;
    const width = heightmap[0].length;

    // Find min and max to normalize
    let min = Infinity;
    let max = -Infinity;
    for (const row of heightmap) {
        for (const val of row) {
            if (val < min) min = val;
            if (val > max) max = val;
        }
    }

    const png = new PNG({ width, height });

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Normalize to 0-255
            const normalized = Math.floor(((heightmap[y][x] - min) / (max - min)) * 255);
            const idx = (y * width + x) << 2; // RGBA index
            png.data[idx] = normalized;       // R
            png.data[idx + 1] = normalized;   // G
            png.data[idx + 2] = normalized;   // B
            png.data[idx + 3] = 255;          // A
        }
    }

    const buffer = PNG.sync.write(png);
    writeFileSync(outputFile, buffer);
    console.log(`PNG saved to ${outputFile}`);
}