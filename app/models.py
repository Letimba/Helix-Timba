from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal


def now_ms() -> int:
    return int(datetime.now(tz=timezone.utc).timestamp() * 1000)


@dataclass
class OpportunityBreakdown:
    liquidity_quality: float = 0.0
    volume_acceleration: float = 0.0
    buy_pressure: float = 0.0
    price_momentum: float = 0.0
    holder_growth: float = 0.0
    wallet_quality: float = 0.0
    market_cap_acceleration: float = 0.0
    liquidity_acceleration: float = 0.0
    trend_strength: float = 0.0
    execution_quality: float = 0.0
    risk_penalty: float = 0.0
    composite: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "liquidity_quality": round(self.liquidity_quality, 2),
            "volume_acceleration": round(self.volume_acceleration, 2),
            "buy_pressure": round(self.buy_pressure, 2),
            "price_momentum": round(self.price_momentum, 2),
            "holder_growth": round(self.holder_growth, 2),
            "wallet_quality": round(self.wallet_quality, 2),
            "market_cap_acceleration": round(self.market_cap_acceleration, 2),
            "liquidity_acceleration": round(self.liquidity_acceleration, 2),
            "trend_strength": round(self.trend_strength, 2),
            "execution_quality": round(self.execution_quality, 2),
            "risk_penalty": round(self.risk_penalty, 2),
            "composite": round(self.composite, 2),
        }


@dataclass
class RugRiskReport:
    risk_state: Literal["SAFE", "CAUTION", "HIGH_RISK", "BLOCKED"] = "SAFE"
    risk_score: float = 0.0
    reasons: list[str] = field(default_factory=list)
    factors: dict[str, float] = field(default_factory=dict)
    is_tradable: bool = True


@dataclass
class Coin:
    mint: str
    name: str = ""
    symbol: str = ""
    creator: str = ""
    image_uri: str = ""
    created_at_ms: int = 0
    last_trade_at_ms: int = 0
    complete: bool = False
    banned: bool = False
    venue: str = "pump.fun"
    pool_address: str = ""
    price_usd: float = 0.0
    price_sol: float = 0.0
    market_cap_usd: float = 0.0
    liquidity_usd: float = 0.0
    volume_5m_usd: float = 0.0
    buys_5m: int = 0
    sells_5m: int = 0
    price_change_5m: float = 0.0
    virtual_sol_reserves: float = 0.0
    virtual_token_reserves: float = 0.0
    real_sol_reserves: float = 0.0
    token_total_supply: float = 1_000_000_000.0
    is_new: bool = False
    risk_score: float = 0.0
    risk_level: str = "unknown"
    signal_score: float = 0.0
    strategy_agreement: int = 0
    strategy_scores: dict[str, float] = field(default_factory=dict)
    source: str = "pumpfun"
    observed_at_ms: int = 0
    quote_source: str = ""
    volatility_rank: int = 0
    # Enhanced Market Intelligence & Rug Protection
    opportunity_score: float = 0.0
    opportunity_breakdown: dict[str, float] = field(default_factory=dict)
    rug_risk_state: str = "SAFE"
    rug_reasons: list[str] = field(default_factory=list)
    regime: str = "UNKNOWN"
    chain: str = "solana"
    dex: str = "pump.fun"
    transaction_velocity: float = 0.0
    volume_acceleration: float = 0.0
    price_acceleration: float = 0.0
    liquidity_acceleration: float = 0.0
    top_holder_concentration: float = 0.0
    creator_holding_pct: float = 0.0

    @property
    def age_seconds(self) -> float:
        if not self.created_at_ms:
            return 999999.0
        return max(0.0, (now_ms() - self.created_at_ms) / 1000)


@dataclass
class Position:
    id: str
    mint: str
    symbol: str
    strategy: str
    entry_price_usd: float
    entry_sol: float
    qty: float
    current_price_usd: float
    high_price_usd: float
    stop_pct: float
    take_pct: float
    trail_pct: float
    opened_at_ms: int
    last_updated_at_ms: int
    status: Literal["OPEN", "CLOSED"] = "OPEN"
    current_value_sol: float = 0.0
    unrealized_pnl_sol: float = 0.0
    exit_reason: str = ""
    quote_source: str = ""
    quote_updated_at_ms: int = 0
    entry_price_sol: float = 0.0
    current_price_sol: float = 0.0
    high_price_sol: float = 0.0
    last_quote_latency_ms: float = 0.0
    quote_status: str = "unknown"
    max_hold_minutes: int = 45
    realized_pnl_sol: float = 0.0
    runner_levels_hit: list[int] = field(default_factory=list)
    # Extreme Move & Outlier Management
    break_even_active: bool = False
    trailing_stop_usd: float = 0.0
    runner_pct_remaining: float = 100.0
    partial_exits_count: int = 0
    execution_route: str = "paper"
    tx_signature: str = ""
    landing_latency_ms: float = 0.0
    regime_at_entry: str = "UNKNOWN"
    opportunity_score_at_entry: float = 0.0

    @property
    def return_pct(self) -> float:
        if self.entry_price_usd <= 0 or self.current_price_usd <= 0:
            return 0.0
        return (self.current_price_usd / self.entry_price_usd - 1) * 100


@dataclass
class Fill:
    ts_ms: int
    side: str
    symbol: str
    mint: str
    sol: float
    price_usd: float
    pnl_sol: float = 0.0
    reason: str = ""
    mode: str = "paper"
    route: str = "paper"
    slippage_pct: float = 0.0
    execution_latency_ms: float = 0.0
    txid: str = ""
    failure_class: str = ""


@dataclass
class Order:
    id: str
    mint: str
    symbol: str
    side: Literal["BUY", "SELL"]
    amount_sol: float
    amount_tokens: float
    price_usd: float
    slippage_pct: float
    route: str
    status: Literal["PENDING", "SIMULATED", "SUBMITTED", "CONFIRMED", "FAILED", "CANCELLED"] = "PENDING"
    mode: Literal["paper", "dry_run", "live"] = "paper"
    idempotency_key: str = ""
    txid: str = ""
    created_at_ms: int = 0
    updated_at_ms: int = 0
    latency_ms: float = 0.0
    error: str = ""


@dataclass
class Stats:
    signals: int = 0
    trades: int = 0
    wins: int = 0
    losses: int = 0
    realized_sol: float = 0.0
    unrealized_sol: float = 0.0
    open_exposure_sol: float = 0.0
    cash_sol: float = 5.0
    equity_sol: float = 5.0
    peak_equity_sol: float = 5.0
    max_drawdown_pct: float = 0.0
    fees_sol: float = 0.0
    consecutive_losses: int = 0
    execution_failures: int = 0
    equity_history: list[dict[str, float]] = field(default_factory=list)

    @property
    def win_rate_pct(self) -> float:
        n = self.wins + self.losses
        return (self.wins / n * 100) if n else 0.0


@dataclass
class BacktestMetrics:
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    win_rate_pct: float = 0.0
    profit_factor: float = 0.0
    expectancy_sol: float = 0.0
    net_pnl_sol: float = 0.0
    net_return_pct: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    sortino_ratio: float = 0.0
    average_r: float = 0.0
    tail_capture_pct: float = 0.0
    total_fees_sol: float = 0.0
    total_slippage_sol: float = 0.0
    execution_failure_rate_pct: float = 0.0
    average_hold_minutes: float = 0.0
    monte_carlo_drawdown_p95: float = 0.0
    monte_carlo_pnl_p05: float = 0.0
    trades: list[dict[str, Any]] = field(default_factory=list)
    equity_curve: list[dict[str, float]] = field(default_factory=list)
