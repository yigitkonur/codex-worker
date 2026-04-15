#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function requireSha(label, value) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? '')) {
    throw new Error(`Expected ${label} to be a 64-character sha256 hex string.`);
  }
  return value;
}

export function renderHomebrewFormula({
  version,
  repoSlug,
  description,
  homepage,
  license,
  sha256,
}) {
  const tag = `v${version}`;
  const darwinArm64 = requireSha('darwinArm64 sha256', sha256.darwinArm64);
  const darwinX64 = requireSha('darwinX64 sha256', sha256.darwinX64);
  const linuxArm64 = requireSha('linuxArm64 sha256', sha256.linuxArm64);
  const linuxX64 = requireSha('linuxX64 sha256', sha256.linuxX64);

  return `class CodexWorker < Formula
  desc "${description}"
  homepage "${homepage}"
  version "${version}"
  license "${license}"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/${repoSlug}/releases/download/${tag}/codex-worker-darwin-arm64"
      sha256 "${darwinArm64}"
    else
      url "https://github.com/${repoSlug}/releases/download/${tag}/codex-worker-darwin-x64"
      sha256 "${darwinX64}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/${repoSlug}/releases/download/${tag}/codex-worker-linux-arm64"
      sha256 "${linuxArm64}"
    else
      url "https://github.com/${repoSlug}/releases/download/${tag}/codex-worker-linux-x64"
      sha256 "${linuxX64}"
    end
  end

  def install
    bin.install downloaded_file => "codex-worker"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codex-worker --version")
  end
end
`;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value == null) {
      throw new Error('Expected paired --flag value arguments.');
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write([
      'Usage:',
      '  node scripts/render-homebrew-formula.mjs \\',
      '    --output Formula/codex-worker.rb \\',
      '    --version 0.1.4 \\',
      '    --repo yigitkonur/codex-worker \\',
      '    --darwin-x64-sha <sha256> \\',
      '    --darwin-arm64-sha <sha256> \\',
      '    --linux-x64-sha <sha256> \\',
      '    --linux-arm64-sha <sha256>',
    ].join('\n'));
    process.stdout.write('\n');
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  if (!args.output || !args.version || !args.repo || !args['darwin-x64-sha'] || !args['darwin-arm64-sha'] || !args['linux-x64-sha'] || !args['linux-arm64-sha']) {
    throw new Error('Missing required arguments. Run with --help for usage.');
  }

  const outputPath = resolve(process.cwd(), args.output);
  const formula = renderHomebrewFormula({
    version: args.version,
    repoSlug: args.repo,
    description: 'Daemon-backed Codex app-server worker CLI',
    homepage: `https://github.com/${args.repo}`,
    license: 'MIT',
    sha256: {
      darwinX64: args['darwin-x64-sha'],
      darwinArm64: args['darwin-arm64-sha'],
      linuxX64: args['linux-x64-sha'],
      linuxArm64: args['linux-arm64-sha'],
    },
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, formula, 'utf8');
  process.stdout.write(`Wrote ${outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
