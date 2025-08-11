"""Codex Worker - Safe parallel execution of AI coding agents on your codebase."""

__version__ = "1.0.0"
__author__ = "Codex Worker Contributors"

from .worker import CodexWorker
from .state import TaskState, StatePrefix

__all__ = ["CodexWorker", "TaskState", "StatePrefix"]