import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';

import { readCodexConfig, type CodexConfigDefaults } from '../core/codex-config.js';
import { appendRawEvent } from '../core/raw-log.js';
import { classifyWorkerFailure } from '../core/failure-classifier.js';
import { appendFleetDeveloperInstructions } from '../core/fleet-mode.js';
import {
  buildModelCatalog,
  describeAllowedModels,
  resolveRequestedModel,
  type ModelCatalog,
  type ModelCatalogInput,
} from '../core/model-catalog.js';
import { ensureStateRoot, logPath, rawLogPath, transcriptPath } from '../core/paths.js';
import { ProfileFaultPlanner } from '../core/profile-faults.js';
import { ProfileManager } from '../core/profile-manager.js';
import { PersistentStore } from '../core/store.js';
import type {
  AccountProfileState,
  CodexErrorTag,
  LocalJobRecord,
  PendingServerRequestRecord,
  ThreadRecord,
  TurnErrorDetail,
  TurnRecord,
} from '../core/types.js';
import {
  AppServerClient,
  type RpcId,
  type RpcNotificationMessage,
  type RpcServerRequestMessage,
} from '../runtime/app-server.js';

const DEFAULT_MODEL = 'gpt-5.4';
const FALLBACK_TURN_IDLE_TIMEOUT_MS = 30 * 60_000;

function resolveTurnIdleTimeoutMs(): number {
  const raw = process.env.CODEX_WORKER_TURN_TIMEOUT_MS;
  if (raw === undefined) return FALLBACK_TURN_IDLE_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return FALLBACK_TURN_IDLE_TIMEOUT_MS;
  return n;
}

type AppServerLike = {
  start(): Promise<void>;
  stop(): Promise<void>;
  request<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> | undefined,
  ): Promise<T>;
  respond(requestId: RpcId, payload: Record<string, unknown>): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
};

interface EventWriter {
  event(name: string, data: Record<string, unknown>): void;
}

interface ActiveExecution {
  threadId: string;
  turnId: string;
  jobId: string;
  source: TurnRecord['source'];
  connectionKey: string;
  cwd: string;
  codexHome: string;
  client: AppServerLike;
  writer?: EventWriter | undefined;
  settled: boolean;
  detach: () => void;
  visible: Promise<Record<string, unknown>>;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export interface CliCodexWorkerServiceOptions {
  connectionFactory?: ((cwd: string, codexHome: string) => AppServerLike) | undefined;
}

// ---------------------------------------------------------------------------
// CodexErrorInfo wire-format parser
// ---------------------------------------------------------------------------

/**
 * Map from camelCase wire strings to snake_case CodexErrorTag.
 * Covers every variant of the upstream CodexErrorInfo discriminated union.
 */
const CODEX_ERROR_INFO_TAG_MAP: Record<string, CodexErrorTag> = {
  contextWindowExceeded: 'context_window_exceeded',
  usageLimitExceeded: 'usage_limit_exceeded',
  serverOverloaded: 'server_overloaded',
  httpConnectionFailed: 'http_connection_failed',
  responseStreamConnectionFailed: 'response_stream_connection_failed',
  responseStreamDisconnected: 'response_stream_disconnected',
  responseTooManyFailedAttempts: 'response_too_many_failed_attempts',
  internalServerError: 'internal_server_error',
  unauthorized: 'unauthorized',
  badRequest: 'bad_request',
  threadRollbackFailed: 'thread_rollback_failed',
  sandboxError: 'sandbox_error',
  activeTurnNotSteerable: 'active_turn_not_steerable',
  other: 'other',
};

/**
 * Parse the upstream codexErrorInfo value into a CodexErrorTag and optional httpStatusCode.
 *
 * The wire value is either:
 *   - a string literal:  "contextWindowExceeded"
 *   - an object with a single key:  { "httpConnectionFailed": { "httpStatusCode": 502 } }
 */
function parseCodexErrorInfo(value: unknown): { tag: CodexErrorTag; httpStatusCode?: number } {
  if (typeof value === 'string') {
    return { tag: CODEX_ERROR_INFO_TAG_MAP[value] ?? 'other' };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1) {
      const key = keys[0]!;
      const tag = CODEX_ERROR_INFO_TAG_MAP[key] ?? 'other';
      const inner = (value as Record<string, unknown>)[key];
      const httpStatusCode = isRecord(inner)
        ? (typeof inner.httpStatusCode === 'number' ? inner.httpStatusCode : undefined)
        : undefined;
      return { tag, httpStatusCode };
    }
  }
  return { tag: 'other' };
}

/**
 * Build a TurnErrorDetail from an upstream TurnError-shaped object
 * (the turn.error field on turn/completed, or params.error on error notification).
 */
function parseTurnError(
  turnError: Record<string, unknown> | undefined,
  fallbackMessage: string,
): TurnErrorDetail {
  if (!turnError) {
    return { message: fallbackMessage, tag: 'other' };
  }
  const message = stringValue(turnError.message) ?? fallbackMessage;
  const additionalDetails = stringValue(turnError.additionalDetails);
  const codexInfo = turnError.codexErrorInfo;
  const { tag, httpStatusCode } = codexInfo != null
    ? parseCodexErrorInfo(codexInfo)
    : { tag: 'other' as CodexErrorTag, httpStatusCode: undefined };

  return {
    message,
    tag,
    ...(httpStatusCode !== undefined ? { httpStatusCode } : {}),
    ...(additionalDetails ? { additionalDetails } : {}),
    ...(codexInfo != null ? { raw: isRecord(codexInfo) ? codexInfo : { value: codexInfo } } : {}),
  };
}

/**
 * Build a TurnErrorDetail from the params of an `error` notification.
 * The error shape lives at params.error (not at the top level).
 */
function parseTurnErrorFromParams(params: Record<string, unknown>): TurnErrorDetail {
  const remoteError = isRecord(params.error) ? params.error : undefined;
  const fallback = stringValue(params.message)
    ?? (remoteError ? JSON.stringify(remoteError).slice(0, 200) : undefined)
    ?? JSON.stringify(params).slice(0, 200);
  return parseTurnError(remoteError, fallback);
}

/** Create a TurnErrorDetail for failures that originate inside codex-worker. */
function localErrorDetail(tag: CodexErrorTag, message: string): TurnErrorDetail {
  return { message, tag };
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function commandVersion(command: string): string | null {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }
  return (result.stdout || result.stderr).trim() || null;
}

function connectionKey(cwd: string, codexHome: string): string {
  return `${cwd}::${codexHome}`;
}

function promptPreview(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function buildTextInput(text: string): Array<Record<string, unknown>> {
  return [{ type: 'text', text }];
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Expected a JSON object.');
  }
  return parsed;
}

async function readTailLines(filePath: string, limit: number): Promise<string[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .split(/\r?\n/g)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(-limit);
  } catch {
    return [];
  }
}

async function readTailJson(filePath: string, limit: number): Promise<Array<Record<string, unknown>>> {
  const lines = await readTailLines(filePath, limit);
  const parsed: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as unknown;
      if (isRecord(value)) {
        parsed.push(value);
      }
    } catch {
      // ignore malformed lines
    }
  }
  return parsed;
}

function buildDisplayLog(
  recentEvents: Array<Record<string, unknown>>,
  rawLogTail: string[],
): string[] {
  const lines: string[] = [];
  let assistantBuffer = '';

  const pushLine = (line: string) => {
    if (line.length === 0) {
      return;
    }
    if (lines.at(-1) === line) {
      return;
    }
    lines.push(line);
  };

  const flushAssistant = () => {
    if (!assistantBuffer) {
      return;
    }
    pushLine(assistantBuffer);
    assistantBuffer = '';
  };

  for (const event of recentEvents) {
    if (event.type === 'assistant.delta' && typeof event.delta === 'string') {
      assistantBuffer += event.delta;
      continue;
    }

    flushAssistant();

    if (event.type === 'user') {
      const prompt = typeof event.prompt === 'string'
        ? event.prompt
        : (typeof event.text === 'string' ? event.text : undefined);
      if (prompt) {
        pushLine(`> ${prompt}`);
      }
      continue;
    }

    if (event.type === 'request' && typeof event.method === 'string') {
      pushLine(`request: ${event.method}`);
      continue;
    }

    if (event.type === 'notification' && event.method === 'item/completed') {
      const params = isRecord(event.params) ? event.params : undefined;
      const item = params && isRecord(params.item) ? params.item : undefined;
      if (item?.type === 'agentMessage' && typeof item.text === 'string' && item.text.length > 0) {
        assistantBuffer = '';
        pushLine(item.text);
      }
    }
  }

  flushAssistant();

  if (lines.length > 0) {
    return lines;
  }
  return rawLogTail;
}

export class CliCodexWorkerService {
  readonly store = new PersistentStore();
  readonly activeExecutions = new Map<string, ActiveExecution>();
  readonly connectionFactory: (cwd: string, codexHome: string) => AppServerLike;
  profileManager!: ProfileManager;
  faultPlanner!: ProfileFaultPlanner;
  private readonly configCache = new Map<string, CodexConfigDefaults>();

  constructor(options: CliCodexWorkerServiceOptions = {}) {
    this.connectionFactory = options.connectionFactory ?? ((cwd, codexHome) => (
      new AppServerClient(cwd, codexHome)
    ));
  }

  private getConfigFor(codexHome: string): CodexConfigDefaults {
    let cfg = this.configCache.get(codexHome);
    if (cfg === undefined) {
      cfg = readCodexConfig(codexHome);
      this.configCache.set(codexHome, cfg);
    }
    return cfg;
  }

  async initialize(): Promise<void> {
    await this.store.load();
    this.profileManager = ProfileManager.fromEnvironment(this.store.getProfiles());
    this.faultPlanner = ProfileFaultPlanner.fromEnvironment();
    this.store.setProfiles(this.profileManager.toPersistedState());
    await this.store.persist();
  }

  async daemonStatus(): Promise<Record<string, unknown>> {
    const { daemonMetaPath, socketPath } = ensureStateRoot();
    return {
      status: 'running',
      socketPath,
      daemonMetaPath,
      profiles: this.profileManager.getProfiles(),
      activeExecutions: this.activeExecutions.size,
      threads: this.store.listThreads().length,
      pendingRequests: this.store.listPendingRequests('pending').length,
    };
  }

  async shutdown(): Promise<Record<string, unknown>> {
    for (const execution of this.activeExecutions.values()) {
      await execution.client.stop().catch(() => {});
    }
    this.activeExecutions.clear();
    return { status: 'stopped' };
  }

  async threadStart(args: Record<string, unknown> = {}, _writer?: EventWriter): Promise<Record<string, unknown>> {
    const cwd = stringValue(args.cwd) ?? process.cwd();
    const resolution = await this.resolveModelForCwd(cwd, stringValue(args.model));
    const started = await this.startThreadOnHealthyProfile(cwd, resolution.resolved, {
      developerInstructions: stringValue(args.developerInstructions),
      baseInstructions: stringValue(args.baseInstructions),
    });
    return {
      thread: started.thread,
      model: started.thread.model,
      modelProvider: started.thread.modelProvider,
      remappedFrom: resolution.remappedFrom,
      actions: this.buildActions(started.thread.id),
    };
  }

  async threadResume(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const threadId = stringValue(args.threadId);
    if (!threadId) {
      throw new Error('thread.resume requires threadId');
    }
    const localThread = this.resolveThread(threadId);
    const cwd = stringValue(args.cwd);
    const started = await this.startClientForThread(localThread, cwd);
    const detachRawLog = this.attachRawClientLogObservers(started.client, localThread.cwd, localThread.id);
    try {
      const cfg = this.getConfigFor(started.profile.codexHome);
      const params: Record<string, unknown> = {
        threadId: localThread.id,
        modelProvider: cfg.modelProvider ?? 'openai',
        approvalPolicy: cfg.approvalPolicy ?? 'on-request',
        sandbox: cfg.sandboxMode ?? 'workspace-write',
        persistExtendedHistory: false,
      };
      let remappedFrom: string | undefined;
      if (stringValue(args.model)) {
        const resolution = await this.resolveModelForCwd(cwd ?? localThread.cwd, stringValue(args.model));
        params.model = resolution.resolved;
        remappedFrom = resolution.remappedFrom;
      }
      if (cwd) {
        params.cwd = cwd;
      }
      if (stringValue(args.developerInstructions)) {
        params.developerInstructions = appendFleetDeveloperInstructions(stringValue(args.developerInstructions));
      }
      const response = await started.client.request('thread/resume', params);
      const remoteThread = isRecord(response.thread) ? response.thread : {};
      const thread = this.store.upsertThread({
        ...localThread,
        cwd: stringValue(remoteThread.cwd) ?? cwd ?? localThread.cwd,
        model: stringValue(response.model) ?? (params.model as string | undefined) ?? localThread.model,
        modelProvider: stringValue(response.modelProvider) ?? cfg.modelProvider ?? 'openai',
        updatedAt: nowIso(),
      });
      await this.persistProfiles();
      return {
        thread,
        model: thread.model,
        modelProvider: thread.modelProvider,
        remappedFrom,
        actions: this.buildActions(thread.id),
      };
    } finally {
      detachRawLog();
      await started.client.stop().catch(() => {});
    }
  }

  async threadRead(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const threadId = stringValue(args.threadId);
    if (!threadId) {
      throw new Error('thread.read requires threadId');
    }
    const localThread = this.resolveThread(threadId);
    let remoteThread: Record<string, unknown> | undefined;
    try {
      const started = await this.startClientForThread(localThread);
      try {
        const response = await started.client.request('thread/read', {
          threadId: localThread.id,
          includeTurns: typeof args.includeTurns === 'boolean' ? args.includeTurns : true,
        });
        remoteThread = isRecord(response.thread) ? response.thread : undefined;
      } finally {
        await started.client.stop().catch(() => {});
      }
    } catch {
      remoteThread = undefined;
    }

    const tailLines = typeof args.tailLines === 'number' && Number.isFinite(args.tailLines)
      ? Math.max(1, Math.min(200, Math.trunc(args.tailLines)))
      : 20;
    const transcriptFilePath = transcriptPath(localThread.cwd, localThread.id);
    const logFilePath = logPath(localThread.cwd, localThread.id);
    const rawLogFilePath = rawLogPath(localThread.cwd, localThread.id);

    const recentEvents = await readTailJson(transcriptFilePath, tailLines);
    const rawLogTail = await readTailLines(logFilePath, tailLines);

    return {
      thread: remoteThread ?? localThread,
      localThread,
      turns: this.store.listTurns(localThread.id),
      pendingRequests: this.store.listPendingRequests('pending').filter((entry) => entry.threadId === localThread.id),
      artifacts: {
        transcriptPath: transcriptFilePath,
        logPath: logFilePath,
        rawLogPath: rawLogFilePath,
        recentEvents,
        logTail: rawLogTail,
        displayLog: buildDisplayLog(recentEvents, rawLogTail),
      },
      actions: this.buildActions(localThread.id),
    };
  }

  async threadList(_args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return {
      data: this.store.listThreads(),
    };
  }

  async threadRollback(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const threadId = stringValue(args.threadId);
    if (!threadId) {
      throw new Error('thread.rollback requires threadId');
    }
    const thread = this.resolveThread(threadId);
    const started = await this.startClientForThread(thread);
    try {
      const response = await started.client.request('thread/rollback', {
        threadId: thread.id,
        numTurns: typeof args.numTurns === 'number' ? args.numTurns : 1,
      });
      const remoteThread = isRecord(response.thread) ? response.thread : undefined;
      const turns = Array.isArray(remoteThread?.turns) ? remoteThread.turns.filter(isRecord) : [];
      this.store.replaceTurnsForThread(thread.id, turns as Array<Partial<TurnRecord> & { id: string }>);
      const allowedTurnIds = turns
        .map((turn) => stringValue(turn.id))
        .filter((id): id is string => Boolean(id));
      this.store.pruneJobsForThreadTurns(thread.id, allowedTurnIds);
      this.store.prunePendingRequestsForThreadTurns(thread.id, allowedTurnIds);
      this.store.updateThread(thread.id, {
        latestTurnId: allowedTurnIds[0],
        status: this.mapThreadStatus(remoteThread?.status ?? 'idle'),
      });
      await this.persistProfiles();
      return {
        thread: remoteThread ?? thread,
        actions: this.buildActions(thread.id),
      };
    } finally {
      await started.client.stop().catch(() => {});
    }
  }

  async run(args: Record<string, unknown>, writer?: EventWriter): Promise<Record<string, unknown>> {
    const cwd = stringValue(args.cwd);
    const content = stringValue(args.content);
    const inputFilePath = stringValue(args.inputFilePath);
    if (!cwd || !content || !inputFilePath) {
      throw new Error('run requires cwd, content, and inputFilePath');
    }
    const resolution = await this.resolveModelForCwd(cwd, stringValue(args.model));
    const started = await this.startThreadOnHealthyProfile(cwd, resolution.resolved, {
      developerInstructions: [
        'you are codex-worker.',
        'execute the file-backed task exactly and avoid unrelated work.',
      ].join(' '),
      taskPrompt: content,
    });

    const execution = await this.launchTurn({
      client: started.client,
      thread: started.thread,
      source: 'alias/run',
      alias: 'run',
      prompt: content,
      inputFilePath,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : resolveTurnIdleTimeoutMs(),
      writer,
      startTurn: async () => await started.client.request('turn/start', {
        threadId: started.thread.id,
        model: started.thread.model,
        input: buildTextInput(content),
      }),
    });

    if (Boolean(args.async)) {
      return {
        ...this.turnPayload(started.thread.id, execution.turn.id, execution.job.id),
        remappedFrom: resolution.remappedFrom,
      };
    }

    const visible = await execution.visible;
    return {
      ...visible,
      remappedFrom: resolution.remappedFrom,
    };
  }

  async send(args: Record<string, unknown>, writer?: EventWriter): Promise<Record<string, unknown>> {
    const threadId = stringValue(args.threadId);
    const content = stringValue(args.content);
    const inputFilePath = stringValue(args.inputFilePath);
    if (!threadId || !content || !inputFilePath) {
      throw new Error('send requires threadId, content, and inputFilePath');
    }
    const thread = this.resolveThread(threadId);
    const started = await this.startClientForThread(thread);
    const sendCfg = this.getConfigFor(started.profile.codexHome);
    await started.client.request('thread/resume', {
      threadId: thread.id,
      modelProvider: sendCfg.modelProvider ?? 'openai',
      approvalPolicy: sendCfg.approvalPolicy ?? 'on-request',
      sandbox: sendCfg.sandboxMode ?? 'workspace-write',
      persistExtendedHistory: false,
    });
    const execution = await this.launchTurn({
      client: started.client,
      thread,
      source: 'alias/send',
      alias: 'send',
      prompt: content,
      inputFilePath,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : resolveTurnIdleTimeoutMs(),
      writer,
      startTurn: async () => await started.client.request('turn/start', {
        threadId: thread.id,
        model: thread.model,
        input: buildTextInput(content),
      }),
    });

    if (Boolean(args.async)) {
      return this.turnPayload(thread.id, execution.turn.id, execution.job.id);
    }
    return await execution.visible;
  }

  async turnStart(args: Record<string, unknown>, writer?: EventWriter): Promise<Record<string, unknown>> {
    return await this.send({
      threadId: stringValue(args.threadId),
      content: stringValue(args.prompt) ?? stringValue(args.content) ?? '',
      inputFilePath: stringValue(args.inputFilePath) ?? 'prompt.md',
      async: Boolean(args.async),
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
    }, writer);
  }

  async turnSteer(args: Record<string, unknown>, writer?: EventWriter): Promise<Record<string, unknown>> {
    const threadId = stringValue(args.threadId);
    const expectedTurnId = stringValue(args.expectedTurnId);
    if (!threadId || !expectedTurnId) {
      throw new Error('turn.steer requires threadId and expectedTurnId');
    }
    const execution = this.activeExecutions.get(threadId);
    if (!execution) {
      throw new Error(`Thread ${threadId} is not active.`);
    }
    if (execution.settled) {
      throw new Error(`Thread ${threadId} is not accepting steer requests while waiting on another operation.`);
    }
    execution.writer = writer ?? execution.writer;
    const thread = this.resolveThread(threadId);
    const prompt = stringValue(args.prompt) ?? stringValue(args.content) ?? '';
    await execution.client.request('turn/steer', {
      threadId: execution.threadId,
      expectedTurnId,
      model: thread.model,
      input: buildTextInput(prompt),
    });

    if (Boolean(args.async)) {
      return this.turnPayload(execution.threadId, execution.turnId, execution.jobId);
    }
    return await execution.visible;
  }

  async turnInterrupt(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const threadId = stringValue(args.threadId);
    if (!threadId) {
      throw new Error('turn.interrupt requires threadId');
    }
    const execution = this.activeExecutions.get(threadId);
    if (!execution) {
      throw new Error(`Thread ${threadId} is not active.`);
    }
    await execution.client.request('turn/interrupt', {
      threadId: execution.threadId,
      ...(stringValue(args.turnId) ? { turnId: stringValue(args.turnId) } : {}),
    });
    return {
      threadId: execution.threadId,
      turnId: execution.turnId,
      status: 'interrupt_requested',
      actions: this.buildActions(execution.threadId),
    };
  }

  async reviewStart(args: Record<string, unknown>, writer?: EventWriter): Promise<Record<string, unknown>> {
    const threadId = stringValue(args.threadId);
    if (!threadId) {
      throw new Error('review.start requires threadId');
    }
    const thread = this.resolveThread(threadId);
    const started = await this.startClientForThread(thread);
    const cfg = this.getConfigFor(started.profile.codexHome);
    await started.client.request('thread/resume', {
      threadId: thread.id,
      modelProvider: cfg.modelProvider ?? 'openai',
      approvalPolicy: cfg.approvalPolicy ?? 'on-request',
      sandbox: cfg.sandboxMode ?? 'workspace-write',
      persistExtendedHistory: false,
    });

    const target = stringValue(args.commit)
      ? { type: 'commit', sha: stringValue(args.commit), title: stringValue(args.commitTitle) ?? null }
      : stringValue(args.baseBranch)
        ? { type: 'baseBranch', branch: stringValue(args.baseBranch) }
        : stringValue(args.instructions)
          ? { type: 'custom', instructions: stringValue(args.instructions) }
          : { type: 'uncommittedChanges' };

    const response = await started.client.request('review/start', {
      threadId: thread.id,
      target,
      delivery: Boolean(args.detached) ? 'detached' : 'inline',
    });
    const reviewThreadId = stringValue(response.reviewThreadId) ?? thread.id;
    const turn = isRecord(response.turn) ? response.turn : undefined;
    const turnId = stringValue(turn?.id);
    if (!turnId) {
      await started.client.stop().catch(() => {});
      throw new Error('review/start did not return a turn id.');
    }
    const reviewThread = this.store.upsertThread({
      ...thread,
      id: reviewThreadId,
      status: 'running',
      updatedAt: nowIso(),
    });
    const timestamp = nowIso();
    const turnRecord = this.store.upsertTurn({
      id: turnId,
      threadId: reviewThread.id,
      status: stringValue(turn?.status) ?? 'running',
      source: 'review/start',
      inputFilePath: 'review.md',
      promptPreview: `review ${JSON.stringify(target)}`,
      startedAt: timestamp,
    });
    const job = this.store.createJob({
      alias: 'review',
      threadId: reviewThread.id,
      turnId,
      status: 'running',
      inputFilePath: 'review.md',
      outputLogPath: logPath(reviewThread.cwd, reviewThread.id),
    });
    this.store.updateThread(reviewThread.id, {
      latestTurnId: turnId,
      status: 'running',
      lastError: undefined,
    });
    const visible = Promise.resolve(this.turnPayload(reviewThread.id, turnId, job.id));
    const execution: ActiveExecution = {
      threadId: reviewThread.id,
      turnId,
      jobId: job.id,
      source: 'review/start',
      connectionKey: connectionKey(reviewThread.cwd, reviewThread.codexHome),
      cwd: reviewThread.cwd,
      codexHome: reviewThread.codexHome,
      client: started.client,
      writer,
      settled: false,
      detach: this.attachRawClientLogObservers(started.client, reviewThread.cwd, reviewThread.id, {
        onNotification: (notification) => {
          void this.handleNotification(execution, notification).catch((err) => {
            void appendRawEvent(reviewThread.cwd, reviewThread.id, { dir: 'daemon', message: `handleNotification error: ${String(err)}` });
          });
        },
        onServerRequest: (request) => {
          void this.handleServerRequest(execution, request).catch((err) => {
            void appendRawEvent(reviewThread.cwd, reviewThread.id, { dir: 'daemon', message: `handleServerRequest error: ${String(err)}` });
          });
        },
        onExit: () => {
          void this.failExecution(execution, localErrorDetail('app_server_exited', 'Codex app-server exited before the review finished.'));
        },
      }),
      visible,
      resolve: () => {},
      reject: () => {},
    };
    this.activeExecutions.set(reviewThread.id, execution);
    await this.persistProfiles();

    if (Boolean(args.async)) {
      return this.turnPayload(reviewThread.id, turnRecord.id, job.id);
    }
    return await visible;
  }

  async commandExec(args: Record<string, unknown>, writer?: EventWriter): Promise<Record<string, unknown>> {
    const command = Array.isArray(args.command) ? args.command.filter((value): value is string => typeof value === 'string') : [];
    if (command.length === 0) {
      throw new Error('command.exec requires command');
    }
    const cwd = stringValue(args.cwd) ?? process.cwd();
    const started = await this.startClientOnHealthyProfile(cwd);
    try {
      const onNotification = (notification: RpcNotificationMessage) => {
        if (notification.method === 'command/exec/outputDelta') {
          writer?.event(notification.method, isRecord(notification.params) ? notification.params : {});
        }
      };
      started.client.on('notification', onNotification);
      const processId = stringValue(args.processId)
        ?? ((Boolean(args.tty) || Boolean(args.streamStdoutStderr) || Boolean(args.streamStdin))
          ? `exec-${Date.now()}`
          : undefined);
      const response = await started.client.request('command/exec', {
        command,
        cwd,
        processId,
        tty: Boolean(args.tty),
        streamStdin: Boolean(args.streamStdin),
        streamStdoutStderr: Boolean(args.streamStdoutStderr),
        timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
        sandboxPolicy: args.sandboxPolicy,
      });
      started.client.off?.('notification', onNotification);
      return response;
    } finally {
      await started.client.stop().catch(() => {});
    }
  }

  async modelList(_args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const catalog = await this.loadModelCatalog(process.cwd());
    return {
      data: catalog.visibleModelIds,
      aliases: catalog.aliasMappings,
    };
  }

  async accountRead(args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return await this.requestHealthyProfile('account/read', args);
  }

  async accountRateLimits(args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const candidates = this.profileManager.getCandidateProfiles();
    const allOptOut = candidates.length > 0 && candidates.every(
      (profile) => this.getConfigFor(profile.codexHome).requiresOpenaiAuth === false,
    );
    if (allOptOut) {
      return {
        data: null,
        note: 'rate limits unavailable: requires_openai_auth=false in config.toml',
      };
    }
    return await this.requestHealthyProfile('account/rateLimits/read', args);
  }

  async skillsList(args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return await this.requestHealthyProfile('skills/list', args);
  }

  async appList(args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return await this.requestHealthyProfile('app/list', args);
  }

  async requestList(args: { status?: PendingServerRequestRecord['status'] | undefined } = {}): Promise<Record<string, unknown>> {
    return {
      data: this.store.listPendingRequests(args.status),
    };
  }

  async requestRead(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const requestId = String(args.requestId ?? '');
    const request = this.store.getPendingRequest(requestId);
    if (!request) {
      throw new Error(`Pending request not found: ${requestId}`);
    }
    return { request };
  }

  async requestRespond(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const requestId = String(args.requestId ?? '');
    const request = this.store.getPendingRequest(requestId);
    if (!request || request.status !== 'pending') {
      throw new Error(`Pending request not found: ${requestId}`);
    }

    const execution = request.threadId ? this.activeExecutions.get(request.threadId) : undefined;
    if (!execution) {
      throw new Error(`Thread ${request.threadId ?? 'unknown'} is not waiting on a live request.`);
    }

    const payload = parseJsonObject(stringValue(args.json)) ?? this.buildRequestPayload(request, {
      decision: parseJsonObject(stringValue(args.decisionJson))
        ?? ((typeof args.decision === 'string' || isRecord(args.decision)) ? (args.decision as string | Record<string, unknown>) : undefined),
      answers: Array.isArray(args.answer)
        ? args.answer.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : (stringValue(args.answer) ? [stringValue(args.answer)!] : []),
      note: stringValue(args.note),
      questionId: stringValue(args.questionId),
    });
    await execution.client.respond(request.requestId, payload);
    this.store.resolvePendingRequest(request.id, payload);
    this.store.updateThread(execution.threadId, { status: 'running' });
    this.store.updateTurn(execution.turnId, { status: 'running' });
    this.store.updateJob(execution.jobId, { status: 'running' });
    await this.persistProfiles();

    return {
      status: 'responded',
      requestId: request.id,
      threadId: request.threadId ?? null,
      actions: this.buildActions(execution.threadId),
    };
  }

  async wait(args: Record<string, unknown>, _writer?: EventWriter): Promise<Record<string, unknown>> {
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : resolveTurnIdleTimeoutMs();
    const started = Date.now();

    while (Date.now() - started <= timeoutMs) {
      if (stringValue(args.jobId)) {
        const job = this.store.getJob(stringValue(args.jobId)!);
        if (!job) {
          throw new Error(`Job not found: ${String(args.jobId)}`);
        }
        if (job.status !== 'running') {
          return this.turnPayload(job.threadId, job.turnId, job.id);
        }
      } else if (stringValue(args.threadId)) {
        const thread = this.resolveThread(stringValue(args.threadId)!);
        if (thread.status !== 'running') {
          return {
            threadId: thread.id,
            turnId: thread.latestTurnId ?? stringValue(args.turnId) ?? null,
            status: thread.status,
            actions: this.buildActions(thread.id),
          };
        }
      } else {
        throw new Error('wait requires --job-id or --thread-id');
      }
      await sleep(500);
    }

    throw new Error('Timed out waiting for the requested Codex operation.');
  }

  async doctor(): Promise<Record<string, unknown>> {
    return {
      node: process.version,
      codex: commandVersion('codex'),
      mcpc: commandVersion('mcpc'),
      cwd: process.cwd(),
      stateRoot: ensureStateRoot().rootDir,
      profiles: this.profileManager.getProfiles(),
      experimentalApiEnabled: process.env.CODEX_WORKER_EXPERIMENTAL_API === '1',
    };
  }

  async read(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const threadId = stringValue(args.threadId);
    if (!threadId) {
      throw new Error('read requires threadId');
    }
    return await this.threadRead({
      threadId,
      includeTurns: true,
      tailLines: typeof args.tailLines === 'number' ? args.tailLines : undefined,
    });
  }

  async writeDaemonMeta(socketPath: string, token: string): Promise<void> {
    await writeFile(ensureStateRoot().daemonMetaPath, JSON.stringify({
      pid: process.pid,
      socketPath,
      token,
      startedAt: nowIso(),
    }, null, 2));
  }

  private async startThreadOnHealthyProfile(
    cwd: string,
    model: string,
    options: {
      developerInstructions?: string | undefined;
      baseInstructions?: string | undefined;
      taskPrompt?: string | undefined;
    } = {},
  ): Promise<{ profile: AccountProfileState; client: AppServerLike; thread: ThreadRecord }> {
    const profiles = this.profileManager.getCandidateProfiles();
    if (profiles.length === 0) {
      throw new Error('No eligible CODEX_HOME directories are available.');
    }

    for (const profile of profiles) {
      const injectedFault = this.faultPlanner.takeFault(profile);
      if (injectedFault) {
        this.profileManager.markFailure(profile.id, injectedFault.category, injectedFault.message ?? 'Injected profile fault');
        continue;
      }

      const client = this.connectionFactory(cwd, profile.codexHome);
      const startCfg = this.getConfigFor(profile.codexHome);
      try {
        await client.start();
        const response = await client.request('thread/start', {
          cwd,
          model,
          modelProvider: startCfg.modelProvider ?? 'openai',
          approvalPolicy: startCfg.approvalPolicy ?? 'on-request',
          sandbox: startCfg.sandboxMode ?? 'workspace-write',
          baseInstructions: options.baseInstructions,
          developerInstructions: appendFleetDeveloperInstructions(options.developerInstructions)
            ?? (options.taskPrompt ? appendFleetDeveloperInstructions(options.taskPrompt) : undefined),
          experimentalRawEvents: false,
          persistExtendedHistory: false,
        });
        const remoteThread = isRecord(response.thread) ? response.thread : undefined;
        if (!remoteThread || typeof remoteThread.id !== 'string') {
          throw new Error('thread/start did not return a thread id.');
        }
        const timestamp = nowIso();
        const thread = this.store.upsertThread({
          id: remoteThread.id,
          cwd: stringValue(remoteThread.cwd) ?? cwd,
          codexHome: profile.codexHome,
          model: stringValue(response.model) ?? model,
          modelProvider: stringValue(response.modelProvider) ?? startCfg.modelProvider ?? 'openai',
          status: this.mapThreadStatus(remoteThread.status),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await this.persistProfiles();
        return { profile, client, thread };
      } catch (error) {
        const failure = classifyWorkerFailure(error);
        this.profileManager.markFailure(profile.id, failure.category, failure.message);
        await client.stop().catch(() => {});
      }
    }

    throw new Error('Unable to start thread on any configured CODEX_HOME.');
  }

  private async startClientForThread(
    thread: ThreadRecord,
    cwdOverride?: string | undefined,
  ): Promise<{ client: AppServerLike; profile: AccountProfileState }> {
    const profiles = this.prioritizedProfilesForThread(thread);
    for (const profile of profiles) {
      const client = this.connectionFactory(cwdOverride ?? thread.cwd, profile.codexHome);
      try {
        await client.start();
        return { client, profile };
      } catch (error) {
        const failure = classifyWorkerFailure(error);
        this.profileManager.markFailure(profile.id, failure.category, failure.message);
        await client.stop().catch(() => {});
      }
    }
    throw new Error(`Unable to start Codex app-server for thread ${thread.id}.`);
  }

  private async startClientOnHealthyProfile(cwd: string): Promise<{ profile: AccountProfileState; client: AppServerLike }> {
    const profiles = this.profileManager.getCandidateProfiles();
    for (const profile of profiles) {
      const client = this.connectionFactory(cwd, profile.codexHome);
      try {
        await client.start();
        return { profile, client };
      } catch (error) {
        const failure = classifyWorkerFailure(error);
        this.profileManager.markFailure(profile.id, failure.category, failure.message);
        await client.stop().catch(() => {});
      }
    }
    throw new Error('Unable to start Codex app-server on any configured CODEX_HOME.');
  }

  private async launchTurn(input: {
    client: AppServerLike;
    thread: ThreadRecord;
    source: TurnRecord['source'];
    alias: LocalJobRecord['alias'];
    prompt: string;
    inputFilePath: string;
    timeoutMs: number;
    writer?: EventWriter | undefined;
    startTurn: () => Promise<Record<string, unknown>>;
  }): Promise<{
    turn: TurnRecord;
    job: LocalJobRecord;
    visible: Promise<Record<string, unknown>>;
  }> {
    let execution!: ActiveExecution;
    const cwd = input.thread.cwd;
    const threadId = input.thread.id;

    let lastActivityAt = Date.now();
    let idleTimer: NodeJS.Timeout | undefined;
    const bumpActivity = () => {
      lastActivityAt = Date.now();
    };

    const detachRawLog = this.attachRawClientLogObservers(input.client, cwd, threadId, {
      onNotification: (notification) => {
        bumpActivity();
        if (execution) {
          void this.handleNotification(execution, notification).catch((err) => {
            void appendRawEvent(cwd, threadId, { dir: 'daemon', message: `handleNotification error: ${String(err)}` });
          });
        }
      },
      onServerRequest: (request) => {
        bumpActivity();
        if (execution) {
          void this.handleServerRequest(execution, request).catch((err) => {
            void appendRawEvent(cwd, threadId, { dir: 'daemon', message: `handleServerRequest error: ${String(err)}` });
          });
        }
      },
      onExit: () => {
        if (execution) {
          void this.failExecution(execution, localErrorDetail('app_server_exited', 'Codex app-server exited before the turn finished.'));
        }
      },
    });

    let response: Record<string, unknown>;
    try {
      response = await input.startTurn();
    } catch (error) {
      detachRawLog();
      throw error;
    }
    const turn = isRecord(response.turn) ? response.turn : undefined;
    const turnId = stringValue(turn?.id);
    if (!turnId) {
      detachRawLog();
      throw new Error('turn/start did not return a turn id.');
    }

    const timestamp = nowIso();
    const turnRecord = this.store.upsertTurn({
      id: turnId,
      threadId: input.thread.id,
      status: stringValue(turn?.status) ?? 'running',
      source: input.source,
      inputFilePath: input.inputFilePath,
      promptPreview: promptPreview(input.prompt),
      startedAt: timestamp,
    });
    const job = this.store.createJob({
      alias: input.alias,
      threadId: input.thread.id,
      turnId,
      status: 'running',
      inputFilePath: input.inputFilePath,
      outputLogPath: logPath(input.thread.cwd, input.thread.id),
    });
    this.store.updateThread(input.thread.id, {
      latestTurnId: turnId,
      status: 'running',
      lastError: undefined,
    });
    const visible = new Promise<Record<string, unknown>>((resolve, reject) => {
      const currentExecution: ActiveExecution = {
        threadId: input.thread.id,
        turnId,
        jobId: job.id,
        source: input.source,
        connectionKey: connectionKey(input.thread.cwd, input.thread.codexHome),
        cwd: input.thread.cwd,
        codexHome: input.thread.codexHome,
        client: input.client,
        writer: input.writer,
        settled: false,
        detach: () => {},
        visible: undefined as unknown as Promise<Record<string, unknown>>,
        resolve,
        reject,
      };
      execution = currentExecution;
      this.activeExecutions.set(input.thread.id, currentExecution);
      const scheduleIdleTimer = (ms: number) => {
        const t = setTimeout(fireIfIdle, ms);
        t.unref();
        idleTimer = t;
      };
      const fireIfIdle = () => {
        if (currentExecution.settled) return;
        const idleMs = Date.now() - lastActivityAt;
        if (idleMs + 50 < input.timeoutMs) {
          scheduleIdleTimer(input.timeoutMs - idleMs);
          return;
        }
        void appendRawEvent(cwd, threadId, {
          dir: 'daemon',
          message: `watchdog_fire turnId=${turnId} idle_ms=${idleMs} limit_ms=${input.timeoutMs}`,
        });
        void this.failExecution(
          currentExecution,
          localErrorDetail('idle_timeout', `Idle turn timeout: no events for ${Math.round(idleMs / 1000)}s (limit ${Math.round(input.timeoutMs / 1000)}s). Set CODEX_WORKER_TURN_TIMEOUT_MS to raise.`),
        );
      };

      currentExecution.detach = () => {
        detachRawLog();
        if (idleTimer) clearTimeout(idleTimer);
      };

      void appendRawEvent(cwd, threadId, {
        dir: 'daemon',
        message: `launchTurn source=${input.source} turnId=${turnId} jobId=${job.id}`,
      });

      scheduleIdleTimer(input.timeoutMs);
    });
    execution.visible = visible;

    try {
      await this.store.appendThreadEvent({
        cwd: input.thread.cwd,
        threadId: input.thread.id,
        payload: {
          type: 'user',
          turnId,
          prompt: input.prompt,
          source: input.source,
        },
        logLine: `> ${input.prompt}`,
      });
      await this.persistProfiles();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.failExecution(execution, localErrorDetail('other', msg));
    }

    // Ensure rejections are never unhandled. Async callers read terminal state
    // from the store; sync callers can still await the returned promise.
    visible.catch(() => {});
    return { turn: turnRecord, job, visible };
  }

  private async handleNotification(execution: ActiveExecution, notification: RpcNotificationMessage): Promise<void> {
    const params = isRecord(notification.params) ? notification.params : {};
    execution.writer?.event(notification.method, params);

    if (notification.method === 'item/agentMessage/delta') {
      const delta = stringValue(params.delta);
      if (delta) {
        await this.store.appendThreadEvent({
          cwd: execution.cwd,
          threadId: execution.threadId,
          payload: { type: 'assistant.delta', delta, turnId: execution.turnId },
          logLine: delta,
        });
      }
      return;
    }

    if (notification.method === 'item/commandExecution/outputDelta' || notification.method === 'item/fileChange/outputDelta') {
      const delta = stringValue(params.delta);
      if (delta) {
        await this.store.appendThreadEvent({
          cwd: execution.cwd,
          threadId: execution.threadId,
          payload: { type: notification.method, delta, turnId: execution.turnId },
          logLine: delta,
        });
      }
      return;
    }

    if (notification.method === 'account/rateLimits/updated') {
      return;
    }

    if (notification.method === 'thread/status/changed') {
      const thread = isRecord(params.thread) ? params.thread : undefined;
      const status = this.mapThreadStatus(thread?.status ?? params.status);
      this.store.updateThread(execution.threadId, { status });
      await this.persistProfiles();
      return;
    }

    if (notification.method === 'turn/completed') {
      const turn = isRecord(params.turn) ? params.turn : undefined;
      const status = stringValue(turn?.status) ?? 'completed';
      if (status === 'completed') {
        await this.completeExecution(execution, 'completed');
      } else if (status === 'interrupted') {
        await this.completeExecution(execution, 'interrupted');
      } else {
        const turnError = isRecord(turn?.error) ? turn.error : undefined;
        const detail = parseTurnError(turnError, `Turn finished with status ${status}.`);
        await this.failExecution(execution, detail);
      }
      return;
    }

    if (notification.method === 'error') {
      const detail = parseTurnErrorFromParams(params);
      if (params.willRetry === true) {
        await this.store.appendThreadEvent({
          cwd: execution.cwd,
          threadId: execution.threadId,
          payload: { type: 'turn.retrying', error: detail.message, tag: detail.tag, errorInfo: detail },
          logLine: `retrying [${detail.tag}]: ${detail.message}`,
        });
        execution.writer?.event('error', { ...params, willRetry: true });
        return;
      }
      await this.failExecution(execution, detail);
      return;
    }

    await this.store.appendThreadEvent({
      cwd: execution.cwd,
      threadId: execution.threadId,
      payload: { type: 'notification', method: notification.method, params },
    });
  }

  private async handleServerRequest(execution: ActiveExecution, request: RpcServerRequestMessage): Promise<void> {
    const params = isRecord(request.params) ? request.params : {};
    const pending = this.store.createPendingRequest({
      requestId: request.id,
      method: request.method,
      threadId: execution.threadId,
      turnId: execution.turnId,
      connectionKey: execution.connectionKey,
      codexHome: execution.codexHome,
      cwd: execution.cwd,
      params,
    });
    this.store.updateThread(execution.threadId, { status: 'waiting_request' });
    this.store.updateTurn(execution.turnId, { status: 'waiting_request' });
    this.store.updateJob(execution.jobId, { status: 'waiting_request' });
    await this.store.appendThreadEvent({
      cwd: execution.cwd,
      threadId: execution.threadId,
      payload: { type: 'request', requestId: pending.id, method: request.method, params },
      logLine: `request: ${request.method}`,
    });
    await this.persistProfiles();

    if (!execution.settled) {
      execution.settled = true;
      execution.resolve(this.turnPayload(execution.threadId, execution.turnId, execution.jobId));
    }
  }

  private async completeExecution(execution: ActiveExecution, status: 'completed' | 'interrupted'): Promise<void> {
    await appendRawEvent(execution.cwd, execution.threadId, {
      dir: 'daemon',
      message: `completeExecution status=${status} turnId=${execution.turnId}`,
    });
    const shouldResolve = !execution.settled;
    execution.settled = true;
    execution.detach();
    this.activeExecutions.delete(execution.threadId);
    this.store.updateTurn(execution.turnId, {
      status,
      completedAt: nowIso(),
    });
    this.store.updateJob(execution.jobId, {
      status: status === 'completed' ? 'completed' : 'interrupted',
    });
    this.store.updateThread(execution.threadId, {
      status: status === 'completed' ? 'idle' : 'interrupted',
      lastError: undefined,
    });
    await this.persistProfiles();
    await execution.client.stop().catch(() => {});

    if (shouldResolve) {
      execution.resolve(this.turnPayload(execution.threadId, execution.turnId, execution.jobId));
    }
  }

  private async failExecution(
    execution: ActiveExecution,
    detail: TurnErrorDetail,
  ): Promise<void> {
    await appendRawEvent(execution.cwd, execution.threadId, {
      dir: 'daemon',
      message: `failExecution turnId=${execution.turnId} tag=${detail.tag} error=${detail.message}`,
    });
    if (execution.settled) {
      return;
    }
    execution.settled = true;
    execution.detach();
    this.activeExecutions.delete(execution.threadId);
    this.store.updateTurn(execution.turnId, {
      status: 'failed',
      completedAt: nowIso(),
      error: detail.message,
      errorInfo: detail,
    });
    this.store.updateJob(execution.jobId, {
      status: 'failed',
      error: detail.message,
    });
    this.store.updateThread(execution.threadId, {
      status: 'failed',
      lastError: detail.message,
      lastErrorTag: detail.tag,
    });
    await this.store.appendThreadEvent({
      cwd: execution.cwd,
      threadId: execution.threadId,
      payload: {
        type: 'turn.failed',
        turnId: execution.turnId,
        error: detail.message,
        tag: detail.tag,
        errorInfo: detail,
      },
      logLine: `error [${detail.tag}]: ${detail.message}`,
    });
    await this.persistProfiles();
    await execution.client.stop().catch(() => {});

    execution.reject(new Error(detail.message));
  }

  private attachRawClientLogObservers(
    client: AppServerLike,
    cwd: string,
    threadId: string,
    hooks: {
      onNotification?: ((notification: RpcNotificationMessage) => void) | undefined;
      onServerRequest?: ((request: RpcServerRequestMessage) => void) | undefined;
      onExit?: ((info: unknown) => void) | undefined;
    } = {},
  ): () => void {
    const onNotification = (notification: RpcNotificationMessage) => {
      void appendRawEvent(cwd, threadId, {
        dir: 'notification',
        method: notification.method,
        params: notification.params,
      });
      hooks.onNotification?.(notification);
    };
    const onServerRequest = (request: RpcServerRequestMessage) => {
      void appendRawEvent(cwd, threadId, {
        dir: 'server_request',
        id: request.id,
        method: request.method,
        params: request.params,
      });
      hooks.onServerRequest?.(request);
    };
    const onExit = (info: unknown) => {
      void appendRawEvent(cwd, threadId, { dir: 'exit', data: info });
      hooks.onExit?.(info);
    };
    const onRpcOut = (payload: Record<string, unknown>) => {
      void appendRawEvent(cwd, threadId, {
        dir: 'rpc_out',
        id: payload.id as string | number | undefined,
        method: typeof payload.method === 'string' ? payload.method : undefined,
        params: payload.params,
        result: payload.result,
      });
    };
    const onRpcIn = (payload: Record<string, unknown>) => {
      void appendRawEvent(cwd, threadId, {
        dir: 'rpc_in',
        id: payload.id as string | number | undefined,
        result: payload.result,
        error: payload.error,
      });
    };
    const onStderr = (chunk: string) => {
      void appendRawEvent(cwd, threadId, { dir: 'stderr', data: chunk });
    };
    const onProtocolError = (info: unknown) => {
      void appendRawEvent(cwd, threadId, { dir: 'protocol_error', data: info });
    };

    client.on('notification', onNotification);
    client.on('serverRequest', onServerRequest);
    client.on('exit', onExit);
    client.on('rpcOut', onRpcOut);
    client.on('rpcIn', onRpcIn);
    client.on('stderr', onStderr);
    client.on('protocolError', onProtocolError);

    return () => {
      client.off?.('notification', onNotification);
      client.off?.('serverRequest', onServerRequest);
      client.off?.('exit', onExit);
      client.off?.('rpcOut', onRpcOut);
      client.off?.('rpcIn', onRpcIn);
      client.off?.('stderr', onStderr);
      client.off?.('protocolError', onProtocolError);
    };
  }

  private buildRequestPayload(
    request: PendingServerRequestRecord,
    args: {
      decision?: string | Record<string, unknown> | undefined;
      answers?: string[] | undefined;
      note?: string | undefined;
      questionId?: string | undefined;
    },
  ): Record<string, unknown> {
    if (isRecord(args.decision)) {
      return args.decision;
    }
    if (request.method === 'item/tool/requestUserInput') {
      const questionId = args.questionId
        ?? (Array.isArray(request.params.questions) && isRecord(request.params.questions[0])
          ? stringValue(request.params.questions[0].id)
          : undefined)
        ?? 'q1';
      return {
        answers: {
          [questionId]: {
            answers: args.answers && args.answers.length > 0 ? args.answers : [''],
            ...(args.note ? { other: args.note } : {}),
          },
        },
      };
    }
    return {
      decision: args.decision ?? 'accept',
    };
  }

  private async resolveModelForCwd(cwd: string, requestedModel?: string): Promise<{
    resolved: string;
    remappedFrom?: string | undefined;
  }> {
    const catalog = await this.loadModelCatalog(cwd);
    const firstProfile = this.profileManager.getCandidateProfiles()[0];
    const configModel = firstProfile ? this.getConfigFor(firstProfile.codexHome).model : undefined;
    const fallbackModel = requestedModel ?? configModel ?? DEFAULT_MODEL;
    const resolution = resolveRequestedModel(fallbackModel, catalog);
    if (!resolution) {
      throw new Error(`Unsupported model "${fallbackModel}". ${describeAllowedModels(catalog)}`);
    }
    return resolution;
  }

  private async loadModelCatalog(cwd: string): Promise<ModelCatalog> {
    const models: ModelCatalogInput[] = [];
    const profiles = this.profileManager.getCandidateProfiles();
    for (const profile of profiles) {
      const client = this.connectionFactory(cwd, profile.codexHome);
      try {
        await client.start();
        const response = await client.request('model/list', { includeHidden: true });
        const data = Array.isArray(response.data) ? response.data : [];
        for (const rawEntry of data) {
          if (!isRecord(rawEntry) || typeof rawEntry.id !== 'string') {
            continue;
          }
          models.push({
            id: rawEntry.id,
            hidden: Boolean(rawEntry.hidden),
            upgrade: stringValue(rawEntry.upgrade) ?? null,
          });
        }
      } catch (error) {
        const failure = classifyWorkerFailure(error);
        this.profileManager.markFailure(profile.id, failure.category, failure.message);
      } finally {
        await client.stop().catch(() => {});
      }
    }

    if (models.length === 0) {
      throw new Error('No selectable Codex models are available from the configured CODEX_HOME directories.');
    }
    return buildModelCatalog(models);
  }

  private async requestHealthyProfile<T extends Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T> {
    const profiles = this.profileManager.getCandidateProfiles();
    for (const profile of profiles) {
      const client = this.connectionFactory(process.cwd(), profile.codexHome);
      try {
        await client.start();
        return await client.request<T>(method, params);
      } catch (error) {
        const failure = classifyWorkerFailure(error);
        this.profileManager.markFailure(profile.id, failure.category, failure.message);
      } finally {
        await client.stop().catch(() => {});
      }
    }
    throw new Error(`Unable to execute ${method} on any configured CODEX_HOME.`);
  }

  private prioritizedProfilesForThread(thread: ThreadRecord): AccountProfileState[] {
    const profiles = this.profileManager.getCandidateProfiles();
    const preferred = profiles.find((profile) => profile.codexHome === thread.codexHome);
    return preferred
      ? [preferred, ...profiles.filter((profile) => profile.codexHome !== preferred.codexHome)]
      : profiles;
  }

  private resolveThread(threadId: string): ThreadRecord {
    const thread = this.store.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return thread;
  }

  private turnPayload(threadId: string, turnId: string, jobId: string): Record<string, unknown> {
    const thread = this.resolveThread(threadId);
    const turn = this.store.getTurn(turnId);
    const job = this.store.getJob(jobId);
    return {
      threadId,
      turnId,
      status: turn?.status ?? job?.status ?? thread.status,
      thread,
      turn,
      job,
      pendingRequests: this.store.listPendingRequests('pending').filter((entry) => entry.threadId === threadId),
      actions: this.buildActions(threadId),
    };
  }

  private buildActions(threadId: string): Record<string, string> {
    return {
      read: `codex-worker read ${threadId}`,
      send: `codex-worker send ${threadId} prompt.md`,
      requests: 'codex-worker request list',
    };
  }

  private mapThreadStatus(value: unknown): string {
    if (isRecord(value)) {
      return stringValue(value.type) ?? 'unknown';
    }
    return stringValue(value) ?? 'unknown';
  }

  private async persistProfiles(): Promise<void> {
    this.store.setProfiles(this.profileManager.toPersistedState());
    await this.store.persist();
  }
}
