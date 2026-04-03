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

export function createEventPrinter(enabled: boolean): {
  onEvent: (event: string, data: Record<string, unknown>) => void;
  finish: () => void;
} {
  let wrote = false;
  return {
    onEvent(event, data) {
      if (!enabled) {
        return;
      }
      wrote = true;
      const payload = data.text
        ? String(data.text)
        : JSON.stringify(data);
      process.stdout.write(`[${event}] ${payload}\n`);
    },
    finish() {
      if (enabled && wrote) {
        process.stdout.write('\n');
      }
    },
  };
}
