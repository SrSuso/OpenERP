"""Purchase orders (phase 6) and their goods receipts (phase 9).

Phase 6 only ever drives a purchase order through
``DRAFT -> ORDERED -> CANCELLED``; ``PARTIALLY_RECEIVED``/``RECEIVED`` are
reached exclusively by phase 9's receiving flow, once the inventory ledger
(phase 7) and lot tracking (phase 8) it depends on exist. The status enum
and ``quantity_received`` column are defined now so phase 9 has nothing to
migrate — only behaviour to add.
"""
