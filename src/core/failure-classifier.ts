import type { WorkerFailureInfo, WorkerFailureCategory } from './types.js';

function buildFailureInfo(
  category: WorkerFailureCategory,
  message: string,
  details?: { code?: number | undefined },
): WorkerFailureInfo {
  return {
    category,
    retryable: category !== 'fatal',
    message,
    ...details,
  };
}

function normalizeMessage(input: unknown): string {
  if (input instanceof Error) {
    return input.message || input.name;
  }
  if (typeof input === 'string') {
    return input;
  }
  if (input && typeof input === 'object' && 'message' in input) {
    const value = (input as { message?: unknown }).message;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return 'Unknown worker failure';
}

function classifyStatusCode(statusCode: number | undefined): WorkerFailureCategory | undefined {
  if (statusCode === undefined) {
    return undefined;
  }
  if (statusCode === 401 || statusCode === 403) {
    return 'auth';
  }
  if (statusCode === 429) {
    return 'rate_limit';
  }
  if (statusCode >= 500) {
    return 'transient';
  }
  return undefined;
}

function classifyText(message: string): WorkerFailureCategory {
  const text = message.toLowerCase();
  if (text.includes('unauthorized') || text.includes('login') || text.includes('auth')) {
    return 'auth';
  }
  if (text.includes('rate limit') || text.includes('429') || text.includes('quota')) {
    return 'rate_limit';
  }
  if (text.includes('connection') || text.includes('socket') || text.includes('broken pipe') || text.includes('econn')) {
    return 'connection';
  }
  if (text.includes('timeout') || text.includes('overloaded') || text.includes('try again')) {
    return 'transient';
  }
  return 'fatal';
}

export function classifyWorkerFailure(error: unknown): WorkerFailureInfo {
  const message = normalizeMessage(error);
  const statusCode = (() => {
    if (error && typeof error === 'object') {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'number') {
        return code;
      }
    }
    return undefined;
  })();
  return buildFailureInfo(classifyStatusCode(statusCode) ?? classifyText(message), message, {
    code: statusCode,
  });
}
