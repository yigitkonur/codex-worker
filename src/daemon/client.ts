import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';

import { buildDaemonToken, ensureStateRoot } from '../core/paths.js';
import { selfRespawnSpec } from '../core/runtime-env.js';
import type { DaemonMeta, DaemonRequestEnvelope, DaemonResponseEnvelope } from '../core/types.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDaemonMeta(): Promise<DaemonMeta | null> {
  const { daemonMetaPath } = ensureStateRoot();
  if (!existsSync(daemonMetaPath)) {
    return null;
  }

  try {
    const raw = await readFile(daemonMetaPath, 'utf8');
    return JSON.parse(raw) as DaemonMeta;
  } catch {
    return null;
  }
}

async function canConnect(socketPath: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection(socketPath, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

export async function ensureDaemonMeta(): Promise<DaemonMeta> {
  const existing = await readDaemonMeta();
  if (existing && await canConnect(existing.socketPath)) {
    return existing;
  }

  const { socketPath } = ensureStateRoot();
  const token = buildDaemonToken();
  const launchSpec = selfRespawnSpec('daemon-run');
  const child = spawn(launchSpec.command, launchSpec.args, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CODEX_WORKER_DAEMON_SOCKET: socketPath,
      CODEX_WORKER_DAEMON_TOKEN: token,
    },
  });
  child.unref();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = await readDaemonMeta();
    if (current && await canConnect(current.socketPath)) {
      return current;
    }
    await delay(100);
  }

  throw new Error('Timed out waiting for codex-worker daemon to start');
}

export async function sendDaemonRequest(
  command: DaemonRequestEnvelope['command'],
  args?: Record<string, unknown>,
  options?: {
    onEvent?: ((event: string, data: Record<string, unknown>) => void) | undefined;
  },
): Promise<Record<string, unknown>> {
  const meta = await ensureDaemonMeta();
  const request: DaemonRequestEnvelope = {
    id: `${Date.now()}`,
    token: meta.token,
    command,
    args,
  };

  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const socket = net.createConnection(meta.socketPath);

    const settle = (error?: Error, data?: Record<string, unknown>): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.setTimeout(0);
      if (!socket.destroyed) {
        socket.end();
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(data ?? {});
    };

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          let envelope: DaemonResponseEnvelope;
          try {
            envelope = JSON.parse(line) as DaemonResponseEnvelope;
          } catch {
            settle(new Error('Received malformed daemon response payload'));
            return;
          }
          if (envelope.type === 'event') {
            options?.onEvent?.(envelope.event ?? 'event', envelope.data ?? {});
          } else if (envelope.type === 'result') {
            settle(undefined, envelope.data ?? {});
            return;
          } else {
            settle(new Error(envelope.error ?? 'Unknown daemon error'));
            return;
          }
        }
        newlineIndex = buffer.indexOf('\n');
      }
    });

    socket.on('error', (error) => {
      settle(error);
    });

    socket.on('end', () => {
      if (!settled) {
        settle(new Error('Daemon socket ended before response envelope was received'));
      }
    });

    socket.on('close', (hadError) => {
      if (!settled) {
        const message = hadError
          ? 'Daemon socket closed due to a connection error before response envelope was received'
          : 'Daemon socket closed before response envelope was received';
        settle(new Error(message));
      }
    });

    socket.setTimeout(30_000, () => {
      settle(new Error('Timed out waiting for daemon response envelope'));
    });
  });
}

export async function daemonIsRunning(): Promise<boolean> {
  const meta = await readDaemonMeta();
  return Boolean(meta && await canConnect(meta.socketPath));
}
