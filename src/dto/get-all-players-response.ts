import type { DbPlayer } from '../interfaces/game-player.js';

export interface GetAllPlayersResponse {
  items: DbPlayer[];
}
