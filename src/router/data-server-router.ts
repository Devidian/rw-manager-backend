import { Router } from 'express';
import { requireAuth } from './require-auth.js';
import { getServerConfigHandler } from '../handler/get-server-config-handler.js';
import { getServerAdminListHandler } from '../handler/get-server-admin-list-handler.js';
import { getServerNameHandler } from '../handler/get-server-name-handler.js';

const dataServerRouter = Router();

dataServerRouter.get('/server/config', requireAuth, getServerConfigHandler);
dataServerRouter.get('/server/admins', getServerAdminListHandler);
dataServerRouter.get('/server/name', getServerNameHandler);

export default dataServerRouter;
