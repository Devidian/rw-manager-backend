import { Router } from 'express';

const dataRouter = Router();

dataRouter.get('/', (_req, res) => res.json({ ok: true }));
dataRouter.use('/player', await import('./data-player-router.js').then((module) => module.default));
dataRouter.use('/', await import('./data-server-router.js').then((module) => module.default));

export default dataRouter;
