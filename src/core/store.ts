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

  getPendingRequestByRequestId(requestId: string, connectionKey: string): PendingServerRequestRecord | undefined {
    return this.state.pendingRequests.find(
      (entry) => entry.requestId === requestId && entry.connectionKey === connectionKey,
    );
  }

  listPendingRequests(status?: PendingServerRequestRecord['status']): PendingServerRequestRecord[] {
    const entries = status ? this.state.pendingRequests.filter((entry) => entry.status === status) : this.state.pendingRequests;
    return [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
    await mkdir(ensureStateRoot().rootDir, { recursive: true });
    await appendFile(transcriptPath(input.cwd, input.threadId), `${JSON.stringify(input.payload)}\n`);
    if (input.logLine) {
      await appendFile(logPath(input.cwd, input.threadId), `${input.logLine}\n`);
    }
  }

  async persist(): Promise<void> {
    await writeFile(this.root.registryPath, JSON.stringify(this.state, null, 2));
  }
}
