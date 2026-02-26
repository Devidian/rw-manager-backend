import { Request, Response } from 'express';
import { db } from '../../../../db/sqlite.js';

export function getAllPlayers(req: Request, res: Response) {
  res.json({ items: db.getPlayers() });
}
