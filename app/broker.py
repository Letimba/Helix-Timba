from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .models import Coin


@dataclass(frozen=True)
class ExecutionResult:
    ok: bool
    price_usd: float = 0.0
    error: str = ""
    txid: str = ""


class Executor(Protocol):
    async def buy(self, coin: Coin, amount_sol: float) -> ExecutionResult: ...
    async def sell(self, coin: Coin, amount_sol: float) -> ExecutionResult: ...


class PaperExecutor:
    """Deterministic paper broker using the latest server-side quote."""

    async def buy(self, coin: Coin, amount_sol: float) -> ExecutionResult:
        if amount_sol <= 0:
            return ExecutionResult(False, error="amount must be positive")
        if coin.price_usd <= 0:
            return ExecutionResult(False, error="no valid USD quote")
        return ExecutionResult(True, price_usd=coin.price_usd, txid=f"paper-buy-{coin.mint[:8]}")

    async def sell(self, coin: Coin, amount_sol: float) -> ExecutionResult:
        if amount_sol <= 0:
            return ExecutionResult(False, error="amount must be positive")
        if coin.price_usd <= 0:
            return ExecutionResult(False, error="no valid USD quote")
        return ExecutionResult(True, price_usd=coin.price_usd, txid=f"paper-sell-{coin.mint[:8]}")


class LiveExecutorUnavailable:
    async def buy(self, coin: Coin, amount_sol: float) -> ExecutionResult:
        return ExecutionResult(False, error="live executor is intentionally disabled in this release")

    async def sell(self, coin: Coin, amount_sol: float) -> ExecutionResult:
        return ExecutionResult(False, error="live executor is intentionally disabled in this release")
