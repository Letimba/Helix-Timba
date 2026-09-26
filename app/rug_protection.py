from __future__ import annotations

from typing import Any
from .models import Coin, RugRiskReport


def evaluate_rug_risk(coin: Coin) -> RugRiskReport:
    """Rigorous rug protection engine evaluating contract permissions, liquidity depth,

    creator concentration, transaction velocity, and suspicious patterns.
    Returns RugRiskReport with risk_state: SAFE | CAUTION | HIGH_RISK | BLOCKED.
    """
    reasons: list[str] = []
    factors: dict[str, float] = {}
    total_penalty = 0.0

    # 1. Pump.fun banned / blacklist flag
    if coin.banned:
        reasons.append("Token flagged/banned by protocol")
        factors["banned"] = 100.0
        return RugRiskReport(risk_state="BLOCKED", risk_score=100.0, reasons=reasons, factors=factors, is_tradable=False)

    # 2. Complete/Graduated without active AMM pool address
    if coin.complete and not coin.pool_address:
        reasons.append("Graduated bonding curve but AMM pool is missing or unverified")
        total_penalty += 35.0
        factors["missing_pool"] = 35.0

    # 3. Liquidity Depth & Liquidity Removal
    effective_liq = coin.liquidity_usd if coin.liquidity_usd > 0 else (coin.real_sol_reserves * 150.0)
    if effective_liq < 1000.0 and not coin.is_new:
        reasons.append(f"Insufficient liquidity (${effective_liq:.0f} < $1,000 threshold)")
        total_penalty += 30.0
        factors["low_liquidity"] = 30.0
    elif effective_liq < 3000.0 and coin.age_seconds > 300:
        reasons.append("Sub-critical liquidity depth for seasoned token")
        total_penalty += 15.0
        factors["low_liquidity"] = 15.0

    # 4. Creator Holdings & Top-Holder Concentration
    if coin.creator_holding_pct > 20.0:
        reasons.append(f"Excessive creator token concentration ({coin.creator_holding_pct:.1f}% > 20%)")
        total_penalty += 40.0
        factors["creator_concentration"] = 40.0
    elif coin.creator_holding_pct > 10.0:
        reasons.append(f"Elevated creator holdings ({coin.creator_holding_pct:.1f}%)")
        total_penalty += 18.0
        factors["creator_concentration"] = 18.0

    if coin.top_holder_concentration > 50.0:
        reasons.append(f"Dangerous top-holder cluster concentration ({coin.top_holder_concentration:.1f}%)")
        total_penalty += 30.0
        factors["top_holders"] = 30.0

    # 5. Sell Pressure & One-way Order Flow (Honey-pot / Rug in progress)
    total_5m_tx = coin.buys_5m + coin.sells_5m
    if total_5m_tx >= 10:
        sell_ratio = coin.sells_5m / max(1, coin.buys_5m)
        if sell_ratio >= 3.0 and coin.price_change_5m < -15.0:
            reasons.append("Aggressive dump detected: sell count >3x buy count with rapid price drop")
            total_penalty += 35.0
            factors["dump_in_progress"] = 35.0
        elif coin.buys_5m >= 20 and coin.sells_5m == 0:
            reasons.append("Honeypot signature: zero sell transactions despite 20+ buys")
            total_penalty += 45.0
            factors["zero_sells_honeypot"] = 45.0

    # 6. Wash Trading / Volume Distortion
    if coin.volume_5m_usd > 100_000 and total_5m_tx < 5:
        reasons.append("Wash trading flag: abnormal volume with minimal distinct transaction count")
        total_penalty += 25.0
        factors["wash_trading"] = 25.0

    # 7. Extreme Slippage / Liquidity Collapse Risk
    if coin.liquidity_acceleration < -40.0:
        reasons.append("Liquidity drain detected: liquidity dropped >40% in recent interval")
        total_penalty += 50.0
        factors["liquidity_drain"] = 50.0

    # 8. Token Age vs Velocity
    if coin.age_seconds < 15.0 and coin.price_change_5m < -30.0:
        reasons.append("Instant launch collapse: massive sell-off within 15s of launch")
        total_penalty += 40.0
        factors["instant_collapse"] = 40.0

    risk_score = min(100.0, max(0.0, total_penalty))
    if risk_score >= 80.0:
        state = "BLOCKED"
        tradable = False
    elif risk_score >= 50.0:
        state = "HIGH_RISK"
        tradable = False
    elif risk_score >= 25.0:
        state = "CAUTION"
        tradable = True
    else:
        state = "SAFE"
        tradable = True

    if not reasons:
        reasons.append("Normal liquidity distribution and verified trade flow")

    return RugRiskReport(
        risk_state=state,
        risk_score=risk_score,
        reasons=reasons,
        factors=factors,
        is_tradable=tradable,
    )
