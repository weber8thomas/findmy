.PHONY: setup dev dev-backend dev-frontend test test-backend test-frontend e2e build serve docker compose-check

setup:
	cd backend && uv sync
	cd frontend && pnpm install
	cd e2e && pnpm install

# Backend on :8000 (auto-reload) + Vite on :5173 proxying /api. Open http://localhost:5173
dev:
	$(MAKE) -j2 dev-backend dev-frontend

dev-backend:
	cd backend && DATA_DIR=../data uv run uvicorn --factory app.main:create_app --reload --port 8000

dev-frontend:
	cd frontend && pnpm dev

test: test-backend test-frontend

test-backend:
	cd backend && uv run ruff check app tests && uv run pytest -q

test-frontend:
	cd frontend && pnpm typecheck && pnpm test

build:
	cd frontend && pnpm build

# Single process serving the built frontend, like production. http://localhost:8000
serve: build
	cd backend && DATA_DIR=../data STATIC_DIR=../frontend/dist uv run uvicorn --factory app.main:create_app --port 8000

e2e: build
	cd e2e && pnpm exec playwright test

docker:
	docker compose build

compose-check:
	docker compose config -q && docker compose --profile https --profile tunnel --profile findmy config -q
