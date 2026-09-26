from __future__ import annotations

from math import fabs
from typing import TYPE_CHECKING

from .models import Coin, OpportunityBreakdown
from .regime import classify_coin_regime
from .rug_protection import evaluate_rug_risk

if TYPE_CHECKING:
    from .config import OpportunityWeights


def clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def ratio(a: float, b: float) -> float:
    return a / max(1.0, b)


def compute_opportunity_score(c: Coin, weights: OpportunityWeights | None = None) -> OpportunityBreakdown:
    """Computes the 0-100 Opportunity Score across 11 distinct components:

    1. Liquidity Quality
    2. Volume Acceleration
    3. Buy Pressure
    4. Price Momentum
    5. Holder Growth
    6. Wallet Quality
    7. Market Cap Acceleration
    8. Liquidity Acceleration
    9. Trend Strength
    10. Execution Quality
    11. Risk Penalty
    """
    # 1. Liquidity Quality (0-100)
    eff_liq = c.liquidity_usd if c.liquidity_usd > 0 else (c.real_sol_reserves * 150.0)
    liq_quality = clamp((eff_liq / 50_000.0) * 100.0)

    # 2. Volume Acceleration (0-100)
    vol_accel = clamp(min(c.volume_5m_usd / 40_000.0, 2.5) * 40.0 + max(0.0, c.volume_acceleration * 0.5))

    # 3. Buy Pressure (0-100)
    total_tx = c.buys_5m + c.sells_5m
    if total_tx > 0:
        buy_ratio = c.buys_5m / total_tx
        buy_pressure = clamp(buy_ratio * 100.0 + min(c.buys_5m, 20) * 1.5)
    else:
        buy_pressure = 40.0

    # 4. Price Momentum (0-100)
    price_mom = clamp(50.0 + c.price_change_5m * 2.5 + c.price_acceleration * 1.5)

    # 5. Holder Growth / Distribution (0-100)
    holder_growth = clamp(60.0 - c.top_holder_concentration * 0.5 - c.creator_holding_pct * 0.5)

    # 6. Wallet Quality (0-100)
    wallet_quality = clamp(70.0 if not c.banned else 10.0)

    # 7. Market Cap Acceleration (0-100)
    mc_accel = clamp(min(c.market_cap_usd / 150_000.0, 2.0) * 45.0 + max(0.0, c.price_change_5m * 0.8))

    # 8. Liquidity Acceleration (0-100)
    liq_accel = clamp(50.0 + c.liquidity_acceleration)

    # 9. Trend Strength (0-100)
    trend_strength = clamp(50.0 + (c.price_change_5m * 1.8) + (15.0 if c.buys_5m > c.sells_5m else -15.0))

    # 10. Execution Quality (0-100)
    exec_quality = clamp(85.0 - (15.0 if eff_liq < 3000 else 0.0) - (20.0 if c.price_change_5m > 60 else 0.0))

    # 11. Risk Penalty (0-100, higher means more severe penalty)
    risk_penalty = clamp(c.risk_score)

    # Composite calculation with configurable weights
    w_liq = weights.liquidity_quality if weights else 0.12
    w_vol = weights.volume_acceleration if weights else 0.12
    w_buy = weights.buy_pressure if weights else 0.14
    w_mom = weights.price_momentum if weights else 0.14
    w_hold = weights.holder_growth if weights else 0.08
    w_wal = weights.wallet_quality if weights else 0.08
    w_mc = weights.market_cap_acceleration if weights else 0.08
    w_la = weights.liquidity_acceleration if weights else 0.08
    w_tr = weights.trend_strength if weights else 0.10
    w_ex = weights.execution_quality if weights else 0.06
    w_rp = weights.risk_penalty if weights else 0.15

    raw_score = (
        liq_quality * w_liq
        + vol_accel * w_vol
        + buy_pressure * w_buy
        + price_mom * w_mom
        + holder_growth * w_hold
        + wallet_quality * w_wal
        + mc_accel * w_mc
        + liq_accel * w_la
        + trend_strength * w_tr
        + exec_quality * w_ex
    )
    # Deduct risk penalty proportional to w_rp
    composite = clamp(raw_score - (risk_penalty * w_rp))

    return OpportunityBreakdown(
        liquidity_quality=liq_quality,
        volume_acceleration=vol_accel,
        buy_pressure=buy_pressure,
        price_momentum=price_mom,
        holder_growth=holder_growth,
        wallet_quality=wallet_quality,
        market_cap_acceleration=mc_accel,
        liquidity_acceleration=liq_accel,
        trend_strength=trend_strength,
        execution_quality=exec_quality,
        risk_penalty=risk_penalty,
        composite=composite,
    )


def strategy_scores(c: Coin) -> dict[str, float]:
    """Evaluates all trading strategies from changes.txt:

    1. Launch Sniper
    2. Momentum Ignition
    3. Breakout
    4. Trend Following
    5. Pullback Continuation
    6. Volatility Expansion
    7. Micro Scalper / HFT Scalper
    8. Outlier Runner
    plus auxiliary models (combo, early-entry, graduation, liquidity, mean-reversion).
    """
    flow = c.buys_5m / max(1, c.sells_5m)
    flow_score = clamp(50 + (flow - 1) * 25)
    volume_score = clamp(min(c.volume_5m_usd / 75_000, 2.0) * 50)
    age = c.age_seconds
    sniper_age = 100 - clamp(age / 90 * 100)
    eff_liq = c.liquidity_usd if c.liquidity_usd > 0 else (c.real_sol_reserves * 150.0)
    liq = clamp((eff_liq / 50_000) * 100)
    momentum = clamp(50 + c.price_change_5m * 2.8)
    volatility = clamp(fabs(c.price_change_5m) * 5.0 + volume_score * 0.35)
    graduation = 95 if c.complete else clamp((c.real_sol_reserves / 85) * 100)
    mean_reversion = clamp(70 - c.price_change_5m * 1.6 + flow_score * 0.35)
    breakout = clamp(momentum * 0.65 + volume_score * 0.35)
    early = clamp(sniper_age * 0.55 + flow_score * 0.45)

    # 1. Launch Sniper: fresh tokens with early liquidity and buyer momentum
    sniper = clamp(sniper_age * 0.35 + flow_score * 0.25 + volume_score * 0.15 + liq * 0.25)

    # 4. Trend Following: established directional momentum, strong buy flow, non-extreme change
    trend_following = clamp(
        min(momentum * 0.50 + flow_score * 0.30 + liq * 0.20, 95.0)
        - (25.0 if c.price_change_5m > 80.0 else 0.0)  # avoid late-stage blow-off
    )

    # 5. Pullback Continuation: controlled retracement (-2% to -10%) inside healthy volume/liquidity
    if -12.0 <= c.price_change_5m <= -1.0 and flow >= 0.9 and eff_liq > 5000:
        pullback_continuation = clamp(70.0 + flow_score * 0.25 + volume_score * 0.15)
    else:
        pullback_continuation = clamp(40.0 + flow_score * 0.30)

    # 6. Volatility Expansion: high volume and volatility surge
    volatility_expansion = clamp(fabs(c.price_change_5m) * 3.5 + volume_score * 0.45 + (15.0 if c.buys_5m > c.sells_5m else 0.0))

    # 7. Micro Scalper / HFT Scalper: rapid 5m turnover with positive buyer flow
    micro_scalper = clamp(
        min(fabs(c.price_change_5m) * 4.0, 55.0)
        + min(c.volume_5m_usd / 1000.0, 25.0)
        + min((c.buys_5m + c.sells_5m) / 2.0, 10.0)
        + min(liq * 0.10, 10.0)
    )

    # 8. Outlier Runner: early launch or high breakout with strong liquidity and sustained buyer dominance
    runner = clamp(
        early * 0.25 + flow_score * 0.25 + volume_score * 0.25
        + liq * 0.15 + momentum * 0.10
    )

    return {
        "momentum": momentum,
        "breakout": breakout,
        "trend-following": trend_following,
        "pullback-continuation": pullback_continuation,
        "volatility-expansion": volatility_expansion,
        "micro-scalper": micro_scalper,
        "hft-scalper": micro_scalper,
        "runner": runner,
        "sniper": sniper,
        "early-entry": early,
        "graduation": graduation,
        "volatility": volatility,
        "liquidity": liq,
        "mean-reversion": mean_reversion,
    }


def score_coin(c: Coin, strategy: str, min_score: float, weights: OpportunityWeights | None = None) -> Coin:
    """Full evaluation of rug protection, market regime, opportunity score, and strategy scores."""
    # 1. Rug Protection Check
    rug_report = evaluate_rug_risk(c)
    c.rug_risk_state = rug_report.risk_state
    c.rug_reasons = rug_report.reasons
    c.risk_score = rug_report.risk_score
    c.risk_level = "quarantine" if rug_report.risk_state == "BLOCKED" else rug_report.risk_state.lower()

    # 2. Micro Regime
    c.regime = classify_coin_regime(c)

    # 3. Opportunity Score (11 components)
    opp = compute_opportunity_score(c, weights)
    c.opportunity_score = opp.composite
    c.opportunity_breakdown = opp.to_dict()

    # 4. Strategy Scores
    scores = strategy_scores(c)
    c.strategy_scores = scores

    if strategy == "combo":
        active = [v for v in scores.values() if v >= min_score]
        c.signal_score = clamp(sum(scores.values()) / len(scores) + len(active) * 1.8)
        c.strategy_agreement = len(active)
    else:
        c.signal_score = scores.get(strategy, scores.get("momentum", 0.0))
        c.strategy_agreement = sum(1 for v in scores.values() if v >= min_score)

    c.signal_score = clamp(c.signal_score)
    return c


def tradable(
    c: Coin,
    strategy: str,
    min_score: float,
    sniper_age: int,
    sniper_min_score: float,
    hft_min_liquidity_usd: float = 0.0,
) -> bool:
    """Enforces rug filtering, regime rules, and strategy-specific entry gating."""
    # Rug & Safety Gate
    if c.rug_risk_state in ("BLOCKED", "HIGH_RISK") or c.banned or c.price_usd <= 0:
        return False
    if c.risk_level in ("quarantine", "blocked", "high_risk"):
        return False

    # Regime Gate: avoid dead and panic markets
    if c.regime in ("DEAD", "PANIC"):
        return False

    # Strategy-Specific Rules
    if strategy == "sniper":
        return (
            c.age_seconds <= sniper_age
            and c.signal_score >= sniper_min_score
            and c.strategy_scores.get("sniper", 0) >= sniper_min_score
        )
    if strategy == "combo":
        return c.signal_score >= min_score and c.strategy_agreement >= 2
    if strategy in ("hft-scalper", "micro-scalper"):
        return (
            c.signal_score >= min_score
            and c.liquidity_usd >= hft_min_liquidity_usd
            and c.volume_5m_usd > 0
            and c.buys_5m + c.sells_5m > 0
            and c.price_change_5m > 0
            and c.buys_5m >= c.sells_5m
        )
    if strategy == "trend-following":
        return c.signal_score >= min_score and c.regime in ("TREND", "ACCELERATION")
    if strategy == "breakout":
        return c.signal_score >= min_score and c.regime in ("ACCELERATION", "TREND", "LOW_VOLATILITY")
    if strategy == "runner":
        return c.signal_score >= min_score and c.opportunity_score >= 60.0

    return c.signal_score >= min_score
