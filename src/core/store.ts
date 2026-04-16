import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { generateId } from './ids.js';
import { ensureStateRoot, logPath, transcriptPath } from './paths.js';
import type {
  AccountProfileState,
  LocalJobRecord,
  PendingServerRequestRecord,
  StateFile,
  ThreadRecord,
  TurnErrorDetail,
  TurnRecord,
} from './types.js';

const EMPTY_STATE: StateFile = {
  version: 1,
  profiles: [],
  threads: [],
  turns: [],
  pendingRequests: [],
  jobs: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

export class PersistentStore {
  private readonly root = ensureStateRoot();
  private state: StateFile = structuredClone(EMPTY_STATE);

  async load(): Promise<void> {
    if (!existsSync(this.root.registryPath)) {
      this.state = structuredClone(EMPTY_STATE);
      await this.persist();
      return;
    }

    const raw = await readFile(this.root.registryPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StateFile>;
    this.state = {
      version: 1,
      profiles: parsed.profiles ?? [],
      threads: parsed.threads ?? [],
      turns: parsed.turns ?? [],
      pendingRequests: parsed.pendingRequests ?? [],
      jobs: parsed.jobs ?? [],
    };
  }

  getProfiles(): AccountProfileState[] {
    return this.state.profiles.map((profile) => ({ ...profile }));
  }

  setProfiles(profiles: AccountProfileState[]): void {
    this.state.profiles = profiles.map((profile) => ({ ...profile }));
  }

  listThreads(): ThreadRecord[] {
    return [...this.state.threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getThread(threadId: string): ThreadRecord | undefined {
    const lowered = threadId.toLowerCase();
    return this.state.threads.find((thread) => thread.id.toLowerCase() === lowered);
  }

  upsertThread(input: ThreadRecord): ThreadRecord {
    const existing = this.getThread(input.id);
    if (existing) {
      Object.assign(existing, input, { updatedAt: nowIso() });
      return existing;
    }

    const record = { ...input };
    this.state.threads.push(record);
    return record;
  }

  updateThread(threadId: string, updates: Partial<ThreadRecord>): ThreadRecord {
    const thread = this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    Object.assign(thread, updates, { updatedAt: nowIso() });
    return thread;
  }

  listTurns(threadId?: string): TurnRecord[] {
    const turns = threadId ? this.state.turns.filter((turn) => turn.threadId === threadId) : this.state.turns;
    return [...turns].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  getTurn(turnId: string): TurnRecord | undefined {
    const lowered = turnId.toLowerCase();
    return this.state.turns.find((turn) => turn.id.toLowerCase() === lowered);
  }

  upsertTurn(input: TurnRecord): TurnRecord {
    const existing = this.getTurn(input.id);
    if (existing) {
      Object.assign(existing, input);
      return existing;
    }

    const record = { ...input };
    this.state.turns.push(record);
    return record;
  }

  updateTurn(turnId: string, updates: Partial<TurnRecord>): TurnRecord {
    const turn = this.getTurn(turnId);
    if (!turn) {
      throw new Error(`Turn not found: ${turnId}`);
    }

    Object.assign(turn, updates);
    return turn;
  }

  replaceTurnsForThread(threadId: string, turns: Array<Partial<TurnRecord> & { id: string }>): void {
    this.state.turns = this.state.turns.filter((turn) => turn.threadId !== threadId);
    const timestamp = nowIso();
    for (const input of turns) {
      this.state.turns.push({
        id: input.id,
        threadId,
        status: typeof input.status === 'string' ? input.status : 'completed',
        source: (input.source as TurnRecord['source'] | undefined) ?? 'turn/start',
        inputFilePath: typeof input.inputFilePath === 'string' ? input.inputFilePath : undefined,
        promptPreview: typeof input.promptPreview === 'string' ? input.promptPreview : '',
        startedAt: typeof input.startedAt === 'string' ? input.startedAt : timestamp,
        completedAt: typeof input.completedAt === 'string' ? input.completedAt : undefined,
        error: typeof input.error === 'string' ? input.error : undefined,
        errorInfo: input.errorInfo && typeof input.errorInfo === 'object' ? input.errorInfo as TurnErrorDetail : undefined,
      });
    }
  }

  createJob(input: Omit<LocalJobRecord, 'id' | 'createdAt' | 'updatedAt'>): LocalJobRecord {
    const timestamp = nowIso();
    const record: LocalJobRecord = {
      ...input,
      id: generateId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.state.jobs.push(record);
    return record;
  }

  getJob(jobId: string): LocalJobRecord | undefined {
    const lowered = jobId.toLowerCase();
    return this.state.jobs.find((job) => job.id.toLowerCase() === lowered);
  }

  listJobs(): LocalJobRecord[] {
    return [...this.state.jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  pruneJobsForThreadTurns(threadId: string, allowedTurnIds: string[]): void {
    const allowed = new Set(allowedTurnIds.map((id) => id.toLowerCase()));
    this.state.jobs = this.state.jobs.filter((job) => job.threadId !== threadId || allowed.has(job.turnId.toLowerCase()));
  }

  updateJob(jobId: string, updates: Partial<LocalJobRecord>): LocalJobRecord {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    Object.assign(job, updates, { updatedAt: nowIso() });
    return job;
  }

  createPendingRequest(input: Omit<PendingServerRequestRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>): PendingServerRequestRecord {
    const existing = this.getPendingRequestByRequestId(input.requestId, input.connectionKey);
    const timestamp = nowIso();
    if (existing) {
      Object.assign(existing, input, { status: 'pending', updatedAt: timestamp });
      return existing;
    }

    const record: PendingServerRequestRecord = {
      ...input,
      id: generateId(),
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.state.pendingRequests.push(record);
    return record;
  }

  getPendingRequest(id: string): PendingServerRequestRecord | undefined {
    const lowered = id.toLowerCase();
    return this.state.pendingRequests.find((request) => request.id.toLowerCase() === lowered);
  }

  getPendingRequestByRequestId(requestId: PendingServerRequestRecord['requestId'], connectionKey: string): PendingServerRequestRecord | undefined {
    return this.state.pendingRequests.find(
      (entry) => entry.requestId === requestId && entry.connectionKey === connectionKey,
    );
  }

  listPendingRequests(status?: PendingServerRequestRecord['status']): PendingServerRequestRecord[] {
    const entries = status ? this.state.pendingRequests.filter((entry) => entry.status === status) : this.state.pendingRequests;
    return [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  prunePendingRequestsForThreadTurns(threadId: string, allowedTurnIds: string[]): void {
    const allowed = new Set(allowedTurnIds.map((id) => id.toLowerCase()));
    this.state.pendingRequests = this.state.pendingRequests.filter((request) => {
      if (request.threadId !== threadId) {
        return true;
      }
      if (!request.turnId) {
        return false;
      }
      return allowed.has(request.turnId.toLowerCase());
    });
  }

  resolvePendingRequest(id: string, response: Record<string, unknown>): PendingServerRequestRecord {
    const request = this.getPendingRequest(id);
    if (!request) {
      throw new Error(`Pending request not found: ${id}`);
    }

    Object.assign(request, {
      status: 'responded',
      response,
      resolvedAt: nowIso(),
      updatedAt: nowIso(),
    });
    return request;
  }

  failPendingRequest(id: string, error: string): PendingServerRequestRecord {
    const request = this.getPendingRequest(id);
    if (!request) {
      throw new Error(`Pending request not found: ${id}`);
    }

    Object.assign(request, {
      status: 'failed',
      error,
      resolvedAt: nowIso(),
      updatedAt: nowIso(),
    });
    return request;
  }

  async appendThreadEvent(input: {
    cwd: string;
    threadId: string;
    payload: Record<string, unknown>;
    logLine?: string | undefined;
  }): Promise<void> {
    try {
      await mkdir(ensureStateRoot().rootDir, { recursive: true });
      await appendFile(transcriptPath(input.cwd, input.threadId), `${JSON.stringify(input.payload)}\n`);
      if (input.logLine) {
        await appendFile(logPath(input.cwd, input.threadId), `${input.logLine}\n`);
      }
    } catch (err) {
      process.stderr.write(`warning: failed to write thread event: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  async persist(): Promise<void> {
    try {
      await writeFile(this.root.registryPath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      process.stderr.write(`warning: failed to persist registry: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}
