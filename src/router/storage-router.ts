import { RequestHandler, Router } from 'express';
import { AppConfig } from '../utils/app-config.js';
import { requireAuth } from './require-auth.js';
import { listServersHandler } from '../handler/list-servers-handler.js';
import { listUsersHandler } from '../handler/list-users-handler.js';
import { updateStorageUserHandler } from '../handler/update-storage-user-handler.js';
import { deleteStorageUserHandler } from '../handler/delete-storage-user-handler.js';
import { pinServerHandler } from '../handler/pin-server-handler.js';
import { unpinServerHandler } from '../handler/unpin-server-handler.js';
import { refreshServerQueryDataHandler } from '../handler/refresh-server-query-data-handler.js';
import { getServerLiveStatusHandler } from '../handler/get-server-live-status-handler.js';

const storageRouter = Router();

const noAuth: RequestHandler = (_req, _res, next) => next();
const requireServerGetAuth =
  AppConfig.enableAuth && AppConfig.forceAuth ? requireAuth : noAuth;

storageRouter.get('/server', requireServerGetAuth, listServersHandler);
storageRouter.post('/server/refresh-query-data', requireAuth, refreshServerQueryDataHandler);
storageRouter.get('/server/:id/live', requireServerGetAuth, getServerLiveStatusHandler);
storageRouter.post('/server/:id/pin', AppConfig.enableAuth ? requireAuth : noAuth, pinServerHandler);
storageRouter.delete('/server/:id/pin', AppConfig.enableAuth ? requireAuth : noAuth, unpinServerHandler);

if (AppConfig.superAdminId) {
  storageRouter.get('/user', requireAuth, listUsersHandler);
  storageRouter.patch('/user/:id', requireAuth, updateStorageUserHandler);
  storageRouter.delete('/user/:id', requireAuth, deleteStorageUserHandler);
}

export default storageRouter;
