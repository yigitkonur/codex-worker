import type { RpcId } from '../runtime/app-server.js';

export type WorkerFailureCategory = 'auth' | 'rate_limit' | 'connection' | 'transient' | 'fatal';

// ---------------------------------------------------------------------------
// Structured turn-error types aligned with upstream CodexErrorInfo variants
// ---------------------------------------------------------------------------

/**
 * Normalized tag for every possible turn failure.
 * All tags except the final 4 (`app_server_exited`, `idle_timeout`,
 * `spawn_failed`, and `protocol_error`) map 1:1 to the upstream
 * CodexErrorInfo discriminated union.
 * The final 4 cover failures that originate inside codex-worker itself.
 */
export type CodexErrorTag =
  | 'context_window_exceeded'
  | 'usage_limit_exceeded'
  | 'server_overloaded'
  | 'http_connection_failed'
  | 'response_stream_connection_failed'
  | 'response_stream_disconnected'
  | 'response_too_many_failed_attempts'
  | 'internal_server_error'
  | 'unauthorized'
  | 'bad_request'
  | 'thread_rollback_failed'
  | 'sandbox_error'
  | 'active_turn_not_steerable'
  | 'app_server_exited'
  | 'idle_timeout'
  | 'spawn_failed'
  | 'protocol_error'
  | 'other';

/** Structured error detail that travels from the failure site to every output. */
export interface TurnErrorDetail {
  /** Human-readable message (the primary diagnostic string). */
  message: string;
  /** Normalized tag classifying the failure. */
  tag: CodexErrorTag;
  /** Upstream HTTP status when available (e.g. 502 from httpConnectionFailed). */
  httpStatusCode?: number | undefined;
  /** Free-text additional details from the upstream TurnError. */
  additionalDetails?: string | undefined;
  /** Original codexErrorInfo payload preserved verbatim for JSON output. */
  raw?: Record<string, unknown> | undefined;
}

export interface WorkerFailureInfo {
  category: WorkerFailureCategory;
  retryable: boolean;
  message: string;
  code?: number | undefined;
}

export interface AccountProfileState {
  id: string;
  codexHome: string;
  cooldownUntil?: number | undefined;
  failureCount: number;
  lastFailureReason?: string | undefined;
  lastFailureCategory?: WorkerFailureCategory | undefined;
  lastFailureAt?: string | undefined;
  lastSuccessAt?: string | undefined;
}

export interface ThreadRecord {
  id: string;
  cwd: string;
  codexHome: string;
  model: string;
  modelProvider: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  latestTurnId?: string | undefined;
  lastError?: string | undefined;
  lastErrorTag?: CodexErrorTag | undefined;
}

export interface TurnRecord {
  id: string;
  threadId: string;
  status: string;
  source: 'turn/start' | 'turn/steer' | 'review/start' | 'alias/run' | 'alias/send';
  inputFilePath?: string | undefined;
  promptPreview: string;
  startedAt: string;
  completedAt?: string | undefined;
  error?: string | undefined;
  errorInfo?: TurnErrorDetail | undefined;
}

export interface PendingServerRequestRecord {
  id: string;
  requestId: RpcId;
  method: string;
  threadId?: string | undefined;
  turnId?: string | undefined;
  connectionKey: string;
  codexHome: string;
  cwd: string;
  status: 'pending' | 'responded' | 'failed';
  params: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | undefined;
  response?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

export interface LocalJobRecord {
  id: string;
  alias: 'run' | 'send' | 'review';
  threadId: string;
  turnId: string;
  status: 'running' | 'waiting_request' | 'completed' | 'failed' | 'interrupted';
  createdAt: string;
  updatedAt: string;
  inputFilePath: string;
  outputLogPath: string;
  error?: string | undefined;
}

export interface StateFile {
  version: 1;
  profiles: AccountProfileState[];
  threads: ThreadRecord[];
  turns: TurnRecord[];
  pendingRequests: PendingServerRequestRecord[];
  jobs: LocalJobRecord[];
}

export interface DaemonMeta {
  pid: number;
  socketPath: string;
  token: string;
  startedAt: string;
}

export type DaemonCommand =
  | 'daemon.status'
  | 'daemon.stop'
  | 'thread.start'
  | 'thread.resume'
  | 'thread.read'
  | 'thread.list'
  | 'thread.rollback'
  | 'turn.start'
  | 'turn.steer'
  | 'turn.interrupt'
  | 'review.start'
  | 'command.exec'
  | 'model.list'
  | 'account.read'
  | 'account.rate-limits'
  | 'skills.list'
  | 'app.list'
  | 'request.list'
  | 'request.read'
  | 'request.respond'
  | 'wait'
  | 'doctor'
  | 'run'
  | 'send'
  | 'read';

export interface DaemonRequestEnvelope {
  id: string;
  token: string;
  command: DaemonCommand;
  args?: Record<string, unknown> | undefined;
}

export interface DaemonResponseEnvelope {
  id: string;
  type: 'event' | 'result' | 'error';
  event?: string | undefined;
  data?: Record<string, unknown> | undefined;
  error?: string | undefined;
}
