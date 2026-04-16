import { relative } from 'node:path';

export type OutputFormat = 'text' | 'json';

export function resolveOutputFormat(raw: unknown): OutputFormat {
  return raw === 'json' ? 'json' : 'text';
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function shortenPath(path: string): string {
  try {
    const rel = relative(process.cwd(), path);
    if (!rel.startsWith('..')) {
      return rel || '.';
    }
  } catch {
    // noop
  }
  return path;
}

export function formatSimpleActions(actions: Record<string, unknown> | undefined): string {
  if (!actions) {
    return '- none';
  }

  const lines = Object.entries(actions)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([name, value]) => `- ${name}: ${String(value)}`);
  return lines.length > 0 ? lines.join('\n') : '- none';
}

export function renderExecResult(result: Record<string, unknown>): string {
  const lines = [
    `Exit: ${String(result.exitCode ?? 'unknown')}`,
    `Process: ${String(result.processId ?? 'buffered')}`,
  ];
  if (typeof result.stdout === 'string' && result.stdout.length > 0) {
    lines.push('');
    lines.push(result.stdout.trimEnd());
  }
  if (typeof result.stderr === 'string' && result.stderr.length > 0) {
    lines.push('');
    lines.push(result.stderr.trimEnd());
  }
  return lines.join('\n');
}

export function createEventPrinter(enabled: boolean, compact = false): {
  onEvent: (event: string, data: Record<string, unknown>) => void;
  finish: () => void;
} {
  let wrote = false;
  let assistantBuffer = '';
  return {
    onEvent(event, data) {
      if (!enabled) {
        return;
      }

      if (compact) {
        const formatted = formatCompactLiveEvent(event, data, { assistantBuffer });
        if (formatted.buffer !== undefined) {
          assistantBuffer = formatted.buffer;
        }
        if (formatted.output) {
          wrote = true;
          process.stdout.write(`${formatted.output}\n`);
        }
        return;
      }

      wrote = true;
      const payload = data.text
        ? String(data.text)
        : JSON.stringify(data);
      process.stdout.write(`[${event}] ${payload}\n`);
    },
    finish() {
      if (assistantBuffer) {
        process.stdout.write(`💬 ${assistantBuffer}\n`);
        assistantBuffer = '';
      }
      if (enabled && wrote) {
        process.stdout.write('\n');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Compact live-event formatting (for --compact on run/wait/send with events)
// ---------------------------------------------------------------------------

function formatCompactLiveEvent(
  event: string,
  data: Record<string, unknown>,
  state: { assistantBuffer: string },
): { output: string | null; buffer?: string } {
  // Accumulate agent message deltas
  if (event === 'item/agentMessage/delta') {
    const delta = typeof data.delta === 'string' ? data.delta : '';
    return { output: null, buffer: state.assistantBuffer + delta };
  }

  // When a completed item arrives, flush buffer and show
  if (event === 'item/completed') {
    const item = isRecord(data.item) ? data.item : data;
    const type = String(item.type ?? '');

    if (type === 'agentMessage' && typeof item.text === 'string') {
      return { output: `💬 ${item.text}`, buffer: '' };
    }
    if (type === 'commandExecution') {
      const name = String(item.name ?? item.command ?? 'command');
      const status = String(item.status ?? '');
      return { output: `🔧 ${name} (${status})`, buffer: state.assistantBuffer };
    }
    if (type === 'fileChange') {
      const path = String(item.path ?? item.file ?? '');
      const action = String(item.action ?? 'changed');
      return { output: `📝 ${action}: ${shortenPath(path)}`, buffer: state.assistantBuffer };
    }
    return { output: null };
  }

  // Suppress noisy events
  if (event === 'account/rateLimits/updated') {
    return { output: null };
  }
  if (event === 'item/commandExecution/outputDelta' || event === 'item/fileChange/outputDelta') {
    return { output: null };
  }
  if (event === 'command/exec/outputDelta') {
    const deltaBase64 = typeof data.deltaBase64 === 'string' ? data.deltaBase64 : '';
    const decoded = deltaBase64 ? Buffer.from(deltaBase64, 'base64').toString('utf8') : '';
    return decoded ? { output: decoded.trimEnd() || decoded } : { output: null };
  }

  // Show turn completion
  if (event === 'turn/completed') {
    const flushPrefix = state.assistantBuffer ? `💬 ${state.assistantBuffer}\n` : '';
    const turn = isRecord(data.turn) ? data.turn : data;
    const status = String(turn.status ?? data.status ?? 'completed');
    const icon = status === 'completed' ? '✅' : (status === 'interrupted' ? '⚠️' : '❌');
    if (status === 'failed') {
      const turnError = isRecord(turn.error) ? turn.error : undefined;
      const tag = normalizeErrorTag(turnError?.codexErrorInfo);
      const msg = String(turnError?.message ?? turn.error ?? '');
      const tagLabel = tag ? `[${tag}] ` : '';
      return { output: `${flushPrefix}${icon} Turn failed ${tagLabel}${msg}`.trimEnd(), buffer: '' };
    }
    return { output: `${flushPrefix}${icon} Turn ${status}`, buffer: '' };
  }

  // Show thread status changes
  if (event === 'thread/status/changed') {
    return { output: `📊 Status: ${String(data.status ?? 'unknown')}` };
  }

  // Show errors
  if (event === 'error') {
    const errObj = isRecord(data.error) ? data.error : undefined;
    const msg = String(errObj?.message ?? data.message ?? JSON.stringify(data));
    const willRetry = data.willRetry === true;
    if (willRetry) {
      return { output: `⚠️  Error (retrying): ${msg}` };
    }
    const tag = normalizeErrorTag(errObj?.codexErrorInfo) ?? '';
    return { output: `❌ Error${tag ? ` [${tag}]` : ''}: ${msg}` };
  }

  return { output: null };
}

// ---------------------------------------------------------------------------
// Follow-mode event formatting (for task follow / transcript tailing)
// ---------------------------------------------------------------------------

export interface FollowFormatter {
  compact: boolean;
  assistantBuffer: string;
}

export function formatFollowEvent(
  event: Record<string, unknown>,
  formatter: FollowFormatter,
): string | null {
  const type = String(event.type ?? '');

  if (formatter.compact) {
    return formatCompactTranscriptEvent(event, type, formatter);
  }

  return formatVerboseTranscriptEvent(event, type, formatter);
}

function formatCompactTranscriptEvent(
  event: Record<string, unknown>,
  type: string,
  formatter: FollowFormatter,
): string | null {
  // Accumulate assistant deltas
  if (type === 'assistant.delta') {
    formatter.assistantBuffer += String(event.delta ?? '');
    return null;
  }

  // Flush buffer on non-delta events
  let prefix = '';
  if (formatter.assistantBuffer) {
    prefix = `💬 ${formatter.assistantBuffer}\n`;
    formatter.assistantBuffer = '';
  }

  if (type === 'user') {
    const prompt = String(event.prompt ?? event.text ?? '');
    const preview = prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
    return `${prefix}👤 ${preview}`;
  }

  if (type === 'request') {
    const method = String(event.method ?? '');
    const requestId = String(event.requestId ?? '');
    if (method === 'item/tool/requestUserInput') {
      return `${prefix}❓ Agent asks a question (${requestId})`;
    }
    return `${prefix}⏸️  Approval needed: ${method} (${requestId})`;
  }

  if (type === 'notification') {
    const method = String(event.method ?? '');
    const params = isRecord(event.params) ? event.params : {};
    const item = isRecord(params.item) ? params.item : undefined;

    if (method === 'item/completed' && item) {
      if (item.type === 'agentMessage' && typeof item.text === 'string') {
        formatter.assistantBuffer = '';
        return `${prefix}💬 ${item.text}`;
      }
      if (item.type === 'commandExecution') {
        return `${prefix}🔧 ${String(item.name ?? item.command ?? 'command')}`;
      }
      if (item.type === 'fileChange') {
        return `${prefix}📝 ${String(item.action ?? 'changed')}: ${shortenPath(String(item.path ?? ''))}`;
      }
    }
    return null;
  }

  return prefix || null;
}

function formatVerboseTranscriptEvent(
  event: Record<string, unknown>,
  type: string,
  formatter: FollowFormatter,
): string | null {
  if (type === 'assistant.delta') {
    formatter.assistantBuffer += String(event.delta ?? '');
    return null;
  }

  let prefix = '';
  if (formatter.assistantBuffer) {
    prefix = `[assistant] ${formatter.assistantBuffer}\n`;
    formatter.assistantBuffer = '';
  }

  if (type === 'user') {
    return `${prefix}[user] ${String(event.prompt ?? event.text ?? '')}`;
  }

  if (type === 'request') {
    return `${prefix}[request] ${String(event.method ?? '')} (${String(event.requestId ?? '')})`;
  }

  if (type === 'notification') {
    const method = String(event.method ?? '');
    const params = isRecord(event.params) ? event.params : {};
    return `${prefix}[${method}] ${JSON.stringify(params)}`;
  }

  if (type.includes('Delta')) {
    return null; // suppress raw deltas in verbose mode too
  }

  return `${prefix}[${type}] ${JSON.stringify(event)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize a camelCase codexErrorInfo key to snake_case tag. */
function normalizeErrorTag(codexErrorInfo: unknown): string | undefined {
  if (codexErrorInfo == null) return undefined;
  const key = typeof codexErrorInfo === 'string'
    ? codexErrorInfo
    : (isRecord(codexErrorInfo) ? Object.keys(codexErrorInfo)[0] : undefined);
  if (!key) return undefined;
  // camelCase → snake_case
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}
