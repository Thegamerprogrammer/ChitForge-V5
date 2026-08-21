import assert from 'node:assert/strict';
import { buildMissionPrompt } from './generation.js';
import { buildResearchQueries, deriveAutomaticTargetCandidates } from './ddgsResearch.js';

const form = {
  committee: 'Example Council',
  agenda: 'Protection of maritime supply corridors and humanitarian access',
  portfolio: 'Example Portfolio',
  researchNotes: 'Focus on voting contradictions and treaty obligations involving Target Alpha and Target Beta.',
  freezeDate: '2024-12-31',
  backgroundGuideName: 'bg-maritime.md',
  backgroundGuideText: 'The Background Guide discusses Target Alpha, Target Beta, humanitarian access, civilian protection, and council voting politics.',
  backgroundGuide: { name: 'bg-maritime.md', mimeType: 'text/markdown', size: 154, data: Buffer.from('guide').toString('base64'), text: 'Target Alpha Target Beta humanitarian access civilian protection' },
};
const sliders = { aggression: 75, controversy: 85, diplomacy: 35, length: 45 };
const selectedTargets = [];
const queries = buildResearchQueries({ form, sliders, selectedTargets, targetingMode: 'selected_global', poiTypes: ['LEGAL TRAP', 'VOTING CONTRADICTION'] });
assert(queries.some((q) => q.includes(form.agenda)), 'agenda is used in DDGS planning');
assert(queries.some((q) => q.includes(form.portfolio)), 'portfolio is used in DDGS planning');
assert(!queries.some((q) => /before 2024-12-31|before:2024-12-31/.test(q)), 'Freeze Date is not emitted as unsupported DDGS query syntax');
assert(queries.some((q) => q.includes('voting contradictions')), 'Research Notes are used in DDGS planning');
assert(queries.some((q) => /humanitarian access|civilian protection|Security Council/i.test(q)), 'Background Guide text influences DDGS planning');
assert(queries.some((q) => /official position|policy|commitment/.test(q) && q.includes(form.portfolio)), 'portfolio agenda research is planned');
const sources = [
  { title: 'Target Alpha blocks council action on humanitarian access', snippet: 'Target Alpha civilian protection obligations', domain: 'un.org' },
  { title: 'Target Beta voting record on access resolutions', snippet: 'Target Beta abstentions and policy contradiction', domain: 'digitallibrary.un.org' },
];
const candidates = deriveAutomaticTargetCandidates({ form, sources, selectedTargets });
assert(candidates.some((c) => c.name === 'Target Alpha'), 'automatic target candidates include agenda-mentioned actors from context');
assert(candidates.some((c) => c.name === 'Target Beta'), 'automatic target candidates include source-mentioned actors from context');
assert(!candidates.some((c) => c.name === 'Example Portfolio'), 'portfolio is excluded as an opposition target');
const prompt = buildMissionPrompt({ form, sliders, selectedTargets, targetingMode: 'selected_global', includeFollowUp: true, poiCount: 2, poiTypes: ['LEGAL TRAP'], researchPacket: { queries, sources, retrievedSources: [], bangUrls: [], automaticTargetCandidates: candidates, stats: {} } });
for (const expected of ['BACKGROUND GUIDE ATTACHMENT', 'AUXILIARY ONLY', 'DDGS results are research references and discovery starting points, not the boundary', 'Before POI generation, explicitly analyze the portfolio country', 'Perform agenda-specific antiprep/dirt-prep', 'Freeze Date is strict', 'Never generate an opposition POI against the user']) assert(prompt.includes(expected), `prompt contains ${expected}`);
assert(prompt.includes('Do not use Google Search Grounding, Gemini Search Grounding, or any hidden search tool.'));
assert(prompt.includes('Do not restrict your research to the supplied DDGS results.'));
assert(prompt.includes('Never fabricate URLs'));
assert(!/Example Unrelated Fixed Topic/.test(prompt));
console.log('research planning dry-run passed');
