import { Request, Response } from 'express';
import { db } from '../../../../db/sqlite.js';
import { ServerConfig } from '../../../../utils/server-config.js';

export function getServerName(req: Request, res: Response) {
    res.json({
        name: ServerConfig.getProperties(db.rootPath).Server_Name?.toString() ?? '',
    });
}
