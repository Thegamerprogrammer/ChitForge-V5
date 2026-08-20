import assert from 'node:assert/strict';
import { analyzeRetention, mergeRecoveryCandidates } from './generation.js';

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
console.log('recovery orchestration dry-run passed');
