import { Router } from 'express';
import { getAllPlayersHandler } from '../handler/get-all-players-handler.js';

const dataPlayerRouter = Router();

dataPlayerRouter.get('/', getAllPlayersHandler);

export default dataPlayerRouter;
