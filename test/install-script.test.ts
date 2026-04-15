import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFile } from 'node:child_process';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const installScriptPath = resolve(process.cwd(), 'install.sh');
const execFileAsync = promisify(execFile);

function runInstallerShell(command: string, env: Record<string, string> = {}) {
  return spawnSync('bash', ['-lc', `source "${installScriptPath}"; ${command}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('install.sh has valid bash syntax', () => {
  const result = spawnSync('bash', ['-n', installScriptPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('cw_select_asset_name chooses linux x64 glibc asset', () => {
  const result = runInstallerShell('cw_select_asset_name Linux x64 glibc false');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'codex-worker-linux-x64');
});

test('cw_select_asset_name chooses linux x64 musl asset', () => {
  const result = runInstallerShell('cw_select_asset_name Linux x64 musl false');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'codex-worker-linux-x64-musl');
});

test('cw_select_asset_name chooses linux x64 baseline asset when AVX2 is unavailable', () => {
  const result = runInstallerShell('cw_select_asset_name Linux x64 glibc true');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'codex-worker-linux-x64-baseline');
});

test('cw_select_asset_name chooses darwin arm64 asset', () => {
  const result = runInstallerShell('cw_select_asset_name Darwin arm64 none false');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'codex-worker-darwin-arm64');
});

test('cw_release_download_url uses latest/download for latest version', () => {
  const result = runInstallerShell('cw_release_download_url yigitkonur/codex-worker latest codex-worker-linux-x64');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    'https://github.com/yigitkonur/codex-worker/releases/latest/download/codex-worker-linux-x64',
  );
});

test('cw_release_download_url uses release tag path for explicit versions', () => {
  const result = runInstallerShell('cw_release_download_url yigitkonur/codex-worker v0.1.14 codex-worker-linux-x64');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    'https://github.com/yigitkonur/codex-worker/releases/download/v0.1.14/codex-worker-linux-x64',
  );
});

test('cw_verify_sha256_file accepts matching checksum files', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-worker-install-'));
  const binaryPath = join(tempDir, 'codex-worker-linux-x64');
  const checksumPath = `${binaryPath}.sha256`;
  writeFileSync(binaryPath, 'hello world\n', 'utf8');
  writeFileSync(
    checksumPath,
    'a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447  codex-worker-linux-x64\n',
    'utf8',
  );

  try {
    const result = runInstallerShell(`cw_verify_sha256_file "${binaryPath}" "${checksumPath}"`);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('cw_verify_sha256_file rejects mismatched checksum files', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-worker-install-'));
  const binaryPath = join(tempDir, 'codex-worker-linux-x64');
  const checksumPath = `${binaryPath}.sha256`;
  writeFileSync(binaryPath, 'hello world\n', 'utf8');
  writeFileSync(
    checksumPath,
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff  codex-worker-linux-x64\n',
    'utf8',
  );

  try {
    const result = runInstallerShell(`cw_verify_sha256_file "${binaryPath}" "${checksumPath}"`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('cw_resolve_install_dir respects explicit override', () => {
  const result = runInstallerShell('cw_resolve_install_dir', {
    CODEX_WORKER_INSTALL_DIR: '/tmp/codex-worker-bin',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '/tmp/codex-worker-bin');
});

test('cw_cpu_needs_baseline reports true when avx2 is absent', () => {
  const result = runInstallerShell('cw_cpu_needs_baseline "sse4_2 avx" && echo yes || echo no');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'yes');
});

test('cw_cpu_needs_baseline reports false when avx2 is present', () => {
  const result = runInstallerShell('cw_cpu_needs_baseline "sse4_2 avx avx2" && echo yes || echo no');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'no');
});

test('install.sh runs correctly when piped into bash -s', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-worker-install-pipe-'));
  try {
    const result = spawnSync(
      'bash',
      ['-lc', `cat "${installScriptPath}" | bash -s -- --dry-run --install-dir "${tempDir}"`],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /install_dir=/);
    assert.match(result.stdout, new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('cw_list_all_on_path reports every codex-worker copy on PATH in order', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-worker-shadow-list-'));
  try {
    const binA = join(tempDir, 'a');
    const binB = join(tempDir, 'b');
    const binC = join(tempDir, 'c');
    mkdirSync(binA);
    mkdirSync(binB);
    mkdirSync(binC);
    writeFileSync(join(binA, 'codex-worker'), '#!/bin/sh\necho 0.0.1\n');
    writeFileSync(join(binC, 'codex-worker'), '#!/bin/sh\necho 0.0.3\n');
    chmodSync(join(binA, 'codex-worker'), 0o755);
    chmodSync(join(binC, 'codex-worker'), 0o755);

    const searchPath = `${binA}:${binB}:${binC}`;
    const result = runInstallerShell(`cw_list_all_on_path codex-worker "${searchPath}"`);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.stdout.trim().split('\n'),
      [join(binA, 'codex-worker'), join(binC, 'codex-worker')],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('cw_remove_shadowing_copies removes earlier PATH entries until install_path wins', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-worker-shadow-remove-'));
  try {
    const binA = join(tempDir, 'a');
    const binB = join(tempDir, 'b');
    const binC = join(tempDir, 'c');
    mkdirSync(binA);
    mkdirSync(binB);
    mkdirSync(binC);
    const installPath = join(binC, 'codex-worker');
    writeFileSync(join(binA, 'codex-worker'), '#!/bin/sh\necho shadow-a\n');
    writeFileSync(join(binB, 'codex-worker'), '#!/bin/sh\necho shadow-b\n');
    writeFileSync(installPath, '#!/bin/sh\necho real\n');
    chmodSync(join(binA, 'codex-worker'), 0o755);
    chmodSync(join(binB, 'codex-worker'), 0o755);
    chmodSync(installPath, 0o755);

    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source "${installScriptPath}"; export PATH="${binA}:${binB}:${binC}:$PATH"; cw_remove_shadowing_copies "${installPath}" codex-worker; cw_which_on_path codex-worker "$PATH"`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), installPath);
    assert.match(result.stderr, new RegExp(`Removed shadowing copy at ${binA}/codex-worker`));
    assert.match(result.stderr, new RegExp(`Removed shadowing copy at ${binB}/codex-worker`));
    assert.equal(existsSync(join(binA, 'codex-worker')), false);
    assert.equal(existsSync(join(binB, 'codex-worker')), false);
    assert.equal(existsSync(installPath), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('cw_remove_shadowing_copies is a no-op when install_path is already first on PATH', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-worker-shadow-noop-'));
  try {
    const binFirst = join(tempDir, 'first');
    const binLater = join(tempDir, 'later');
    mkdirSync(binFirst);
    mkdirSync(binLater);
    const installPath = join(binFirst, 'codex-worker');
    const laterCopy = join(binLater, 'codex-worker');
    writeFileSync(installPath, '#!/bin/sh\necho real\n');
    writeFileSync(laterCopy, '#!/bin/sh\necho later\n');
    chmodSync(installPath, 0o755);
    chmodSync(laterCopy, 0o755);

    const result = spawnSync(
      'bash',
      [
        '-lc',
        `source "${installScriptPath}"; export PATH="${binFirst}:${binLater}:$PATH"; cw_remove_shadowing_copies "${installPath}" codex-worker`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(installPath), true);
    assert.equal(existsSync(laterCopy), true, 'later-on-PATH copies should not be removed');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('install.sh removes shadowing copies earlier on PATH after install', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-worker-install-shadow-'));
  const installDir = join(tempDir, 'bin');
  const shadowDir = join(tempDir, 'shadow');
  mkdirSync(shadowDir, { recursive: true });
  const shadowCopy = join(shadowDir, 'codex-worker');
  writeFileSync(shadowCopy, '#!/bin/sh\necho 0.0.0-shadow\n');
  chmodSync(shadowCopy, 0o755);

  const fakeBinary = '#!/usr/bin/env bash\necho 9.9.9\n';
  const sha256 = createHash('sha256').update(fakeBinary).digest('hex');

  const server = http.createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (request.url === '/download/v9.9.9/codex-worker-darwin-arm64') {
      response.statusCode = 200;
      response.end(fakeBinary);
      return;
    }
    if (request.url === '/download/v9.9.9/codex-worker-darwin-arm64.sha256') {
      response.statusCode = 200;
      response.end(`${sha256}  codex-worker-darwin-arm64\n`);
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const downloadBaseUrl = `http://127.0.0.1:${address.port}/download`;

  try {
    const installerEnv = {
      ...process.env,
      PATH: `${shadowDir}:${installDir}:${process.env.PATH ?? ''}`,
      CODEX_WORKER_INSTALL_OS: 'Darwin',
      CODEX_WORKER_INSTALL_ARCH: 'arm64',
      CODEX_WORKER_INSTALL_LATEST_TAG: 'v9.9.9',
      CODEX_WORKER_DOWNLOAD_BASE_URL: downloadBaseUrl,
    };

    const result = await execFileAsync('bash', [installScriptPath, '--install-dir', installDir], {
      encoding: 'utf8',
      env: installerEnv,
    });
    assert.match(result.stderr ?? '', /Installed codex-worker 9\.9\.9/i);
    assert.match(result.stderr ?? '', new RegExp(`Removed shadowing copy at ${shadowCopy}`));
    assert.equal(existsSync(shadowCopy), false, 'shadowing copy should be removed');
    assert.equal(existsSync(join(installDir, 'codex-worker')), true);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('install.sh leaves shadowing copies alone when --no-override is passed', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-worker-install-no-override-'));
  const installDir = join(tempDir, 'bin');
  const shadowDir = join(tempDir, 'shadow');
  mkdirSync(shadowDir, { recursive: true });
  const shadowCopy = join(shadowDir, 'codex-worker');
  writeFileSync(shadowCopy, '#!/bin/sh\necho 0.0.0-shadow\n');
  chmodSync(shadowCopy, 0o755);

  const fakeBinary = '#!/usr/bin/env bash\necho 9.9.9\n';
  const sha256 = createHash('sha256').update(fakeBinary).digest('hex');

  const server = http.createServer((request, response) => {
    if (request.url === '/download/v9.9.9/codex-worker-darwin-arm64') {
      response.statusCode = 200;
      response.end(fakeBinary);
      return;
    }
    if (request.url === '/download/v9.9.9/codex-worker-darwin-arm64.sha256') {
      response.statusCode = 200;
      response.end(`${sha256}  codex-worker-darwin-arm64\n`);
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const downloadBaseUrl = `http://127.0.0.1:${address.port}/download`;

  try {
    const installerEnv = {
      ...process.env,
      PATH: `${shadowDir}:${installDir}:${process.env.PATH ?? ''}`,
      CODEX_WORKER_INSTALL_OS: 'Darwin',
      CODEX_WORKER_INSTALL_ARCH: 'arm64',
      CODEX_WORKER_INSTALL_LATEST_TAG: 'v9.9.9',
      CODEX_WORKER_DOWNLOAD_BASE_URL: downloadBaseUrl,
    };

    const result = await execFileAsync(
      'bash',
      [installScriptPath, '--install-dir', installDir, '--no-override'],
      { encoding: 'utf8', env: installerEnv },
    );
    assert.match(result.stderr ?? '', /Installed codex-worker 9\.9\.9/i);
    assert.doesNotMatch(result.stderr ?? '', /Removed shadowing copy/);
    assert.equal(existsSync(shadowCopy), true, 'shadowing copy should remain when --no-override is set');
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('install.sh installs and then skips when the same version is already present', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-worker-install-e2e-'));
  const installDir = join(tempDir, 'bin');
  const fakeBinary = '#!/usr/bin/env bash\necho 9.9.9\n';
  const sha256 = createHash('sha256').update(fakeBinary).digest('hex');

  const server = http.createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    if (request.url === '/download/v9.9.9/codex-worker-darwin-arm64') {
      response.statusCode = 200;
      response.end(fakeBinary);
      return;
    }

    if (request.url === '/download/v9.9.9/codex-worker-darwin-arm64.sha256') {
      response.statusCode = 200;
      response.end(`${sha256}  codex-worker-darwin-arm64\n`);
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const downloadBaseUrl = `http://127.0.0.1:${address.port}/download`;

  try {
    const installerEnv = {
      ...process.env,
      CODEX_WORKER_INSTALL_OS: 'Darwin',
      CODEX_WORKER_INSTALL_ARCH: 'arm64',
      CODEX_WORKER_INSTALL_LATEST_TAG: 'v9.9.9',
      CODEX_WORKER_DOWNLOAD_BASE_URL: downloadBaseUrl,
    };

    const first = await execFileAsync('bash', [installScriptPath, '--install-dir', installDir], {
      encoding: 'utf8',
      env: installerEnv,
    });
    assert.match(first.stderr ?? '', /Installed codex-worker 9\.9\.9/i);

    const installedVersion = await execFileAsync(join(installDir, 'codex-worker'), ['--version'], {
      encoding: 'utf8',
    });
    assert.equal(installedVersion.stdout.trim(), '9.9.9');

    const second = await execFileAsync('bash', [installScriptPath, '--install-dir', installDir], {
      encoding: 'utf8',
      env: installerEnv,
    });
    assert.match(second.stderr ?? '', /already installed/i);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    rmSync(tempDir, { recursive: true, force: true });
  }
});
