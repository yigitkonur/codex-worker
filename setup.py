#!/usr/bin/env python3
"""Setup script for Codex Worker."""

from setuptools import setup, find_packages
from pathlib import Path

# Read version from package
version = "1.0.0"
try:
    with open("codex_worker/__init__.py", "r") as f:
        for line in f:
            if line.startswith("__version__"):
                version = line.split("=")[1].strip().strip('"').strip("'")
                break
except Exception:
    pass

# Read README
readme = Path("README.md")
long_description = ""
if readme.exists():
    long_description = readme.read_text(encoding="utf-8")

setup(
    name="codex-worker",
    version=version,
    description="Safe parallel execution of AI coding agents on your codebase",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Codex Worker Contributors",
    author_email="",
    url="https://github.com/yourusername/codex-worker",
    license="MIT",
    python_requires=">=3.8",
    
    packages=find_packages(exclude=["tests", "tests.*"]),
    
    install_requires=[
        "typer[all]>=0.9.0",
        "rich>=13.0.0",
    ],
    
    extras_require={
        "dev": [
            "pytest>=7.0.0",
            "pytest-cov>=4.0.0",
            "black>=23.0.0",
            "ruff>=0.1.0",
            "mypy>=1.0.0",
        ],
    },
    
    entry_points={
        "console_scripts": [
            "codex-worker=codex_worker.cli:main",
            "cw=codex_worker.cli:main",  # Short alias
        ],
    },
    
    classifiers=[
        "Development Status :: 4 - Beta",
        "Environment :: Console",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Code Generators",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: System :: Distributed Computing",
        "Typing :: Typed",
    ],
    
    keywords=[
        "ai",
        "codex",
        "gemini",
        "automation",
        "parallel",
        "batch",
        "coding",
        "agents",
        "llm",
        "development",
    ],
    
    project_urls={
        "Bug Reports": "https://github.com/yourusername/codex-worker/issues",
        "Source": "https://github.com/yourusername/codex-worker",
        "Documentation": "https://github.com/yourusername/codex-worker#readme",
    },
)