#!/usr/bin/env python3
"""
Demo script for Codex Worker.

This creates sample task files and demonstrates the key features.
"""

import os
import sys
from pathlib import Path
import time

def create_demo_tasks():
    """Create sample task files for demonstration."""
    demo_dir = Path("demo_tasks")
    demo_dir.mkdir(exist_ok=True)
    
    tasks = [
        ("analyze-code.md", "Analyze the Python files in the current directory and suggest improvements"),
        ("write-tests.md", "Write unit tests for the main functions"),
        ("fix-bugs.md", "Find and fix any potential bugs in the codebase"),
        ("add-docs.md", "Add comprehensive docstrings to all functions"),
        ("optimize.md", "Optimize the code for better performance"),
    ]
    
    print("📝 Creating demo task files...")
    for filename, content in tasks:
        file_path = demo_dir / filename
        file_path.write_text(content)
        print(f"   Created: {filename}")
    
    return demo_dir

def main():
    """Run the demo."""
    print("🚀 Codex Worker Demo\n")
    print("=" * 50)
    
    # Create demo tasks
    demo_dir = create_demo_tasks()
    
    print("\n" + "=" * 50)
    print("📊 Demo Commands to Try:\n")
    
    commands = [
        ("Check status", f"python -m codex_worker status {demo_dir}"),
        ("Dry run", f"python -m codex_worker run {demo_dir} --mode dry-run"),
        ("Run single worker", f"python -m codex_worker run {demo_dir}"),
        ("Run parallel (4 workers)", f"python -m codex_worker run {demo_dir} --concurrency 4"),
        ("Check detailed status", f"python -m codex_worker status {demo_dir} --detailed"),
        ("Clean stale markers", f"python -m codex_worker clean {demo_dir}"),
        ("Reset all states", f"python -m codex_worker reset {demo_dir} --force"),
    ]
    
    for desc, cmd in commands:
        print(f"• {desc}:")
        print(f"  $ {cmd}\n")
    
    print("=" * 50)
    print("\n💡 Tips:")
    print("• Tasks are automatically resumed if interrupted")
    print("• Multiple workers can run from different terminals")
    print("• Check the file prefixes to see state changes")
    print("• Use --verbose for detailed output")
    print("\n🔗 For more info: python -m codex_worker --help")

if __name__ == "__main__":
    main()