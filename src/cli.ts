#!/usr/bin/env node

import { resolve as resolvePath } from 'node:path';
import process from 'node:process';

import { Command } from 'commander';

import pkg from '../package.json' with { type: 'json' };
import { readMarkdownFile } from './core/markdown.js';
import { daemonIsRunning, ensureDaemonMeta, sendDaemonRequest } from './daemon/client.js';
import { runDaemonServer } from './daemon/server.js';
import { inspectDoctor } from './doctor.js';
import {
  createEventPrinter,
  formatSimpleActions,
  printJson,
  resolveOutputFormat,
  shortenPath,
  type OutputFormat,
} from './output.js';

function parseInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function getOutputFormat(program: Command): OutputFormat {
  return resolveOutputFormat((program.opts() as { output?: string }).output);
}

function renderThreadResult(result: Record<string, unknown>): string {
  const thread = (result.thread as Record<string, unknown>) ?? {};
  const threadId = String(thread.id ?? result.threadId ?? 'unknown');
  const lines = [
    `Thread: ${threadId}`,
    `Model: ${String(result.model ?? thread.model ?? 'unknown')}`,
    `Provider: ${String(result.modelProvider ?? thread.modelProvider ?? 'unknown')}`,
    `cwd: ${shortenPath(String(thread.cwd ?? ''))}`,
  ];
  if (result.remappedFrom) {
    lines.push(`Model remap: ${String(result.remappedFrom)} -> ${String(result.model)}`);
  }
  lines.push('');
  lines.push('Actions:');
  lines.push(formatSimpleActions(result.actions as Record<string, unknown> | undefined));
  return lines.join('\n');
}

function renderTurnResult(result: Record<string, unknown>): string {
  const turn = result.turn && typeof result.turn === 'object'
    ? result.turn as Record<string, unknown>
    : undefined;
  const lines = [
    `Thread: ${String(result.threadId ?? 'unknown')}`,
    `Turn: ${String(result.turnId ?? turn?.id ?? 'unknown')}`,
    `Status: ${String(result.status ?? turn?.status ?? 'unknown')}`,
  ];

  if (result.job && typeof result.job === 'object') {
    const job = result.job as Record<string, unknown>;
    lines.push(`Job: ${String(job.id ?? 'unknown')} (${String(job.status ?? 'unknown')})`);
  }
  if (result.pendingRequests && Array.isArray(result.pendingRequests) && result.pendingRequests.length > 0) {
    lines.push(`Pending requests: ${result.pendingRequests.length}`);
  }
  lines.push('');
  lines.push('Actions:');
  lines.push(formatSimpleActions(result.actions as Record<string, unknown> | undefined));
  return lines.join('\n');
}

function renderListResult(result: Record<string, unknown>): string {
  const data = Array.isArray(result.data)
    ? result.data as Array<Record<string, unknown>>
    : [];
  if (data.length === 0) {
    return 'No entries.';
  }

  return data
    .map((entry) => {
      if (entry.id && entry.status) {
        return `${String(entry.id)}  ${String(entry.status)}  ${shortenPath(String(entry.cwd ?? ''))}`;
      }
      return JSON.stringify(entry);
    })
    .join('\n');
}

function renderReadResult(result: Record<string, unknown>): string {
  const thread = (result.thread as Record<string, unknown>) ?? {};
  const localThread = (result.localThread as Record<string, unknown> | undefined) ?? undefined;
  const turns = Array.isArray(result.turns) ? result.turns as Array<Record<string, unknown>> : [];
  const pendingRequests = Array.isArray(result.pendingRequests) ? result.pendingRequests as Array<Record<string, unknown>> : [];
  const artifacts = (result.artifacts as Record<string, unknown> | undefined) ?? undefined;
  const logTail = Array.isArray(artifacts?.displayLog)
    ? artifacts.displayLog as string[]
    : (Array.isArray(artifacts?.logTail) ? artifacts.logTail as string[] : []);

  const lines = [
    `Thread: ${String(thread.id ?? localThread?.id ?? 'unknown')}`,
    `Status: ${String(localThread?.status ?? thread.status ?? 'unknown')}`,
    `Model: ${String(localThread?.model ?? 'unknown')}`,
    `cwd: ${shortenPath(String(localThread?.cwd ?? thread.cwd ?? ''))}`,
    `Turns tracked: ${turns.length}`,
    `Pending requests: ${pendingRequests.length}`,
  ];

  if (artifacts?.transcriptPath || artifacts?.logPath) {
    lines.push('');
    lines.push('Artifacts:');
    if (typeof artifacts.transcriptPath === 'string') {
      lines.push(`- transcript: ${shortenPath(artifacts.transcriptPath)}`);
    }
    if (typeof artifacts.logPath === 'string') {
      lines.push(`- log: ${shortenPath(artifacts.logPath)}`);
    }
  }

  if (turns.length > 0) {
    lines.push('');
    lines.push('Recent turns:');
    for (const turn of turns.slice(0, 5)) {
      lines.push(`- ${String(turn.id)} ${String(turn.status)} ${String(turn.promptPreview ?? '')}`);
    }
  }

  if (logTail.length > 0) {
    lines.push('');
    lines.push('Recent log:');
    for (const line of logTail) {
      lines.push(line);
    }
  }

  return lines.join('\n');
}

function renderLogResult(result: Record<string, unknown>): string {
  const artifacts = (result.artifacts as Record<string, unknown> | undefined) ?? {};
  const logTail = Array.isArray(artifacts.displayLog)
    ? artifacts.displayLog as string[]
    : (Array.isArray(artifacts.logTail) ? artifacts.logTail as string[] : []);
  const lines: string[] = [];
  if (typeof artifacts.logPath === 'string') {
    lines.push(`Log: ${shortenPath(artifacts.logPath)}`);
  }
  lines.push('');
  lines.push(...(logTail.length > 0 ? logTail : ['(no log lines yet)']));
  return lines.join('\n');
}

async function readPrompt(path: string): Promise<{ path: string; content: string }> {
  return await readMarkdownFile(path, process.cwd());
}

async function commandThreadStart(options: {
  cwd?: string;
  model?: string;
  developerInstructions?: string;
  baseInstructions?: string;
}, program: Command): Promise<void> {
  const result = await sendDaemonRequest('thread.start', {
    cwd: resolvePath(options.cwd ?? process.cwd()),
    model: options.model,
    developerInstructions: options.developerInstructions,
    baseInstructions: options.baseInstructions,
  });
  if (getOutputFormat(program) === 'json') {
    printJson(result);
    return;
  }
  process.stdout.write(`${renderThreadResult(result)}\n`);
}

async function commandTurnStart(threadId: string, promptFile: string, options: { async?: boolean; timeout?: string }, program: Command): Promise<void> {
  const payload = await readPrompt(promptFile);
  const output = getOutputFormat(program);
  const printer = createEventPrinter(output === 'text' && !options.async && Boolean(process.stdout.isTTY));
  const result = await sendDaemonRequest('turn.start', {
    threadId,
    prompt: payload.content,
    inputFilePath: payload.path,
    async: options.async ?? false,
    timeoutMs: parseInteger(options.timeout, 'timeout'),
  }, { onEvent: printer.onEvent });
  printer.finish();

  if (output === 'json') {
    printJson(result);
    return;
  }
  process.stdout.write(`${renderTurnResult(result)}\n`);
}

async function commandTurnSteer(threadId: string, turnId: string, promptFile: string, options: { async?: boolean; timeout?: string }, program: Command): Promise<void> {
  const payload = await readPrompt(promptFile);
  const output = getOutputFormat(program);
  const printer = createEventPrinter(output === 'text' && !options.async && Boolean(process.stdout.isTTY));
  const result = await sendDaemonRequest('turn.steer', {
    threadId,
    expectedTurnId: turnId,
    prompt: payload.content,
    inputFilePath: payload.path,
    async: options.async ?? false,
    timeoutMs: parseInteger(options.timeout, 'timeout'),
  }, { onEvent: printer.onEvent });
  printer.finish();

  if (output === 'json') {
    printJson(result);
    return;
  }
  process.stdout.write(`${renderTurnResult(result)}\n`);
}

async function commandRun(taskFile: string, options: { cwd?: string; model?: string; async?: boolean; timeout?: string }, program: Command): Promise<void> {
  const payload = await readPrompt(taskFile);
  const output = getOutputFormat(program);
  const printer = createEventPrinter(output === 'text' && !options.async && Boolean(process.stdout.isTTY));
  const result = await sendDaemonRequest('run', {
    cwd: resolvePath(options.cwd ?? process.cwd()),
    model: options.model,
    content: payload.content,
    inputFilePath: payload.path,
    async: options.async ?? false,
    timeoutMs: parseInteger(options.timeout, 'timeout'),
  }, { onEvent: printer.onEvent });
  printer.finish();

  if (output === 'json') {
    printJson(result);
    return;
  }
  process.stdout.write(`${renderTurnResult(result)}\n`);
}

async function commandSend(threadId: string, messageFile: string, options: { async?: boolean; timeout?: string }, program: Command): Promise<void> {
  const payload = await readPrompt(messageFile);
  const output = getOutputFormat(program);
  const printer = createEventPrinter(output === 'text' && !options.async && Boolean(process.stdout.isTTY));
  const result = await sendDaemonRequest('send', {
    threadId,
    content: payload.content,
    inputFilePath: payload.path,
    async: options.async ?? false,
    timeoutMs: parseInteger(options.timeout, 'timeout'),
  }, { onEvent: printer.onEvent });
  printer.finish();

  if (output === 'json') {
    printJson(result);
    return;
  }
  process.stdout.write(`${renderTurnResult(result)}\n`);
}

const program = new Command();

program
  .name('codex-worker')
  .description('Daemon-backed Codex app-server worker CLI')
  .version(pkg.version)
  .option('--output <format>', 'Output format: text or json');

program
  .command('run')
  .argument('<task.md>')
  .description('Friendly alias: create a thread and start a turn from a Markdown prompt file')
  .option('--cwd <dir>', 'Working directory for the thread')
  .option('--model <id>', 'Model id')
  .option('--async', 'Return immediately with thread/turn ids')
  .option('--timeout <ms>', 'Wait timeout in milliseconds')
  .action(async (taskFile, options) => {
    await commandRun(taskFile, options, program);
  });

program
  .command('send')
  .argument('<thread-id>')
  .argument('<message.md>')
  .description('Friendly alias: resume thread and send new prompt from Markdown file')
  .option('--async', 'Return immediately with thread/turn ids')
  .option('--timeout <ms>', 'Wait timeout in milliseconds')
  .action(async (threadId, messageFile, options) => {
    await commandSend(threadId, messageFile, options, program);
  });

program
  .command('read')
  .argument('<thread-id>')
  .description('Friendly alias: read thread state with turns')
  .option('--tail <n>', 'Number of transcript/log lines to include')
  .action(async (threadId, options) => {
    const result = await sendDaemonRequest('read', {
      threadId,
      tailLines: parseInteger(options.tail, 'tail'),
    });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderReadResult(result)}\n`);
  });

program
  .command('logs')
  .argument('<thread-id>')
  .description('Read recent execution log lines for a thread')
  .option('--tail <n>', 'Number of log lines to include')
  .action(async (threadId, options) => {
    const result = await sendDaemonRequest('read', {
      threadId,
      tailLines: parseInteger(options.tail, 'tail') ?? 50,
    });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderLogResult(result)}\n`);
  });

const thread = program.command('thread').description('Protocol-first thread operations');
thread
  .command('start')
  .option('--cwd <dir>', 'Thread working directory')
  .option('--model <id>', 'Model id')
  .option('--developer-instructions <text>', 'Thread-level developer instructions')
  .option('--base-instructions <text>', 'Thread-level base instructions')
  .action(async (options) => {
    await commandThreadStart(options, program);
  });

thread
  .command('resume')
  .argument('<thread-id>')
  .action(async (threadId) => {
    const result = await sendDaemonRequest('thread.resume', { threadId });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderThreadResult(result)}\n`);
  });

thread
  .command('read')
  .argument('<thread-id>')
  .option('--include-turns', 'Include turns from app-server history')
  .option('--tail <n>', 'Number of transcript/log lines to include')
  .action(async (threadId, options) => {
    const result = await sendDaemonRequest('thread.read', {
      threadId,
      includeTurns: options.includeTurns ?? false,
      tailLines: parseInteger(options.tail, 'tail'),
    });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderReadResult(result)}\n`);
  });

thread
  .command('list')
  .option('--cwd <dir>', 'Filter by cwd')
  .option('--archived', 'List archived threads')
  .option('--limit <n>', 'Limit')
  .action(async (options) => {
    const result = await sendDaemonRequest('thread.list', {
      cwd: options.cwd ? resolvePath(options.cwd) : undefined,
      archived: options.archived ?? false,
      limit: parseInteger(options.limit, 'limit'),
    });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderListResult(result)}\n`);
  });

const turn = program.command('turn').description('Protocol-first turn operations');
turn
  .command('start')
  .argument('<thread-id>')
  .argument('<prompt.md>')
  .option('--async', 'Return immediately with turn id')
  .option('--timeout <ms>', 'Wait timeout in milliseconds')
  .action(async (threadId, promptFile, options) => {
    await commandTurnStart(threadId, promptFile, options, program);
  });

turn
  .command('steer')
  .argument('<thread-id>')
  .argument('<turn-id>')
  .argument('<prompt.md>')
  .option('--async', 'Return immediately with turn id')
  .option('--timeout <ms>', 'Wait timeout in milliseconds')
  .action(async (threadId, turnId, promptFile, options) => {
    await commandTurnSteer(threadId, turnId, promptFile, options, program);
  });

turn
  .command('interrupt')
  .argument('<thread-id>')
  .argument('<turn-id>')
  .action(async (threadId, turnId) => {
    const result = await sendDaemonRequest('turn.interrupt', { threadId, turnId });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderTurnResult(result)}\n`);
  });

program
  .command('model')
  .description('Model operations')
  .command('list')
  .option('--cwd <dir>', 'Working directory for model discovery')
  .option('--include-hidden', 'Include hidden models')
  .action(async (options) => {
    const result = await sendDaemonRequest('model.list', {
      cwd: options.cwd ? resolvePath(options.cwd) : process.cwd(),
      includeHidden: options.includeHidden ?? false,
    });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    const ids = Array.isArray(result.data) ? result.data as string[] : [];
    process.stdout.write(`${ids.join('\n')}\n`);
  });

const account = program.command('account').description('Account operations');
account
  .command('read')
  .option('--refresh-token', 'Request token refresh before read')
  .action(async (options) => {
    const result = await sendDaemonRequest('account.read', {
      refreshToken: options.refreshToken ?? false,
    });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

account
  .command('rate-limits')
  .action(async () => {
    const result = await sendDaemonRequest('account.rate-limits', {});
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command('skills')
  .description('Skills operations')
  .command('list')
  .option('--force-reload', 'Force skill re-scan')
  .action(async (options) => {
    const result = await sendDaemonRequest('skills.list', { forceReload: options.forceReload ?? false });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderListResult(result)}\n`);
  });

program
  .command('app')
  .description('Apps operations')
  .command('list')
  .option('--limit <n>', 'Limit')
  .option('--force-refetch', 'Force refetch')
  .option('--thread-id <id>', 'Thread context for app gating')
  .action(async (options) => {
    const result = await sendDaemonRequest('app.list', {
      limit: parseInteger(options.limit, 'limit') ?? 50,
      forceRefetch: options.forceRefetch ?? false,
      threadId: options.threadId,
    });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderListResult(result)}\n`);
  });

const request = program.command('request').description('Pending server request handling');
request
  .command('list')
  .option('--status <status>', 'Filter by pending/responded/failed')
  .action(async (options) => {
    const result = await sendDaemonRequest('request.list', { status: options.status });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderListResult(result)}\n`);
  });

request
  .command('read')
  .argument('<request-id>')
  .action(async (requestId) => {
    const result = await sendDaemonRequest('request.read', { requestId });
    printJson(result);
  });

request
  .command('respond')
  .argument('<request-id>')
  .option('--json <payload>', 'Raw JSON response payload')
  .option('--decision <decision>', 'Decision string for approval requests')
  .option('--answer <text>', 'Answer text for user-input requests')
  .option('--question-id <id>', 'Question id for --answer')
  .action(async (requestId, options) => {
    const result = await sendDaemonRequest('request.respond', {
      requestId,
      json: options.json,
      decision: options.decision,
      answer: options.answer,
      questionId: options.questionId,
    });
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command('wait')
  .description('Wait for a turn/job to reach terminal state')
  .option('--thread-id <id>', 'Thread id')
  .option('--turn-id <id>', 'Turn id')
  .option('--job-id <id>', 'Job id')
  .option('--timeout <ms>', 'Timeout in milliseconds')
  .action(async (options) => {
    const output = getOutputFormat(program);
    const printer = createEventPrinter(output === 'text' && Boolean(process.stdout.isTTY));
    const result = await sendDaemonRequest('wait', {
      threadId: options.threadId,
      turnId: options.turnId,
      jobId: options.jobId,
      timeoutMs: parseInteger(options.timeout, 'timeout'),
    }, { onEvent: printer.onEvent });
    printer.finish();
    if (output === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${renderTurnResult(result)}\n`);
  });

program
  .command('doctor')
  .description('Inspect local runtime prerequisites')
  .action(async () => {
    const result = await inspectDoctor();
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

const daemon = program.command('daemon').description('Manage daemon lifecycle');
daemon
  .command('start')
  .action(async () => {
    const meta = await ensureDaemonMeta();
    const result = await sendDaemonRequest('daemon.status');
    const payload = { ...result, pid: meta.pid, startedAt: meta.startedAt };
    if (getOutputFormat(program) === 'json') {
      printJson(payload);
      return;
    }
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  });

daemon
  .command('status')
  .action(async () => {
    if (!await daemonIsRunning()) {
      if (getOutputFormat(program) === 'json') {
        printJson({ status: 'stopped' });
      } else {
        process.stdout.write('status: stopped\n');
      }
      return;
    }
    const result = await sendDaemonRequest('daemon.status');
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

daemon
  .command('stop')
  .action(async () => {
    if (!await daemonIsRunning()) {
      if (getOutputFormat(program) === 'json') {
        printJson({ status: 'stopped' });
      } else {
        process.stdout.write('status: stopped\n');
      }
      return;
    }
    const result = await sendDaemonRequest('daemon.stop');
    if (getOutputFormat(program) === 'json') {
      printJson(result);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command('daemon-run', { hidden: true })
  .action(async () => {
    await runDaemonServer();
  });

await program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
