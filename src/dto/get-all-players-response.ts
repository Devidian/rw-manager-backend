import type { DbPlayer } from '../interfaces/game-player.js';

export type ApiPlayer = Omit<DbPlayer, 'id'> & { id?: string | number; slotId?: number };

export interface GetAllPlayersResponse {
  items: ApiPlayer[];
}
