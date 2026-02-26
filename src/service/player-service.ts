import { db } from '../db/sqlite.js';
import type { DbPlayer } from '../interfaces/game-player.js';

export function getAllPlayers(): DbPlayer[] {
  return db.getPlayers();
}
