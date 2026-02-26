import { RequestHandler, Router } from 'express';
import { AppConfig } from '../utils/app-config.js';
import { requireAuth } from './require-auth.js';
import { listServersHandler } from '../handler/list-servers-handler.js';
import { createServerHandler } from '../handler/create-server-handler.js';
import { updateServerHandler } from '../handler/update-server-handler.js';
import { deleteServerHandler } from '../handler/delete-server-handler.js';
import { listUsersHandler } from '../handler/list-users-handler.js';
import { updateStorageUserHandler } from '../handler/update-storage-user-handler.js';
import { deleteStorageUserHandler } from '../handler/delete-storage-user-handler.js';

const storageRouter = Router();

const noAuth: RequestHandler = (_req, _res, next) => next();
const requireServerGetAuth =
  AppConfig.enableAuth && AppConfig.forceAuth ? requireAuth : noAuth;
const requireServerWriteAuth = AppConfig.enableAuth ? requireAuth : noAuth;

storageRouter.get('/server', requireServerGetAuth, listServersHandler);
storageRouter.post('/server', requireServerWriteAuth, createServerHandler);
storageRouter.patch('/server/:id', requireServerWriteAuth, updateServerHandler);
storageRouter.delete('/server/:id', requireServerWriteAuth, deleteServerHandler);

if (AppConfig.superAdminId) {
  storageRouter.get('/user', requireAuth, listUsersHandler);
  storageRouter.patch('/user/:id', requireAuth, updateStorageUserHandler);
  storageRouter.delete('/user/:id', requireAuth, deleteStorageUserHandler);
}

export default storageRouter;
