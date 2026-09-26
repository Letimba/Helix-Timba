# HELIX V5.3 Industrial Architecture

```text
                    Pump.fun backend
              ┌─────────┼──────────┐
              │         │          │
           /coins   /coins-v2   /sol-price
              │         │          │
              └─────────┴──────────┘
                         │
                         ▼
                 PumpFunProvider
                         │
              ┌──────────┴──────────┐
              │ Market / Scoring     │
              │ Strategy / Risk     │
              └──────────┬──────────┘
                         │
                    Paper Broker
                         │
       ┌─────────────────┴─────────────────┐
       │                                   │
       ▼                                   ▼
Independent Position Engine          FastAPI/WebSocket
       │                                   │
       ├─ Pump.fun coin-state              ▼
       ├─ Pump.fun curve quote        Industrial UI
       ├─ DexScreener fallback             │
       ├─ TP / SL / Trail                   ├─ Dashboard
       └─ SOL accounting                   ├─ Scanner
                                           ├─ Strategies
                                           ├─ Positions
                                           ├─ Activity
                                           ├─ Risk
                                           ├─ Settings
                                           └─ Diagnostics
       │
       ▼
     SQLite
```

## Accounting invariants

- Capital is always stored in **SOL**.
- Display market price is stored in **USD/token**.
- Optional token quote is stored in **SOL/token**.
- Position value uses the ratio of current price to entry price, preventing USD/SOL unit mixing.
- Invalid quotes never overwrite a valid quote.
- Impossible legacy values are rejected on persistence restore.

## Exit invariants

- Position management is independent from scanner membership.
- TP/SL/trailing are evaluated only on a fresh quote.
- TP triggers at the configured return threshold.
- Every position stores the strategy parameters that were active at entry.

## Security invariants

- No private key is required by the default release.
- JWT is backend-only and excluded from the frontend and saved project config.
- Default server bind is localhost.
