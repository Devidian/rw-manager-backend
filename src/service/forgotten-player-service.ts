import { listServers } from '../db/manager-store.js';
import { getMongoCollections } from '../db/mongodb.js';
import { forgetPlayerStatistics } from '../db/server-statistics-store.js';
import { mappingByUids } from './player-identity-service.js';

/** Runs after an authoritative, consent-filtered plugin export removed a player. */
export async function forgetPlayerFromServer(serverId: string, uid: string): Promise<void> {
  const mapping = (await mappingByUids([uid])).get(uid);
  await forgetPlayerStatistics(serverId, uid, mapping?._id.toHexString());
  const stillExported = (await listServers()).some((server) =>
    server.knownPlayers?.some((player) => player.uid === uid));
  if (!stillExported) await getMongoCollections()?.playerMappings.deleteOne({ uid });
}
