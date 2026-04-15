import { appendFile } from 'node:fs/promises';

import { rawLogPath } from './paths.js';

export type RawDirection =
  | 'rpc_out'
  | 'rpc_in'
  | 'notification'
  | 'server_request'
  | 'server_response'
  | 'stderr'
  | 'exit'
  | 'protocol_error'
  | 'daemon';

export interface RawEvent {
  dir: RawDirection;
  method?: string | undefined;
  id?: string | number | undefined;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  data?: unknown;
  message?: string | undefined;
}

function disabled(): boolean {
  const v = process.env.CODEX_WORKER_RAW_LOG;
  if (v === undefined) return false;
  const s = v.trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'off' || s === 'no';
}

export async function appendRawEvent(
  cwd: string,
  threadId: string,
  event: RawEvent,
): Promise<void> {
  if (disabled()) return;
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
    await appendFile(rawLogPath(cwd, threadId), `${line}\n`);
  } catch {
    // Raw log is best-effort — never break a turn because of logging.
  }
}

export function appendRawEventSync(
  cwd: string,
  threadId: string,
  event: RawEvent,
): void {
  // Fire-and-forget wrapper for contexts where we don't want to await.
  void appendRawEvent(cwd, threadId, event);
}
