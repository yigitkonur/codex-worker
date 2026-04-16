import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { pkgMeta } from '../core/package-meta.js';

export type RpcId = string | number;

export interface RpcResultMessage {
  id: RpcId;
  result?: Record<string, unknown>;
  error?: { code?: number; message: string; data?: unknown };
}

export interface RpcNotificationMessage {
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcServerRequestMessage {
  id: RpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requestKey(id: RpcId): string {
  return typeof id === 'number' ? `n:${id}` : `s:${id}`;
}

export class AppServerClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams | undefined;
  private buffer = '';
  private readonly pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private started = false;

  constructor(
    readonly cwd: string,
    readonly codexHome: string,
    private readonly clientName = 'codex-worker',
  ) {
    super();
  }

  get connectionKey(): string {
    return `${this.cwd}::${this.codexHome}`;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      cwd: this.cwd,
      env: {
        ...process.env,
        CODEX_HOME: this.codexHome,
      },
      stdio: 'pipe',
    });

    this.child = child;
    this.started = true;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleChunk(chunk));
    child.stdout.on('error', (err) => {
      this.emit('protocolError', { message: `stdout error: ${err.message}` });
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.emit('stderr', chunk);
    });
    child.stderr.on('error', () => {
      // stderr stream error — best-effort, nothing to propagate
    });
    child.stdin.on('error', (err) => {
      this.emit('protocolError', { message: `stdin error: ${err.message}` });
    });
    child.on('error', (error) => {
      this.started = false;
      this.child = undefined;
      const reason = `failed to start codex app-server: ${error.message}`;
      this.rejectPending(reason);
    });
    child.on('exit', (code, signal) => {
      this.started = false;
      this.child = undefined;
      const reason = `codex app-server exited (code=${String(code)} signal=${String(signal)})`;
      this.rejectPending(reason);
      this.emit('exit', { code, signal });
    });

    const experimentalApi = process.env.CODEX_WORKER_EXPERIMENTAL_API === '1';
    await this.request('initialize', {
      clientInfo: {
        name: this.clientName,
        title: this.clientName,
        version: pkgMeta.version,
      },
      capabilities: {
        experimentalApi,
        optOutNotificationMethods: null,
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.child) {
      return;
    }

    this.child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      this.child?.once('exit', () => resolve());
      setTimeout(() => resolve(), 1_000).unref();
    });
    this.child = undefined;
    this.started = false;
  }

  async request<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> | undefined,
  ): Promise<T> {
    await this.start();
    if (!this.child) {
      throw new Error('codex app-server not started');
    }

    const id: RpcId = `client-${++this.requestCounter}`;
    const key = requestKey(id);
    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Timed out waiting for ${method} response`));
      }, 30_000);
      timeout.unref();
      this.pending.set(key, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });

    this.writeLine({ method, id, params });
    return await promise;
  }

  async respond(requestId: RpcId, result: Record<string, unknown>): Promise<void> {
    await this.start();
    this.writeLine({
      id: requestId,
      result,
    });
  }

  private writeLine(payload: Record<string, unknown>): void {
    if (!this.child) {
      throw new Error('codex app-server not started');
    }
    this.emit('rpcOut', payload);
    try {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch (err) {
      this.emit('protocolError', { message: `stdin write failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.emit('protocolError', { line });
      return;
    }

    if ((typeof message.id === 'string' || typeof message.id === 'number') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) && !message.method) {
      this.emit('rpcIn', message);
      const key = requestKey(message.id);
      const pending = this.pending.get(key);
      if (!pending) {
        return;
      }
      this.pending.delete(key);
      clearTimeout(pending.timeout);
      const error = asObject(message.error);
      if (Object.keys(error).length > 0) {
        pending.reject(new Error(String(error.message ?? `RPC ${String(message.id)} failed`)));
        return;
      }
      pending.resolve(asObject(message.result));
      return;
    }

    if ((typeof message.id === 'string' || typeof message.id === 'number') && typeof message.method === 'string') {
      const request: RpcServerRequestMessage = {
        id: message.id,
        method: message.method,
        params: asObject(message.params),
      };
      this.emit('serverRequest', request);
      return;
    }

    if (typeof message.method === 'string') {
      const notification: RpcNotificationMessage = {
        method: message.method,
        params: asObject(message.params),
      };
      this.emit('notification', notification);
    }
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

export function parseRpcError(error: unknown): { message: string; code?: number } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (error && typeof error === 'object') {
    const raw = error as { message?: unknown; code?: unknown };
    return {
      message: typeof raw.message === 'string' ? raw.message : String(error),
      code: typeof raw.code === 'number' ? raw.code : undefined,
    };
  }
  return { message: String(error) };
}
