import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => res.json({ ok: true }));

router.use(
  '/player',
  await import('./player/router.js').then((m) => m.default),
);
router.use(
  '/server',
  await import('./server/router.js').then((m) => m.default),
);

export default router;
