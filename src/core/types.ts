export type WorkerFailureCategory = 'auth' | 'rate_limit' | 'connection' | 'transient' | 'fatal';

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
}

export interface TurnRecord {
  id: string;
  threadId: string;
  status: string;
  source: 'turn/start' | 'turn/steer' | 'alias/run' | 'alias/send';
  inputFilePath?: string | undefined;
  promptPreview: string;
  startedAt: string;
  completedAt?: string | undefined;
  error?: string | undefined;
}

export interface PendingServerRequestRecord {
  id: string;
  requestId: string;
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
  alias: 'run' | 'send';
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
  | 'turn.start'
  | 'turn.steer'
  | 'turn.interrupt'
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
