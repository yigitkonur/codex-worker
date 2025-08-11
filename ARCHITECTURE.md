# Codex Worker Architecture

## Design Philosophy (John Carmack Style)

1. **Simplicity First**: File prefixes as database - no complex state management
2. **Delete Over Add**: Minimal dependencies (just Typer + Rich)
3. **Obvious Code**: Each module has one clear purpose
4. **Safe by Default**: Read-only mode, explicit permissions required
5. **Fast Iteration**: Resumable, parallel, no setup required

## Core Components

### 1. State Management (`state.py`)
- **File Prefix Convention**: The genius is in the simplicity
  - `in-progress-` = Currently running
  - `done_exec_log-` = Completed 
  - `failed_exec_log-` = Failed
- **Atomic Operations**: Uses filesystem atomicity for coordination
- **No Database**: Filesystem IS the database
- **Lock Files**: Prevent race conditions between workers

### 2. Worker Engine (`worker.py`)
- **Single Responsibility**: Execute tasks safely
- **Signal Handling**: Graceful shutdown on Ctrl+C
- **Process Management**: Track and cleanup child processes
- **Retry Logic**: Built-in retry with exponential backoff
- **Safety Modes**: From dry-run to full-access

### 3. CLI Interface (`cli.py`)
- **Typer-based**: Type-safe, auto-completion, rich help
- **Rich Output**: Beautiful progress bars and tables
- **Multiple Commands**: run, status, clean, reset
- **Validation**: All inputs validated before execution
- **Confirmation Prompts**: For dangerous operations

## Data Flow

```
1. User runs: codex-worker tasks/ --concurrency 4
2. CLI validates inputs and safety level
3. Worker discovers task files (*.md)
4. For each file:
   a. Check if done (done_exec_log-* exists) → Skip
   b. Try to acquire lock (create in-progress-*)
   c. Execute AI agent with timeout
   d. Update state (done_exec_log-* or failed_exec_log-*)
   e. Release lock
5. Show results with statistics
```

## Safety Layers

1. **Mode Validation**: Default read-only, explicit write permission
2. **File Locking**: Atomic operations prevent races
3. **Process Monitoring**: Detect and clean dead processes
4. **Graceful Shutdown**: Handle signals properly
5. **Confirmation Prompts**: Double-confirm dangerous operations
6. **Timeout Protection**: Prevent runaway processes
7. **State Recovery**: Resume from any interruption

## Performance Optimizations

- **Parallel Workers**: N workers process N files simultaneously
- **Skip Completed**: O(1) check via file existence
- **Minimal I/O**: Only read/write when necessary
- **Lazy Imports**: Import only what's needed
- **Efficient State Check**: Simple file prefix check

## Why This Design Works

1. **Zero Config**: No database, no setup, just run
2. **Transparent State**: `ls` shows you everything
3. **Multiple Workers**: Can run from different terminals
4. **Crash Recovery**: Just run again, picks up where it left off
5. **Debug Friendly**: State is visible in filesystem
6. **Ops Friendly**: No hidden state, easy to clean up

## What Carmack Would Say

> "Good. It does what it needs to do. No database, no complex state machines, 
> just files with prefixes. You could delete half the code and it would still work.
> The filesystem is the source of truth - that's elegant."

## Future Considerations (YAGNI)

Things we deliberately DIDN'T add:
- Database for state (filesystem works fine)
- Complex scheduling (OS scheduler is enough)
- Web UI (CLI is sufficient)
- Remote execution (SSH + CLI works)
- Complex retry strategies (exponential backoff is enough)
- Plugin system (not needed)

Remember: Every line of code is a liability. The best code is no code.