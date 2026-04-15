import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function isBunRuntime(): boolean {
  return typeof process.versions.bun === 'string';
}

function isVirtualizedBunModuleUrl(moduleUrl: string): boolean {
  if (moduleUrl.startsWith('bun:')) {
    return true;
  }
  return moduleUrl.includes('/$bunfs/') || moduleUrl.includes('\\$bunfs\\');
}

function modulePathFromUrl(moduleUrl: string): string | null {
  if (!moduleUrl.startsWith('file://')) {
    return null;
  }
  try {
    return fileURLToPath(moduleUrl);
  } catch {
    return null;
  }
}

export function isCompiledBinary(): boolean {
  if (!isBunRuntime()) {
    return false;
  }

  const moduleUrl = import.meta.url;
  if (isVirtualizedBunModuleUrl(moduleUrl)) {
    return true;
  }

  const modulePath = modulePathFromUrl(moduleUrl);
  if (!modulePath) {
    return true;
  }

  return !existsSync(modulePath);
}

export function selfRespawnSpec(subcommand: string): { command: string; args: string[] } {
  if (isCompiledBinary()) {
    return {
      command: process.execPath,
      args: [subcommand],
    };
  }

  const compiledCliPath = fileURLToPath(new URL('../cli.js', import.meta.url));
  if (existsSync(compiledCliPath)) {
    return {
      command: process.execPath,
      args: [compiledCliPath, subcommand],
    };
  }

  const sourceCliPath = fileURLToPath(new URL('../cli.ts', import.meta.url));
  if (isBunRuntime()) {
    return {
      command: process.execPath,
      args: [sourceCliPath, subcommand],
    };
  }

  return {
    command: process.execPath,
    args: ['--import', 'tsx', sourceCliPath, subcommand],
  };
}
