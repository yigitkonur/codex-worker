import { open, readFile, stat } from 'node:fs/promises';

import { sendDaemonRequest } from './daemon/client.js';
import { shortenPath } from './output.js';

interface MonitorOptions {
  follow: boolean;
  initialTail: number;
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

export function parseRawLogLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function formatMonitorEvent(entry: Record<string, unknown>): string | null {
  const dir = stringValue(entry.dir);
  if (!dir) {
    return null;
  }

  if (dir === 'rpc_out' && entry.method === 'turn/steer') {
    const params = isRecord(entry.params) ? entry.params : {};
    return `<<CODEX>> steer_requested thread=${String(params.threadId ?? 'unknown')}`;
  }

  if (dir === 'server_request') {
    const method = String(entry.method ?? '');
    const id = String(entry.id ?? '');
    if (method === 'item/tool/requestUserInput') {
      return `<<CODEX>> question id=${id}`;
    }
    return `<<CODEX>> approval method=${method} id=${id}`;
  }

  if (dir === 'notification') {
    const method = String(entry.method ?? '');
    const params = isRecord(entry.params) ? entry.params : {};

    if (method === 'turn/plan/updated' || method === 'item/plan/delta') {
      return '<<CODEX>> plan_updated';
    }

    if (method === 'error') {
      const error = isRecord(params.error) ? params.error : {};
      const msg = String(error.message ?? params.message ?? 'unknown');
      const willRetry = params.willRetry === true;
      const codexInfo = error.codexErrorInfo;
      const tag = codexInfo != null
        ? (typeof codexInfo === 'string' ? codexInfo : Object.keys(codexInfo as object)[0] ?? '')
        : '';
      const prefix = willRetry ? 'error_retrying' : 'error';
      return `<<CODEX>> ${prefix}${tag ? ` [${tag}]` : ''} message=${JSON.stringify(msg)}`;
    }

    if (method === 'item/completed') {
      const item = isRecord(params.item) ? params.item : undefined;
      if (!item) {
        return null;
      }
      if (item.type === 'agentMessage' && typeof item.text === 'string') {
        return `<<CODEX>> agent_message text=${JSON.stringify(item.text)}`;
      }
      if (item.type === 'commandExecution') {
        return `<<CODEX>> command_executed command=${JSON.stringify(String(item.command ?? item.name ?? 'command'))}`;
      }
      if (item.type === 'fileChange') {
        return `<<CODEX>> file_changed action=${String(item.action ?? 'changed')} path=${JSON.stringify(shortenPath(String(item.path ?? item.file ?? '')))}`;
      }
    }
    return null;
  }

  if (dir === 'daemon' && typeof entry.message === 'string') {
    const turnId = entry.message.match(/turnId=([^\s]+)/)?.[1] ?? 'unknown';
    if (entry.message.startsWith('completeExecution status=completed')) {
      return `<<CODEX>> task_complete turn=${turnId}`;
    }
    if (entry.message.startsWith('completeExecution status=interrupted')) {
      return `<<CODEX>> task_interrupted turn=${turnId}`;
    }
    if (entry.message.startsWith('failExecution')) {
      const tag = entry.message.match(/tag=([^\s]+)/)?.[1] ?? '';
      const error = entry.message.match(/error=(.+)$/)?.[1] ?? 'unknown';
      return `<<CODEX>> task_failed${tag ? ` [${tag}]` : ''} turn=${turnId} error=${JSON.stringify(error)}`;
    }
  }

  return null;
}

async function readRawLines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function readBytesFrom(path: string, offset: number, length: number): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, offset);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

export async function monitorThread(threadId: string, options: MonitorOptions): Promise<void> {
  const result = await sendDaemonRequest('read', { threadId, tailLines: 0 });
  const artifacts = result.artifacts as Record<string, unknown> | undefined;
  const rawLogPath = String(artifacts?.rawLogPath ?? '');
  if (!rawLogPath) {
    throw new Error(`Cannot determine raw log path for thread ${threadId}`);
  }

  const printLine = (line: string) => {
    const event = parseRawLogLine(line);
    if (!event) {
      return;
    }
    const rendered = formatMonitorEvent(event);
    if (rendered) {
      process.stdout.write(`${rendered}\n`);
    }
  };

  const initialLines = await readRawLines(rawLogPath);
  const initialTail = Math.max(0, Math.trunc(options.initialTail));
  const initialLinesToPrint = initialTail === 0 ? [] : initialLines.slice(-initialTail);
  for (const line of initialLinesToPrint) {
    printLine(line);
  }

  if (!options.follow) {
    return;
  }

  let byteOffset = await fileSize(rawLogPath);
  let tailBuffer = '';

  while (true) {
    const currentSize = await fileSize(rawLogPath);
    if (currentSize > byteOffset) {
      const chunk = await readBytesFrom(rawLogPath, byteOffset, currentSize - byteOffset);
      byteOffset = currentSize;
      tailBuffer += chunk;
      let newlineIndex = tailBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = tailBuffer.slice(0, newlineIndex).trim();
        tailBuffer = tailBuffer.slice(newlineIndex + 1);
        if (line) {
          printLine(line);
        }
        newlineIndex = tailBuffer.indexOf('\n');
      }
    }
    await sleep(500);
  }
}
