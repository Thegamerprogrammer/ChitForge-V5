import assert from 'node:assert/strict';
import { callGemini, GeminiError, MODEL_SELECTION_MODES } from './gemini.js';

let generateCalls = 0;
global.fetch = async (url) => {
  const value = String(url);
  if (value.endsWith('/models')) return Response.json({ models: [
    { name: 'models/gemini-interactions-only', displayName: 'Gemini Interactions Only', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 100000, outputTokenLimit: 8192 },
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 100000, outputTokenLimit: 8192 },
  ] });
  generateCalls += 1;
  if (value.includes('gemini-interactions-only')) return Response.json({ error: { message: 'This model only supports Interactions API.' } }, { status: 400 });
  return Response.json({ candidates: [{ content: { parts: [{ text: '{"pois":[]}' }] } }] });
};

const response = await callGemini('test-key', 'Return JSON', { modelMode: MODEL_SELECTION_MODES.MANUAL, manualModelId: 'gemini-interactions-only' });
assert.equal(response.model.id, 'gemini-2.5-flash');
assert.equal(response.text, '{"pois":[]}');
assert.equal(generateCalls, 2);
assert(response.fallbackLog.some((entry) => entry.reason === 400 || entry.reason === 'model-unavailable'));

let ddgsWasCalled = false;
global.fetch = async (url) => {
  const value = String(url);
  if (value.includes('127.0.0.1:4479')) ddgsWasCalled = true;
  if (value.endsWith('/models')) return Response.json({ models: [{ name: 'models/gemini-interactions-only-2', displayName: 'Interactions Only 2', supportedGenerationMethods: ['generateContent'] }] });
  return Response.json({ error: { message: 'This model only supports Interactions API.' } }, { status: 400 });
};
await assert.rejects(() => callGemini('another-key', 'Return JSON', { modelMode: MODEL_SELECTION_MODES.BEST }), (error) => error instanceof GeminiError && error.category === 'all-models-failed');
assert.equal(ddgsWasCalled, false, 'Gemini failures do not trigger DDGS requests');

console.log('Gemini/DDGS error separation tests passed');

let discoveryCalls = 0;
global.fetch = async (url, options) => {
  const value = String(url);
  if (value.endsWith('/models')) { discoveryCalls += 1; await Promise.resolve(); return Response.json({ models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 100000, outputTokenLimit: 4096 }] }); }
  const body = JSON.parse(options.body);
  assert.equal(body.generationConfig.maxOutputTokens, 4096);
  return Response.json({ candidates: [{ content: { parts: [{ text: '{"pois":[]}' }] } }] });
};
await Promise.all(Array.from({ length: 20 }, () => callGemini('stampede-key', 'Return JSON')));
assert.equal(discoveryCalls, 1, 'concurrent model discovery is coalesced');

const tokenLimits = [1024, 4096, 32768];
const expectedMax = [1024, 4096, 8192];
for (let i = 0; i < tokenLimits.length; i += 1) {
  let seenMax = 0;
  global.fetch = async (url, options) => {
    const value = String(url);
    if (value.endsWith('/models')) return Response.json({ models: [{ name: `models/token-${tokenLimits[i]}`, displayName: `Token ${tokenLimits[i]}`, supportedGenerationMethods: ['generateContent'], inputTokenLimit: 100000, outputTokenLimit: tokenLimits[i] }] });
    seenMax = JSON.parse(options.body).generationConfig.maxOutputTokens;
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"pois":[]}' }] } }] });
  };
  await callGemini(`token-key-${i}`, 'Return JSON');
  assert.equal(seenMax, expectedMax[i], `maxOutputTokens respects model limit ${tokenLimits[i]}`);
}

let transientGenerateCalls = 0;
global.fetch = async (url) => {
  const value = String(url);
  if (value.endsWith('/models')) return Response.json({ models: [
    { name: 'models/transient-a', displayName: 'Transient A', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 100000, outputTokenLimit: 4096 },
    { name: 'models/transient-b', displayName: 'Transient B', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 100000, outputTokenLimit: 4096 },
    { name: 'models/transient-c', displayName: 'Transient C', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 100000, outputTokenLimit: 4096 },
  ] });
  transientGenerateCalls += 1;
  return Response.json({ error: { message: 'unavailable' } }, { status: 503 });
};
await assert.rejects(() => callGemini('transient-key', 'Return JSON'), (error) => error instanceof GeminiError && error.category === 'all-models-failed');
assert.equal(transientGenerateCalls, 2, 'bounded fallback tries at most two models for transient failures');

let permanentGenerateCalls = 0;
global.fetch = async (url) => {
  const value = String(url);
  if (value.endsWith('/models')) return Response.json({ models: [{ name: 'models/perm', displayName: 'Permanent', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 100000, outputTokenLimit: 4096 }] });
  permanentGenerateCalls += 1;
  return Response.json({ error: { message: 'bad key' } }, { status: 403 });
};
await assert.rejects(() => callGemini('permanent-key', 'Return JSON'), (error) => error instanceof GeminiError && error.category === 'invalid-api-key');
assert.equal(permanentGenerateCalls, 1, 'permanent auth failure does not retry generation');
