import type { Request, Response } from 'express';
import {
  InvalidMapTileRequestError,
  resolveMapTile,
} from '../service/map-service.js';

interface MapTileRequestParams {
  worldKey: string;
  z: string;
  x: string;
  fileName: string;
}

export async function getServerMapTileHandler(
  req: Request<MapTileRequestParams>,
  res: Response,
) {
  try {
    if (!req.params.fileName.endsWith('.png')) {
      throw new InvalidMapTileRequestError('Only PNG tiles are supported');
    }
    const tile = await resolveMapTile(
      req.params.worldKey,
      req.params.z,
      req.params.x,
      req.params.fileName.slice(0, -4),
    );
    if (tile === null) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    res.type('png');
    return res.sendFile(tile);
  } catch (error) {
    if (error instanceof InvalidMapTileRequestError) {
      return res.status(400).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(500).json({ error: message });
  }
}
