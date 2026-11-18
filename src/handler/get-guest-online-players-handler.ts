import type { Request, Response } from 'express';
import { findServerById } from '../db/manager-store.js';
import { hasToolsPlayerStatus, readPublicOnlinePlayerNames } from '../service/public-online-player-service.js';

/** Read through only. Public player identities never enter Manager storage. */
export async function getGuestOnlinePlayersHandler(req: Request, res: Response) {
  const server = await findServerById(String(req.params.id));
  if (!server?.queryUrl || server.blocked) return res.status(404).json({ error: 'SERVER_NOT_FOUND' });
  res.setHeader('Cache-Control', 'no-store');
  const fallback = req.query?.fallback === '1';
  if (fallback && await hasToolsPlayerStatus(server.id)) return res.status(204).end();
  const names = await readPublicOnlinePlayerNames(server);
  if (names === null) return res.status(502).json({ error: 'PLAYERLIST_UNAVAILABLE' });
  if (fallback && await hasToolsPlayerStatus(server.id)) return res.status(204).end();
  return res.json({ count: names.length, names });
}
