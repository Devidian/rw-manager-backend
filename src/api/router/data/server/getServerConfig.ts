import { Request, Response } from 'express';
import { db } from '../../../../db/sqlite.js';
import { ServerConfig } from '../../../../utils/server-config.js';

export async function getServerConfig(req: Request, res: Response) {
    res.json({ config: ServerConfig.getProperties(db.rootPath) });
}
