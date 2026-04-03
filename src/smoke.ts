import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sendDaemonRequest } from './daemon/client.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'cli-codex-worker-smoke-'));
  const outputPath = join(workspace, 'smoke-output.txt');
  const promptPath = join(workspace, 'prompt.md');

  await writeFile(promptPath, [
    `Write the exact text "smoke-ok" to ${outputPath}.`,
    'Use a single line and no extra text.',
  ].join('\n'));

  const models = await sendDaemonRequest('model.list', {
    cwd: workspace,
    includeHidden: false,
  });
  const modelIds = Array.isArray(models.data) ? models.data as string[] : [];
  assert(modelIds.length > 0, 'model/list returned no models');

  const runResult = await sendDaemonRequest('run', {
    cwd: workspace,
    inputFilePath: promptPath,
    content: await readFile(promptPath, 'utf8'),
    async: false,
    timeoutMs: 240_000,
  });
  assert(typeof runResult.threadId === 'string', 'run did not return threadId');
  assert(typeof runResult.turnId === 'string', 'run did not return turnId');
  assert(String(runResult.status) === 'completed', `run did not complete successfully: ${JSON.stringify(runResult)}`);

  const readResult = await sendDaemonRequest('thread.read', {
    threadId: runResult.threadId,
    includeTurns: false,
  });
  assert(readResult.thread && typeof readResult.thread === 'object', 'thread/read did not return thread');

  const file = await readFile(outputPath, 'utf8');
  assert(file.trim() === 'smoke-ok', `unexpected output file content: ${file}`);

  process.stdout.write(JSON.stringify({
    workspace,
    modelCount: modelIds.length,
    threadId: runResult.threadId,
    turnId: runResult.turnId,
    outputPath,
    output: file.trim(),
  }, null, 2));
  process.stdout.write('\n');
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
