# HELIX Benchmark Notes

Snapshot: 2026-09-26.

## Public repository references

| Repository | Stars shown during research | Relevant benchmark |
|---|---:|---|
| warp-id/solana-trading-bot | ~2.3k | auto-buy/auto-sell, filters, Jito/Warp execution options |
| chainstacklabs/pumpfun-bonkfun-bot | ~1.0k | Python, Pump.fun, Geyser/logs/blocks listeners, regression tests |
| henrytirla/Solana-Trading-Bot | ~288 | Python, Pump.fun/Raydium/Jito |

Stars are a social metric, not a software-quality score. HELIX should compete on reproducibility, tests, UX, documentation and transparent safety boundaries rather than promising a star count.

## Architectural lessons

1. Keep discovery separate from position management.
2. Prefer chain/provider event streams over blind polling for future low-latency execution.
3. Treat quote freshness as a first-class state.
4. Keep accounting units explicit: SOL capital, USD display price, token quantity.
5. Keep secrets out of frontend and project config.
6. Provide regression tests for every trading bug.
