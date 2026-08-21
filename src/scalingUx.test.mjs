import assert from 'node:assert/strict';
import { validateMissionInputs, findDuplicatePoiIndexes, validateMissionResponse } from './validation.js';
import { buildMissionPrompt, planGenerationBatches } from './generation.js';
import { planResearchBudget } from './ddgsResearch.js';

const base = { agenda: 'Climate finance implementation', portfolio: 'Indonesia', apiKey: 'k' };
for (const poiCount of [1, 20, 50, 100, 150, 200, 250]) assert.equal(validateMissionInputs({ ...base, poiCount }), '', `${poiCount} accepted`);
for (const poiCount of [0, -1, 1.5, 251]) assert.match(validateMissionInputs({ ...base, poiCount }), /1 to 250/, `${poiCount} rejected`);
assert.deepEqual(planGenerationBatches(1), [1]);
assert.equal(planGenerationBatches(50).length, 2);
assert.equal(planGenerationBatches(250).length, 10);
const form = { ...base, committee: 'ECOFIN', researchNotes: 'debt swaps and implementation gaps', freezeDate: '2025-01-01', backgroundGuide: { name: 'guide.pdf', data: 'x', text: 'finance' } };
const sliders = { aggression: 50, controversy: 85, diplomacy: 50, length: 40 };
const budgets = [20, 50, 100, 150, 200, 250].map((poiCount) => planResearchBudget({ poiCount, selectedTargets: [{ iso: 'CHN', name: 'China' }], automaticTargetCount: 3, sliders, form }));
assert.deepEqual(budgets.map((b) => b.sourcesPerPass), [120, 300, 600, 900, 1200, 1500]);
assert.deepEqual(budgets.map((b) => b.extractionsPerPass), [40, 100, 200, 300, 400, 500]);
assert.deepEqual(budgets.map((b) => b.sourceBudget), [240, 600, 1200, 1800, 2400, 3000]);
assert.deepEqual(budgets.map((b) => b.extractionBudget), [80, 200, 400, 600, 800, 1000]);
assert(budgets.every((b) => b.primaryPasses === 2), 'exactly two primary research passes');
assert(budgets.every((b) => b.hardMax <= b.absoluteSafetyCeiling), 'bounded hard ceiling');
const natural = buildMissionPrompt({ form: { ...form, naturalLanguage: true }, sliders, selectedTargets: [], targetingMode: 'selected_global', includeFollowUp: false, poiCount: 50, poiTypes: ['AUTO'], researchPacket: { stats: {} }, batchNumber: 2, totalBatches: 2, previousPoiMetadata: [{ target: 'China', type: 'VOTING CONTRADICTION', factualClaim: 'claim', source: 'https://un.org/x', tacticalAngle: 'angle', questionPattern: 'why did' }] });
assert(natural.includes('NATURAL LANGUAGE MODE'));
assert(natural.includes('GENERATION BATCH'));
assert(natural.includes('PREVIOUS POI METADATA'));
const duplicateIndexes = findDuplicatePoiIndexes([
  { target: 'China', poi: 'Why did China support this policy?', documentedIssue: 'Same claim', evidence: [{ url: 'https://un.org/a', claimSupported: 'Same claim' }], tacticalImpact: 'same angle' },
  { target: 'China', poi: 'Can China explain support for this policy?', documentedIssue: 'Same claim', evidence: [{ url: 'https://un.org/a', claimSupported: 'Same claim' }], tacticalImpact: 'same angle' },
]);
assert.deepEqual(duplicateIndexes, [1]);
const missionProblems = validateMissionResponse({ portfolioProfile: { summary: 'ok' }, chits: [{ target: 'Indonesia', poi: 'Question?', evidence: [], legalTacticalTypes: ['ACCOUNTABILITY'], pressurePoint: { portfolioPosition: 'x' } }] }, { targetingMode: 'selected_global', poiCount: 1, portfolio: 'Indonesia' });
assert(missionProblems.some((p) => /Own portfolio/.test(p)));
console.log('scaling and UX dry-run passed');
