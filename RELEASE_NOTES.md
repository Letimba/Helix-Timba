# HELIX V5.3.1 — Industrial UI + Accounting Overhaul

## Critical bug fixes

### UI
- Removed the nested 12-column grid that squeezed all pages into narrow vertical strips.
- Rebuilt every tab around a single responsive page layout.
- Added mobile/tablet breakpoints and horizontal table overflow.
- WebSocket updates preserve scroll position.

### Position accounting
- Fixed USD/SOL unit mixing that could create impossible paper PnL.
- Current value is derived from `entry_sol × current_price / entry_price`.
- Invalid/stale quotes never overwrite a valid quote with zero.
- Corrupt legacy positions are rejected during persistence restore.

### Exits
- TP/SL/trailing are evaluated in a dedicated position loop.
- TP uses the actual return threshold and fires at the exact configured boundary.
- Position management does not depend on scanner membership.

### Pump.fun
- Added current `coins-v2/{mint}` coin-state endpoint.
- Added Pump.fun `/sol-price` quote source.
- Retained legacy `/coins/{mint}` fallback for compatibility.
- Bonding-curve spot price is derived from virtual SOL/token reserves.

### Strategies
- Strategy selection remains server-authoritative.
- Every configured strategy is selectable from the new Strategy Matrix.
- Existing positions retain their original TP/SL/trailing parameters.

## QA

- 15 pytest tests pass.
- Python compileall passes.
- JavaScript syntax check passes.
- Local FastAPI smoke test passes for `/`, `/api/state`, `/api/health`, `/api/strategy`.

## V5.3.1 — UI boot reliability
- Render the terminal immediately before API/WebSocket synchronization, eliminating blank-background startup while the backend/feed is loading.
- Added 8-second API timeout with a readable error.
- Hardened WebSocket reconnect/payload handling.
- Added frontend cache-busting query strings for CSS/JS.
