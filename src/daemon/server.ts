import net from 'node:net';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';

import { ensureStateRoot } from '../core/paths.js';
import type { DaemonRequestEnvelope, DaemonResponseEnvelope } from '../core/types.js';
import { CliCodexWorkerService } from './service.js';

function writeEnvelope(socket: net.Socket, envelope: DaemonResponseEnvelope): void {
  socket.write(`${JSON.stringify(envelope)}\n`);
}

export async function runDaemonServer(): Promise<void> {
  const socketPath = process.env.CLI_CODEX_WORKER_DAEMON_SOCKET ?? ensureStateRoot().socketPath;
  const token = process.env.CLI_CODEX_WORKER_DAEMON_TOKEN;
  if (!token) {
    throw new Error('Missing CLI_CODEX_WORKER_DAEMON_TOKEN');
  }

  if (existsSync(socketPath)) {
    await unlink(socketPath).catch(() => {});
  }

  const service = new CliCodexWorkerService();
  await service.initialize();
  await service.writeDaemonMeta(socketPath, token);

  const shutdown = async () => {
    await service.shutdown().catch(() => {});
    server.close();
    process.exit(0);
  };

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          void handleRequest(line, socket, token, service, shutdown);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function handleRequest(
  line: string,
  socket: net.Socket,
  token: string,
  service: CliCodexWorkerService,
  shutdown: () => Promise<void>,
): Promise<void> {
  let envelope: DaemonRequestEnvelope;
  try {
    envelope = JSON.parse(line) as DaemonRequestEnvelope;
  } catch {
    writeEnvelope(socket, {
      id: 'unknown',
      type: 'error',
      error: 'Invalid JSON request',
    });
    return;
  }

  if (envelope.token !== token) {
    writeEnvelope(socket, {
      id: envelope.id,
      type: 'error',
      error: 'Unauthorized',
    });
    return;
  }

  const writer = {
    event(name: string, data: Record<string, unknown>) {
      writeEnvelope(socket, {
        id: envelope.id,
        type: 'event',
        event: name,
        data,
      });
    },
  };

  try {
    let result: Record<string, unknown>;
    let shouldShutdown = false;
    switch (envelope.command) {
      case 'daemon.status':
        result = await service.daemonStatus();
        break;
      case 'daemon.stop':
        result = await service.shutdown();
        shouldShutdown = true;
        break;
      case 'thread.start':
        result = await service.threadStart(envelope.args ?? {}, writer);
        break;
      case 'thread.resume':
        result = await service.threadResume(envelope.args ?? {});
        break;
      case 'thread.read':
        result = await service.threadRead(envelope.args ?? {});
        break;
      case 'thread.list':
        result = await service.threadList(envelope.args ?? {});
        break;
      case 'turn.start':
        result = await service.turnStart(envelope.args ?? {}, writer);
        break;
      case 'turn.steer':
        result = await service.turnSteer(envelope.args ?? {}, writer);
        break;
      case 'turn.interrupt':
        result = await service.turnInterrupt(envelope.args ?? {});
        break;
      case 'model.list':
        result = await service.modelList(envelope.args ?? {});
        break;
      case 'account.read':
        result = await service.accountRead(envelope.args ?? {});
        break;
      case 'account.rate-limits':
        result = await service.accountRateLimits(envelope.args ?? {});
        break;
      case 'skills.list':
        result = await service.skillsList(envelope.args ?? {});
        break;
      case 'app.list':
        result = await service.appList(envelope.args ?? {});
        break;
      case 'request.list':
        result = await service.requestList(envelope.args ?? {});
        break;
      case 'request.read':
        result = await service.requestRead(envelope.args ?? {});
        break;
      case 'request.respond':
        result = await service.requestRespond(envelope.args ?? {});
        break;
      case 'wait':
        result = await service.wait(envelope.args ?? {}, writer);
        break;
      case 'doctor':
        result = await service.doctor();
        break;
      case 'run':
        result = await service.run(envelope.args ?? {}, writer);
        break;
      case 'send':
        result = await service.send(envelope.args ?? {}, writer);
        break;
      case 'read':
        result = await service.read(envelope.args ?? {});
        break;
      default:
        throw new Error(`Unknown command: ${envelope.command}`);
    }

    writeEnvelope(socket, {
      id: envelope.id,
      type: 'result',
      data: result,
    });
    if (shouldShutdown) {
      socket.end();
      setTimeout(() => {
        void shutdown();
      }, 10).unref();
    }
  } catch (error) {
    writeEnvelope(socket, {
      id: envelope.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
