import { Router } from 'express';
import { getAllPlayers } from './getAllPlayers.js';

const router = Router();

router.get('/', getAllPlayers);

export default router;
