import { Router } from 'express';
import { AppConfig } from '../utils/app-config.js';

const router = Router();

router.get('/', (req, res) => res.json({ ok: true }));

if (AppConfig.enableAuth) {
  const { authMiddleware } = await import('./utils/index.js');
  router.use(...authMiddleware);
  router.use(
    '/auth',
    await import('./router/auth/router.js').then((m) => m.default),
  );
}

if (AppConfig.enableStorage)
  router.use(
    '/storage',
    await import('./router/storage/router.js').then((m) => m.default),
  );
if (AppConfig.enableData)
  router.use(
    '/data',
    await import('./router/data/router.js').then((m) => m.default),
  );

export default router;
