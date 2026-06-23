import { Router } from 'express';
import { requireAuth } from './require-auth.js';
import { getServerConfigHandler } from '../handler/get-server-config-handler.js';
import { getServerAdminListHandler } from '../handler/get-server-admin-list-handler.js';
import { getServerNameHandler } from '../handler/get-server-name-handler.js';
import { listServerPluginsHandler } from '../handler/list-server-plugins-handler.js';
import { getServerMapHandler } from '../handler/get-server-map-handler.js';
import { getServerMapTileHandler } from '../handler/get-server-map-tile-handler.js';
import { getMapLayerCapabilitiesHandler } from '../handler/get-map-layer-capabilities-handler.js';
import { getMapClaimsHandler } from '../handler/get-map-claims-handler.js';
import { getMapPlayersHandler } from '../handler/get-map-players-handler.js';
import {
  getMapGpsGlobalMarkersHandler,
} from '../handler/get-map-gps-global-markers-handler.js';
import { getMapMarketplaceOffersHandler } from '../handler/get-map-marketplace-offers-handler.js';

const dataServerRouter = Router();

dataServerRouter.get('/server/config', requireAuth, getServerConfigHandler);
dataServerRouter.get('/server/admins', getServerAdminListHandler);
dataServerRouter.get('/server/name', getServerNameHandler);
dataServerRouter.get('/server/plugins', listServerPluginsHandler);
dataServerRouter.get('/server/map', getServerMapHandler);
dataServerRouter.get('/server/map/layers', getMapLayerCapabilitiesHandler);
dataServerRouter.get('/server/map/layers/claims', getMapClaimsHandler);
dataServerRouter.get('/server/map/layers/players', getMapPlayersHandler);
dataServerRouter.get('/server/map/layers/gps-global-markers', getMapGpsGlobalMarkersHandler);
dataServerRouter.get(
  '/server/map/layers/marketplaces/:areaId/offers',
  getMapMarketplaceOffersHandler,
);
dataServerRouter.get(
  '/server/map/tiles/:worldKey/:z/:x/:fileName',
  getServerMapTileHandler,
);

export default dataServerRouter;
