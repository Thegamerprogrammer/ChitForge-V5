import assert from 'node:assert/strict';
import { analyzeRetention, assertGenerationCompleteBeforeFactCheck, generationSafetyCeiling, mergeRecoveryCandidates, recoverPoiShortfallLoop } from './generation.js';

const valid = (id) => ({ target: `Target ${id}`, poi: `Why did Target ${id} answer for unique treaty vote ${id} and finance policy ${id}?`, evidence: [{ url: `https://example.org/${id}`, claimSupported: `claim ${id}` }], tacticalImpact: `angle ${id}` });
const duplicate = { ...valid(1), poi: 'Can Target 1 answer for unique treaty vote 1 and finance policy 1?' };
const noEvidence = { ...valid(99), evidence: [] };
let mission = { chits: [valid(1), valid(2), valid(3)] };
const rejectedBatch = [valid(4), duplicate, noEvidence, valid(5), valid(6)];
const analysis = analyzeRetention({ before: rejectedBatch, after: rejectedBatch.filter((p) => p.evidence.length), requested: 25 });
assert.equal(analysis.underProduced, 20);
assert.equal(analysis.evidenceFailures, 1);
mission = mergeRecoveryCandidates(mission, rejectedBatch.filter((p) => p.evidence.length), 25);
assert(mission.chits.length > 3, 'recovery adds defensible candidates instead of mission error');
mission = { chits: Array.from({ length: 43 }, (_, i) => valid(i + 1)) };
const partial = mergeRecoveryCandidates(mission, [], 50);
assert.equal(partial.chits.length, 43, 'partial valid results are preserved');
const recoveredExact = mergeRecoveryCandidates(partial, Array.from({ length: 10 }, (_, i) => valid(44 + i)), 50);
assert.equal(recoveredExact.chits.length, 50, 'successful recovery fills exactly the requested POI count without discarding valid POIs');
let exactLoop = { chits: [valid(1), valid(2), valid(3)] };
const requestedPoiCount = 50;
let usablePoiCount = exactLoop.chits.length;
let remainingPoiCount = requestedPoiCount - usablePoiCount;
assert.equal(remainingPoiCount, 47);
exactLoop = mergeRecoveryCandidates(exactLoop, Array.from({ length: 20 }, (_, i) => valid(4 + i)), requestedPoiCount);
usablePoiCount = exactLoop.chits.length;
remainingPoiCount = requestedPoiCount - usablePoiCount;
assert.equal(usablePoiCount, 23, 'initial 3 plus first recovery 20 are preserved');
assert.equal(remainingPoiCount, 27, 'remaining is recalculated after first recovery');
exactLoop = mergeRecoveryCandidates(exactLoop, Array.from({ length: 27 }, (_, i) => valid(24 + i)), requestedPoiCount);
assert.equal(exactLoop.chits.length, requestedPoiCount, '3 + 20 + 27 reaches exactly 50');
assert.deepEqual(assertGenerationCompleteBeforeFactCheck(exactLoop, requestedPoiCount), { requestedPoiCount, usablePoiCount: 50, remainingPoiCount: 0 });
assert.throws(() => assertGenerationCompleteBeforeFactCheck({ chits: Array.from({ length: 49 }, (_, i) => valid(i + 1)) }, 50), /Fact checking was not started/);
const duplicatesRejected = mergeRecoveryCandidates({ chits: [valid(1)] }, [duplicate, valid(2)], 50);
assert.equal(duplicatesRejected.chits.length, 2, 'duplicate recovery candidates are rejected while unique candidates survive');
const zeroRecovery = mergeRecoveryCandidates({ chits: [valid(1), valid(2), valid(3)] }, [], 50);
assert.equal(zeroRecovery.chits.length, 3, 'zero-candidate recovery is a shortfall, not false success');
assert.throws(() => assertGenerationCompleteBeforeFactCheck(zeroRecovery, 50), /3\/50/);

async function runSequence(sequence, start = []) {
  let index = 0;
  return recoverPoiShortfallLoop({
    mission: { chits: start },
    poiCount: 50,
    generateCandidates: async ({ remainingPoiCount }) => {
      const count = sequence[index++] ?? 0;
      return { candidates: Array.from({ length: Math.min(count, remainingPoiCount) }, (_, i) => valid(1000 + index * 100 + i)), diagnostics: { parseSucceeded: true, candidatesFound: count, normalizedPois: Math.min(count, remainingPoiCount) } };
    },
  });
}

const fourEightTwelveTenSixteen = await runSequence([4, 8, 12, 10, 16]);
assert.equal(fourEightTwelveTenSixteen.chits.length, 50, '4/50 under-filled generation continues through 8, 12, 10, 16 to exactly 50');
assert.equal(fourEightTwelveTenSixteen.metadata.recoveryLog.at(-1).remainingAfter, 0);
const threeTwentyTwentySeven = await runSequence([20, 27], [valid(1), valid(2), valid(3)]);
assert.equal(threeTwentyTwentySeven.chits.length, 50, '50 → 3 → 20 → 27 reaches exactly 50');
const fortyNineOne = await runSequence([1], Array.from({ length: 49 }, (_, i) => valid(i + 1)));
assert.equal(fortyNineOne.chits.length, 50, '50 → 49 → 1 reaches exactly 50');
const zeroThenRetry = await runSequence([4, 0, 46]);
assert.equal(zeroThenRetry.chits.length, 50, '50 → 4 → 0 retries and continues to 50');
const duplicateThenNew = await recoverPoiShortfallLoop({
  mission: { chits: [valid(1)] },
  poiCount: 50,
  generateCandidates: async ({ level, remainingPoiCount }) => level === 1
    ? { candidates: [duplicate, ...Array.from({ length: 10 }, (_, i) => valid(2000 + i))], diagnostics: { parseSucceeded: true, candidatesFound: 11, normalizedPois: 11 } }
    : { candidates: Array.from({ length: remainingPoiCount }, (_, i) => valid(3000 + i)), diagnostics: { parseSucceeded: true, candidatesFound: remainingPoiCount, normalizedPois: remainingPoiCount } },
});
assert.equal(duplicateThenNew.chits.length, 50, 'duplicate-heavy recovery batch rejects duplicates and continues with new candidates to 50');
const repeatedUnderfilled = await runSequence(Array.from({ length: 13 }, () => 4));
assert.equal(repeatedUnderfilled.chits.length, 50, 'repeated 4-POI batches continue beyond small retry counts until 50');
assert(generationSafetyCeiling(50) >= 100, '50-POI generation safety ceiling is scaled, not a tiny fixed retry count');


console.log('recovery orchestration dry-run passed');
