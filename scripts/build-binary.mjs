#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveSpawnCommand } from './spawn-command.mjs';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const rootPackagePath = join(rootDir, 'package.json');
const distDir = join(rootDir, 'dist');
const distPackagePath = join(distDir, 'package.json');
const distBinDir = join(distDir, 'bin');
const hostBinaryPath = join(distBinDir, process.platform === 'win32' ? 'codex-worker.exe' : 'codex-worker');

export const RELEASE_TARGETS = [
  {
    id: 'linux-x64',
    bunTarget: 'bun-linux-x64',
    outputName: 'codex-worker-linux-x64',
    bytecode: false,
  },
  {
    id: 'linux-x64-baseline',
    bunTarget: 'bun-linux-x64-baseline',
    outputName: 'codex-worker-linux-x64-baseline',
    bytecode: false,
  },
  {
    id: 'linux-arm64',
    bunTarget: 'bun-linux-arm64',
    outputName: 'codex-worker-linux-arm64',
    bytecode: false,
  },
  {
    id: 'linux-x64-musl',
    bunTarget: 'bun-linux-x64-musl',
    outputName: 'codex-worker-linux-x64-musl',
    bytecode: false,
  },
  {
    id: 'linux-arm64-musl',
    bunTarget: 'bun-linux-arm64-musl',
    outputName: 'codex-worker-linux-arm64-musl',
    bytecode: false,
  },
  {
    id: 'darwin-x64',
    bunTarget: 'bun-darwin-x64',
    outputName: 'codex-worker-darwin-x64',
    bytecode: false,
  },
  {
    id: 'darwin-arm64',
    bunTarget: 'bun-darwin-arm64',
    outputName: 'codex-worker-darwin-arm64',
    bytecode: false,
  },
  {
    id: 'windows-x64',
    bunTarget: 'bun-windows-x64',
    outputName: 'codex-worker-windows-x64.exe',
    bytecode: false,
  },
];

// Verified locally on 2026-04-15: Bun 1.3.11 fails to compile this CLI for
// bun-windows-x64 when --bytecode is enabled, erroring on the top-level await
// in src/cli.ts. Keep bytecode off until upstream behavior changes and is
// re-verified on real Windows-hosted runners.
export function shouldUseHostBytecode() {
  return false;
}

function readRootPackageJson() {
  return JSON.parse(readFileSync(rootPackagePath, 'utf8'));
}

function writeDistPackageJson() {
  const rootPackage = readRootPackageJson();
  const distPackage = {
    name: rootPackage.name,
    version: rootPackage.version,
    type: rootPackage.type,
  };
  mkdirSync(distDir, { recursive: true });
  writeFileSync(distPackagePath, `${JSON.stringify(distPackage, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${distPackagePath}\n`);
}

function resolveWorkspaceBunBinary() {
  const envOverride = process.env.BUN_BINARY?.trim();
  if (envOverride) {
    return envOverride;
  }

  const binCandidates = [
    join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'bun.cmd' : 'bun'),
  ];

  try {
    const bunPackageJsonPath = require.resolve('bun/package.json', { paths: [rootDir] });
    const bunPackageDir = dirname(bunPackageJsonPath);
    const bunPackageJson = JSON.parse(readFileSync(bunPackageJsonPath, 'utf8'));
    if (typeof bunPackageJson.bin === 'string') {
      binCandidates.push(join(bunPackageDir, bunPackageJson.bin));
    } else if (bunPackageJson.bin && typeof bunPackageJson.bin === 'object' && typeof bunPackageJson.bin.bun === 'string') {
      binCandidates.push(join(bunPackageDir, bunPackageJson.bin.bun));
    }
    binCandidates.push(join(bunPackageDir, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'));
  } catch {
    // Fall through to existence check and explicit guidance.
  }

  const match = binCandidates.find((candidate) => existsSync(candidate));
  if (!match) {
    throw new Error(
      'Could not resolve a workspace Bun binary. Install dev dependency bun@1.3.11, then rerun this script.',
    );
  }
  return match;
}

function runBunBuild(args) {
  const bunBinary = resolveWorkspaceBunBinary();
  const spawnCommand = resolveSpawnCommand(bunBinary);
  const result = spawnSync(spawnCommand.command, [...spawnCommand.args, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.error) {
    throw result.error;
  }
}

function compileHostBinary() {
  writeDistPackageJson();
  mkdirSync(distBinDir, { recursive: true });
  const args = [
    'build',
    './src/cli.ts',
    '--compile',
    '--minify',
    '--sourcemap',
    ...(shouldUseHostBytecode() ? ['--bytecode'] : []),
    '--outfile',
    hostBinaryPath,
  ];
  runBunBuild(args);
  process.stdout.write(`Built ${hostBinaryPath}\n`);
}

function resolveReleaseTarget(value) {
  const normalized = (value ?? '').trim();
  if (!normalized) {
    throw new Error(`Missing release target. Expected one of: ${RELEASE_TARGETS.map((target) => target.id).join(', ')}`);
  }
  const byId = RELEASE_TARGETS.find((target) => target.id === normalized);
  if (byId) {
    return byId;
  }
  const byBunTarget = RELEASE_TARGETS.find((target) => target.bunTarget === normalized);
  if (byBunTarget) {
    return byBunTarget;
  }
  throw new Error(`Unknown release target "${value}". Expected one of: ${RELEASE_TARGETS.map((target) => target.id).join(', ')}`);
}

function compileReleaseTarget(target) {
  const outPath = join(distBinDir, target.outputName);
  const args = [
    'build',
    './src/cli.ts',
    '--compile',
    '--minify',
    '--sourcemap',
    `--target=${target.bunTarget}`,
    '--outfile',
    outPath,
  ];
  if (target.bytecode) {
    args.push('--bytecode');
  }
  runBunBuild(args);
  process.stdout.write(`Built ${outPath}\n`);
}

function compileAllReleaseTargets() {
  writeDistPackageJson();
  mkdirSync(distBinDir, { recursive: true });
  for (const target of RELEASE_TARGETS) {
    compileReleaseTarget(target);
  }
}

function compileOneReleaseTarget(targetArg) {
  writeDistPackageJson();
  mkdirSync(distBinDir, { recursive: true });
  compileReleaseTarget(resolveReleaseTarget(targetArg));
}

function printUsage() {
  process.stdout.write([
    'Usage:',
    '  node scripts/build-binary.mjs host',
    '  node scripts/build-binary.mjs target <release-target>',
    '  node scripts/build-binary.mjs all',
    '  node scripts/build-binary.mjs prepare-dist-package',
    '',
    `Release targets: ${RELEASE_TARGETS.map((target) => target.id).join(', ')}`,
  ].join('\n'));
  process.stdout.write('\n');
}

export function main(argv = process.argv.slice(2)) {
  const command = argv[0] ?? 'host';

  if (command === '--help' || command === '-h') {
    printUsage();
  } else if (command === 'prepare-dist-package') {
    writeDistPackageJson();
  } else if (command === '--all') {
    compileAllReleaseTargets();
  } else if (command === '--target') {
    compileOneReleaseTarget(argv[1]);
  } else if (command === 'compile-host' || command === 'host') {
    compileHostBinary();
  } else if (command === 'target') {
    compileOneReleaseTarget(argv[1]);
  } else if (command === 'all') {
    compileAllReleaseTargets();
  } else if (command.startsWith('--target=')) {
    compileOneReleaseTarget(command.slice('--target='.length));
  } else if (command.startsWith('--')) {
    throw new Error(
      `Unknown flag "${command}". Expected "--all" or "--target <release-target>".`,
    );
  } else if (argv.length === 0) {
    compileHostBinary();
  } else {
    throw new Error(
      `Unknown command "${command}". Expected host/default, "--all", "--target <release-target>", or "prepare-dist-package".`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
