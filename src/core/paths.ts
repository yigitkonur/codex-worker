import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StatePaths {
  rootDir: string;
  registryPath: string;
  daemonMetaPath: string;
  socketPath: string;
}

export function stateRootDir(): string {
  const explicitRoot = process.env.CODEX_WORKER_STATE_DIR?.trim()
    ?? process.env.CLI_CODEX_WORKER_STATE_DIR?.trim();
  return explicitRoot || join(homedir(), '.codex-worker');
}

export function ensureStateRoot(): StatePaths {
  const rootDir = stateRootDir();
  mkdirSync(rootDir, { recursive: true });
  return {
    rootDir,
    registryPath: join(rootDir, 'registry.json'),
    daemonMetaPath: join(rootDir, 'daemon.json'),
    socketPath: join(rootDir, 'daemon.sock'),
  };
}

export function workspaceIdForCwd(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 12);
}

export function workspaceDir(cwd: string): string {
  return join(ensureStateRoot().rootDir, 'workspaces', workspaceIdForCwd(cwd));
}

export function ensureWorkspaceDirs(cwd: string): { workspaceDir: string; transcriptDir: string; logDir: string } {
  const base = workspaceDir(cwd);
  const transcriptDir = join(base, 'threads');
  const logDir = join(base, 'logs');
  mkdirSync(transcriptDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  return { workspaceDir: base, transcriptDir, logDir };
}

export function transcriptPath(cwd: string, threadId: string): string {
  return join(ensureWorkspaceDirs(cwd).transcriptDir, `${threadId}.jsonl`);
}

export function logPath(cwd: string, threadId: string): string {
  return join(ensureWorkspaceDirs(cwd).logDir, `${threadId}.output`);
}

export function buildDaemonToken(): string {
  return randomUUID();
}
