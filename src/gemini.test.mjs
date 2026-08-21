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
