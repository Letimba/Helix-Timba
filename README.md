# HELIX 5.3 Industrial — Pump.fun Intelligence Terminal

> **Open-source Solana memecoin intelligence + paper execution terminal focused on pump.fun.**

Python 3.11+ · FastAPI · WebSocket · SQLite · Pump.fun · responsive zero-dependency frontend

## Why V5.3 exists

The previous UI had a structural rendering bug: pages were rendered inside another 12-column grid, which squeezed entire tabs into narrow vertical columns. The previous accounting path could also mix USD token prices with SOL capital, producing impossible paper PnL. V5.3 removes both classes of bugs.

### V5.3 industrial fixes

- **Independent position engine** — open positions are refreshed even when they disappear from the scanner.
- **Hard TP/SL evaluation** — TP is evaluated on every fresh quote and closes at the configured threshold.
- **Correct paper accounting** — position value is calculated from price ratios in SOL, preventing impossible $50,000-style PnL from a 0.1 SOL paper position.
- **No zero overwrite** — a failed quote never replaces the last valid price.
- **Quote hierarchy** — Pump.fun coin state → Pump.fun curve + `/sol-price` → DexScreener fallback.
- **Live market enrichment** — DexScreener batch quotes add pool liquidity, 5-minute volume, buys/sells and price change to scanner candidates.
- **Persistent equity monitor** — the graph uses saved, timestamped equity samples instead of reconstructing a line from unrelated totals.
- **Runtime settings** — engine and strategy parameters can be changed and saved while the bot is running; active form drafts survive WebSocket refreshes and page reloads.
- **HFT scalper and runner modes** — the paper scalper ranks the most volatile liquid candidates; the runner takes staged paper profits at 10×, 100× and 1,000× and can keep a remainder for larger moves.
- **Current Pump.fun coin endpoint** — `coins-v2/{mint}` with legacy compatibility fallback.
- **Server-authoritative strategies** — strategy changes are persisted and immediately reflected across every tab.
- **Responsive industrial UI** — Dashboard, Scanner, Strategies, Positions, Activity, Risk, Settings and Diagnostics.
- **Paper BUY from Scanner** — manual paper entry uses the same validated quote path as the engine.
- **Migration guard** — obviously corrupted legacy positions are rejected on startup.
- **15 automated tests** plus Python compile and browser-JavaScript syntax checks.

## Current Pump.fun integration

The current Pump.fun skill documentation describes the backend-only `frontend-api-v3.pump.fun/coins-v2/{mint}` coin-state endpoint and `/sol-price`; the coin-state response includes bonding-curve reserves, graduation state and USD market cap. Pump.fun also publishes SDKs for the bonding curve and PumpSwap AMM.

For a web application, the Pump.fun endpoint must be called by the backend rather than browser-side JavaScript because it is CORS protected.

## Architecture

```text
Pump.fun backend API
       │
       ├── candidate discovery
       ├── coin state / curve reserves
       └── SOL/USD quote
       │
       ▼
┌─────────────────────┐
│  Market Engine      │
│  score + risk       │
└─────────┬───────────┘
          ▼
┌─────────────────────┐       ┌──────────────────────┐
│ Strategy Engine     │──────▶│ Paper Execution      │
│ combo/sniper/etc.   │       │ deterministic ledger │
└─────────────────────┘       └──────────┬───────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ Position Engine      │
                              │ quote → PnL → TP/SL │
                              └──────────┬──────────┘
                                         │
                       FastAPI + WebSocket state bus
                                         │
                                         ▼
                              Responsive frontend
```

## Windows — one-command startup

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -e ".[dev]"
copy .env.example .env
python -m app.main
```

Or double-click:

```text
START_HELIX_WINDOWS.bat
```

Open:

```text
http://127.0.0.1:8088
```

## Pump.fun authentication

Put the current Pump.fun JWT in `.env`:

```env
PUMPFUN_AUTH_TOKEN=YOUR_CURRENT_JWT
```

The JWT is intentionally never persisted into `helix.config.json` and never sent to the frontend.

## Paper trading

V5.3 is **paper execution**. It uses real Pump.fun market data but does not sign or broadcast blockchain transactions. This makes the quote, strategy, TP/SL and accounting paths testable without risking a wallet.

## Strategy control

```text
combo
sniper
momentum
breakout
early-entry
graduation
volatility
liquidity
mean-reversion
hft-scalper
runner
```

`hft-scalper` uses the available REST market feed and is a short-interval paper scalper, not a direct exchange-order-book strategy. `runner` uses a configurable take-profit up to 5,000× and scales out 25% of the remaining position at 10×, 100× and 1,000×.

The exact configured strategy names are exposed by `GET /api/strategy`. Selection uses `POST /api/strategy`.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/state` | complete terminal snapshot |
| `GET /api/strategy` | active strategy + matrix |
| `POST /api/strategy` | change strategy |
| `PUT /api/config` | validated runtime config |
| `POST /api/control` | pause/arm/kill/paper controls |
| `POST /api/paper/buy` | validated paper entry |
| `POST /api/paper/exit` | manual paper exit |
| `POST /api/paper/reset` | reset paper ledger |
| `GET /api/diagnostics/pumpfun` | live provider check |
| `WS /ws` | live UI state stream |

## Quality gates

```powershell
pytest -q
python -m compileall -q app tests
node --check frontend/ui.js
```

## Benchmark context

Current public GitHub projects show that open-source Solana trading bots can attract meaningful developer attention: `warp-id/solana-trading-bot` is currently around 2.3k stars, while Chainstack's pump.fun/bonk.fun bot is around 1k stars. HELIX targets that class of repository quality with clear architecture, tests, documentation, security boundaries and a polished UI — **but no project can honestly guarantee 10,000 stars in one week**.

## Security

- No private key is required for V5.3.
- Default server bind is `127.0.0.1`.
- JWT stays in environment memory.
- No secrets are embedded in the frontend.
- Live transaction signing is intentionally disabled in this release.

## License

MIT.
