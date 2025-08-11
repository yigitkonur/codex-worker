"""Core worker implementation for safe task execution."""

import os
import signal
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Callable
from enum import Enum

from state import TaskState, TaskMetadata, find_task_files, get_task_stats


class ExecutionMode(Enum):
    """Execution safety levels."""
    DRY_RUN = "dry-run"
    READ_ONLY = "read-only"
    WORKSPACE_WRITE = "workspace-write"
    FULL_ACCESS = "danger-full-access"


@dataclass
class WorkerConfig:
    """Worker configuration."""
    model: str = "o4-mini"
    mode: ExecutionMode = ExecutionMode.READ_ONLY
    approval: str = "never"
    timeout: Optional[float] = None
    retries: int = 0
    retry_delay: float = 5.0
    concurrency: int = 1
    sleep_between: float = 1.0
    skip_git_check: bool = True
    codex_cmd: str = "codex"
    verbose: bool = False


@dataclass 
class ExecutionResult:
    """Result from task execution."""
    file: Path
    success: bool
    return_code: int
    duration: float
    output_log: Optional[Path] = None
    error_msg: Optional[str] = None
    attempts: int = 1


class CodexWorker:
    """
    Safe, resumable worker for executing Codex on files.
    
    Key features:
    - Atomic state transitions with file prefixes
    - Automatic resumability after crashes
    - Safe parallel execution with file locking
    - Comprehensive error handling
    - Graceful shutdown on signals
    """
    
    def __init__(self, config: WorkerConfig):
        self.config = config
        self.worker_id = str(uuid.uuid4())[:8]
        self.shutdown = False
        self.active_processes: Dict[int, subprocess.Popen] = {}
        self.stats = {"started": 0, "completed": 0, "failed": 0, "skipped": 0}
        
        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)
    
    def _handle_shutdown(self, signum, frame):
        """Handle shutdown signals gracefully."""
        print(f"\n⚠️  Received signal {signum}, shutting down gracefully...")
        self.shutdown = True
        
        # Terminate active processes
        for pid, proc in self.active_processes.items():
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
    
    def validate_environment(self) -> List[str]:
        """
        Validate environment and return any warnings.
        Returns list of warning messages.
        """
        warnings = []
        
        # Check if codex command exists
        cmd = self.config.codex_cmd
        
        try:
            result = subprocess.run(
                [cmd, "--version"],
                capture_output=True,
                timeout=5,
                text=True
            )
            if result.returncode != 0:
                warnings.append(f"Command '{cmd}' returned error: {result.stderr}")
        except FileNotFoundError:
            warnings.append(f"Command '{cmd}' not found in PATH")
        except subprocess.TimeoutExpired:
            warnings.append(f"Command '{cmd}' timed out")
        except Exception as e:
            warnings.append(f"Error checking '{cmd}': {e}")
        
        # Warn about dangerous modes
        if self.config.mode == ExecutionMode.FULL_ACCESS:
            warnings.append("⚠️  Running in FULL ACCESS mode - agent can modify any file!")
        
        if self.config.approval == "never":
            warnings.append("Approval mode is 'never' - agent will act autonomously")
        
        return warnings
    
    def process_file(self, file: Path) -> ExecutionResult:
        """
        Process a single file with full safety checks.
        
        This method:
        1. Checks if already completed (resumability)
        2. Acquires lock to prevent races
        3. Executes with retries
        4. Updates state atomically
        """
        start_time = time.time()
        state = TaskState(file)
        
        # Check if already done (resumability)
        if state.is_completed():
            self.stats["skipped"] += 1
            return ExecutionResult(
                file=file,
                success=True,
                return_code=0,
                duration=0,
                error_msg="Already completed"
            )
        
        # Check if in progress by another worker
        if state.is_in_progress():
            meta = state.get_metadata()
            if meta and meta.worker_id != self.worker_id:
                self.stats["skipped"] += 1
                return ExecutionResult(
                    file=file,
                    success=False,
                    return_code=1,
                    duration=0,
                    error_msg=f"In progress by worker {meta.worker_id}"
                )
        
        # Try to acquire task
        metadata = TaskMetadata(
            file=str(file),
            engine="codex",
            model=self.config.model,
            started_at=datetime.now().isoformat(),
            pid=os.getpid(),
            worker_id=self.worker_id,
            attempt=1
        )
        
        if not state.mark_in_progress(metadata):
            self.stats["skipped"] += 1
            return ExecutionResult(
                file=file,
                success=False,
                return_code=1,
                duration=0,
                error_msg="Could not acquire task"
            )
        
        self.stats["started"] += 1
        
        # Execute with retries
        try:
            for attempt in range(1, self.config.retries + 2):
                if self.shutdown:
                    break
                
                if attempt > 1:
                    print(f"  🔄 Retry {attempt}/{self.config.retries + 1} for {file.name}")
                    time.sleep(self.config.retry_delay)
                    metadata.attempt = attempt
                
                result = self._execute_single(file, state)
                
                if result.success:
                    state.mark_completed()
                    self.stats["completed"] += 1
                    return result
                
                if attempt == self.config.retries + 1:
                    state.mark_failed()
                    self.stats["failed"] += 1
                    return result
            
            # Shutdown case
            state.in_progress.unlink(missing_ok=True)
            return ExecutionResult(
                file=file,
                success=False,
                return_code=130,
                duration=time.time() - start_time,
                error_msg="Shutdown requested"
            )
            
        except Exception as e:
            state.mark_failed()
            self.stats["failed"] += 1
            return ExecutionResult(
                file=file,
                success=False,
                return_code=1,
                duration=time.time() - start_time,
                error_msg=str(e)
            )
    
    def _execute_single(self, file: Path, state: TaskState) -> ExecutionResult:
        """Execute a single file (one attempt)."""
        start = time.time()
        
        # Build command
        cmd = [
            self.config.codex_cmd,
            "--model", self.config.model,
            "--ask-for-approval", self.config.approval,
            "--sandbox", self.config.mode.value,
            "exec"
        ]
        if self.config.skip_git_check:
            cmd.append("--skip-git-repo-check")
        
        # Dry run mode
        if self.config.mode == ExecutionMode.DRY_RUN:
            print(f"  [DRY RUN] Would execute: {' '.join(cmd)} < {file}")
            return ExecutionResult(
                file=file,
                success=True,
                return_code=0,
                duration=0
            )
        
        # Execute
        try:
            # Ensure log directory exists
            state.temp_log.parent.mkdir(parents=True, exist_ok=True)
            
            with file.open('rb') as input_file, \
                 state.temp_log.open('wb') as output_file:
                
                proc = subprocess.Popen(
                    cmd,
                    stdin=input_file,
                    stdout=output_file,
                    stderr=subprocess.STDOUT
                )
                
                self.active_processes[proc.pid] = proc
                
                try:
                    rc = proc.wait(timeout=self.config.timeout)
                finally:
                    self.active_processes.pop(proc.pid, None)
                
                return ExecutionResult(
                    file=file,
                    success=(rc == 0),
                    return_code=rc,
                    duration=time.time() - start,
                    output_log=state.temp_log if state.temp_log.exists() else None
                )
                
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
            
            return ExecutionResult(
                file=file,
                success=False,
                return_code=124,
                duration=time.time() - start,
                error_msg="Timeout"
            )
        
        except Exception as e:
            return ExecutionResult(
                file=file,
                success=False,
                return_code=1,
                duration=time.time() - start,
                error_msg=str(e)
            )
    
    def run_batch(self, files: List[Path], 
                  progress_callback: Optional[Callable[[int, int], None]] = None) -> List[ExecutionResult]:
        """
        Run batch of files with parallel workers.
        
        Args:
            files: List of files to process
            progress_callback: Optional callback(completed, total)
        
        Returns:
            List of execution results
        """
        if not files:
            return []
        
        results = []
        total = len(files)
        completed = 0
        
        if self.config.concurrency == 1:
            # Sequential execution
            for file in files:
                if self.shutdown:
                    break
                
                result = self.process_file(file)
                results.append(result)
                completed += 1
                
                if progress_callback:
                    progress_callback(completed, total)
                
                if not self.shutdown and completed < total:
                    time.sleep(self.config.sleep_between)
        else:
            # Parallel execution
            with ThreadPoolExecutor(max_workers=self.config.concurrency) as executor:
                future_to_file = {
                    executor.submit(self.process_file, file): file
                    for file in files
                }
                
                for future in as_completed(future_to_file):
                    if self.shutdown:
                        # Cancel remaining futures
                        for f in future_to_file:
                            f.cancel()
                        break
                    
                    result = future.result()
                    results.append(result)
                    completed += 1
                    
                    if progress_callback:
                        progress_callback(completed, total)
                    
                    if not self.shutdown and completed < total:
                        time.sleep(self.config.sleep_between)
        
        return results
    
    def cleanup_stale_markers(self, directory: Path, max_age: float = 3600) -> int:
        """
        Clean up stale in-progress markers.
        
        Returns number of markers cleaned.
        """
        cleaned = 0
        files = find_task_files(directory)
        
        for file in files:
            state = TaskState(file)
            if state.cleanup_stale(max_age):
                cleaned += 1
                print(f"  🧹 Cleaned stale marker for {file.name}")
        
        return cleaned