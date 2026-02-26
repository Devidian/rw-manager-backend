import { Router } from 'express';
import { AppConfig } from '../utils/app-config.js';

const router = Router();

router.get('/', (_req, res) => res.json({ ok: true }));

if (AppConfig.enableAuth) {
  const { authMiddleware } = await import('../service/auth-token-service.js');
  router.use(...authMiddleware);
  router.use(
    '/auth',
    await import('./auth-router.js').then((module) => module.default),
  );
}

if (AppConfig.enableStorage) {
  router.use(
    '/storage',
    await import('./storage-router.js').then((module) => module.default),
  );
}

if (AppConfig.enableData) {
  router.use(
    '/data',
    await import('./data-router.js').then((module) => module.default),
  );
}

export default router;
