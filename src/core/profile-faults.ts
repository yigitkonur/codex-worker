import type { AccountProfileState, WorkerFailureCategory } from './types.js';

export interface InjectedProfileFault {
  category: WorkerFailureCategory;
  remaining?: number | undefined;
  message?: string | undefined;
  errorType?: string | undefined;
  statusCode?: number | undefined;
}

type StoredFault = InjectedProfileFault;

function defaultErrorType(category: WorkerFailureCategory): string {
  switch (category) {
    case 'auth':
      return 'authentication';
    case 'rate_limit':
      return 'rate_limit';
    case 'connection':
      return 'connection';
    case 'transient':
      return 'transient';
    case 'fatal':
      return 'fatal';
  }
}

function defaultStatusCode(category: WorkerFailureCategory): number | undefined {
  switch (category) {
    case 'auth':
      return 401;
    case 'rate_limit':
      return 429;
    case 'connection':
      return undefined;
    case 'transient':
      return 504;
    case 'fatal':
      return undefined;
  }
}

function defaultMessage(profile: Pick<AccountProfileState, 'id' | 'codexHome'>, category: WorkerFailureCategory): string {
  return `Injected ${category} failure for profile ${profile.id} (${profile.codexHome})`;
}

function normalizeFault(value: unknown): StoredFault | undefined {
  if (typeof value === 'string') {
    return { category: value as WorkerFailureCategory };
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Partial<InjectedProfileFault> & { category?: unknown };
  if (typeof raw.category !== 'string') {
    return undefined;
  }

  const remaining = typeof raw.remaining === 'number' && Number.isFinite(raw.remaining)
    ? Math.max(0, Math.trunc(raw.remaining))
    : undefined;

  return {
    category: raw.category as WorkerFailureCategory,
    remaining,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    errorType: typeof raw.errorType === 'string' ? raw.errorType : undefined,
    statusCode: typeof raw.statusCode === 'number' && Number.isFinite(raw.statusCode)
      ? Math.trunc(raw.statusCode)
      : undefined,
  };
}

export class ProfileFaultPlanner {
  private readonly faults = new Map<string, StoredFault>();

  constructor(raw = process.env.CLI_CODEX_WORKER_PROFILE_FAULTS) {
    if (!raw) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`Failed to parse CLI_CODEX_WORKER_PROFILE_FAULTS: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('CLI_CODEX_WORKER_PROFILE_FAULTS must be a JSON object');
    }

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const fault = normalizeFault(value);
      if (fault) {
        this.faults.set(key, fault);
      }
    }
  }

  static fromEnvironment(): ProfileFaultPlanner {
    return new ProfileFaultPlanner();
  }

  takeFault(profile: Pick<AccountProfileState, 'id' | 'codexHome'>): InjectedProfileFault | undefined {
    const fault = this.findFault(profile);
    if (!fault) {
      return undefined;
    }

    if (fault.remaining !== undefined) {
      fault.remaining -= 1;
      if (fault.remaining <= 0) {
        this.faults.delete(profile.codexHome);
        this.faults.delete(profile.id);
      }
    }

    return {
      category: fault.category,
      remaining: fault.remaining,
      message: fault.message ?? defaultMessage(profile, fault.category),
      errorType: fault.errorType ?? defaultErrorType(fault.category),
      statusCode: fault.statusCode ?? defaultStatusCode(fault.category),
    };
  }

  private findFault(profile: Pick<AccountProfileState, 'id' | 'codexHome'>): StoredFault | undefined {
    const byHome = this.faults.get(profile.codexHome);
    if (byHome) {
      return byHome;
    }
    return this.faults.get(profile.id);
  }
}
