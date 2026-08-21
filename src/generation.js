import { callGemini, callFactCheck, repairJsonWithGemini, GeminiError, CHITFORGE_RESPONSE_SCHEMA, FOLLOW_UP_RESPONSE_SCHEMA } from './gemini.js';
import { findDuplicatePoiIndexes, validateMissionResponse } from './validation.js';
import { toInternalMission, validateInternalMission, extractJson } from './responseParser.js';
import { applyFactCheckToSources, validateSources } from './sourceValidation.js';
import { discoverResearch } from './ddgsResearch.js';

const MAX_POIS = 250;
const GENERATION_BATCH_SIZE = 25;
const MAX_RECOVERY_RESEARCH_ROUNDS = 3;
const MAX_GENERATION_ATTEMPTS = 15;

export function assertGenerationCompleteBeforeFactCheck(mission, requestedPoiCount) {
  const usablePoiCount = (mission.chits || []).length;
  const remainingPoiCount = Math.max(0, requestedPoiCount - usablePoiCount);
  if (usablePoiCount !== requestedPoiCount) throw new GeminiError(`Generation shortfall: ${usablePoiCount}/${requestedPoiCount} unique usable POIs generated after bounded recovery. Fact checking was not started.`, { category: 'generation-shortfall', diagnostic: `${remainingPoiCount} POIs remaining` });
  return { requestedPoiCount, usablePoiCount, remainingPoiCount };
}

export async function generateMission({ form, sliders, selectedTargets, targetingMode, includeFollowUp, poiCount, poiTypes = ['AUTO'], onProgress, modelSelection }) {
  onProgress?.({ stage: 'INITIALIZING', detail: 'Initializing ChitForge synthesis engine.', done: 0, total: poiCount });
  onProgress?.({ stage: 'READING AGENDA', detail: 'Reading committee, agenda and portfolio inputs.', done: 0, total: poiCount });
  onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: 'Starting official DDGS API URL discovery.', done: 0, total: poiCount });
  const researchPacket = await discoverResearch({ form, sliders, selectedTargets, targetingMode, poiTypes, poiCount, onProgress });
  const prompt = buildMissionPrompt({ form, sliders, selectedTargets, targetingMode, includeFollowUp, poiCount, poiTypes, researchPacket });
  onProgress?.({ stage: 'ANALYZING PORTFOLIO', detail: 'Analyzing portfolio foreign-policy interests.', done: 0, total: poiCount });
  onProgress?.({ stage: 'ANALYZING FOREIGN POLICY', detail: 'Mapping foreign-policy alignment and constraints.', done: 0, total: poiCount });
  onProgress?.({ stage: 'MAPPING TARGETS', detail: 'Mapping selected and global target opportunities.', done: 0, total: poiCount });
  onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: 'Requesting traceable source-backed evidence.', done: 0, total: poiCount });
  onProgress?.({ stage: 'ANALYZING LEGAL FRAMEWORKS', detail: 'Separating legal obligations from political commitments.', done: 0, total: poiCount });
  const batchSizes = planGenerationBatches(poiCount);
  let response;
  let mission;
  if (batchSizes.length === 1) {
    response = await callGemini(form.apiKey, prompt, { ...modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA, attachments: form.backgroundGuide?.data ? [form.backgroundGuide] : [], onModelStatus: (status) => onProgress?.({ stage: 'MAPPING TARGETS', detail: `Using ${status.model.displayName} for ${status.mode}.`, done: 0, total: poiCount }) });
    mission = await recoverMission({ apiKey: form.apiKey, text: response.text, ctx: { form, sliders, includeFollowUp, poiCount, targetingMode, poiTypes, lengthInfo: lengthInfo(sliders.length) }, modelSelection, modelInfo: { primaryModel: response.model.displayName } });
  } else {
    mission = await generateBatchedMission({ form, sliders, selectedTargets, targetingMode, includeFollowUp, poiCount, poiTypes, researchPacket, batchSizes, modelSelection, onProgress });
    response = mission._response;
    delete mission._response;
  }
  mission = await recoverShortfall({ form, sliders, selectedTargets, targetingMode, includeFollowUp, mission, poiCount, poiTypes, modelSelection, researchPacket, onProgress });
  assertGenerationCompleteBeforeFactCheck(mission, poiCount);
  onProgress?.({ stage: 'VALIDATING STRUCTURE', detail: `${mission.chits.length}/${poiCount} usable POIs normalized. Validating source structures...`, done: mission.chits.length, total: poiCount });
  mission.chits = await Promise.all(mission.chits.map(async (poi) => ({ ...poi, evidence: await validateSources(poi.evidence || []) })));
  onProgress?.({ stage: 'CALCULATING PRESSURE', detail: 'Calculating local pressure, word count, line and speaking-time metrics.', done: mission.chits.length, total: poiCount });
  mission = await runFactChecks({ mission, form, apiKey: form.apiKey, primaryModel: response.model, modelSelection, onProgress });
  mission.validationProblems = validateMissionResponse(mission, { targetingMode, poiCount, portfolio: form.portfolio, freezeDate: form.freezeDate });
  mission.metadata = { ...(mission.metadata || {}), researchPacketStats: researchPacket.stats, ddgsQueries: researchPacket.queries };
  return { ...mission, researchPacket, modelInfo: { model: response.model, factCheckModel: mission.metadata.factCheckModel, mode: response.mode, fallbackLog: response.fallbackLog } };
}

export async function regenerateChit({ form, sliders, chit, existingChits, apiKey, includeFollowUp, onProgress, modelSelection }) {
  onProgress?.({ stage: 'GENERATING POIs', detail: `Regenerating POI for ${chit.target}...`, done: 0, total: 1 });
  const prompt = `${form.naturalLanguage ? naturalLanguageInstruction() : ''}\nReturn STRICT JSON only, no markdown fences. Regenerate exactly 1 distinct ChitForge POI to replace the weak POI below. Use the same agenda, portfolio, target, slider profile, evidence standards, simple English, no ceremonial opening, and Markdown bold emphasis. Do not duplicate these existing POIs: ${JSON.stringify(existingChits.map((item) => item.poi))}.\nAGENDA: ${form.agenda}\nPORTFOLIO: ${form.portfolio}\nTARGET: ${chit.target}\nSLIDERS: ${JSON.stringify(sliders)}\nFOLLOW-UP: ${includeFollowUp ? 'GENERATE' : 'DO NOT GENERATE'}\nOLD CHIT: ${JSON.stringify(chit)}\nReturn schema {"research_summary":"...","portfolio_alignment":"...","targets":[{"country":"${chit.target}","pressure_points":[{"poi":"...","legal_foundation":"...","evidence":[{"claim":"...","source_name":"...","source_url":"..."}],"documented_contradiction":"...","tactical_impact":"...","classification":"...","follow_up":${includeFollowUp ? '"..."' : 'null'}}]}]}`;
  const response = await callGemini(apiKey, prompt, { ...modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA });
  const text = response.text;
  const mission = await recoverMission({ apiKey, text, ctx: { form, sliders, includeFollowUp, poiCount: 1, targetingMode: 'regenerate', lengthInfo: lengthInfo(sliders.length) }, modelSelection, modelInfo: { primaryModel: response.model.displayName } });
  const regenerated = mission.chits[0] || chit;
  const problems = validateMissionResponse({ ...mission, chits: [regenerated], portfolioProfile: mission.portfolioProfile || { summary: 'Regeneration' } }, { targetingMode: 'regenerate', poiCount: 1, portfolio: form.portfolio, freezeDate: form.freezeDate });
  if (problems.some((problem) => /Own portfolio/i.test(problem))) throw new GeminiError('Regeneration attempted to target the portfolio country; rejected by validation.', { category: 'own-portfolio-target' });
  return regenerated;
}

export async function generateFollowUp({ form, sliders, chit, apiKey, onProgress, modelSelection }) {
  onProgress?.({ stage: 'GENERATING FOLLOW-UP', detail: `Generating optional follow-up for ${chit.target}...`, done: 0, total: 1 });
  const prompt = `${form.naturalLanguage ? naturalLanguageInstruction() : ''}\nReturn STRICT JSON only, no markdown fences. Generate an optional follow-up for this MUN POI.\nAGENDA: ${form.agenda}\nPORTFOLIO: ${form.portfolio}\nSLIDERS: ${JSON.stringify(sliders)}\nEXISTING CHIT: ${JSON.stringify(chit)}\nReturn {"expectedEvasion":"...","question":"..."}. The follow-up must be short, direct, evidence-based, and must return to the original pressure point. Do not introduce unrelated issues, ceremonial openings, or new unsupported sources.`;
  const response = await callGemini(apiKey, prompt, { ...modelSelection, schema: FOLLOW_UP_RESPONSE_SCHEMA });
  const text = response.text;
  try {
    const parsed = extractJson(text);
    return { ...chit, followUp: { expectedEvasion: parsed.expectedEvasion || 'MANUAL VERIFICATION', question: parsed.question || 'What evidence addresses the original contradiction directly?' } };
  } catch (cause) {
    throw new GeminiError('Invalid JSON returned by Gemini while generating the follow-up. Try again.', { category: 'invalid-json', cause });
  }
}


async function recoverMission({ apiKey, text, ctx, modelSelection, modelInfo }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const mission = toInternalMission(text, ctx, modelInfo);
      const usable = mission.chits.length;
      if (usable > 0 || ctx.poiCount === 0) return mission;
      const problems = validateInternalMission(mission, { poiCount: ctx.poiCount, includeFollowUp: ctx.includeFollowUp });
      if (attempt === 2) throw new GeminiError(`Normalization failure: parsed=${mission.diagnostics?.parseSucceeded}; candidates=${mission.diagnostics?.candidatesFound}; normalized=${usable}; requested=${ctx.poiCount}. ${problems.slice(0, 3).join('; ')}`, { category: 'normalization', rawText: text });
      const repair = await repairJsonWithGemini(apiKey, text, { modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA });
      text = repair.text;
    } catch (err) {
      if (attempt === 2) {
        if (err instanceof GeminiError) throw err;
        throw new GeminiError('Gemini returned usable content requiring normalization, but ChitForge could not safely recover it.', { category: 'format-recovery-failed', cause: err, rawText: text });
      }
      const repair = await repairJsonWithGemini(apiKey, text, { modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA });
      text = repair.text;
    }
  }
  throw new GeminiError("Gemini returned a response that did not match ChitForge's required format.", { category: 'schema-failure' });
}

function buildFactCheckPrompt({ form, poi, pass }) {
  const instruction = pass === 1 ? `You are ChitForge's factual verification engine. Independently verify every factual claim. Do not rewrite the POI. Classify each claim as verified, partially_verified, disputed, unverified, or false. Check dates, statistics, policies, resolutions, treaties, legal claims, institutional actions, financial claims and source relevance. Do not assume that a source proves a claim merely because it is listed.` : `Independently verify the factual and legal claims. Do not rely on another model's conclusion. Identify unsupported, exaggerated, misleading or incorrectly classified claims. Pay particular attention to legal terminology. Do not classify something as a legal violation unless the evidence actually supports that conclusion.`;
  return `${instruction}
Return ONLY valid JSON with overallStatus (VERIFIED|MANUAL_VERIFICATION|FAILED), confidence 0-100, claims[], legalAssessment, and classificationAssessment. Check whether each source actually supports its mapped claim and whether the POI classification is evidence-driven.
AGENDA: ${form.agenda}
PORTFOLIO: ${form.portfolio}
TARGET: ${poi.target}
POI: ${poi.poi}
LEGAL FOUNDATION: ${poi.legalFoundation}
CLASSIFICATION: ${poi.classification}
CLASSIFICATION REASON: ${poi.classificationReason}
FREEZE DATE: ${form.freezeDate || 'NONE'}
EVIDENCE: ${JSON.stringify(poi.evidence)}
DOCUMENTED ISSUE: ${poi.documentedIssue}`;
}

function normalizeFactCheck(parsed) {
  const rawStatus = String(parsed.overallStatus || '').toUpperCase().replace(/_/g, ' ');
  const status = ['VERIFIED', 'MANUAL VERIFICATION', 'FAILED'].includes(rawStatus) ? rawStatus : 'MANUAL VERIFICATION';
  return { overallStatus: status, confidence: Number(parsed.confidence || 0), claims: Array.isArray(parsed.claims) ? parsed.claims.map((claim) => ({ ...claim, status: String(claim.status || 'UNVERIFIED').toUpperCase().replace(/ /g, '_') })) : [], legalAssessment: parsed.legalAssessment || { status: 'UNCERTAIN', reason: 'No legal assessment returned.' }, classificationAssessment: parsed.classificationAssessment || { status: 'UNCERTAIN', reason: 'No classification assessment returned.' } };
}

function combineFactChecks(first, second) {
  if (first.overallStatus === 'FAILED' && second.overallStatus === 'FAILED') return { status: 'FAILED', confidence: Math.round((first.confidence + second.confidence) / 2), claims: [...first.claims, ...second.claims], legalAssessment: first.legalAssessment, classificationAssessment: first.classificationAssessment };
  if (first.overallStatus === second.overallStatus && first.overallStatus === 'VERIFIED') return { status: 'VERIFIED', confidence: Math.round((first.confidence + second.confidence) / 2), claims: [...first.claims, ...second.claims], legalAssessment: first.legalAssessment, classificationAssessment: first.classificationAssessment };
  return { status: 'MANUAL VERIFICATION', confidence: Math.round((first.confidence + second.confidence) / 2), claims: [...first.claims, ...second.claims], legalAssessment: first.legalAssessment, classificationAssessment: first.classificationAssessment };
}

async function runFactChecks({ mission, form, apiKey, primaryModel, modelSelection, onProgress }) {
  const updated = []; let factCheckModel = '';
  for (let i = 0; i < mission.chits.length; i += 1) {
    const poi = mission.chits[i];
    onProgress?.({ stage: 'FACT CHECK PASS 1', detail: `Fact-check pass 1 for POI ${i + 1}/${mission.chits.length}.`, done: i, total: mission.chits.length });
    try {
      const first = await callFactCheck(apiKey, buildFactCheckPrompt({ form, poi, pass: 1 }), { primaryModelId: primaryModel.id, modelSelection });
      onProgress?.({ stage: 'FACT CHECK PASS 2', detail: `Fact-check pass 2 for POI ${i + 1}/${mission.chits.length}.`, done: i, total: mission.chits.length });
      const second = await callFactCheck(apiKey, buildFactCheckPrompt({ form, poi, pass: 2 }), { primaryModelId: primaryModel.id, modelSelection });
      factCheckModel = second.model.displayName;
      { const combined = combineFactChecks(normalizeFactCheck(extractJson(first.text)), normalizeFactCheck(extractJson(second.text))); updated.push({ ...poi, factCheck: combined, evidence: applyFactCheckToSources(poi.evidence || [], combined) }); }
    } catch {
      updated.push({ ...poi, factCheck: { status: 'MANUAL VERIFICATION', confidence: 0, claims: [], legalAssessment: { status: 'UNCERTAIN', reason: 'Fact-check unavailable; verify evidence manually.' }, classificationAssessment: { status: 'UNCERTAIN', reason: 'Classification could not be independently verified.' } } });
    }
  }
  mission.chits = updated;
  mission.targets = mission.targets.map((target) => ({ ...target, pois: updated.filter((poi) => poi.target === target.country) }));
  onProgress?.({ stage: 'FINALIZING CHITS', detail: 'Final verification states calculated and chits finalized.', done: mission.chits.length, total: mission.chits.length });
  mission.metadata.factCheckModel = factCheckModel || 'Unavailable';
  return mission;
}

function band(value, bands) { return bands.find(([max]) => value <= max)?.[1] || bands.at(-1)[1]; }
export function lengthInfo(length) { return band(length, [[10, { lines: '≈ 1 line', words: 'approximately 8–15 words', min: 8, max: 15 }], [25, { lines: '≈ 1–2 lines', words: 'approximately 15–25 words', min: 15, max: 25 }], [40, { lines: '≈ 2 lines', words: 'approximately 20–35 words', min: 20, max: 35 }], [55, { lines: '≈ 2–3 lines', words: 'approximately 30–45 words', min: 30, max: 45 }], [70, { lines: '≈ 3 lines', words: 'approximately 40–55 words', min: 40, max: 55 }], [85, { lines: '≈ 3–4 lines', words: 'approximately 50–70 words', min: 50, max: 70 }], [100, { lines: '≈ 4–5 lines', words: 'approximately 65–90 words', min: 65, max: 90 }]]); }
function aggressionInstruction(value) { return band(value, [[10, 'Use a calm, neutral question with minimal confrontation.'], [30, 'Use a mild challenge that asks for a clear policy explanation.'], [50, 'Use a firm challenge and clearly expose the relevant disagreement.'], [70, 'Use strong direct wording and pressure; ask how the delegation can justify the contradiction.'], [85, 'Use very aggressive but MUN-usable wording. Lead into the contradiction and give little room for vague answers.'], [100, 'Use maximum directness. Lead with the strongest verified contradiction, remove unnecessary diplomatic cushioning, end with a direct challenge, and do not soften the wording. Do not use insults or unsupported accusations.']]); }
function controversyInstruction(value) { return band(value, [[10, 'Use a normal policy disagreement only.'], [30, 'Use a minor documented inconsistency if available.'], [50, 'Use a clear policy contradiction tied to the agenda.'], [70, 'Use a serious documented contradiction, commitment gap, vote, dispute, or implementation failure.'], [85, 'Prioritize major verified controversies, commitment failures, policy-practice gaps, legal disputes, or financial inconsistencies.'], [100, 'Search for the strongest relevant VERIFIED pressure point available: broken commitments, conflicting statements, voting contradictions, legal disputes, implementation failures, or financial inconsistencies. Never manufacture or exaggerate controversy.']]); }
function diplomacyInstruction(value) { return band(value, [[10, 'Use blunt, direct wording. Do not add diplomatic cushioning.'], [30, 'Use very direct MUN wording with minimal restraint.'], [50, 'Use normal MUN language with moderate diplomatic restraint.'], [70, 'Use formal language while preserving pressure.'], [85, 'Use highly diplomatic polish without weakening the challenge.'], [100, 'Use maximum diplomatic polish, but preserve the same substantive pressure and direct question. High diplomacy does not reduce pressure.']]); }
export function buildMissionPrompt({ form, sliders, selectedTargets, targetingMode, includeFollowUp, poiCount, poiTypes = ['AUTO'], researchPacket = null, batchNumber = 1, totalBatches = 1, previousPoiMetadata = [] }) {
  const manualTargets = selectedTargets.map((c) => `${c.name} (${c.iso})`).join(', ') || 'NONE — target countries are optional; identify useful targets globally if target mode allows.';
  const info = lengthInfo(sliders.length);
  return `COMMITTEE:
${form.committee || 'Unspecified'}

AGENDA:
${form.agenda}

PORTFOLIO:
${form.portfolio}

TARGETS:
${manualTargets}

TARGET MODE:
${targetingMode === 'selected_only' ? 'SELECTED TARGETS ONLY' : 'SELECTED + GLOBAL RESEARCH'}

NUMBER OF POIs:
${poiCount}

GENERATION BATCH:
${batchNumber} of ${totalBatches}

AGGRESSION:
${sliders.aggression}/100

CONTROVERSY:
${sliders.controversy}/100

DIPLOMACY:
${sliders.diplomacy}/100

LENGTH:
${sliders.length}/100

TARGET WORD RANGE:
${info.words}

TARGET DISPLAY LENGTH:
${info.lines}

FOLLOW-UPS:
${includeFollowUp ? 'ON' : 'OFF'}

FREEZE DATE:
${form.freezeDate || 'NONE'}

RESEARCH NOTES:
${form.researchNotes || 'NONE'}

BACKGROUND GUIDE FILE NAME:
${form.backgroundGuideName || 'NONE'}

BACKGROUND GUIDE ATTACHMENT:
${form.backgroundGuide ? `${form.backgroundGuide.name} (${form.backgroundGuide.mimeType || 'application/octet-stream'}, ${form.backgroundGuide.size || 0} bytes) is attached to this Gemini request as inline file context. Use the attachment as the authoritative Background Guide artifact.` : 'NONE'}

BACKGROUND GUIDE EXTRACTED TEXT (AUXILIARY ONLY):
${form.backgroundGuide?.text || form.backgroundGuideText || 'NONE'}

DDGS RESEARCH PACKET:
${researchPacket ? JSON.stringify(researchPacket).slice(0, 45000) : 'DDGS unavailable or not yet run.'}

POI TYPE:
${poiTypes.join(', ')}

PREVIOUS POI METADATA TO AVOID REPETITION:
${previousPoiMetadata.length ? JSON.stringify(previousPoiMetadata).slice(0, 18000) : 'NONE'}

You are an expert competitive Model United Nations strategist.

DDGS is supplemental research/reference material shared across the entire requested POI set, not a per-POI search pipeline. DDGS results include provenance states: DISCOVERED_FROM_SEARCH search metadata/snippet only, RETRIEVED extracted page text, DISCOVERED_NOT_RETRIEVED, DISCOVERED_DIRECT_EXTRACTION_BLOCKED, RATE_LIMITED and SEARCH_FAILED. Treat snippets as discovery-level evidence only, not retrieved page content. DDGS results are research references and discovery starting points, not the boundary of your research. Use the supplied DDGS URLs and source material, but independently reason through the subject using your own knowledge and analytical capabilities. Identify missing information, relevant policies, historical context, legal instruments, voting behavior, controversies, contradictions and additional relevant facts. Do not restrict your research to the supplied DDGS results. Do not claim model knowledge is a verified external citation. Use the existing ChitForge research/generation methodology, but substantially improve its depth and tactical reasoning. Do not use Google Search Grounding, Gemini Search Grounding, or any hidden search tool.

Before POI generation, explicitly analyze the portfolio country's foreign policy doctrine, strategic priorities, alliances, treaty positions, UN voting patterns, economic diplomacy, historical positions and contradictions. If no manual targets are selected, select targets because they matter to the agenda and produce meaningful tactical material; never select the user's own portfolio as an opposition target. For each automatic target, analyze foreign policy, agenda position, voting record, treaties, commitments, legislation, diplomatic/economic conduct and contradictions against the agenda, Background Guide, portfolio foreign policy and international obligations.

Perform agenda-specific antiprep/dirt-prep before final POIs: scandals, malpractice, voting contradictions, policy contradictions, controversial policies, diplomatic controversies, implementation failures, investigations, corruption-related issues, institutional failures, treaty contradictions, legal disputes, historical contradictions, economic controversies and accountability failures where relevant.

Freeze Date is strict. Distinguish event date, publication date and information date. A later source may be used only when reporting information that existed before the Freeze Date; genuinely post-Freeze-Date developments must not enter research, target analysis, antiprep, final POIs or fact checking.

Analyze the represented country's actual foreign-policy interests in relation to the committee and agenda.

Research credible evidence and relevant international legal frameworks.

Generate concise, simple, hard-hitting POIs.

Do not begin with 'Distinguished delegate'.

Begin directly with the substantive question.

Aggression controls confrontation. ${aggressionInstruction(sliders.aggression)}

Controversy controls research depth and political discomfort. ${controversyInstruction(sliders.controversy)}

Diplomacy controls wording. ${diplomacyInstruction(sliders.diplomacy)}

Length controls actual word count. Stay approximately within ${info.words} and ${info.lines}. Do not add filler.

The ideal POI should expose a documented contradiction, obligation, commitment, policy failure or controversy that makes a clean evasive answer difficult.

Do not claim a question is literally impossible to answer.

Never generate an opposition POI against the user's own portfolio/country. Validation will reject self-targeted opposition POIs.

Do not fabricate:
- allegations
- violations
- statistics
- resolutions
- treaties
- quotations
- sources
- scandals
- government positions

Distinguish allegations from established facts.

Distinguish legally binding obligations from non-binding political commitments.

Use simple but precise English.

${form.naturalLanguage ? naturalLanguageInstruction() : ''}

Do not write an academic essay.

Do not use ceremonial openings.

Do not add filler.

Every factual statement must be supported by a real source. Do not output 'VERIFICATION REQUIRED' as a source. If a claim cannot be verified, mark it MANUAL VERIFICATION. Never fabricate citations. Never fabricate URLs. Never invent foreign-policy positions. Prefer official government, UN, treaty, IMF, World Bank and other primary sources. Use reputable external reporting where primary sources do not cover the issue.

For every factual claim used in a POI, provide a real, traceable source. Use the strongest available source. Prefer primary sources: UN documents, official government documents, treaties, court judgments, IMF, World Bank, WTO, OECD, official statistics, and official reports. For controversies and events that primary sources do not adequately cover, use reputable journalism such as Reuters, AP, Financial Times, Bloomberg, BBC, etc. Never fabricate a source. Never fabricate a URL. Never fabricate a publication date. Do not use 'VERIFICATION REQUIRED' as a source. If you cannot establish a claim with a credible source, mark the claim as requiring manual verification instead of inventing evidence.

Source objects must include sourceName, organization, publicationDate, url, claimSupported, sourceType, confidence, ddgsQuery, searchBackend, bangUrl, canonicalUrl, and extractionStatus when known. sourceType must be one of PRIMARY, GOVERNMENT, UN, INTERNATIONAL_ORGANIZATION, COURT, NEWS, ACADEMIC, THINK_TANK, OTHER_CREDIBLE.

Distinguish BINDING LEGAL OBLIGATION, NON-BINDING RESOLUTION, POLITICAL COMMITMENT, POLICY GUIDANCE, CUSTOMARY INTERNATIONAL LAW, ALLEGED VIOLATION, POLICY CONTRADICTION, LEGAL CONCERN, and POTENTIAL LEGAL ISSUE. Never call something a LEGAL VIOLATION unless the cited legal framework actually supports that characterization.

POI TYPE instructions: AUTO lets ChitForge/Gemini choose the strongest legitimate category. If one or more types are selected, prioritize and distribute across those types only where evidence supports them. Classification must be evidence-driven, not chosen merely because it sounds aggressive. Include classificationReason explaining why the classification fits.

Type definitions: POLICY CONTRADICTION = stated policy conflicts with conduct/position/vote/commitment; LEGAL ERROR = legally incorrect claim or misinterpretation; LEGAL TRAP = actual legal obligation/framework; COMMITMENT CONTRADICTION = commitment conflicts with actions; EVIDENCE TRAP = documented fact/statistic/report/record; ACCOUNTABILITY = asks to explain documented action; FINANCIAL PRESSURE = debt/lending/financial flows/sanctions/tax/development finance; IMPLEMENTATION FAILURE = commitment implementation falls short; VOTING CONTRADICTION = vote conflicts with stated position; TREATY / OBLIGATION = treaty or formal obligation; HISTORICAL CONTRADICTION = previous position/action conflicts with current position; CONTROVERSY = documented controversy central to POI.

Target countries are optional. If targets are selected, prioritize them. If no countries are selected, perform global research and identify countries relevant to the agenda, portfolio interests, legal obligations, international commitments, policy contradictions, documented controversies, financial conduct, voting behavior, implementation failures, diplomatic disputes, economic relevance, and committee relevance. If target mode is SELECTED + GLOBAL RESEARCH, selected countries must not prevent broader portfolio-interest analysis.

Use authoritative legal sources where relevant: UN Charter, UNSC resolutions, UNGA resolutions, ICJ judgments, treaties, WTO agreements, IMF/World Bank documents, official government sources, and official court records. Do NOT call every UNGA resolution legally binding. Use LEGAL VIOLATION only where justified; otherwise use LEGAL CONCERN or POLICY CONTRADICTION.

Use reputable external sources for documented controversies: Reuters, AP, Financial Times, Bloomberg, BBC, Al Jazeera, major established newspapers, credible investigative organizations, academic publications, and established research institutions. Avoid random blogs, unsourced sites, anonymous claims, social media as primary evidence, AI-generated sources, and Wikipedia as primary evidence.

Generate exactly ${poiCount} distinct POIs for this batch. No duplicates within this batch or against PREVIOUS POI METADATA. Each POI must use a meaningfully distinct pressure point: vary targets, documents, events, policies, commitments, votes, contradictions, legal frameworks, implementation failures, investigations, findings, or historical evidence only where actually relevant to the user's agenda and discovered material. Do not generate paraphrases of the same issue.

Important concepts may be emphasized with Markdown-style bold markers around short phrases only.

If FOLLOW-UPS is OFF, set followUp to null for every POI. If ON, generate one concise follow-up that anticipates an evasive answer and presses the same issue from another angle.

Return ONLY the requested structured response.
Do not include introductory prose.
Do not use Markdown code fences.
Use valid JSON.
Use double quotes.
Do not use comments.
Do not use trailing commas.
Use null for optional values.
Follow the provided schema.

Required JSON shape:
{"pois":[{"target":"","question":"","legalFoundation":"","evidence":[{"sourceName":"","organization":"","publicationDate":"","url":"","claimSupported":"","sourceType":"PRIMARY","confidence":0}],"documentedIssue":"","classification":"","classificationReason":"","tacticalImpact":"","followUp":null}]}`;
}

export function planGenerationBatches(poiCount) {
  const count = Number(poiCount);
  if (!Number.isInteger(count) || count < 1 || count > MAX_POIS) throw new GeminiError('Choose a POI count from 1 to 250.', { category: 'invalid-poi-count' });
  const batches = [];
  let remaining = count;
  while (remaining > 0) { const next = Math.min(GENERATION_BATCH_SIZE, remaining); batches.push(next); remaining -= next; }
  return batches;
}
function naturalLanguageInstruction() { return `NATURAL LANGUAGE MODE: Write each POI like a real MUN delegate would naturally say it. Use simple, direct human English. Avoid AI-assistant, legal-memo, academic-paper, consulting-report, press-release, or template-like phrasing. Avoid filler, robotic repetition, unnecessary formalism, repeated openings, and excessive legal terminology. Prefer concise spoken simple MUN language which anyone can understand, varied sentence structures, specific references to the researched issue, and direct tactical questions. Do not make the language childish, sloppy, slang-heavy, or grammatically incorrect. Natural language must NEVER override factual accuracy, legal/policy accuracy, tactical usefulness, or requested length.`; }
function compactPoiMetadata(chits = []) { return chits.map((chit) => ({ target: chit.target, type: chit.classification || chit.pressureProfile?.classification, factualClaim: chit.documentedIssue || chit.pressurePoint?.conflict, source: (chit.evidence || [])[0]?.url || (chit.evidence || [])[0]?.sourceName || '', tacticalAngle: chit.tacticalImpact, questionPattern: String(chit.poi || '').replace(/\*\*/g, '').split(/\s+/).slice(0, 14).join(' ') })); }
async function generateBatchedMission({ form, sliders, selectedTargets, targetingMode, includeFollowUp, poiCount, poiTypes, researchPacket, batchSizes, modelSelection, onProgress }) {
  let combined = null; let responseInfo = null; const previous = []; const batchDiagnostics = [];
  for (let i = 0; i < batchSizes.length; i += 1) {
    const batchCount = batchSizes[i];
    onProgress?.({ stage: 'GENERATING POIs', detail: `Generating batch ${i + 1}/${batchSizes.length} (${batchCount} POIs).`, done: previous.length, total: poiCount });
    const batchPrompt = buildMissionPrompt({ form, sliders, selectedTargets, targetingMode, includeFollowUp, poiCount: batchCount, poiTypes, researchPacket, batchNumber: i + 1, totalBatches: batchSizes.length, previousPoiMetadata: compactPoiMetadata(previous) });
    const response = await callGemini(form.apiKey, batchPrompt, { ...modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA, attachments: i === 0 && form.backgroundGuide?.data ? [form.backgroundGuide] : [], onModelStatus: (status) => onProgress?.({ stage: 'GENERATING POIs', detail: `Using ${status.model.displayName} for batch ${i + 1}.`, done: previous.length, total: poiCount }) });
    responseInfo = response;
    const batchMission = await recoverMission({ apiKey: form.apiKey, text: response.text, ctx: { form, sliders, includeFollowUp, poiCount: batchCount, targetingMode, poiTypes, lengthInfo: lengthInfo(sliders.length) }, modelSelection, modelInfo: { primaryModel: response.model.displayName } });
    const deduped = batchMission.chits.filter((chit) => !findDuplicatePoiIndexes([...previous, chit]).includes(previous.length));
    const duplicateRejected = batchMission.chits.length - deduped.length;
    batchDiagnostics.push({ batch: i + 1, requested: batchCount, candidatesFound: batchMission.diagnostics?.candidatesFound || 0, normalizedPois: batchMission.diagnostics?.normalizedPois || batchMission.chits.length, accepted: deduped.length, duplicateRejected, parseSucceeded: batchMission.diagnostics?.parseSucceeded, parseError: batchMission.diagnostics?.parseError || '' });
    previous.push(...deduped);
    onProgress?.({ stage: 'GENERATING POIs', detail: `Batch ${i + 1}/${batchSizes.length}: ${deduped.length}/${batchCount} accepted (${duplicateRejected} duplicate rejection${duplicateRejected === 1 ? '' : 's'}).`, done: previous.length, total: poiCount });
    combined = combined || { ...batchMission, chits: [], targets: [], recommendedTargets: [] };
    combined.portfolioProfile = combined.portfolioProfile || batchMission.portfolioProfile;
    combined.recommendedTargets = [...(combined.recommendedTargets || []), ...(batchMission.recommendedTargets || [])];
  }
  combined.chits = previous.slice(0, poiCount); combined.metadata = { ...(combined.metadata || {}), batchDiagnostics };
  const groups = new Map(); combined.chits.forEach((poi) => { if (!groups.has(poi.target)) groups.set(poi.target, { country: poi.target, reasonForTargeting: poi.reasonForTargeting, pois: [] }); groups.get(poi.target).pois.push(poi); });
  combined.targets = [...groups.values()]; combined._response = responseInfo; return combined;
}

export function analyzeRetention({ before = [], after = [], requested = 0 } = {}) {
  const duplicateCount = findDuplicatePoiIndexes(before).length;
  const evidenceFailures = before.filter((poi) => !(poi.evidence || []).some((e) => e.url && /^https?:\/\//i.test(e.url))).length;
  const validationRejections = Math.max(0, before.length - after.length - duplicateCount);
  return { requested, returned: before.length, retained: after.length, duplicateCount, evidenceFailures, validationRejections, underProduced: Math.max(0, requested - before.length), remaining: Math.max(0, requested - after.length) };
}
export function mergeRecoveryCandidates(mission, candidates, poiCount) {
  return dedupeMission({ ...mission, chits: [...(mission.chits || []), ...(candidates || [])] }, poiCount);
}
function dedupeMission(mission, poiCount) {
  const duplicates = findDuplicatePoiIndexes(mission.chits);
  const chits = mission.chits.filter((_, index) => !duplicates.includes(index)).slice(0, poiCount);
  const groups = new Map(); chits.forEach((poi) => { if (!groups.has(poi.target)) groups.set(poi.target, { country: poi.target, reasonForTargeting: poi.reasonForTargeting, pois: [] }); groups.get(poi.target).pois.push(poi); });
  return { ...mission, chits, targets: [...groups.values()] };
}
function recoveryFocus(level, analysis) {
  const pieces = [`RECOVERY LEVEL ${level}: generate new defensible POIs without reusing rejected angles.`];
  if (analysis.duplicateCount) pieces.push('Duplicates were rejected; prioritize new factual bases, years, institutions, voting events, treaty hooks, financial mechanisms, and question structures.');
  if (analysis.evidenceFailures) pieces.push('Evidence was weak; prioritize official/primary legal, policy, voting, financial, and implementation sources.');
  if (analysis.underProduced) pieces.push('Previous Gemini batch under-produced; oversample candidates but retain only supported, non-duplicate POIs.');
  return pieces.join(' ');
}
export async function recoverShortfall({ form, sliders, selectedTargets, targetingMode, includeFollowUp, mission, poiCount, poiTypes, modelSelection, researchPacket, onProgress }) {
  let current = dedupeMission(mission, poiCount);
  let packet = researchPacket;
  const recoveryLog = [];
  let recoveryResearchRounds = 0;
  const maxAttempts = Math.min(MAX_GENERATION_ATTEMPTS, Math.max(5, Math.ceil(poiCount / GENERATION_BATCH_SIZE) + 4));
  for (let level = 1; current.chits.length < poiCount && level <= maxAttempts; level += 1) {
    const remaining = poiCount - current.chits.length;
    const analysis = analyzeRetention({ before: current.chits, after: current.chits, requested: poiCount });
    recoveryLog.push({ level, ...analysis, remaining });
    onProgress?.({ stage: 'RECOVERING GENERATION', detail: `${current.chits.length} / ${poiCount} valid POIs — recovering ${remaining} rejected or missing candidate(s).`, done: current.chits.length, total: poiCount });
    if (packet?.needsSupplementalRecoveryResearch && level >= 2 && recoveryResearchRounds < MAX_RECOVERY_RESEARCH_ROUNDS && (analysis.evidenceFailures || analysis.duplicateCount || level >= 3)) {
      recoveryResearchRounds += 1;
      onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `Recovery research round ${recoveryResearchRounds}/${MAX_RECOVERY_RESEARCH_ROUNDS}: reusing existing corpus and extracting only new URLs.`, done: current.chits.length, total: poiCount });
      const expansion = await discoverResearch({ form, sliders, selectedTargets, targetingMode, poiTypes, poiCount, researchState: packet?.researchState, onProgress });
      packet = { ...(packet || {}), ...expansion, sources: expansion.sources || [], retrievedSources: expansion.retrievedSources || [], failures: expansion.failures || [], researchState: expansion.researchState, recoveryExpansions: [...(packet?.recoveryExpansions || []), expansion.stats] };
    }
    const askFor = remaining;
    const beforeCount = current.chits.length;
    const prompt = buildMissionPrompt({ form, sliders, selectedTargets, targetingMode, includeFollowUp, poiCount: askFor, poiTypes, researchPacket: packet, batchNumber: level, totalBatches: maxAttempts, previousPoiMetadata: compactPoiMetadata(current.chits) }) + `\n\nRECOVERY INSTRUCTIONS: ${recoveryFocus(level, analysis)} Need exactly ${remaining} more final POIs. Return ${askFor} candidate POIs; ChitForge will keep only defensible non-duplicates.`;
    try {
      const response = await callGemini(form.apiKey, prompt, { ...modelSelection, schema: CHITFORGE_RESPONSE_SCHEMA });
      const extra = await recoverMission({ apiKey: form.apiKey, text: response.text, ctx: { form, sliders, includeFollowUp, poiCount: askFor, targetingMode: `recovery-${level}`, poiTypes, lengthInfo: lengthInfo(sliders.length) }, modelSelection, modelInfo: { primaryModel: response.model.displayName } });
      current = { ...mergeRecoveryCandidates(current, extra.chits, poiCount), recommendedTargets: [...(current.recommendedTargets || []), ...(extra.recommendedTargets || [])] };
    } catch (error) { recoveryLog.at(-1).error = error?.message || String(error); }
    if (current.chits.length === beforeCount && level >= 3) recoveryLog.at(-1).diminishingReturns = true;
  }
  current.metadata = { ...(current.metadata || {}), initialGenerationDiagnostics: mission.diagnostics || {}, recoveryResearchRounds, maxRecoveryResearchRounds: MAX_RECOVERY_RESEARCH_ROUNDS, recoveryLog, partialResult: current.chits.length < poiCount, partialResultReason: current.chits.length < poiCount ? `${current.chits.length} of ${poiCount} defensible POIs generated. Additional candidates were not retained because bounded recovery could not establish enough distinct supported POIs.` : '' };
  return current;
}
