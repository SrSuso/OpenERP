"""A minimal in-memory sliding-window rate limiter.

Single-process only: state is a process-local map, never shared across worker
processes. That is enough for this monolith's deployment model — one API
process, with `app.jobs.worker` (phase 18) as the only other process, per
the README's own architecture table — but a horizontally-scaled deployment
(multiple API workers/replicas) would need a shared store (e.g. Redis)
instead. Documented as known deuda técnica rather than worked around, to
keep this phase's scope to what the rest of the stack actually needs today.

Expired keys are periodically removed and the map has a hard 10,000-key LRU
bound, so spraying unique email addresses cannot grow process memory forever.

No lock: every operation here is synchronous, in-process dict manipulation
with no ``await`` in the middle, so under asyncio's single-threaded event
loop nothing can interleave mid-update even without one.

The limit itself (``max_hits``/``window_seconds``) is a parameter of each
call, not the constructor — callers read it from `Settings` on every
request (see `app.auth.router.login`), so tests can exercise a tiny window
without needing a second limiter instance or a settings-reload dance.
"""

from __future__ import annotations

import time
from collections import OrderedDict


class SlidingWindowRateLimiter:
    """Bounded process-local hit history for the single production API process."""

    def __init__(self, *, max_keys: int = 10_000) -> None:
        self._hits: OrderedDict[str, list[float]] = OrderedDict()
        self._expires_at: dict[str, float] = {}
        self._max_keys = max_keys
        self._next_cleanup_at = 0.0

    def _discard(self, key: str) -> None:
        self._hits.pop(key, None)
        self._expires_at.pop(key, None)

    def _prune_expired(self, now: float) -> None:
        if now < self._next_cleanup_at:
            return
        self._next_cleanup_at = now + 30.0
        for key, expires_at in list(self._expires_at.items()):
            if expires_at <= now:
                self._discard(key)

    def _recent_hits(self, key: str, *, window_seconds: float) -> list[float]:
        now = time.monotonic()
        cutoff = now - window_seconds
        hits = [timestamp for timestamp in self._hits.get(key, ()) if timestamp > cutoff]
        if not hits:
            self._discard(key)
            return []
        self._hits[key] = hits
        self._hits.move_to_end(key)
        self._expires_at[key] = hits[-1] + window_seconds
        return hits

    def is_limited(self, key: str, *, max_hits: int, window_seconds: float) -> bool:
        """Check only — never records a hit. Call before doing the
        expensive/sensitive work a caller wants rate-limited."""
        return len(self._recent_hits(key, window_seconds=window_seconds)) >= max_hits

    def record(self, key: str, *, window_seconds: float) -> None:
        """Record one hit against `key` — call after whatever should count
        towards the limit (e.g. a failed login), not before."""
        now = time.monotonic()
        self._prune_expired(now)
        if key not in self._hits and len(self._hits) >= self._max_keys:
            oldest, _ = self._hits.popitem(last=False)
            self._expires_at.pop(oldest, None)
        self._hits.setdefault(key, []).append(now)
        self._hits.move_to_end(key)
        self._expires_at[key] = now + window_seconds

    def reset(self, key: str) -> None:
        """Clear `key`'s history — call on success, so a legitimate user
        who mistyped a couple of times isn't penalised once they get it
        right."""
        self._discard(key)

    def clear(self) -> None:
        """Clear all history; useful when a process/test boundary is reset."""
        self._hits.clear()
        self._expires_at.clear()
        self._next_cleanup_at = 0.0
