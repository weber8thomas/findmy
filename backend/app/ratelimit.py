"""Tiny in-memory sliding-window rate limiter (single-process by design)."""

from __future__ import annotations

import time
from collections import deque


class RateLimiter:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self._hits: dict[tuple[str, str], deque[float]] = {}

    def hit(self, bucket: str, key: str, limit: int, window_s: float) -> bool:
        """Record a hit. Returns False when the limit is exceeded."""
        if not self.enabled:
            return True
        now = time.monotonic()
        q = self._hits.setdefault((bucket, key), deque())
        while q and q[0] <= now - window_s:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        if len(self._hits) > 50_000:  # crude memory bound
            self._hits.clear()
        return True
