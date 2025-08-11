# Codex Worker 🤖

**Production-ready tool for running OpenAI Codex CLI in parallel on your codebase**

Codex Worker enables safe, resumable, parallel execution of OpenAI Codex CLI on multiple files. Perfect for automating repetitive coding tasks that don't require complex reasoning.

## 🔥 Real-World Use Cases

### Save Claude/GPT-4 Tokens on Repetitive Tasks
> "I use Claude Code to analyze npm lint errors, group them by file and error type, then create task files for OpenAI Codex CLI to fix. Since the tasks are clear and mechanical, OpenAI Codex CLI handles them perfectly. This saves my Claude tokens for complex problems and avoids hitting rate limits!" 

### Common Scenarios
- **Bulk Lint Fixes**: Let Claude analyze errors → Create fix tasks → OpenAI Codex CLI executes in parallel
- **Test Generation**: Define test requirements → OpenAI Codex CLI writes tests for multiple files
- **Code Migrations**: Specify transformation rules → OpenAI Codex CLI applies across codebase
- **Documentation**: Outline what's needed → OpenAI Codex CLI adds to multiple files
- **Refactoring**: Define the pattern → OpenAI Codex CLI applies consistently

The key insight: Use expensive AI (Claude/GPT-4) for **planning**, use OpenAI Codex CLI for **execution**.

## 🎯 Why Codex Worker?

When working with AI coding agents, you often want to:
- **Process multiple tasks in parallel** - Run 10 agents fixing different bugs simultaneously
- **Resume after interruptions** - Power outage? Network issue? Just run again, completed tasks are skipped
- **Track progress visually** - See what's done, in-progress, or failed at a glance
- **Maintain safety** - Default read-only mode, explicit permissions for modifications
- **Coordinate multiple workers** - Run from multiple terminals without conflicts

## 🚀 Key Features

### 📁 File Prefix State Management

Codex Worker uses a simple but powerful approach: file prefixes track state.

```
tasks/
├── fix-auth-bug.md                 # ⏸️  Pending task
├── in-progress-add-feature.md      # 🔄 Currently being processed
├── done_exec_log-update-api.md.txt # ✅ Completed task (with output log)
└── failed_exec_log-refactor.md.txt # ❌ Failed task (with error log)
```

This prefix system enables:
- **Zero-config resumability** - Just run the command again
- **Parallel coordination** - Workers see what others are doing
- **Clear visual status** - `ls` shows you everything
- **No database needed** - Filesystem is the source of truth

### Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `--pattern` | File pattern to match | `*.md` |
| `--model` | Model name | `o4-mini` |
| `--mode` | Safety level | `read-only` |
| `--concurrency` | Parallel workers | `1` |
| `--timeout` | Task timeout (seconds) | None |
| `--retries` | Retry attempts | `0` |
| `--approval` | Human approval mode | `on-request` |

### 🔄 Perfect Resumability

Interrupted? No problem. Codex Worker automatically:
1. Skips completed tasks (files with `done_exec_log-` prefix)
2. Detects in-progress tasks from other workers
3. Cleans up stale locks from crashed processes
4. Retries failed tasks based on your configuration

## 📦 Installation

```bash
# Install with pip
pip install codex-worker

# Or install from source
git clone https://github.com/yigitkonur/codex-worker
cd codex-worker
pip install -e .
```

### Requirements
- Python 3.8+
- OpenAI Codex CLI:
  ```bash
  npm install -g @openai/codex
  ```
- Typer, Rich (installed automatically with pip install)

## 🎮 Usage Examples

### Basic: Process All Tasks in Current Directory

```bash
# Create task files
echo "Fix the authentication bug in login.py" > fix-auth.md
echo "Add rate limiting to API endpoints" > add-ratelimit.md
echo "Refactor database queries for performance" > optimize-db.md

# Run OpenAI Codex CLI on all .md files (safe read-only mode by default)
codex-worker

# Output:
# ✅ fix-auth.md completed
# ✅ add-ratelimit.md completed  
# ✅ optimize-db.md completed
```

### Parallel Execution: Speed Up with Multiple Workers

```bash
# Run 4 AI agents in parallel
codex-worker --concurrency 4

# Each agent works on a different file simultaneously
# 4x faster than sequential execution!
```

### Resume After Interruption

```bash
# Start processing 100 files
codex-worker large-tasks/ --concurrency 8

# Ctrl+C after 30 files complete
# ^C Shutting down gracefully...

# Run again - only processes remaining 70 files!
codex-worker large-tasks/ --concurrency 8
# Automatically skips the 30 completed files
```

### Different Models

```bash
# Use a specific OpenAI Codex CLI model
codex-worker --model o4

# Use different models for different task complexity
codex-worker simple-tasks/ --model o4-mini
codex-worker complex-tasks/ --model o4
```

### Safety Modes

```bash
# Dry run - see what would be executed
codex-worker --mode dry-run

# Read-only (default) - agent can only read files
codex-worker --mode read-only

# Workspace write - agent can modify files in current directory
codex-worker --mode workspace-write

# Full access (DANGEROUS) - agent can modify any file
codex-worker --mode danger-full-access --yes
```

### Monitor Progress

```bash
# Check status of all tasks
codex-worker status

# Output:
# ┏━━━━━━━━━━━━┳━━━━━━━┳━━━━━━━━━━━━┓
# ┃ Status      ┃ Count ┃ Percentage ┃
# ┡━━━━━━━━━━━━╇━━━━━━━╇━━━━━━━━━━━━┫
# │ Pending     │    45 │      45.0% │
# │ In Progress │     5 │       5.0% │
# │ Completed   │    40 │      40.0% │
# │ Failed      │    10 │      10.0% │
# │ Total       │   100 │     100.0% │
# └─────────────┴───────┴────────────┘

# Detailed file-by-file status
codex-worker status --detailed
```

### Clean Up and Reset

```bash
# Clean stale in-progress markers (process died)
codex-worker clean --max-age 3600

# Reset all states to rerun tasks
codex-worker reset --force
```

## 🏗️ Architecture

### How It Works

1. **Task Discovery**: Finds all matching files (e.g., `*.md`)
2. **State Check**: Checks file prefixes to determine status
3. **Lock Acquisition**: Atomically acquires lock with `in-progress-` prefix
4. **Execution**: Runs AI agent with configured settings
5. **State Update**: Updates prefix to `done_exec_log-` or `failed_exec_log-`
6. **Parallel Coordination**: Multiple workers respect each other's locks

### File Prefix Convention

| Prefix | Meaning | Example |
|--------|---------|---------|
| (none) | Pending task | `fix-bug.md` |
| `in-progress-` | Currently processing | `in-progress-fix-bug.md` |
| `done_exec_log-` | Successfully completed | `done_exec_log-fix-bug.md.txt` |
| `failed_exec_log-` | Failed execution | `failed_exec_log-fix-bug.md.txt` |
| `.lock-` | Temporary lock file | `.lock-fix-bug.md` |

## 🛡️ Safety Features

- **Read-only by default** - Must explicitly enable write access
- **Confirmation prompts** - For dangerous operations
- **Atomic operations** - No partial states or race conditions
- **Process monitoring** - Detects and cleans up dead processes
- **Graceful shutdown** - Ctrl+C handled properly
- **Comprehensive validation** - All inputs validated with Typer

## 🎯 Real-World Use Cases

### 1. Parallel Bug Fixes
```bash
# Create bug report files
for i in {1..20}; do
  echo "Fix bug #$i: Check the error in module$i.py" > bug-$i.md
done

# Fix all bugs in parallel with 5 workers
codex-worker bug-*.md --concurrency 5 --mode workspace-write
```

### 2. Code Review Automation
```bash
# Generate review tasks for each PR file
git diff main --name-only | while read file; do
  echo "Review and suggest improvements for $file" > review-$(basename $file).md
done

# Run reviews in parallel
codex-worker review-*.md --concurrency 10
```

### 3. Test Generation
```bash
# Create test generation tasks
find src -name "*.py" | while read file; do
  echo "Generate comprehensive tests for $file" > test-$(basename $file).md
done

# Generate all tests
codex-worker test-*.md --concurrency 8 --mode workspace-write
```

### 4. Documentation Updates
```bash
# Create doc tasks
echo "Update README with new API endpoints" > doc-api.md
echo "Add examples to authentication guide" > doc-auth.md
echo "Document the new CLI commands" > doc-cli.md

# Process documentation updates
codex-worker doc-*.md --concurrency 3
```

## 🔧 Configuration

### Environment Variables

```bash
export CODEX_CMD=/path/to/codex     # Custom codex binary
```
