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
import { getServerStatisticsHandler } from '../handler/get-server-statistics-handler.js';
import { getGlobalStatisticsHandler } from '../handler/get-global-statistics-handler.js';
import { getServerMapHandler } from '../handler/get-server-map-handler.js';
import { listServerPluginsHandler } from '../handler/list-server-plugins-handler.js';
import { getMapLayerCapabilitiesHandler } from '../handler/get-map-layer-capabilities-handler.js';
import { getMapClaimsHandler } from '../handler/get-map-claims-handler.js';
import { getMapPlayersHandler } from '../handler/get-map-players-handler.js';
import { getMapGpsGlobalMarkersHandler } from '../handler/get-map-gps-global-markers-handler.js';
import { getMapMarketplaceOffersHandler } from '../handler/get-map-marketplace-offers-handler.js';
import { getAllPlayersHandler } from '../handler/get-all-players-handler.js';
import { getServerConfigHandler } from '../handler/get-server-config-handler.js';
import { getServerAdminListHandler } from '../handler/get-server-admin-list-handler.js';
import { setServerBlockedHandler } from '../handler/set-server-blocked-handler.js';

const storageRouter = Router();

const noAuth: RequestHandler = (_req, _res, next) => next();
const requireServerGetAuth =
  AppConfig.enableAuth && AppConfig.forceAuth ? requireAuth : noAuth;

storageRouter.get('/server', requireServerGetAuth, listServersHandler);
storageRouter.get('/statistics', requireServerGetAuth, getGlobalStatisticsHandler);
storageRouter.post('/server/refresh-query-data', requireAuth, refreshServerQueryDataHandler);
storageRouter.get('/server/:id/live', requireServerGetAuth, getServerLiveStatusHandler);
storageRouter.get('/server/:id/statistics', requireServerGetAuth, getServerStatisticsHandler);
storageRouter.get('/server/:id/map', requireServerGetAuth, getServerMapHandler);
storageRouter.get('/server/:id/plugins', requireServerGetAuth, listServerPluginsHandler);
storageRouter.get('/server/:id/player', requireServerGetAuth, getAllPlayersHandler);
storageRouter.get('/server/:id/config', requireAuth, getServerConfigHandler);
storageRouter.get('/server/:id/admins', requireServerGetAuth, getServerAdminListHandler);
storageRouter.get('/server/:id/map/layers', requireServerGetAuth, getMapLayerCapabilitiesHandler);
storageRouter.get('/server/:id/map/layers/claims', requireServerGetAuth, getMapClaimsHandler);
storageRouter.get('/server/:id/map/layers/players', requireServerGetAuth, getMapPlayersHandler);
storageRouter.get(
  '/server/:id/map/layers/gps-global-markers',
  requireServerGetAuth,
  getMapGpsGlobalMarkersHandler,
);
storageRouter.get(
  '/server/:id/map/layers/marketplaces/:areaId/offers',
  requireServerGetAuth,
  getMapMarketplaceOffersHandler,
);
storageRouter.post('/server/:id/pin', AppConfig.enableAuth ? requireAuth : noAuth, pinServerHandler);
storageRouter.delete('/server/:id/pin', AppConfig.enableAuth ? requireAuth : noAuth, unpinServerHandler);

if (AppConfig.superAdminId) {
  storageRouter.patch('/server/:id/blocked', requireAuth, setServerBlockedHandler);
  storageRouter.get('/user', requireAuth, listUsersHandler);
  storageRouter.patch('/user/:id', requireAuth, updateStorageUserHandler);
  storageRouter.delete('/user/:id', requireAuth, deleteStorageUserHandler);
}

export default storageRouter;
