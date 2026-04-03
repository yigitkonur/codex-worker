import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { stateRootDir } from './core/paths.js';
import { ProfileManager } from './core/profile-manager.js';
import { PersistentStore } from './core/store.js';
import { daemonIsRunning } from './daemon/client.js';

function commandVersion(command: string): string | null {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }
  return (result.stdout || result.stderr).trim() || null;
}

export async function inspectDoctor(): Promise<Record<string, unknown>> {
  const store = new PersistentStore();
  await store.load();
  const profileManager = ProfileManager.fromEnvironment(store.getProfiles());
  return {
    node: process.version,
    codex: commandVersion('codex'),
    mcpc: commandVersion('mcpc'),
    cwd: process.cwd(),
    daemonRunning: await daemonIsRunning(),
    stateRoot: stateRootDir(),
    profiles: profileManager.getProfiles(),
  };
}
