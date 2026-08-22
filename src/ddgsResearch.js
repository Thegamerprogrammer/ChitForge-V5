// The one authoritative retrieval and evidence-processing layer.  It talks to
// the locally installed DDGS bridge, whose server uses the DDGS Python API.
const DDGS_BASE_URL = 'http://127.0.0.1:4479';
export const MAX_POIS = 100;
export const FREEZE_STATUSES = ['PRE_FREEZE', 'POST_FREEZE_PRE_FREEZE_EVENT', 'POST_FREEZE_NEW_EVENT', 'DATE_UNKNOWN'];

export const queryBudget = (requestedPOIs) => ({ stage1: Math.round(requestedPOIs * 7.5), stage2: requestedPOIs * 10 });
export function canonicalUrl(raw = '') { try { const u = new URL(raw); u.hash = ''; ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid'].forEach((k) => u.searchParams.delete(k)); u.hostname = u.hostname.replace(/^www\./, '').toLowerCase(); u.pathname = u.pathname.replace(/\/$/, ''); return u.toString(); } catch { return ''; } }
export function domainFromResult(url = '') { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, body, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt += 1) try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(`${DDGS_BASE_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }); clearTimeout(timeout);
    if (!response.ok) throw new Error(`DDGS HTTP ${response.status}`); return response.json();
  } catch (error) { if (attempt === retries) throw error; await sleep(300 * (attempt + 1)); }
  return null;
}
export async function ddgsSearch(query, kind = 'text', maxResults = 6) {
  try { const payload = await request(`/search/${kind}`, { query, region: 'us-en', safesearch: 'moderate', max_results: maxResults, backend: 'auto' }); return Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : []; } catch { return []; }
}
export async function extractUrl(url) { try { const p = await request('/extract', { url, fmt: 'text_plain' }, 1); return String(p?.content || '').slice(0, 5000); } catch { return ''; } }
async function pooled(items, worker, limit = 6) { const output = []; let cursor = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (cursor < items.length) { const item = items[cursor++]; output.push(await worker(item)); } })); return output; }
export function newsShare(controversy) { if (controversy <= 30) return .2; if (controversy <= 60) return .5; if (controversy <= 80) return .7; return .85; }
export function allocateActorQueries(actors, budget) { const count = Math.min(actors.length, Math.max(0, budget)); const active = actors.slice(0, count); if (!active.length) return actors.map((actor) => ({ ...actor, queryAllocation: 0 })); const total = active.reduce((sum, actor) => sum + Math.max(1, Number(actor.relevance) || 1), 0) || 1; const allocations = active.map((actor) => Math.floor((Math.max(1, Number(actor.relevance) || 1) / total) * budget)); let remaining = budget - allocations.reduce((sum, value) => sum + value, 0); const order = active.map((actor, index) => ({ index, weight: Math.max(1, Number(actor.relevance) || 1) })).sort((a, b) => b.weight - a.weight); for (let index = 0; remaining > 0; index = (index + 1) % order.length) { allocations[order[index].index] += 1; remaining -= 1; } return actors.map((actor, index) => ({ ...actor, queryAllocation: allocations[index] || 0 })); }
export function normalizeResults(results, query, kind) { return results.map((r) => { const url = canonicalUrl(r.href || r.url || r.link); return url ? { id: '', url, canonicalUrl: url, title: String(r.title || 'Untitled source'), snippet: String(r.body || r.snippet || ''), publicationDate: r.date || r.published || '', eventDate: '', informationAvailabilityDate: '', query, retrievalKind: kind, domain: domainFromResult(url), extractedText: '' } : null; }).filter(Boolean); }
export function deduplicateSources(sources) { const map = new Map(); sources.forEach((s) => { if (!map.has(s.canonicalUrl)) map.set(s.canonicalUrl, s); }); return [...map.values()]; }
export function freezeValidation({ publicationDate, eventDate, informationAvailabilityDate, freezeDate }) {
  const timestamp = (x) => x && !Number.isNaN(Date.parse(x)) ? Date.parse(x) : null; const freeze = timestamp(freezeDate); const publication = timestamp(publicationDate); const event = timestamp(eventDate); const availability = timestamp(informationAvailabilityDate);
  if (!freeze || (!publication && !event && !availability)) return { freezeStatus: 'DATE_UNKNOWN', usable: false };
  if (publication && publication <= freeze) return { freezeStatus: 'PRE_FREEZE', usable: true };
  if (event && event <= freeze && availability && availability <= freeze) return { freezeStatus: 'POST_FREEZE_PRE_FREEZE_EVENT', usable: true };
  if ((event && event > freeze) || (availability && availability > freeze)) return { freezeStatus: 'POST_FREEZE_NEW_EVENT', usable: false };
  return { freezeStatus: 'DATE_UNKNOWN', usable: false };
}
export function incidentKey(evidence) { return `${evidence.country || ''}|${String(evidence.claim || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 4).slice(0, 12).sort().join(' ')}`; }
export function clusterIncidents(evidence) { const clusters = new Map(); evidence.forEach((item) => { const key = incidentKey(item); if (!clusters.has(key)) clusters.set(key, { id: `incident_${clusters.size + 1}`, country: item.country, evidenceIds: [], claims: [], evidence: [] }); const cluster = clusters.get(key); cluster.evidenceIds.push(...item.sourceIds); cluster.claims.push(item.claim); cluster.evidence.push(item); }); return [...clusters.values()]; }
export function targetValue(components) { const weights = { agendaRelevance:.30, evidenceStrength:.20, legalAccountability:.15, controversyFit:.15, recency:.10, sourceQuality:.07, corroboration:.03 }; return Object.entries(weights).reduce((sum, [key, weight]) => sum + (Number(components[key]) || 0) * weight, 0); }
export async function retrieveQueries(queries, { controversy = 0, onProgress, stage, freezeDate = '' }) {
  const share = newsShare(controversy); const entries = await pooled(queries, async (query, index) => { const kind = stage === 1 ? 'text' : ((index % 100) < Math.round(share * 100) ? 'news' : 'text'); const rows = await ddgsSearch(query, kind); onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `Stage ${stage} DDGS ${index + 1}/${queries.length} (${kind}, backend auto).`, done: index + 1, total: queries.length }); return normalizeResults(rows, query, kind); });
  const sources = deduplicateSources(entries.flat()); const extracted = await pooled(sources.slice(0, 80), async (source) => ({ ...source, extractedText: await extractUrl(source.url) }), 5); return deduplicateSources(extracted).map((source) => ({ ...source, ...freezeValidation({ ...source, freezeDate }) }));
}
