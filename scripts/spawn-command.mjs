export function resolveSpawnCommand(commandPath, platform = process.platform, comspec = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe') {
  const normalized = commandPath.toLowerCase();
  if (platform === 'win32' && (normalized.endsWith('.cmd') || normalized.endsWith('.bat'))) {
    return {
      command: comspec,
      args: ['/d', '/s', '/c', commandPath],
    };
  }
  return {
    command: commandPath,
    args: [],
  };
}
