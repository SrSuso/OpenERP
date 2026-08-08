"""A minimal in-memory sliding-window rate limiter.

Single-process only: state is a plain dict, never shared across worker
processes. That is enough for this monolith's deployment model — one API
process, with `app.jobs.worker` (phase 18) as the only other process, per
the README's own architecture table — but a horizontally-scaled deployment
(multiple API workers/replicas) would need a shared store (e.g. Redis)
instead. Documented as known deuda técnica rather than worked around, to
keep this phase's scope to what the rest of the stack actually needs today.

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
from collections import defaultdict


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)

    def _recent_hits(self, key: str, *, window_seconds: float) -> list[float]:
        cutoff = time.monotonic() - window_seconds
        hits = [t for t in self._hits[key] if t > cutoff]
        self._hits[key] = hits
        return hits

    def is_limited(self, key: str, *, max_hits: int, window_seconds: float) -> bool:
        """Check only — never records a hit. Call before doing the
        expensive/sensitive work a caller wants rate-limited."""
        return len(self._recent_hits(key, window_seconds=window_seconds)) >= max_hits

    def record(self, key: str) -> None:
        """Record one hit against `key` — call after whatever should count
        towards the limit (e.g. a failed login), not before."""
        self._hits[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        """Clear `key`'s history — call on success, so a legitimate user
        who mistyped a couple of times isn't penalised once they get it
        right."""
        self._hits.pop(key, None)
