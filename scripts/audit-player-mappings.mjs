import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE ?? 'rw-manager';
if (!uri) throw new Error('MONGODB_URI is required');

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
const stableUid = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const uid = value.uid ?? value.UID;
  if (typeof uid !== 'string' || !uid.trim() || uid === '**PRIVATE**') return undefined;
  return typeof value.id === 'number' && uid.trim() === String(value.id) ? undefined : uid.trim();
};

try {
  await client.connect();
  const db = client.db(databaseName);
  const allUids = new Set();
  const allRefs = new Set();
  const uidToId = new Map();
  const mappedIds = new Set();
  for await (const mapping of db.collection('player_mappings').find({}, { projection: { uid: 1 } })) {
    if (typeof mapping.uid === 'string') uidToId.set(mapping.uid, String(mapping._id));
    mappedIds.add(String(mapping._id));
  }
  const counts = { servers: 0, knownPlayers: 0, onlinePlayers: 0, statisticBuckets: 0,
    statisticPlayerUids: 0, missingPlayerRefs: 0, wrongPlayerRefs: 0,
    missingStatisticRefs: 0, wrongStatisticRefs: 0 };
  for await (const server of db.collection('servers').find({}, { projection: { knownPlayers: 1, onlinePlayers: 1 } })) {
    counts.servers += 1;
    for (const [field, counter] of [['knownPlayers', 'knownPlayers'], ['onlinePlayers', 'onlinePlayers']]) {
      for (const player of Array.isArray(server[field]) ? server[field] : []) {
        counts[counter] += 1;
        const uid = stableUid(player);
        if (!uid) continue;
        allUids.add(uid);
        const ref = player.playerMappingId;
        if (typeof ref === 'string' && /^[a-f\d]{24}$/i.test(ref)) allRefs.add(ref);
        else counts.missingPlayerRefs += 1;
        if (ref && uidToId.has(uid) && ref !== uidToId.get(uid)) counts.wrongPlayerRefs += 1;
      }
    }
  }
  for await (const bucket of db.collection('server_statistics').find({}, { projection: { onlinePlayerUids: 1, onlinePlayerIds: 1 } })) {
    counts.statisticBuckets += 1;
    const uids = Array.isArray(bucket.onlinePlayerUids) ? bucket.onlinePlayerUids.filter((uid) => typeof uid === 'string' && uid.trim()) : [];
    counts.statisticPlayerUids += uids.length;
    uids.forEach((uid) => allUids.add(uid));
    const ids = Array.isArray(bucket.onlinePlayerIds) ? bucket.onlinePlayerIds.filter((id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)) : [];
    ids.forEach((id) => allRefs.add(id));
    const expected = new Set(uids.map((uid) => uidToId.get(uid)).filter(Boolean));
    const actual = new Set(ids);
    if ([...expected].some((id) => !actual.has(id))) counts.missingStatisticRefs += 1;
    if (actual.size !== ids.length || [...actual].some((id) => !expected.has(id))) counts.wrongStatisticRefs += 1;
  }
  console.log(JSON.stringify({ database: databaseName, ...counts, uniqueStableUids: allUids.size,
    mappings: mappedIds.size, unmappedUids: [...allUids].filter((uid) => !uidToId.has(uid)).length,
    orphanedReferences: [...allRefs].filter((id) => !mappedIds.has(id)).length }, null, 2));
} finally {
  await client.close();
}
