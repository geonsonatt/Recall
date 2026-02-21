.PHONY: test lint typecheck run-help

test:
	pytest

lint:
	ruff check src tests

typecheck:
	mypy src

run-help:
	python -m python_learning.cli --help
