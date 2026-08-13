"""Lightweight contracts for the documentation users are meant to follow.

This deliberately checks only stable, high-value links between docs and code.
It is not intended to become a general Markdown linter.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CURRENT_DOCS = (
    ROOT / "README.md",
    ROOT / "docs/USER_GUIDE.md",
    ROOT / "docs/ADMIN_GUIDE.md",
    ROOT / "docs/ARCHITECTURE.md",
    ROOT / "docs/USAGE.md",
    ROOT / "docs/TESTING.md",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_primary_internal_markdown_links_resolve() -> None:
    link_pattern = re.compile(r"(?<!!)\[[^]]+\]\(([^)]+)\)")
    missing: list[str] = []

    for document in CURRENT_DOCS:
        for raw_target in link_pattern.findall(_read(document)):
            target = raw_target.strip().strip("<>").split("#", 1)[0]
            if not target or "://" in target or target.startswith("mailto:"):
                continue
            resolved = (document.parent / target).resolve()
            if not resolved.exists():
                missing.append(f"{document.relative_to(ROOT)} -> {raw_target}")

    assert missing == []


def test_documented_make_targets_and_scripts_exist() -> None:
    makefile = _read(ROOT / "Makefile")
    targets = set(re.findall(r"^([A-Za-z0-9_.%-]+):", makefile, flags=re.MULTILINE))
    documented = set()
    scripts = set()

    for document in CURRENT_DOCS:
        text = _read(document)
        documented.update(re.findall(r"\bmake\s+([A-Za-z0-9_.-]+)", text))
        scripts.update(re.findall(r"scripts/[A-Za-z0-9_.-]+\.(?:sh|cmd)", text))

    assert documented - targets == set()
    assert {script for script in scripts if not (ROOT / script).is_file()} == set()


def test_critical_ui_routes_are_current_and_documented() -> None:
    route_source = _read(ROOT / "frontend/src/routes.tsx")
    architecture = _read(ROOT / "docs/ARCHITECTURE.md")
    expected = {
        "/login": "path: '/login'",
        "/change-password": "path: '/change-password'",
        "/pos": "path: '/pos'",
        "/admin": "path: '/admin'",
        "/admin/access/users": "path: 'users'",
        "/admin/access/roles": "path: 'roles'",
        "/admin/inventory/products": "path: 'products'",
        "/admin/inventory/lots": "path: 'lots'",
        "/admin/inventory/balances": "path: 'balances'",
        "/admin/inventory/terminals": "path: 'terminals'",
        "/admin/purchasing": "path: 'purchasing'",
        "/admin/returns": "path: 'returns'",
        "/admin/reports": "path: 'reports'",
        "/admin/settings": "path: 'settings'",
    }

    for route, source_marker in expected.items():
        assert source_marker in route_source, route
        assert f"`{route}`" in architecture, route


def test_operational_guides_do_not_depend_on_manual_api_calls() -> None:
    user_guide = _read(ROOT / "docs/USER_GUIDE.md")
    admin_guide = _read(ROOT / "docs/ADMIN_GUIDE.md")

    assert "/api/" not in user_guide
    assert "curl " not in user_guide
    assert "curl " not in admin_guide
    assert not re.search(r"(?is)\b(?:abre|usa|utiliza)\b.{0,40}(?:swagger|/api/docs)", admin_guide)


def test_api_documentation_is_explicitly_development_only() -> None:
    usage = _read(ROOT / "docs/USAGE.md")
    assert "DEVELOPMENT ONLY" in usage
    assert "/api/docs" in usage

    admin_guide = _read(ROOT / "docs/ADMIN_GUIDE.md")
    assert "`/api/docs`" in admin_guide
    assert "responden 404" in admin_guide


def test_phase_record_is_unmistakably_historical() -> None:
    heading = _read(ROOT / "docs/PHASES.md")[:1_000]
    assert "HISTORICAL DEVELOPMENT RECORD" in heading
    assert "NOT OPERATIONAL DOCUMENTATION" in heading
