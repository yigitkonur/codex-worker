export const CODEX_ENABLE_FLEET_ENV = 'CODEX_ENABLE_FLEET';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isFleetModeEnabled(value = process.env[CODEX_ENABLE_FLEET_ENV]): boolean {
  return value !== undefined && TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function appendFleetDeveloperInstructions(base?: string | null): string | undefined {
  if (!isFleetModeEnabled()) {
    return base ?? undefined;
  }

  const suffix = [
    '',
    '[codex-worker:fleet]',
    'This request is running with fleet mode enabled.',
    'Prefer concise, independently useful progress that can be composed with parallel workers.',
  ].join('\n');

  if (!base || base.trim().length === 0) {
    return suffix.trim();
  }

  return `${base.trim()}\n${suffix}`;
}
