import { EventEmitter } from 'node:events';

export interface RecordedRequest {
  method: string;
  params: Record<string, unknown> | undefined;
}

export class FakeAppServerClient extends EventEmitter {
  readonly requests: RecordedRequest[] = [];
  readonly responses: Array<{ requestId: string; payload: Record<string, unknown> }> = [];
  started = false;

  constructor(
    readonly cwd: string,
    readonly codexHome: string,
  ) {
    super();
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async request(method: string, params: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
    this.requests.push({ method, params });

    if (method === 'initialize') {
      return {
        userAgent: 'fake',
        codexHome: this.codexHome,
        platformFamily: 'unix',
        platformOs: 'linux',
      };
    }

    if (method === 'model/list') {
      return {
        data: [
          { id: 'gpt-5.4', model: 'gpt-5.4', hidden: false, isDefault: true, upgrade: null },
          { id: 'gpt-5.3-codex', model: 'gpt-5.3-codex', hidden: false, isDefault: false, upgrade: 'gpt-5.4' },
        ],
        nextCursor: null,
      };
    }

    if (method === 'thread/start') {
      return {
        thread: {
          id: 'thread-1',
          cwd: params?.cwd ?? this.cwd,
          status: { type: 'idle' },
        },
        model: params?.model ?? 'gpt-5.4',
        modelProvider: 'fake-provider',
      };
    }

    if (method === 'thread/resume') {
      return {
        thread: {
          id: params?.threadId ?? 'thread-1',
          cwd: this.cwd,
          status: { type: 'idle' },
        },
        model: 'gpt-5.4',
        modelProvider: 'fake-provider',
      };
    }

    if (method === 'turn/start') {
      return {
        turn: {
          id: 'turn-1',
          status: 'inProgress',
        },
      };
    }

    if (method === 'thread/read') {
      return {
        thread: {
          id: params?.threadId ?? 'thread-1',
          cwd: this.cwd,
          status: { type: 'idle' },
          turns: [],
        },
      };
    }

    if (method === 'thread/list') {
      return {
        data: [
          { id: 'thread-1', cwd: this.cwd, status: { type: 'idle' } },
        ],
        nextCursor: null,
      };
    }

    if (method === 'account/read') {
      return { account: { id: 'acct-1' }, requiresOpenaiAuth: false };
    }

    if (method === 'account/rateLimits/read') {
      return { rateLimits: { limitId: 'codex' }, rateLimitsByLimitId: null };
    }

    if (method === 'skills/list') {
      return { data: [] };
    }

    if (method === 'app/list') {
      return { data: [], nextCursor: null };
    }

    return {};
  }

  async respond(requestId: string, payload: Record<string, unknown>): Promise<void> {
    this.responses.push({ requestId, payload });
  }
}
