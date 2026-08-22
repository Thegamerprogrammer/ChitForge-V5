import assert from 'node:assert/strict';
import { generateMission } from './generation.js';

const text = (obj) => ({ text: JSON.stringify(obj) });
const makeQueries = (prefix, n) => ({ queries: Array.from({ length:n }, (_, i) => ({ query:`${prefix} query ${i + 1}` })) });

const fakeGemini = async (_apiKey, prompt) => {
  if (prompt.includes('Stage 0 Context Intelligence')) return text({ intelligence:{ agendaInterpretation:'Agenda meaning', committeeMandate:'Mandate', backgroundGuideSummary:'Guide summary', keyIssues:['Issue'], definitions:['Definition'], historicalContext:'History', mechanisms:['Mechanism'], treaties:['Treaty'], resolutions:['Resolution'], relevantInstitutions:['UN'], importantDates:['2025-01-01'], ambiguities:['Ambiguity'], researchPriorities:['Priority'], portfolioCountry:'France', freezeDate:null, userResearchNotes:{ label:'USER_PROVIDED_CONTEXT', text:'note' }, portfolioStance:'France stance' } });
  if (prompt.includes('Stage 1 Portfolio + Agenda Intelligence') && prompt.includes('Return strict JSON')) return text(makeQueries('stage1', 6));
  if (prompt.includes('Stage 1 synthesis')) return text({ intelligence:{ agendaAnalysis:'Analysis', mandateLimitations:'Limit', portfolioPosition:'Portfolio position', portfolioObjectives:['Objective'], relevantActors:['Germany'], institutions:['UN'], mechanisms:['Mechanism'], policies:['Policy'], treaties:['Treaty'], resolutions:['Resolution'], disagreements:['Disagreement'], evidence:['Evidence'], researchGaps:['Gap'] } });
  if (prompt.includes('Stage 2 Target Discovery') && prompt.includes('Return strict JSON')) return text(makeQueries('stage2', 8));
  if (prompt.includes('Stage 2 target scoring')) return text({ targets:[{ country:'Germany', iso:'DEU', selectionType:'AUTO_DISCOVERED', agendaRelevance:.9, challengeability:.8, responsibilityInvolvement:.8, policyConflict:.7, implementationRelevance:.8, documentedDisagreement:.6, evidenceAvailability:.9, reason:'Direct agenda disagreement', evidenceIds:['stage_2_source_001'] }] });
  if (prompt.includes('Stage 3 Dirt / Accountability Research') && prompt.includes('Return strict JSON')) return text(makeQueries('stage3', 4));
  if (prompt.includes('Stage 3 evidence processing')) return text({ evidence:[{ target:'Germany', claim:'Documented implementation failure', category:'implementation failure', eventDate:'2025-01-01', publicationDate:'2025-02-01', informationAvailabilityDate:'2025-02-01', epistemicStatus:'OFFICIALLY_DOCUMENTED', agendaRelevance:90, evidenceStrength:85, sourceQuality:80, corroboration:1, primarySourceAvailable:true, sourceIds:['stage_3_source_001'] }] });
  if (prompt.includes('Stage 4 Evidence-Bound POI Generation')) return text({ pois:[{ target:'Germany', poi:'How does Germany reconcile **this documented implementation failure**?', evidenceIds:['stage_3_source_001'], classification:'IMPLEMENTATION FAILURE', epistemicStatus:'OFFICIALLY_DOCUMENTED', sliderCompliance:{ aggression:0, controversy:0, diplomacy:0, length:10 } }] });
  throw new Error(`Unexpected Gemini prompt: ${prompt.slice(0, 120)}`);
};

const fakeSearchCalls = [];
const fakeSearch = async (query, kind) => { fakeSearchCalls.push({ query, kind }); return { results:[{ href:`https://un.org/${encodeURIComponent(query)}`, title:`Result ${query}`, body:'Official source body', date:'2025-02-01' }], duration:1, backend:'auto' }; };
const fakeExtract = async () => ({ content:'extracted official text', error:null });
const progress = [];
const mission = await generateMission({
  form:{ committee:'UN', mandate:'Mandate', agenda:'Agenda', portfolio:'France', freezeDate:'', researchNotes:'note', backgroundGuideText:'guide', apiKey:'test' },
  sliders:{ aggression:0, controversy:0, diplomacy:0, length:10 },
  selectedTargets:[], targetingMode:'selected_global', includeFollowUp:false, poiCount:1,
  modelSelection:{ callGeminiImpl:fakeGemini }, search:fakeSearch, extract:fakeExtract, onProgress:(event) => progress.push(event),
});

assert.equal(mission.chits.length, 1, 'Stage 4 enforces exact requested POI count in deterministic mode');
assert.deepEqual(fakeSearchCalls.map((c) => c.query), [...Array.from({ length:6 }, (_, i) => `stage1 query ${i + 1}`), ...Array.from({ length:8 }, (_, i) => `stage2 query ${i + 1}`), ...Array.from({ length:4 }, (_, i) => `stage3 query ${i + 1}`)], 'every generated query reaches DDGS in stage order');
assert(progress.some((e) => e.detail === '[STAGE 0 START]'));
assert(progress.some((e) => e.detail === '[STAGE 4 COMPLETE]'));
assert(progress.every((e) => Number.isInteger(e.completed) && Number.isInteger(e.total) && e.completed >= 0 && e.completed <= e.total), 'progress invariants hold');
assert.equal(mission.researchPacket.targetIntelligence.inheritedArtifacts.includes('MASTER_CONTEXT_PACKET'), true, 'Stage 3 inherits Stage 0');
assert.equal(mission.researchPacket.targetIntelligence.inheritedArtifacts.includes('PORTFOLIO_AGENDA_INTELLIGENCE_PACKET'), true, 'Stage 3 inherits Stage 1');
assert.equal(mission.researchPacket.targetIntelligence.inheritedArtifacts.includes('TARGET_POOL'), true, 'Stage 3 inherits Stage 2');
console.log('deterministic five-stage pipeline integration test passed');

const blockedProgress = [];
await assert.rejects(
  generateMission({
    form:{ committee:'UN', mandate:'Mandate', agenda:'Agenda', portfolio:'France', freezeDate:'', researchNotes:'note', apiKey:'test' },
    sliders:{ aggression:0, controversy:0, diplomacy:0, length:10 },
    selectedTargets:[], targetingMode:'selected_global', includeFollowUp:false, poiCount:1,
    modelSelection:{ callGeminiImpl:fakeGemini },
    search:async () => ({ results:[], error:'connect ECONNREFUSED', duration:1, backend:'auto' }),
    extract:fakeExtract,
    onProgress:(event) => blockedProgress.push(event),
  }),
  /DDGS unavailable|every query failed/,
  'DDGS unavailability blocks the affected stage instead of jumping to Stage 4',
);
assert.equal(blockedProgress.some((e) => e.detail === '[STAGE 4 START]'), false, 'blocked run never reaches Stage 4');
console.log('DDGS-unavailable stage gate test passed');
