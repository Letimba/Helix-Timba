.PHONY: test compile format lint run

run:
	python -m app.main

test:
	pytest -q

compile:
	python -m compileall -q app tests

format:
	python -m ruff format app tests

lint:
	python -m ruff check app tests
