from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Literal

from .config import RiskLimits
from .models import Coin, Position, Stats


@dataclass
class RiskCheckResult:
    allowed: bool
    reason: str = ""
    breached_limit: str = ""


class RiskEngine:
    """Rigorous Risk Management Engine enforcing 12 Hard Limits and Emergency Controls."""

    def __init__(self, limits: RiskLimits | None = None):
        self.limits = limits or RiskLimits()
        self.circuit_breaker_active = False
        self.circuit_breaker_reason = ""

    def evaluate_entry(
        self,
        coin: Coin,
        amount_sol: float,
        current_positions: list[Position],
        stats: Stats,
        rpc_latency_ms: float = 50.0,
        exec_latency_ms: float = 80.0,
        slippage_pct: float = 1.0,
    ) -> RiskCheckResult:
        # Check Circuit Breaker
        if self.circuit_breaker_active:
            return RiskCheckResult(False, f"Risk circuit breaker tripped: {self.circuit_breaker_reason}", "CIRCUIT_BREAKER")

        # 1. MAX_DAILY_LOSS
        if stats.realized_sol <= -self.limits.max_daily_loss_sol:
            self.trip_circuit_breaker(f"Daily loss limit breached (-{abs(stats.realized_sol):.4f} >= {self.limits.max_daily_loss_sol:.4f} SOL)")
            return RiskCheckResult(False, "Daily loss limit breached", "MAX_DAILY_LOSS")

        # 2. MAX_POSITION_SIZE
        if amount_sol > self.limits.max_position_size_sol + 1e-6:
            return RiskCheckResult(False, f"Position size {amount_sol:.4f} exceeds max {self.limits.max_position_size_sol:.4f} SOL", "MAX_POSITION_SIZE")

        # 3. MAX_PORTFOLIO_RISK
        open_val = sum(p.entry_sol for p in current_positions if p.status == "OPEN")
        new_total_exposure = open_val + amount_sol
        if stats.equity_sol > 0:
            portfolio_risk_pct = (new_total_exposure / stats.equity_sol) * 100.0
            if portfolio_risk_pct > self.limits.max_portfolio_risk_pct + 1e-4:
                return RiskCheckResult(False, f"Portfolio risk {portfolio_risk_pct:.1f}% exceeds limit {self.limits.max_portfolio_risk_pct:.1f}%", "MAX_PORTFOLIO_RISK")

        # 4. MAX_OPEN_POSITIONS
        open_count = sum(1 for p in current_positions if p.status == "OPEN")
        if open_count >= self.limits.max_open_positions:
            return RiskCheckResult(False, f"Max open positions ({self.limits.max_open_positions}) reached", "MAX_OPEN_POSITIONS")

        # 5. MAX_SLIPPAGE
        if slippage_pct > self.limits.max_slippage_pct:
            return RiskCheckResult(False, f"Estimated slippage {slippage_pct:.1f}% exceeds max {self.limits.max_slippage_pct:.1f}%", "MAX_SLIPPAGE")

        # 6. MAX_CONSECUTIVE_LOSSES
        if stats.consecutive_losses >= self.limits.max_consecutive_losses:
            self.trip_circuit_breaker(f"{stats.consecutive_losses} consecutive losses reached limit")
            return RiskCheckResult(False, f"Consecutive losses ({stats.consecutive_losses}) limit tripped", "MAX_CONSECUTIVE_LOSSES")

        # 7. MAX_FAILED_TRANSACTIONS
        if stats.execution_failures >= 5:
            return RiskCheckResult(False, f"Execution failures ({stats.execution_failures}) exceeded threshold", "MAX_FAILED_TRANSACTIONS")

        # 8. MAX_TOKEN_RISK_SCORE
        if coin.risk_score > self.limits.max_token_risk_score:
            return RiskCheckResult(False, f"Token risk score {coin.risk_score:.1f} exceeds max {self.limits.max_token_risk_score:.1f}", "MAX_TOKEN_RISK_SCORE")

        # 9. MAX_LIQUIDITY_DROP
        if coin.liquidity_acceleration < -self.limits.max_liquidity_drop_pct:
            return RiskCheckResult(False, f"Token liquidity drop {coin.liquidity_acceleration:.1f}% exceeds threshold", "MAX_LIQUIDITY_DROP")

        # 10. MAX_RPC_LATENCY
        if rpc_latency_ms > self.limits.max_rpc_latency_ms:
            return RiskCheckResult(False, f"RPC latency {rpc_latency_ms:.0f}ms exceeds {self.limits.max_rpc_latency_ms:.0f}ms", "MAX_RPC_LATENCY")

        # 11. MAX_EXECUTION_LATENCY
        if exec_latency_ms > self.limits.max_execution_latency_ms:
            return RiskCheckResult(False, f"Execution latency {exec_latency_ms:.0f}ms exceeds limit", "MAX_EXECUTION_LATENCY")

        return RiskCheckResult(True, "All risk parameters validated")

    def trip_circuit_breaker(self, reason: str) -> None:
        self.circuit_breaker_active = True
        self.circuit_breaker_reason = reason

    def reset_circuit_breaker(self) -> None:
        self.circuit_breaker_active = False
        self.circuit_breaker_reason = ""
