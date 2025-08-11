"""State management using file prefixes for resumability and coordination."""

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Dict, Optional, Set
import fcntl
import tempfile


class StatePrefix(Enum):
    """File prefixes for state tracking."""
    IN_PROGRESS = "in-progress-"
    COMPLETED = "done_exec_log-"
    FAILED = "failed_exec_log-"
    LOCKED = ".lock-"
    TEMP = ".tmp_exec_log-"
    # Legacy support
    LEGACY_COMPLETED = "completed_"


@dataclass
class TaskMetadata:
    """Metadata stored in state markers."""
    file: str
    engine: str
    model: str
    started_at: str
    pid: Optional[int] = None
    worker_id: Optional[str] = None
    attempt: int = 1


class TaskState:
    """
    Manages task state through filesystem markers.
    
    This enables:
    - Multiple workers to coordinate without a database
    - Resumability after crashes
    - Clear visibility of progress
    - Atomic state transitions
    """
    
    def __init__(self, task_file: Path):
        self.file = task_file.resolve()
        self.dir = self.file.parent
        self.name = self.file.name
        
        # State markers
        self.in_progress = self.dir / f"{StatePrefix.IN_PROGRESS.value}{self.name}"
        self.completed = self.dir / f"{StatePrefix.COMPLETED.value}{self.name}.txt"
        self.failed = self.dir / f"{StatePrefix.FAILED.value}{self.name}.txt"
        self.lock = self.dir / f"{StatePrefix.LOCKED.value}{self.name}"
        self.temp_log = self.dir / f"{StatePrefix.TEMP.value}{self.name}.txt"
        
        # Legacy support
        self.legacy_completed = self.dir / f"{StatePrefix.LEGACY_COMPLETED.value}{self.name}.txt"
    
    def get_state(self) -> str:
        """Get current task state."""
        if self.is_completed():
            return "completed"
        elif self.is_failed():
            return "failed"
        elif self.is_in_progress():
            return "in_progress"
        else:
            return "pending"
    
    def is_completed(self) -> bool:
        """Check if task completed successfully."""
        return self.completed.exists() or self.legacy_completed.exists()
    
    def is_failed(self) -> bool:
        """Check if task failed."""
        return self.failed.exists()
    
    def is_in_progress(self) -> bool:
        """Check if task is currently running."""
        return self.in_progress.exists()
    
    def acquire_lock(self, timeout: float = 5.0) -> bool:
        """
        Acquire exclusive lock on this task.
        Prevents race conditions between workers.
        """
        try:
            self.lock.parent.mkdir(parents=True, exist_ok=True)
            start = time.time()
            
            while time.time() - start < timeout:
                try:
                    # Atomic create with O_EXCL
                    fd = os.open(str(self.lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                    os.close(fd)
                    return True
                except FileExistsError:
                    time.sleep(0.1)
            
            return False
        except Exception:
            return False
    
    def release_lock(self) -> None:
        """Release exclusive lock."""
        try:
            self.lock.unlink(missing_ok=True)
        except Exception:
            pass
    
    def mark_in_progress(self, metadata: TaskMetadata) -> bool:
        """
        Atomically mark task as in-progress.
        Returns False if already in progress or completed.
        """
        if self.is_completed() or self.is_in_progress():
            return False
        
        if not self.acquire_lock():
            return False
        
        try:
            # Double-check after acquiring lock
            if self.is_completed() or self.is_in_progress():
                return False
            
            # Write metadata atomically
            meta_dict = {
                "file": metadata.file,
                "engine": metadata.engine,
                "model": metadata.model,
                "started_at": metadata.started_at,
                "pid": metadata.pid,
                "worker_id": metadata.worker_id,
                "attempt": metadata.attempt
            }
            
            # Write to temp file first, then atomic rename
            with tempfile.NamedTemporaryFile(
                mode='w',
                dir=self.dir,
                prefix='.tmp_marker_',
                delete=False
            ) as tmp:
                json.dump(meta_dict, tmp)
                tmp_path = tmp.name
            
            Path(tmp_path).rename(self.in_progress)
            return True
            
        finally:
            self.release_lock()
    
    def mark_completed(self) -> bool:
        """Atomically mark task as completed."""
        if not self.is_in_progress():
            return False
        
        try:
            # Move temp log to completed
            if self.temp_log.exists():
                self.temp_log.rename(self.completed)
            else:
                # Create empty completion marker
                self.completed.touch()
            
            # Remove in-progress marker
            self.in_progress.unlink(missing_ok=True)
            self.failed.unlink(missing_ok=True)  # Clean up any old failure
            return True
            
        except Exception:
            return False
    
    def mark_failed(self) -> bool:
        """Atomically mark task as failed."""
        if not self.is_in_progress():
            return False
        
        try:
            # Move temp log to failed
            if self.temp_log.exists():
                self.temp_log.rename(self.failed)
            else:
                # Create empty failure marker
                self.failed.touch()
            
            # Remove in-progress marker
            self.in_progress.unlink(missing_ok=True)
            return True
            
        except Exception:
            return False
    
    def cleanup_stale(self, max_age_seconds: float = 3600) -> bool:
        """
        Clean up stale in-progress marker if process is dead.
        Returns True if cleaned up.
        """
        if not self.in_progress.exists():
            return False
        
        try:
            # Check age
            age = time.time() - self.in_progress.stat().st_mtime
            if age < max_age_seconds:
                return False
            
            # Check if process is still alive
            with self.in_progress.open('r') as f:
                meta = json.load(f)
                pid = meta.get('pid')
            
            if pid and _is_process_alive(pid):
                return False
            
            # Stale marker - clean it up
            self.in_progress.unlink()
            return True
            
        except Exception:
            return False
    
    def get_metadata(self) -> Optional[TaskMetadata]:
        """Get metadata from in-progress marker."""
        if not self.in_progress.exists():
            return None
        
        try:
            with self.in_progress.open('r') as f:
                data = json.load(f)
            
            return TaskMetadata(
                file=data.get('file', ''),
                engine=data.get('engine', ''),
                model=data.get('model', ''),
                started_at=data.get('started_at', ''),
                pid=data.get('pid'),
                worker_id=data.get('worker_id'),
                attempt=data.get('attempt', 1)
            )
        except Exception:
            return None


def find_task_files(path: Path, pattern: str = "*.md", 
                   exclude_prefixes: Optional[Set[str]] = None) -> list[Path]:
    """
    Find all task files, excluding state markers.
    
    Args:
        path: Directory or file path
        pattern: Glob pattern for files
        exclude_prefixes: Prefixes to exclude (defaults to state prefixes)
    """
    if exclude_prefixes is None:
        exclude_prefixes = {
            StatePrefix.IN_PROGRESS.value,
            StatePrefix.COMPLETED.value,
            StatePrefix.FAILED.value,
            StatePrefix.LOCKED.value,
            StatePrefix.TEMP.value,
            StatePrefix.LEGACY_COMPLETED.value
        }
    
    files = []
    
    if path.is_file():
        files = [path]
    elif path.is_dir():
        files = list(path.glob(pattern))
    
    # Filter out state markers
    return [
        f for f in files
        if not any(f.name.startswith(prefix) for prefix in exclude_prefixes)
    ]


def get_task_stats(directory: Path) -> Dict[str, int]:
    """Get statistics for tasks in a directory."""
    all_files = find_task_files(directory)
    
    stats = {
        "total": len(all_files),
        "pending": 0,
        "in_progress": 0,
        "completed": 0,
        "failed": 0
    }
    
    for file in all_files:
        state = TaskState(file)
        status = state.get_state()
        stats[status] += 1
    
    return stats


def _is_process_alive(pid: int) -> bool:
    """Check if a process is still running."""
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False