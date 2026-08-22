export const RESEARCH_DB_NAME = 'ChitForgeResearchJobStore';
export const RESEARCH_DB_VERSION = 2;
export const RESEARCH_STORES = ['jobs','stageArtifacts','stageMetadata','queryBatches','ddgsBatches','sources','actors','targets','evidence','incidents','pois','progress','errors','diagnostics'];

function memoryStore() {
  const buckets = new Map(RESEARCH_STORES.map((name) => [name, new Map()]));
  return {
    async put(store, value) { buckets.get(store).set(value.id, value); return value; },
    async get(store, id) { return buckets.get(store).get(id) || null; },
    async getAll(store) { return [...buckets.get(store).values()]; },
    async clearJob(jobId) { for (const bucket of buckets.values()) for (const [id, value] of bucket) if (value.jobId === jobId || id === jobId) bucket.delete(id); },
  };
}

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RESEARCH_DB_NAME, RESEARCH_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      RESEARCH_STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('jobId', 'jobId', { unique: false });
          if (name === 'progress') store.createIndex('jobStage', ['jobId', 'stage'], { unique: false });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class ResearchJobStore {
  constructor(db) { this.db = db; this.fallback = db ? null : memoryStore(); }
  static async create() { return new ResearchJobStore(await openDb()); }
  tx(store, mode = 'readonly') { return this.db.transaction(store, mode).objectStore(store); }
  req(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async put(store, value) { const record = { ...value, updatedAt: new Date().toISOString() }; if (this.fallback) return this.fallback.put(store, record); await this.req(this.tx(store, 'readwrite').put(record)); return record; }
  async get(store, id) { return this.fallback ? this.fallback.get(store, id) : this.req(this.tx(store).get(id)); }
  async getAll(store) { return this.fallback ? this.fallback.getAll(store) : this.req(this.tx(store).getAll()); }
  async clearJob(jobId) {
    if (this.fallback) return this.fallback.clearJob(jobId);
    await Promise.all(RESEARCH_STORES.map(async (storeName) => {
      const all = await this.getAll(storeName);
      await Promise.all(all.filter((r) => r.jobId === jobId || r.id === jobId).map((r) => this.req(this.tx(storeName, 'readwrite').delete(r.id))));
    }));
  }
  async createJob(input) { const id = `job_${Date.now()}`; return this.put('jobs', { id, jobId:id, status:'running', input, createdAt:new Date().toISOString() }); }
  async putArtifact(jobId, stage, artifact) { return this.put('stageArtifacts', { id:`${jobId}_${stage}_artifact`, jobId, stage, artifact }); }
  async getArtifact(jobId, stage) { return this.get('stageArtifacts', `${jobId}_${stage}_artifact`); }
  async putStageMetadata(jobId, stage, status, extra = {}) { return this.put('stageMetadata', { id:`${jobId}_${stage}_metadata`, jobId, stage, status, ...extra }); }
  async getStageMetadata(jobId, stage) { return this.get('stageMetadata', `${jobId}_${stage}_metadata`); }
  async putBatch(store, jobId, stage, batchId, records, extra = {}) { return this.put(store, { id:`${jobId}_${stage}_${batchId}`, jobId, stage, batchId, records, ...extra }); }
  async putProgress(jobId, progress) { return this.put('progress', { id:`${jobId}_progress`, jobId, ...sanitizeProgress(progress) }); }
}

export function sanitizeProgress(progress) {
  const total = Math.max(1, Math.trunc(Number.isFinite(progress.total) ? progress.total : 1));
  const completed = Math.min(total, Math.max(0, Math.trunc(Number.isFinite(progress.completed ?? progress.done) ? (progress.completed ?? progress.done) : 0)));
  return { stage: progress.stage || 'stage_0', phase: progress.phase || 'running', completed, total, batch: Math.max(0, Math.trunc(progress.batch || 0)), batchTotal: Math.max(1, Math.trunc(progress.batchTotal || 1)), status: progress.status || 'running', detail: progress.detail || '' };
}
