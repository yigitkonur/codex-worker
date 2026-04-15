export interface SpawnCommandSpec {
  command: string;
  args: string[];
}

export function resolveSpawnCommand(commandPath: string, platform?: string, comspec?: string): SpawnCommandSpec;
