.PHONY: help install install-dev test lint format clean demo build publish

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install:  ## Install the package
	pip install -e .

install-dev:  ## Install with development dependencies
	pip install -e ".[dev]"
	pip install -r requirements-dev.txt

test:  ## Run tests
	pytest tests/ -v --cov=codex_worker

lint:  ## Run linters
	ruff check codex_worker/
	mypy codex_worker/

format:  ## Format code with black
	black codex_worker/
	ruff check --fix codex_worker/

clean:  ## Clean build artifacts and cache
	rm -rf build/ dist/ *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache .mypy_cache .ruff_cache

demo:  ## Run the demo
	python demo.py

build:  ## Build distribution packages
	python -m build

publish:  ## Publish to PyPI (requires credentials)
	python -m twine upload dist/*

run-example:  ## Run example with dry-run
	@mkdir -p example_tasks
	@echo "Fix the bug in authentication" > example_tasks/task1.md
	@echo "Add logging to API endpoints" > example_tasks/task2.md
	python -m codex_worker run example_tasks/ --mode dry-run --verbose