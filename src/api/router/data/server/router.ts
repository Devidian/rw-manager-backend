import { Router } from 'express';
import { requireAuth } from '../../../guards/require-auth.js';
import { getServerConfig } from './getServerConfig.js';
import { getServerName } from './getServerName.js';
import { getAdminList } from './getAdminList.js';

const router = Router();

router.get('/server/config', requireAuth, getServerConfig);
router.get('/server/admins', getAdminList);
router.get('/server/name', getServerName);

export default router;
