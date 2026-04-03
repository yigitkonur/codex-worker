import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  WorkerFailureCategory,
  AccountProfileState,
} from './types.js';

const DEFAULT_PROFILE_COOLDOWNS: Record<WorkerFailureCategory, number> = {
  auth: 5 * 60_000,
  rate_limit: 15 * 60_000,
  connection: 60_000,
  transient: 30_000,
  fatal: 0,
};

function defaultProfileDir(): string {
  return join(homedir(), '.codex');
}

function dedupeProfileDirs(profileDirs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const dir of profileDirs) {
    const normalized = dir.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result.length > 0 ? result : [defaultProfileDir()];
}

function buildCooldowns(options?: {
  cooldownMs?: number | undefined;
  cooldowns?: Partial<Record<WorkerFailureCategory, number>> | undefined;
}): Record<WorkerFailureCategory, number> {
  const cooldowns: Record<WorkerFailureCategory, number> = {
    ...DEFAULT_PROFILE_COOLDOWNS,
  };

  if (options?.cooldownMs !== undefined) {
    cooldowns.auth = options.cooldownMs;
    cooldowns.rate_limit = options.cooldownMs;
    cooldowns.connection = options.cooldownMs;
    cooldowns.transient = options.cooldownMs;
  }

  for (const [category, value] of Object.entries(options?.cooldowns ?? {})) {
    if (value !== undefined) {
      cooldowns[category as WorkerFailureCategory] = value;
    }
  }

  return cooldowns;
}

export class ProfileManager {
  private readonly cooldowns: Record<WorkerFailureCategory, number>;
  private readonly now: () => number;
  private readonly profiles: AccountProfileState[];
  private currentIndex = 0;

  constructor(options?: {
    profileDirs?: string[] | undefined;
    cooldownMs?: number | undefined;
    cooldowns?: Partial<Record<WorkerFailureCategory, number>> | undefined;
    now?: (() => number) | undefined;
    persistedProfiles?: AccountProfileState[] | undefined;
  }) {
    this.cooldowns = buildCooldowns({
      cooldownMs: options?.cooldownMs,
      cooldowns: options?.cooldowns,
    });
    this.now = options?.now ?? Date.now;

    const configuredDirs = dedupeProfileDirs(options?.profileDirs ?? [defaultProfileDir()]);
    const persistedByDir = new Map(
      (options?.persistedProfiles ?? []).map((profile) => [profile.codexHome, profile]),
    );

    this.profiles = configuredDirs.map((configDir, index) => {
      const persisted = persistedByDir.get(configDir);
      return {
        id: persisted?.id ?? `profile-${index + 1}`,
        codexHome: configDir,
        cooldownUntil: persisted?.cooldownUntil,
        failureCount: persisted?.failureCount ?? 0,
        lastFailureReason: persisted?.lastFailureReason,
        lastFailureCategory: persisted?.lastFailureCategory,
        lastFailureAt: persisted?.lastFailureAt,
        lastSuccessAt: persisted?.lastSuccessAt,
      };
    });

    this.currentIndex = this.findFirstAvailableIndex();
  }

  static fromEnvironment(persistedProfiles?: AccountProfileState[]): ProfileManager {
    const raw = process.env.CODEX_HOME_DIRS;
    const dirs = raw
      ? raw.split(':').map((entry) => entry.trim()).filter(Boolean)
      : [process.env.CODEX_HOME?.trim() || defaultProfileDir()];

    return new ProfileManager({ profileDirs: dirs, persistedProfiles });
  }

  getCandidateProfiles(): AccountProfileState[] {
    this.resetExpiredCooldowns();
    return this.profiles
      .filter((profile) => profile.cooldownUntil === undefined || profile.cooldownUntil <= this.now())
      .map((profile) => ({ ...profile }));
  }

  getCurrentProfile(): AccountProfileState {
    this.resetExpiredCooldowns();
    const profile = this.profiles[this.currentIndex] ?? this.profiles[0];
    if (!profile) {
      throw new Error('No profiles configured');
    }

    return { ...profile };
  }

  markFailure(reason: string): void;
  markFailure(profileId: string, category: WorkerFailureCategory, reason: string): void;
  markFailure(
    profileIdOrReason: string,
    category?: WorkerFailureCategory,
    reason?: string,
  ): void {
    const usingTypedSignature = reason !== undefined;
    const profile = usingTypedSignature
      ? this.profiles.find((entry) => entry.id === profileIdOrReason)
      : this.profiles[this.currentIndex];

    if (!profile) {
      return;
    }

    const failureCategory = usingTypedSignature ? category! : 'transient';
    const failureReason = usingTypedSignature ? reason! : profileIdOrReason;

    profile.failureCount += 1;
    profile.lastFailureReason = failureReason;
    profile.lastFailureCategory = failureCategory;
    profile.lastFailureAt = new Date(this.now()).toISOString();

    const cooldownMs = this.getCooldownMs(failureCategory);
    profile.cooldownUntil = cooldownMs > 0 ? this.now() + cooldownMs : undefined;

    if (!usingTypedSignature) {
      const nextIndex = this.findFirstAvailableIndex();
      if (nextIndex !== -1) {
        this.currentIndex = nextIndex;
      }
    }
  }

  markSuccess(profileId: string): void {
    const profile = this.profiles.find((entry) => entry.id === profileId);
    if (!profile) {
      return;
    }

    profile.cooldownUntil = undefined;
    profile.lastSuccessAt = new Date(this.now()).toISOString();

    const nextIndex = this.findFirstAvailableIndex();
    if (nextIndex !== -1) {
      this.currentIndex = nextIndex;
    }
  }

  getCooldownMs(category: WorkerFailureCategory): number {
    return this.cooldowns[category];
  }

  getProfiles(): AccountProfileState[] {
    return this.profiles.map((profile) => ({ ...profile }));
  }

  toPersistedState(): AccountProfileState[] {
    return this.profiles.map((profile) => ({
      id: profile.id,
      codexHome: profile.codexHome,
      cooldownUntil: profile.cooldownUntil,
      failureCount: profile.failureCount,
      lastFailureReason: profile.lastFailureReason,
      lastFailureCategory: profile.lastFailureCategory,
      lastFailureAt: profile.lastFailureAt,
      lastSuccessAt: profile.lastSuccessAt,
    }));
  }

  private resetExpiredCooldowns(): void {
    const now = this.now();
    for (const profile of this.profiles) {
      if (profile.cooldownUntil !== undefined && profile.cooldownUntil <= now) {
        profile.cooldownUntil = undefined;
      }
    }

    const nextIndex = this.findFirstAvailableIndex();
    if (nextIndex !== -1) {
      this.currentIndex = nextIndex;
    }
  }

  private findFirstAvailableIndex(): number {
    const now = this.now();
    return this.profiles.findIndex(
      (profile) => profile.cooldownUntil === undefined || profile.cooldownUntil <= now,
    );
  }
}
