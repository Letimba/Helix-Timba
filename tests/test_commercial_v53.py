from __future__ import annotations

import asyncio
from pathlib import Path

from app.backtest import BacktestEngine
from app.config import AppConfig, StrategyConfig
from app.engine import Engine
from app.execution import ExecutionResult, ExecutionRouter, classify_failure
from app.models import Coin, Position, Stats, now_ms
from app.regime import classify_coin_regime, classify_market_regime
from app.risk import RiskEngine
from app.rug_protection import evaluate_rug_risk
from app.scoring import compute_opportunity_score, score_coin, strategy_scores, tradable
from app.storage import Store


def test_all_eight_required_strategies_present():
    c = Coin(
        mint="TEST_MINT",
        symbol="TEST",
        price_usd=0.005,
        price_sol=0.000033,
        liquidity_usd=25000,
        volume_5m_usd=30000,
        buys_5m=40,
        sells_5m=10,
        price_change_5m=12.5,
        created_at_ms=1,
    )
    scores = strategy_scores(c)
    required = [
        "sniper",
        "momentum",
        "breakout",
        "trend-following",
        "pullback-continuation",
        "volatility-expansion",
        "micro-scalper",
        "runner",
    ]
    for req in required:
        assert req in scores, f"Missing required strategy: {req}"
        assert 0.0 <= scores[req] <= 100.0


def test_opportunity_score_eleven_components():
    c = Coin(
        mint="OPP_MINT",
        symbol="OPP",
        price_usd=0.01,
        liquidity_usd=15000,
        volume_5m_usd=25000,
        buys_5m=50,
        sells_5m=20,
        price_change_5m=15.0,
    )
    opp = compute_opportunity_score(c)
    d = opp.to_dict()
    expected_components = [
        "liquidity_quality",
        "volume_acceleration",
        "buy_pressure",
        "price_momentum",
        "holder_growth",
        "wallet_quality",
        "market_cap_acceleration",
        "liquidity_acceleration",
        "trend_strength",
        "execution_quality",
        "risk_penalty",
        "composite",
    ]
    for exp in expected_components:
        assert exp in d
        assert 0.0 <= d[exp] <= 100.0


def test_rug_protection_engine_detects_blocked_and_honeypot():
    # Banned token
    banned_coin = Coin(mint="BANNED", banned=True)
    report_banned = evaluate_rug_risk(banned_coin)
    assert report_banned.risk_state == "BLOCKED"
    assert not report_banned.is_tradable
    assert len(report_banned.reasons) > 0

    # Honeypot: 30 buys, 0 sells
    honeypot_coin = Coin(
        mint="HONEY",
        liquidity_usd=5000,
        buys_5m=30,
        sells_5m=0,
        price_change_5m=20.0,
    )
    report_hp = evaluate_rug_risk(honeypot_coin)
    assert report_hp.risk_score >= 40.0
    assert any("honeypot" in r.lower() for r in report_hp.reasons)

    # Safe token
    safe_coin = Coin(
        mint="SAFE",
        liquidity_usd=50000,
        buys_5m=25,
        sells_5m=20,
        price_change_5m=5.0,
    )
    report_safe = evaluate_rug_risk(safe_coin)
    assert report_safe.risk_state == "SAFE"
    assert report_safe.is_tradable


def test_market_regime_classification():
    # Acceleration coin
    accel_coin = Coin(mint="ACCEL", volume_5m_usd=15000, price_change_5m=25.0, buys_5m=50, sells_5m=15, liquidity_usd=20000)
    assert classify_coin_regime(accel_coin) == "ACCELERATION"

    # Panic coin
    panic_coin = Coin(mint="PANIC", volume_5m_usd=30000, price_change_5m=-45.0, buys_5m=5, sells_5m=50, liquidity_usd=10000)
    assert classify_coin_regime(panic_coin) == "PANIC"

    # Macro regime
    macro = classify_market_regime([accel_coin, panic_coin])
    assert "macro_regime" in macro
    assert "tradable_regime" in macro


def test_risk_engine_hard_limits():
    risk = RiskEngine()
    stats = Stats(cash_sol=5.0, equity_sol=5.0, realized_sol=-0.55)  # Breaches max daily loss 0.50
    coin = Coin(mint="C1", price_usd=1.0)
    res = risk.evaluate_entry(coin, 0.1, [], stats)
    assert not res.allowed
    assert res.breached_limit == "MAX_DAILY_LOSS"
    assert risk.circuit_breaker_active

    # Reset circuit breaker
    risk.reset_circuit_breaker()
    stats_ok = Stats(cash_sol=5.0, equity_sol=5.0, realized_sol=0.1)
    res_ok = risk.evaluate_entry(coin, 0.1, [], stats_ok)
    assert res_ok.allowed


def test_execution_idempotency_and_failure_classification():
    router = ExecutionRouter(mode="paper")
    k1 = router.idempotency.generate_key("MINT_A", "BUY", 0.1)
    k2 = router.idempotency.generate_key("MINT_A", "BUY", 0.1)
    assert k1 == k2

    assert classify_failure("slippage exceeded 2.5%") == "SAFE_TO_RETRY"
    assert classify_failure("Connection timed out after 5000ms") == "UNKNOWN_STATE"
    assert classify_failure("insufficient funds for gas") == "DO_NOT_RETRY"


def test_backtest_engine_metrics_and_monte_carlo():
    bt = BacktestEngine(starting_capital_sol=5.0)
    res = bt.run_backtest(strategy_name="combo")
    assert res.total_trades > 0
    assert res.win_rate_pct >= 0.0
    assert res.profit_factor >= 0.0
    assert len(res.equity_curve) > 0
    assert res.monte_carlo_drawdown_p95 >= 0.0
    assert len(res.trades) > 0


def test_break_even_protection_and_runner_scaling(tmp_path: Path):
    cfg = AppConfig(starting_sol=1.0, max_positions=2, max_trade_sol=0.1, strategy="runner")
    cfg.strategies["runner"] = StrategyConfig(min_score=10, stop_pct=15, take_pct=50000, trail_pct=10, max_hold_minutes=120)
    store = Store(tmp_path / "test_runner.db")
    engine = Engine(cfg, tmp_path / "cfg.json", store)

    pos = Position(
        id="pos_runner",
        mint="M_RUNNER",
        symbol="RUNNER",
        strategy="runner",
        entry_price_usd=1.0,
        entry_sol=0.1,
        qty=100.0,
        current_price_usd=1.0,
        high_price_usd=1.0,
        stop_pct=15.0,
        take_pct=50000.0,
        trail_pct=10.0,
        opened_at_ms=now_ms(),
        last_updated_at_ms=now_ms(),
        current_value_sol=0.1,
    )
    engine.positions.append(pos)

    # Price jumps +30% -> Break-even stop protection should engage
    pos.current_price_usd = 1.30
    pos.current_price_sol = 0.0013
    pos.current_value_sol = 0.13
    pos.high_price_usd = 1.30
    pos.quote_status = "fresh"

    asyncio.run(engine.manage_exits())
    # Should not exit on 30% gain, but runner level 2x not reached yet
    assert len(engine.positions) == 1

    # Price jumps to 2.5x -> Runner scale 2x should trigger partial profit take (25%)
    pos.current_price_usd = 2.50
    pos.current_value_sol = 0.25
    pos.high_price_usd = 2.50

    asyncio.run(engine.manage_exits())
    assert 2 in pos.runner_levels_hit
    assert pos.realized_pnl_sol > 0
    assert engine.stats.realized_sol > 0

    engine.store.close()
