// mongosh script for six stale records recreated by an in-flight refresh after the confirmed merge.
// Preview by default; set CLEANUP_APPLY=1 after backend 0.9.0-rc.3 is healthy.
const database = db.getSiblingDB('rw-manager');
const targetId = 'server-bde398bff6ffa12d58aa4b01';
const expectedIds = [
  'server-0e0bca93db15de126440c921',
  'server-2f53e914bdfe778670657cae',
  'server-51af3c73fc472f01308743a0',
  'server-6d123436e42248c182ccd5a5',
  'server-9cdd63709a79bb6b454400ae',
  'server-f5322101fab0ec107c5b37c5',
];
const target = database.servers.findOne({ id: targetId });
if (!target || !expectedIds.every((id) => target.alternateIds?.includes(id))) {
  throw new Error('Expected aliases are missing from the canonical server');
}
const records = database.servers.find({ id: { $in: expectedIds } }).toArray();
if (records.length !== expectedIds.length || records.some((record) =>
  record.status !== 'offline' || new Date(record.lastSeen).getTime() > Date.parse('2026-11-10T08:47:09Z')
  || (record.knownPlayers?.length ?? 0) > 0)) {
  throw new Error('Alias records changed or are not the expected stale records');
}
if (database.users.countDocuments({ pinnedServers: { $in: expectedIds } }) > 0
  || database.server_statistics.countDocuments({ serverId: { $in: expectedIds } }) > 0) {
  throw new Error('Alias records have favorites or statistics; cleanup stopped');
}
print(JSON.stringify({ mode: process.env.CLEANUP_APPLY === '1' ? 'apply' : 'preview', targetId, staleRecords: records.length }));
if (process.env.CLEANUP_APPLY === '1') {
  const session = db.getMongo().startSession();
  try {
    session.withTransaction(() => {
      const current = session.getDatabase('rw-manager');
      if (current.users.countDocuments({ pinnedServers: { $in: expectedIds } }) > 0
        || current.server_statistics.countDocuments({ serverId: { $in: expectedIds } }) > 0) {
        throw new Error('Alias records gained favorites or statistics');
      }
      const result = current.servers.deleteMany({
        _id: { $in: records.map((record) => record._id) },
        id: { $in: expectedIds }, status: 'offline',
        lastSeen: { $lte: ISODate('2026-11-10T08:47:09Z') },
      });
      if (result.deletedCount !== expectedIds.length) throw new Error('Unexpected cleanup delete count');
    });
  } finally { session.endSession(); }
  print(JSON.stringify({ verified: database.servers.countDocuments({ id: { $in: expectedIds } }) === 0 }));
}
