from __future__ import annotations

from typing import Iterable
from .models import Coin


def classify_coin_regime(coin: Coin) -> str:
    """Classifies the market micro-regime for a given coin based on price velocity,

    5m volume, buy/sell ratio, and liquidity depth.
    States: DEAD | LOW_VOLATILITY | ACCELERATION | TREND | BLOW_OFF | DISTRIBUTION | PANIC | ILLIQUID | UNKNOWN
    """
    effective_liq = coin.liquidity_usd if coin.liquidity_usd > 0 else (coin.real_sol_reserves * 150.0)
    if effective_liq < 800.0 and not coin.is_new:
        return "ILLIQUID"

    vol = coin.volume_5m_usd
    pct = coin.price_change_5m
    buys = coin.buys_5m
    sells = coin.sells_5m
    total_tx = buys + sells

    # Panic condition
    if pct <= -30.0 and sells > buys * 2:
        return "PANIC"

    # Blow-off top
    if pct >= 120.0 or (pct >= 80.0 and vol > 250_000 and sells > buys * 1.5):
        return "BLOW_OFF"

    # Distribution condition: High volume with rolling over price
    if vol > 50_000 and pct < -5.0 and sells >= buys:
        return "DISTRIBUTION"

    # Acceleration: Rapid expansion in volume and buyers
    if pct >= 15.0 and buys > sells * 1.5 and vol > 5_000:
        return "ACCELERATION"

    # Trend: Solid directional move with balanced/positive buyer flow
    if pct >= 5.0 and buys >= sells and (vol > 2_000 or coin.is_new):
        return "TREND"

    # Dead or Flat
    if vol < 300.0 and total_tx < 3 and abs(pct) < 1.0:
        return "DEAD"

    # Low Volatility: quiet consolidation
    if abs(pct) < 4.0:
        return "LOW_VOLATILITY"

    return "UNKNOWN"


def classify_market_regime(coins: Iterable[Coin]) -> dict:
    """Computes aggregate market regime across all currently observed tokens."""
    coins_list = list(coins)
    if not coins_list:
        return {"macro_regime": "UNKNOWN", "counts": {}, "tradable_regime": True}

    counts: dict[str, int] = {}
    for c in coins_list:
        reg = classify_coin_regime(c)
        c.regime = reg
        counts[reg] = counts.get(reg, 0) + 1

    total = len(coins_list)
    panic_pct = (counts.get("PANIC", 0) + counts.get("DISTRIBUTION", 0)) / total * 100
    accel_pct = counts.get("ACCELERATION", 0) / total * 100
    trend_pct = counts.get("TREND", 0) / total * 100
    dead_pct = counts.get("DEAD", 0) / total * 100

    if panic_pct >= 40.0:
        macro = "PANIC"
        tradable = False
    elif accel_pct >= 25.0:
        macro = "ACCELERATION"
        tradable = True
    elif trend_pct >= 30.0:
        macro = "TREND"
        tradable = True
    elif dead_pct >= 50.0:
        macro = "DEAD"
        tradable = False
    else:
        macro = "TREND" if accel_pct + trend_pct >= 30.0 else "LOW_VOLATILITY"
        tradable = True

    return {
        "macro_regime": macro,
        "counts": counts,
        "tradable_regime": tradable,
        "acceleration_pct": round(accel_pct, 1),
        "panic_pct": round(panic_pct, 1),
    }
