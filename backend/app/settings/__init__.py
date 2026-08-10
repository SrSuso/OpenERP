"""Phase 21: admin-editable overrides on top of `app.core.config.Settings`.

Everything here is optional and additive to the environment/`.env`
configuration — a fresh deployment with no `system_settings` row behaves
exactly as it always did. See `app.settings.models` for why.
"""

from __future__ import annotations
