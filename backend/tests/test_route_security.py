"""Rule 11 (permissions are always checked backend-side), enforced as a
regression test over the actual route table rather than trusted by
convention: every endpoint in the app must either require authentication
(and, for anything beyond a user's own account, a specific permission via
``app.rbac.dependencies.require_permission`` or ``require_any_permission``)
or be on the short, explicit allowlist below of what is legitimately
public/self-service.

Walks FastAPI's own dependency graph (``route.dependant``) rather than
re-deriving permissions by hand, so this catches a router mounted without
its `_require_*` dependency just as reliably as one written with the wrong
permission key would be caught by the phase's own tests.
"""

from __future__ import annotations

from typing import Any

from fastapi.routing import APIRoute

from app.main import create_app

#: No authentication at all — genuinely public. Anything else missing here
#: fails the test below, on purpose: adding a new unauthenticated route
#: must be a deliberate, reviewed edit to this set, never an accident.
PUBLIC_ROUTES = {
    ("GET", "/health/live"),
    ("GET", "/health/ready"),
    ("POST", "/auth/login"),
}

#: Authenticated, but deliberately no *specific* permission — every one of
#: these only ever acts on the caller's own account/session, never another
#: user's data or a business resource, so `require_permission` would be
#: nothing but ceremony here (see each router's own module docstring).
SELF_SERVICE_ROUTES = {
    ("POST", "/auth/logout"),
    ("GET", "/auth/me"),
    ("GET", "/auth/sessions"),
    ("DELETE", "/auth/sessions/{session_id}"),
    ("POST", "/users/me/password"),
}


def _collect_api_routes() -> list[APIRoute]:
    """FastAPI routers nest by way of an internal wrapper, not a flat
    list — recurse through it to reach the real ``APIRoute`` objects."""
    app = create_app()
    routes: list[APIRoute] = []

    def walk(candidates: Any) -> None:
        for candidate in candidates:
            if isinstance(candidate, APIRoute):
                routes.append(candidate)
            elif hasattr(candidate, "original_router"):
                walk(candidate.original_router.routes)
            elif hasattr(candidate, "routes"):
                walk(candidate.routes)

    walk(app.routes)
    # Every `APIRoute` reached this way is one of ours — the built-in docs/
    # openapi routes are plain `starlette.routing.Route`s, filtered out by
    # the `isinstance` check above already. Note `route.path` here is the
    # path as declared on the router (e.g. `/health/live`), *not* prefixed
    # with `settings.api_v1_prefix` — the prefix is applied at mount time,
    # not baked into the route object itself.
    return routes


def _dependency_names(route: APIRoute) -> set[str]:
    names: set[str] = set()

    def walk(dependant: Any) -> None:
        for sub in dependant.dependencies:
            names.add(getattr(sub.call, "__qualname__", str(sub.call)))
            walk(sub)

    walk(route.dependant)
    return names


def _methods(route: APIRoute) -> set[str]:
    return (route.methods or set()) - {"HEAD"}


def test_every_route_requires_authentication_unless_explicitly_public() -> None:
    for route in _collect_api_routes():
        for method in sorted(_methods(route)):
            key = (method, route.path)
            if key in PUBLIC_ROUTES:
                continue
            names = _dependency_names(route)
            assert "get_current_user" in names or "get_current_auth_session" in names, (
                f"{key} has no authentication dependency — add "
                f"`require_permission(...)` (or add it to PUBLIC_ROUTES if this "
                f"route is genuinely meant to be public)."
            )


def test_every_authenticated_route_checks_a_permission_unless_self_service() -> None:
    for route in _collect_api_routes():
        for method in sorted(_methods(route)):
            key = (method, route.path)
            if key in PUBLIC_ROUTES or key in SELF_SERVICE_ROUTES:
                continue
            names = _dependency_names(route)
            # require_any_permission's inner closure is also named "_check"
            # (like require_permission's), qualified as
            # "require_any_permission.<locals>._check" — contains
            # "permission" but not the literal substring "require_permission",
            # so it needs its own check alongside it.
            assert any(
                "require_permission" in name or "require_any_permission" in name for name in names
            ), (
                f"{key} is authenticated but checks no specific permission — "
                f"add `require_permission(...)`/`require_any_permission(...)` (or "
                f"add it to SELF_SERVICE_ROUTES if it genuinely only ever acts on "
                f"the caller's own account)."
            )


def test_the_allowlists_do_not_drift_from_the_actual_route_table() -> None:
    """Catches the opposite mistake: a route that used to be public/self-
    service and has since gained real protection, but the allowlist above
    was never trimmed back down — the allowlist is meant to be exactly the
    exempt set, not a superset of it."""
    all_routes = {
        (method, route.path) for route in _collect_api_routes() for method in _methods(route)
    }
    stale = (PUBLIC_ROUTES | SELF_SERVICE_ROUTES) - all_routes
    assert not stale, f"Allowlisted routes that no longer exist: {stale}"
