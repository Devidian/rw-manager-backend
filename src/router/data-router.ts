import { Router } from 'express';
import { getAllPlayersHandler } from '../handler/get-all-players-handler.js';

const dataRouter = Router();

dataRouter.get('/', (_req, res) => res.json({ ok: true }));
dataRouter.get('/:id/player', getAllPlayersHandler);
dataRouter.use('/player', await import('./data-player-router.js').then((module) => module.default));
dataRouter.use('/', await import('./data-server-router.js').then((module) => module.default));

export default dataRouter;
