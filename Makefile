.PHONY: help install-backend install-frontend install dev-backend dev-frontend test-backend build-frontend

help:
	@echo "Available commands:"
	@echo "  make install         - Setup virtual environment and install backend + frontend dependencies"
	@echo "  make dev-backend     - Start FastAPI backend on http://localhost:8000"
	@echo "  make dev-frontend    - Start Next.js frontend on http://localhost:3000"
	@echo "  make test-backend    - Run backend pytest test suite"
	@echo "  make build-frontend  - Build production Next.js bundle"

install-backend:
	cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt || .venv/Scripts/pip install -r requirements.txt

install-frontend:
	cd frontend && npm install

install: install-backend install-frontend

dev-backend:
	cd backend && uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

test-backend:
	cd backend && pytest tests -v

build-frontend:
	cd frontend && npm run build
