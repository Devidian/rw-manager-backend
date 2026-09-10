import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapNpcMarketsResponse } from '../dto/get-map-npc-markets-response.js';
import { getMapNpcMarkets } from '../service/map-layer-service.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';
export async function getMapNpcMarketsHandler(req: Request,res: Response) { try { const kind=req.params.kind==='shop-traders'?'shopTraders':req.params.kind==='market-criers'?'marketCriers':null;if(!kind)return res.status(404).json({error:'not_found'});const server=await prepareServerRoute(req);const items=await getMapNpcMarkets(kind,server?.id);const response:GetMapNpcMarketsResponse={schemaVersion:1,available:items!==null,items:items??[]};return res.json(typia.assert<GetMapNpcMarketsResponse>(response));}catch(error){const mapped=serverRouteError(error);return res.status(mapped.status).json({error:mapped.error});} }
