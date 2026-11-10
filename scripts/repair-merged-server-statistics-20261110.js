// mongosh script for the confirmed 2026-11-10 merge. Restored backup namespace is read-only.
// Run without REPAIR_APPLY for a preview; set REPAIR_APPLY=1 only after a fresh backup.
const targetId = 'server-bde398bff6ffa12d58aa4b01';
const live = db.getSiblingDB('rw-manager');
const backup = db.getSiblingDB('rw-manager-duplicate-audit-20261110');
const target = live.servers.findOne({ id: targetId });
if (!target || !Array.isArray(target.alternateIds) || target.alternateIds.length !== 19) {
  throw new Error('Unexpected target or alias set; repair stopped');
}
const ids = [targetId, ...target.alternateIds];
if (backup.servers.countDocuments({ id: { $in: ids } }) !== ids.length) {
  throw new Error('Backup does not contain every merged source; repair stopped');
}
const saved = backup.server_statistics.find({ serverId: { $in: ids } }).toArray();
const current = live.server_statistics.find({ serverId: { $in: ids } }).toArray();
if (saved.length < 4500 || current.length < 450) throw new Error('Unexpected bucket count; repair stopped');

const byHour = new Map();
for (const bucket of [...saved, ...current]) {
  if (!byHour.has(bucket.hourStart)) byHour.set(bucket.hourStart, []);
  byHour.get(bucket.hourStart).push(bucket);
}
function preference(a, b) {
  const availability = (x) => x.sampleCount > 0 ? x.onlineSampleCount / x.sampleCount : 0;
  return availability(a) - availability(b) || a.maxPlayers - b.maxPlayers
    || a.sampleCount - b.sampleCount || String(a.updatedAt).localeCompare(String(b.updatedAt));
}
const merged = [...byHour.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hourStart, entries]) => {
  const best = entries.reduce((a, b) => preference(b, a) > 0 ? b : a);
  const maxPlayers = Math.max(...entries.map((entry) => entry.maxPlayers || 0));
  const playerSampleTotal = Math.max(...entries.map((entry) => entry.playerSampleTotal || 0));
  const { _id, ...withoutMongoId } = best;
  return {
    ...withoutMongoId, id: `${targetId}:${hourStart}`, serverId: targetId,
    maxPlayers, playerSampleTotal,
    averagePlayers: best.sampleCount > 0 ? playerSampleTotal / best.sampleCount : 0,
    availability: best.sampleCount > 0 ? best.onlineSampleCount / best.sampleCount * 100 : 0,
    onlinePlayerUids: [...new Set(entries.flatMap((entry) => entry.onlinePlayerUids || []))],
  };
});
const summary = {
  targetId, sourceIds: ids.length - 1, backupBuckets: saved.length,
  currentBuckets: current.length, mergedHours: merged.length,
  onlineHours: merged.filter((bucket) => bucket.onlineSampleCount > 0).length,
  uniquePlayerUids: new Set(merged.flatMap((bucket) => bucket.onlinePlayerUids)).size,
};
print(JSON.stringify({ mode: process.env.REPAIR_APPLY === '1' ? 'apply' : 'preview', ...summary }));
if (process.env.REPAIR_APPLY === '1') {
  const session = db.getMongo().startSession();
  try {
    session.withTransaction(() => {
      const collection = session.getDatabase('rw-manager').server_statistics;
      collection.deleteMany({ serverId: { $in: ids } });
      collection.insertMany(merged);
    });
  } finally { session.endSession(); }
  const actual = live.server_statistics.countDocuments({ serverId: targetId });
  const stray = live.server_statistics.countDocuments({ serverId: { $in: target.alternateIds } });
  if (actual !== merged.length || stray !== 0) throw new Error(`Post-repair mismatch: ${actual} target, ${stray} aliases`);
  print(JSON.stringify({ verified: true, targetBuckets: actual, aliasBuckets: stray }));
}
