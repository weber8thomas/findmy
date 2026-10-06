# syntax=docker/dockerfile:1

# ---- 1. build the web app ----
FROM node:22-slim AS web
WORKDIR /web
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# ---- 2. Python runtime serving API + static files ----
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv
RUN pip install --no-cache-dir "uv>=0.11,<0.12"
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
# The Apple providers' libraries are bundled so they can be switched on with an env var.
RUN uv sync --frozen --no-dev --no-install-project --extra findmy --extra icloud
COPY backend/app ./app
COPY --from=web /web/dist ./static
RUN useradd --system --uid 10001 --home-dir /data locus && mkdir -p /data && chown locus /data
USER locus
ENV PATH=/opt/venv/bin:$PATH \
    DATA_DIR=/data \
    STATIC_DIR=/app/static
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
# One worker by design: live connections and rate limits are kept in memory.
CMD ["uvicorn", "--factory", "app.main:create_app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
