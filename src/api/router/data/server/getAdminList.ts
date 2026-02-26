import { Request, Response } from 'express';
import { db } from '../../../../db/sqlite.js';
import { ServerConfig } from '../../../../utils/server-config.js';

/**
 * method returns all admins as list from server config
 *
 * @export
 * @param {Request} req
 * @param {Response} res
 */
export function getAdminList(req: Request, res: Response) {
    res.json({
        admins: ServerConfig.getProperties(db.rootPath)
            .Server_Admins?.toString()
            .split(';') ?? [],
    });
}
