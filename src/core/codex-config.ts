import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface CodexConfigDefaults {
  model?: string;
  modelProvider?: string;
  approvalPolicy?: ApprovalPolicy;
  sandboxMode?: SandboxMode;
  requiresOpenaiAuth?: boolean;
}

const APPROVAL_VALUES: ReadonlySet<ApprovalPolicy> = new Set([
  'untrusted',
  'on-failure',
  'on-request',
  'never',
]);

const SANDBOX_VALUES: ReadonlySet<SandboxMode> = new Set([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);

function stripInlineComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '#' && !inSingle && !inDouble) return raw.slice(0, i);
  }
  return raw;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseCodexConfigToml(source: string): CodexConfigDefaults {
  const result: CodexConfigDefaults = {};
  const lines = source.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith('[')) break; // top-level scope only

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();

    switch (key) {
      case 'model': {
        const v = unquote(rawValue);
        if (v) result.model = v;
        break;
      }
      case 'model_provider': {
        const v = unquote(rawValue);
        if (v) result.modelProvider = v;
        break;
      }
      case 'approval_policy': {
        const v = unquote(rawValue);
        if (APPROVAL_VALUES.has(v as ApprovalPolicy)) {
          result.approvalPolicy = v as ApprovalPolicy;
        }
        break;
      }
      case 'sandbox_mode': {
        const v = unquote(rawValue);
        if (SANDBOX_VALUES.has(v as SandboxMode)) {
          result.sandboxMode = v as SandboxMode;
        }
        break;
      }
      case 'requires_openai_auth': {
        const v = rawValue.toLowerCase();
        if (v === 'true') result.requiresOpenaiAuth = true;
        else if (v === 'false') result.requiresOpenaiAuth = false;
        break;
      }
      default:
        break;
    }
  }

  return result;
}

export function readCodexConfig(codexHome: string): CodexConfigDefaults {
  try {
    const source = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    return parseCodexConfigToml(source);
  } catch {
    return {};
  }
}
