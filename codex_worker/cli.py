"""Production-ready CLI using Typer with comprehensive safety features."""

import os
import sys
from pathlib import Path
from typing import List, Optional
from datetime import datetime
import json

import typer
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn
from rich.panel import Panel
from rich import print as rprint

from .worker import CodexWorker, WorkerConfig, ExecutionMode, ExecutionResult
from .state import find_task_files, get_task_stats, TaskState

# Initialize Typer app
app = typer.Typer(
    name="codex-worker",
    help="🤖 Safe parallel execution of AI coding agents on your codebase",
    add_completion=True,
    rich_markup_mode="rich",
    epilog="Run 'codex-worker --help' for more information."
)

console = Console()


def validate_paths(paths: List[str]) -> List[Path]:
    """Validate and resolve input paths."""
    if not paths:
        # Default to current directory
        paths = ["."]
    
    resolved = []
    for path_str in paths:
        path = Path(path_str).resolve()
        
        if not path.exists():
            console.print(f"[red]❌ Path does not exist: {path_str}[/red]")
            raise typer.Exit(code=1)
        
        resolved.append(path)
    
    return resolved


def confirm_dangerous_operation(mode: ExecutionMode, file_count: int) -> bool:
    """Prompt for confirmation on dangerous operations."""
    if mode == ExecutionMode.DRY_RUN:
        return True
    
    if mode == ExecutionMode.FULL_ACCESS:
        console.print(Panel(
            "[bold red]⚠️  WARNING: FULL ACCESS MODE[/bold red]\n\n"
            "The AI agent will have UNRESTRICTED access to modify ANY file on your system.\n"
            "This includes system files, credentials, and destructive operations.\n\n"
            f"About to process [yellow]{file_count}[/yellow] file(s).",
            title="[red]Dangerous Operation[/red]",
            border_style="red"
        ))
        
        confirm = typer.confirm("Are you ABSOLUTELY sure you want to continue?", default=False)
        if confirm:
            double_confirm = typer.confirm("Please confirm again to proceed", default=False)
            return double_confirm
        return False
    
    return True


@app.command()
def run(
    paths: List[str] = typer.Argument(
        None,
        help="Files or directories to process (default: current directory)"
    ),
    pattern: str = typer.Option(
        "*.md",
        "--pattern", "-p",
        help="File pattern to match (e.g., '*.md', '*.txt')"
    ),
    model: str = typer.Option(
        None,
        "--model", "-m",
        help="Model to use (default: o4-mini)"
    ),
    mode: ExecutionMode = typer.Option(
        ExecutionMode.READ_ONLY,
        "--mode",
        help="Execution safety level",
        case_sensitive=False
    ),
    approval: str = typer.Option(
        "on-request",
        "--approval", "-a",
        help="When to ask for human approval (never, on-request, on-failure, untrusted)"
    ),
    concurrency: int = typer.Option(
        1,
        "--concurrency", "-c",
        min=1,
        max=32,
        help="Number of parallel workers"
    ),
    timeout: Optional[float] = typer.Option(
        None,
        "--timeout", "-t",
        min=1.0,
        help="Timeout per task in seconds"
    ),
    retries: int = typer.Option(
        0,
        "--retries", "-r",
        min=0,
        max=10,
        help="Number of retry attempts on failure"
    ),
    skip_completed: bool = typer.Option(
        True,
        "--skip-completed/--rerun-completed",
        help="Skip already completed tasks (resumability)"
    ),
    cleanup_stale: Optional[float] = typer.Option(
        None,
        "--cleanup-stale",
        min=60.0,
        help="Clean up stale markers older than N seconds"
    ),
    verbose: bool = typer.Option(
        False,
        "--verbose", "-v",
        help="Show detailed output"
    ),
    yes: bool = typer.Option(
        False,
        "--yes", "-y",
        help="Skip confirmation prompts"
    ),
    output_json: Optional[Path] = typer.Option(
        None,
        "--output-json", "-o",
        help="Save results to JSON file"
    )
):
    """
    🚀 Run Codex on files with parallel execution and state tracking.
    
    This tool enables safe, resumable execution of AI coding agents on your codebase.
    It uses file prefixes to track state, allowing multiple workers to coordinate
    and resume after interruptions.
    
    Examples:
    
        # Process all .md files in current directory (safe mode)
        codex-worker
        
        # Process specific files with 4 parallel workers
        codex-worker file1.md file2.md --concurrency 4
        
        # Dry run to preview what would be executed
        codex-worker tasks/ --mode dry-run
        
        # Use custom model
        codex-worker --model o4 tasks/
        
        # Clean up stale markers and run
        codex-worker --cleanup-stale 3600 tasks/
    """
    # Validate paths
    resolved_paths = validate_paths(paths)
    
    # Find all task files
    all_files = []
    for path in resolved_paths:
        files = find_task_files(path, pattern)
        all_files.extend(files)
    
    if not all_files:
        console.print("[yellow]No matching files found.[/yellow]")
        return
    
    # Remove duplicates and sort
    all_files = sorted(set(all_files))
    
    # Show summary
    console.print(Panel(
        f"[bold]Task Summary[/bold]\n\n"
        f"Files found: [cyan]{len(all_files)}[/cyan]\n"
        f"Pattern: [cyan]{pattern}[/cyan]\n"
        f"Engine: [cyan]codex[/cyan]\n"
        f"Model: [cyan]{model or 'default'}[/cyan]\n"
        f"Mode: [cyan]{mode.value}[/cyan]\n"
        f"Workers: [cyan]{concurrency}[/cyan]\n"
        f"Retries: [cyan]{retries}[/cyan]",
        title="Codex Worker",
        border_style="blue"
    ))
    
    # Get task statistics
    if len(resolved_paths) == 1 and resolved_paths[0].is_dir():
        stats = get_task_stats(resolved_paths[0])
        
        table = Table(title="Current Status")
        table.add_column("Status", style="cyan")
        table.add_column("Count", justify="right")
        
        table.add_row("Pending", str(stats["pending"]))
        table.add_row("In Progress", str(stats["in_progress"]))
        table.add_row("Completed", str(stats["completed"]))
        table.add_row("Failed", str(stats["failed"]))
        table.add_row("[bold]Total[/bold]", f"[bold]{stats['total']}[/bold]")
        
        console.print(table)
    
    # Confirm dangerous operations
    if not yes and not confirm_dangerous_operation(mode, len(all_files)):
        console.print("[red]Operation cancelled.[/red]")
        raise typer.Exit(code=1)
    
    # Setup configuration
    if not model:
        model = "o4-mini"
    
    config = WorkerConfig(
        model=model,
        mode=mode,
        approval=approval,
        timeout=timeout,
        retries=retries,
        retry_delay=5.0,
        concurrency=concurrency,
        sleep_between=1.0,
        skip_git_check=True,
        codex_cmd=os.environ.get("CODEX_CMD", "codex"),
        verbose=verbose
    )
    
    # Create worker
    worker = CodexWorker(config)
    
    # Validate environment
    warnings = worker.validate_environment()
    for warning in warnings:
        console.print(f"[yellow]⚠️  {warning}[/yellow]")
    
    # Clean up stale markers if requested
    if cleanup_stale:
        for path in resolved_paths:
            if path.is_dir():
                cleaned = worker.cleanup_stale_markers(path, cleanup_stale)
                if cleaned > 0:
                    console.print(f"[green]✅ Cleaned {cleaned} stale markers[/green]")
    
    # Execute with progress bar
    results = []
    
    def progress_callback(completed: int, total: int):
        pass  # Handled by Rich progress bar
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        console=console
    ) as progress:
        task = progress.add_task(
            f"Processing {len(all_files)} files...",
            total=len(all_files)
        )
        
        for file in all_files:
            if skip_completed and TaskState(file).is_completed():
                progress.update(task, advance=1)
                continue
            
            result = worker.process_file(file)
            results.append(result)
            
            # Update progress
            progress.update(task, advance=1)
            
            # Show result
            if result.success:
                if verbose:
                    console.print(f"  ✅ {file.name} completed")
            else:
                console.print(f"  ❌ {file.name} failed: {result.error_msg}")
    
    # Show summary
    successful = sum(1 for r in results if r.success)
    failed = sum(1 for r in results if not r.success)
    
    console.print(Panel(
        f"[bold]Execution Complete[/bold]\n\n"
        f"✅ Successful: [green]{successful}[/green]\n"
        f"❌ Failed: [red]{failed}[/red]\n"
        f"⏭️  Skipped: [yellow]{worker.stats['skipped']}[/yellow]\n"
        f"Total processed: {len(results)}",
        title="Results",
        border_style="green" if failed == 0 else "red"
    ))
    
    # Save results to JSON if requested
    if output_json:
        results_data = [
            {
                "file": str(r.file),
                "success": r.success,
                "return_code": r.return_code,
                "duration": r.duration,
                "error": r.error_msg,
                "timestamp": datetime.now().isoformat()
            }
            for r in results
        ]
        
        output_json.write_text(json.dumps(results_data, indent=2))
        console.print(f"[green]Results saved to {output_json}[/green]")
    
    # Exit with appropriate code
    if failed > 0:
        raise typer.Exit(code=1)


@app.command()
def status(
    path: Path = typer.Argument(
        Path("."),
        help="Directory to check status for"
    ),
    pattern: str = typer.Option(
        "*.md",
        "--pattern", "-p",
        help="File pattern to match"
    ),
    detailed: bool = typer.Option(
        False,
        "--detailed", "-d",
        help="Show detailed file-by-file status"
    )
):
    """
    📊 Show status of tasks in a directory.
    
    This command shows which tasks are pending, in progress, completed, or failed.
    """
    if not path.exists():
        console.print(f"[red]Path does not exist: {path}[/red]")
        raise typer.Exit(code=1)
    
    if not path.is_dir():
        path = path.parent
    
    # Get statistics
    stats = get_task_stats(path)
    files = find_task_files(path, pattern)
    
    # Show summary table
    table = Table(title=f"Task Status for {path}")
    table.add_column("Status", style="cyan")
    table.add_column("Count", justify="right")
    table.add_column("Percentage", justify="right")
    
    total = stats["total"]
    if total > 0:
        table.add_row("Pending", str(stats["pending"]), f"{stats['pending']/total*100:.1f}%")
        table.add_row("In Progress", str(stats["in_progress"]), f"{stats['in_progress']/total*100:.1f}%")
        table.add_row("Completed", str(stats["completed"]), f"{stats['completed']/total*100:.1f}%")
        table.add_row("Failed", str(stats["failed"]), f"{stats['failed']/total*100:.1f}%")
        table.add_row("[bold]Total[/bold]", f"[bold]{total}[/bold]", "[bold]100%[/bold]")
    
    console.print(table)
    
    # Show detailed status if requested
    if detailed and files:
        console.print("\n[bold]Detailed Status:[/bold]\n")
        
        for file in sorted(files):
            state = TaskState(file)
            status = state.get_state()
            
            # Color based on status
            if status == "completed":
                icon, color = "✅", "green"
            elif status == "failed":
                icon, color = "❌", "red"
            elif status == "in_progress":
                icon, color = "🔄", "yellow"
            else:
                icon, color = "⏸️ ", "dim"
            
            console.print(f"  {icon} [{color}]{file.name:40} {status}[/{color}]")
            
            # Show metadata for in-progress tasks
            if status == "in_progress":
                meta = state.get_metadata()
                if meta:
                    console.print(f"     Started: {meta.started_at}")
                    console.print(f"     Worker: {meta.worker_id}")
                    console.print(f"     PID: {meta.pid}")


@app.command()
def clean(
    path: Path = typer.Argument(
        Path("."),
        help="Directory to clean"
    ),
    max_age: float = typer.Option(
        3600.0,
        "--max-age", "-a",
        min=60.0,
        help="Maximum age in seconds for stale markers"
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Show what would be cleaned without doing it"
    )
):
    """
    🧹 Clean up stale in-progress markers.
    
    This removes in-progress markers where the process is no longer running.
    """
    if not path.exists():
        console.print(f"[red]Path does not exist: {path}[/red]")
        raise typer.Exit(code=1)
    
    if not path.is_dir():
        path = path.parent
    
    files = find_task_files(path)
    cleaned = 0
    
    for file in files:
        state = TaskState(file)
        if state.is_in_progress():
            meta = state.get_metadata()
            
            if dry_run:
                if meta:
                    console.print(f"Would clean: {file.name} (worker={meta.worker_id}, pid={meta.pid})")
                else:
                    console.print(f"Would clean: {file.name} (no metadata)")
                cleaned += 1
            else:
                if state.cleanup_stale(max_age):
                    console.print(f"✅ Cleaned: {file.name}")
                    cleaned += 1
    
    if cleaned > 0:
        action = "Would clean" if dry_run else "Cleaned"
        console.print(f"\n[green]{action} {cleaned} stale marker(s)[/green]")
    else:
        console.print("[green]No stale markers found[/green]")


@app.command()
def reset(
    path: Path = typer.Argument(
        Path("."),
        help="Directory to reset"
    ),
    force: bool = typer.Option(
        False,
        "--force", "-f",
        help="Skip confirmation prompt"
    )
):
    """
    🔄 Reset all task states in a directory.
    
    This removes all state markers, allowing tasks to be rerun from scratch.
    """
    if not path.exists():
        console.print(f"[red]Path does not exist: {path}[/red]")
        raise typer.Exit(code=1)
    
    if not path.is_dir():
        path = path.parent
    
    # Find all state files
    state_files = []
    for prefix in ["in-progress-", "done_exec_log-", "failed_exec_log-", ".lock-", ".tmp_exec_log-", "completed_"]:
        state_files.extend(path.glob(f"{prefix}*"))
    
    if not state_files:
        console.print("[yellow]No state files found[/yellow]")
        return
    
    console.print(f"Found [red]{len(state_files)}[/red] state files")
    
    if not force:
        confirm = typer.confirm("Are you sure you want to reset all task states?", default=False)
        if not confirm:
            console.print("[yellow]Reset cancelled[/yellow]")
            return
    
    # Remove state files
    removed = 0
    for file in state_files:
        try:
            file.unlink()
            removed += 1
            if force:  # Only show in verbose/force mode
                console.print(f"  Removed: {file.name}")
        except Exception as e:
            console.print(f"  [red]Failed to remove {file.name}: {e}[/red]")
    
    console.print(f"\n[green]✅ Reset complete. Removed {removed} state files.[/green]")


def main():
    """Main entry point."""
    app()


if __name__ == "__main__":
    main()