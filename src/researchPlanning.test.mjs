import assert from 'node:assert/strict';
import { buildMissionPrompt } from './generation.js';
import { buildResearchQueries, deriveAutomaticTargetCandidates } from './ddgsResearch.js';

const form = {
  committee: 'UNSC',
  agenda: 'Protection of civilians and humanitarian access in Ukraine',
  portfolio: 'Indonesia',
  researchNotes: 'Focus on voting contradictions and treaty obligations involving Russia and China.',
  freezeDate: '2024-12-31',
  backgroundGuideName: 'bg-ukraine.md',
  backgroundGuideText: 'The Background Guide discusses Russia, Ukraine, China, humanitarian access, civilian protection, and Security Council veto politics.',
  backgroundGuide: { name: 'bg-ukraine.md', mimeType: 'text/markdown', size: 154, data: Buffer.from('guide').toString('base64'), text: 'Russia Ukraine China humanitarian access civilian protection' },
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
  { title: 'Russia blocks Security Council action on Ukraine humanitarian access', snippet: 'Russia and Ukraine civilian protection obligations', domain: 'un.org' },
  { title: 'China voting record on Ukraine resolutions', snippet: 'China abstentions and policy contradiction', domain: 'digitallibrary.un.org' },
];
const candidates = deriveAutomaticTargetCandidates({ form, sources, selectedTargets });
assert(candidates.some((c) => c.iso === 'RUS'), 'automatic target candidates include agenda-relevant Russia');
assert(candidates.some((c) => c.iso === 'CHN'), 'automatic target candidates include agenda-relevant China');
assert(!candidates.some((c) => c.name === 'Indonesia' || c.iso === 'IDN'), 'portfolio is excluded as an opposition target');
const prompt = buildMissionPrompt({ form, sliders, selectedTargets, targetingMode: 'selected_global', includeFollowUp: true, poiCount: 2, poiTypes: ['LEGAL TRAP'], researchPacket: { queries, sources, retrievedSources: [], bangUrls: [], automaticTargetCandidates: candidates, stats: {} } });
for (const expected of ['BACKGROUND GUIDE ATTACHMENT', 'AUXILIARY ONLY', 'DDGS results are research references and discovery starting points, not the boundary', 'Before POI generation, explicitly analyze the portfolio country', 'Perform agenda-specific antiprep/dirt-prep', 'Freeze Date is strict', 'Never generate an opposition POI against the user']) assert(prompt.includes(expected), `prompt contains ${expected}`);
assert(prompt.includes('Do not use Google Search Grounding, Gemini Search Grounding, or any hidden search tool.'));
assert(prompt.includes('Do not restrict your research to the supplied DDGS results.'));
assert(prompt.includes('Never fabricate URLs'));
assert(!/G20 Common Framework|Paris Club|Addis Ababa Action Agenda/.test(prompt));
console.log('research planning dry-run passed');
