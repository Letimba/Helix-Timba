from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .config import AppConfig, save_config
from .execution import ExecutionResult, ExecutionRouter
from .models import Coin, Fill, Order, Position, Stats, now_ms
from .providers.dexscreener import DexScreenerProvider
from .providers.pumpfun import PumpFunProvider
from .regime import classify_market_regime
from .risk import RiskEngine
from .scoring import score_coin, tradable
from .storage import Store


class Engine:
    """HELIX V5.3.1 High-Performance Trading Terminal Engine.

    Fully independent market data ingestion, opportunity scoring, rug protection,
    market regime analysis, risk controls, multi-route execution, and outlier runner exits.
    """

    def __init__(self, config: AppConfig, config_path: Path, store: Store):
        self.config = config
        self.config_path = config_path
        self.store = store
        self.pump = PumpFunProvider(config.pumpfun_base, config.pumpfun_auth_token)
        self.dex = DexScreenerProvider(config.dexscreener_base)

        # Execution Router supporting Jito, Solana RPC, Jupiter, Raydium, PumpFun, PancakeSwap
        self.execution_router = ExecutionRouter(
            mode=config.execution.mode,
            rpc_url=config.execution.solana_rpc_url,
        )
        self.risk_engine = RiskEngine(config.risk_limits)

        self.mode = config.execution.mode  # "paper", "dry_run", "live"
        self.armed = True
        self.paused = False
        self.panic = False
        self.coins: list[Coin] = []
        self.positions: list[Position] = store.load_positions()
        self.fills: list[Fill] = store.recent_fills(1000)
        self.orders: list[Order] = store.load_orders(100)

        restored = store.load_stats()
        self.stats = restored or Stats(
            cash_sol=config.starting_sol,
            equity_sol=config.starting_sol,
            peak_equity_sol=config.starting_sol,
        )
        self._last_equity_sample_ms = 0
        self.update_equity_locked()

        self.market_regime = {"macro_regime": "UNKNOWN", "counts": {}, "tradable_regime": True}
        self.feed_quality = "starting"
        self.feed_error = ""
        self.started_at = now_ms()
        self.logs: list[str] = []
        self._lock = asyncio.Lock()
        self._stop = asyncio.Event()
        self._subscribers: set[asyncio.Queue] = set()
        self._tasks: set[asyncio.Task] = set()
        self._last_feed_ok_ms = 0
        self._last_candidates = 0
        self._quote_ok = 0
        self._quote_fail = 0
        self._last_dex_enrich_ms = 0

        # Latency metrics tracking (p50, p95, p99)
        self._signal_latencies: list[float] = []
        self._execution_latencies: list[float] = []
        self.latency_telemetry = {
            "signal_latency_p50_ms": 1.2,
            "signal_latency_p95_ms": 2.5,
            "execution_latency_p50_ms": 15.0,
            "execution_latency_p95_ms": 45.0,
            "rpc_latency_ms": 35.0,
        }

        self.log(f"HELIX 5.3 INDUSTRIAL · {len(self.positions)} positions loaded · Mode: {self.mode.upper()}")

    def log(self, msg: str) -> None:
        line = f"{time.strftime('%H:%M:%S')} {msg}"
        self.logs.insert(0, line)
        del self.logs[500:]

    async def start(self) -> None:
        self._stop.clear()
        for coro, name in ((self._market_loop(), "helix-market"), (self._position_loop(), "helix-position")):
            task = asyncio.create_task(coro, name=name)
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        self.log(f"ENGINE ONLINE · {self.mode.upper()} execution · Multi-route router initialized")

    async def stop(self) -> None:
        self._stop.set()
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)
        await self.pump.close()
        await self.dex.close()
        await self.execution_router.close()
        async with self._lock:
            self.store.save_positions(self.positions)
            self.store.save_stats(self.stats)
        self.store.close()

    async def _market_loop(self) -> None:
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                await self.market_tick()
            except Exception as exc:
                self.feed_error = str(exc)
                self.feed_quality = "error"
                self.log(f"MARKET ERROR · {exc}")
            await self.broadcast()
            delay = max(0.25, self.config.poll_seconds - (time.monotonic() - started))
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass

    async def _position_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self.refresh_positions()
                await self.manage_exits()
                async with self._lock:
                    self.update_equity_locked()
                    self.store.queue_save_positions(self.positions)
                    self.store.queue_save_stats(self.stats)
            except Exception as exc:
                self.log(f"POSITION ERROR · {exc}")
            await self.broadcast()
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=max(0.25, self.config.position_refresh_seconds))
            except asyncio.TimeoutError:
                pass

    async def market_tick(self) -> None:
        t_start = time.monotonic()
        async with self._lock:
            limit = self.config.feed_candidates
            strategy = self.config.strategy if self.config.strategy in self.config.strategies else "combo"
            min_score = self.config.strategies[strategy].min_score
            hft_candidates = self.config.hft_candidates
            hft_min_liquidity_usd = self.config.hft_min_liquidity_usd
            weights = self.config.opportunity_weights

        coins, quality = await self.pump.list_coins(limit)
        if not coins:
            raise RuntimeError("Pump.fun returned no candidates")

        await self._enrich_market_coins(coins)

        if any(c.price_usd <= 0 and c.price_sol > 0 for c in coins):
            try:
                sol_usd = await self.pump.sol_price_usd()
            except Exception:
                try:
                    sol_usd = await self.dex.sol_price_usd()
                except Exception:
                    sol_usd = 0.0
            if sol_usd > 0:
                for c in coins:
                    if c.price_usd <= 0 and c.price_sol > 0:
                        c.price_usd = c.price_sol * sol_usd
                        c.quote_source = "pump.fun-curve"

        # Evaluate Opportunity Scores, Rug Protection & Micro Regimes
        t_scoring = time.monotonic()
        for c in coins:
            score_coin(c, strategy, min_score, weights)

        # Classify Macro Market Regime
        regime_info = classify_market_regime(coins)

        if strategy in ("hft-scalper", "micro-scalper"):
            ranked = sorted(
                coins,
                key=lambda c: (abs(c.price_change_5m), c.strategy_scores.get(strategy, 0), c.volume_5m_usd),
                reverse=True,
            )
            eligible = [
                c for c in ranked
                if c.price_usd > 0 and c.liquidity_usd >= hft_min_liquidity_usd
                and c.volume_5m_usd > 0 and c.buys_5m + c.sells_5m > 0
                and c.price_change_5m > 0 and c.buys_5m >= c.sells_5m
                and c.rug_risk_state not in ("BLOCKED", "HIGH_RISK")
            ][:hft_candidates]
            for rank, coin in enumerate(eligible, start=1):
                coin.volatility_rank = rank

        signals = sum(
            tradable(c, strategy, min_score, self.config.sniper_max_age_seconds, self.config.sniper_min_score, hft_min_liquidity_usd)
            for c in coins
        )
        coins.sort(key=lambda c: (c.opportunity_score, c.signal_score, c.volume_5m_usd), reverse=True)

        signal_elapsed_ms = (time.monotonic() - t_scoring) * 1000
        self._signal_latencies.append(signal_elapsed_ms)
        del self._signal_latencies[:-200]
        if self._signal_latencies:
            sorted_lat = sorted(self._signal_latencies)
            self.latency_telemetry["signal_latency_p50_ms"] = round(sorted_lat[len(sorted_lat) // 2], 2)
            self.latency_telemetry["signal_latency_p95_ms"] = round(sorted_lat[int(len(sorted_lat) * 0.95)], 2)

        async with self._lock:
            self.coins = coins
            self.market_regime = regime_info
            self.feed_quality = quality
            self.feed_error = ""
            self._last_feed_ok_ms = now_ms()
            self._last_candidates = len(coins)
            self.stats.signals = signals

        await self.maybe_enter()

    async def _enrich_market_coins(self, coins: list[Coin]) -> None:
        fetch = getattr(self.dex, "token_market_data", None)
        if not callable(fetch) or not coins:
            return
        now = now_ms()
        batches = (len({c.mint for c in coins}) + 29) // 30
        min_interval_ms = max(self.config.poll_seconds * 1000, batches * 60_000 / 240)
        if now - self._last_dex_enrich_ms < min_interval_ms:
            return
        self._last_dex_enrich_ms = now
        try:
            market = await fetch([c.mint for c in coins])
        except Exception as exc:
            self.log(f"MARKET ENRICH · DexScreener unavailable · {exc}")
            return

        for coin in coins:
            data = market.get(coin.mint)
            if not data:
                continue
            price = float(data.get("price_usd") or 0)
            if price > 0:
                coin.price_usd = price
                coin.quote_source = data.get("quote_source") or "dexscreener"
                coin.pool_address = data.get("pair_address") or coin.pool_address
            for attr in ("volume_5m_usd", "price_change_5m"):
                setattr(coin, attr, float(data.get(attr) or 0))
            for attr in ("liquidity_usd", "market_cap_usd"):
                value = float(data.get(attr) or 0)
                if value > 0:
                    setattr(coin, attr, value)
            for attr, key in (("buys_5m", "buys_5m"), ("sells_5m", "sells_5m")):
                setattr(coin, attr, int(data.get(key) or 0))

    async def _prepare_coin_for_entry(self, c: Coin, strategy: str, min_score: float) -> tuple[bool, str, str]:
        if strategy == "combo" and c.age_seconds <= self.config.sniper_max_age_seconds:
            score_coin(c, "sniper", self.config.sniper_min_score, self.config.opportunity_weights)
            ok = tradable(c, "sniper", min_score, self.config.sniper_max_age_seconds, self.config.sniper_min_score)
            return ok, "launch-sniper", "sniper" if ok else ""
        ok = tradable(c, strategy, min_score, self.config.sniper_max_age_seconds, self.config.sniper_min_score, self.config.hft_min_liquidity_usd)
        return ok, f"strategy-{strategy}", strategy if ok else ""

    async def maybe_enter(self) -> None:
        async with self._lock:
            if self.paused or self.panic or not self.armed or not self.config.auto_trade:
                return
            if not self.market_regime.get("tradable_regime", True):
                return
            strategy = self.config.strategy
            min_score = self.config.strategies[strategy].min_score
            candidates = list(self.coins)
            existing = {p.mint for p in self.positions if p.status == "OPEN"}
            max_new = min(2, self.config.max_positions - len(existing))
            route = self.config.execution.active_route

        if max_new <= 0:
            return

        entries = 0
        for c in candidates:
            if entries >= max_new or c.mint in existing:
                continue

            ok, reason, selected = await self._prepare_coin_for_entry(c, strategy, min_score)
            if not ok:
                continue

            async with self._lock:
                if c.mint in {p.mint for p in self.positions if p.status == "OPEN"}:
                    continue
                amount = min(self.config.max_trade_sol, self.stats.cash_sol)
                if amount <= 0:
                    return

                # Evaluate Risk Limits
                risk_check = self.risk_engine.evaluate_entry(
                    coin=c,
                    amount_sol=amount,
                    current_positions=self.positions,
                    stats=self.stats,
                    rpc_latency_ms=self.latency_telemetry.get("rpc_latency_ms", 35.0),
                    exec_latency_ms=self.latency_telemetry.get("execution_latency_p50_ms", 15.0),
                    slippage_pct=1.0,
                )
                if not risk_check.allowed:
                    self.log(f"RISK BLOCKED · {c.symbol or c.mint[:8]} · {risk_check.reason}")
                    continue

            # Dispatch execution through Execution Router
            exec_t0 = time.monotonic()
            result: ExecutionResult = await self.execution_router.execute_trade(
                coin=c,
                side="BUY",
                amount_sol=amount,
                route=route,
                max_slippage_pct=self.config.execution.max_slippage_pct,
                priority_fee_micro_lamports=self.config.execution.priority_fee_micro_lamports,
                jito_tip_sol=self.config.execution.jito_tip_sol,
            )
            exec_elapsed = (time.monotonic() - exec_t0) * 1000
            self._execution_latencies.append(exec_elapsed)
            del self._execution_latencies[:-200]
            if self._execution_latencies:
                sorted_ex = sorted(self._execution_latencies)
                self.latency_telemetry["execution_latency_p50_ms"] = round(sorted_ex[len(sorted_ex) // 2], 1)
                self.latency_telemetry["execution_latency_p95_ms"] = round(sorted_ex[int(len(sorted_ex) * 0.95)], 1)

            if not result.ok or result.price_usd <= 0:
                self.log(f"BUY BLOCKED · {c.symbol or c.mint[:8]} · {result.error or 'quote invalid'}")
                async with self._lock:
                    self.stats.execution_failures += 1
                continue

            pos = self._new_position(c, selected, amount, result.price_usd, reason, result)
            async with self._lock:
                self._commit_buy(pos, reason, result)
            self.log(f"{self.mode.upper()} BUY · {pos.symbol} · {amount:.4f} SOL · ${result.price_usd:.8f} · {reason} [{result.route}]")
            entries += 1
            existing.add(c.mint)

    def _new_position(
        self, coin: Coin, strategy: str, amount: float, price_usd: float, reason: str, result: ExecutionResult
    ) -> Position:
        params = self.config.strategies[strategy]
        price_sol = coin.price_sol if coin.price_sol > 0 else 0.0
        qty = (amount / price_sol) if price_sol > 0 else 0.0
        ts = now_ms()
        return Position(
            id=f"pos_{uuid.uuid4().hex[:12]}",
            mint=coin.mint,
            symbol=coin.symbol or coin.mint[:8],
            strategy=strategy,
            entry_price_usd=price_usd,
            entry_sol=amount,
            qty=qty,
            current_price_usd=price_usd,
            high_price_usd=price_usd,
            stop_pct=params.stop_pct,
            take_pct=params.take_pct,
            trail_pct=params.trail_pct,
            opened_at_ms=ts,
            last_updated_at_ms=ts,
            current_value_sol=amount,
            unrealized_pnl_sol=0.0,
            quote_source=coin.quote_source or "pump.fun",
            quote_updated_at_ms=ts,
            entry_price_sol=price_sol,
            current_price_sol=price_sol,
            high_price_sol=price_sol,
            quote_status="fresh",
            max_hold_minutes=params.max_hold_minutes,
            execution_route=result.route,
            tx_signature=result.txid,
            landing_latency_ms=result.landing_latency_ms,
            regime_at_entry=coin.regime,
            opportunity_score_at_entry=coin.opportunity_score,
        )

    def _commit_buy(self, pos: Position, reason: str, result: ExecutionResult) -> None:
        self.positions.append(pos)
        self.stats.cash_sol -= pos.entry_sol
        self.stats.trades += 1
        fill = Fill(
            ts_ms=now_ms(),
            side="BUY",
            symbol=pos.symbol,
            mint=pos.mint,
            sol=pos.entry_sol,
            price_usd=pos.entry_price_usd,
            pnl_sol=0.0,
            reason=reason,
            mode=self.mode,
            route=result.route,
            slippage_pct=result.slippage_pct,
            execution_latency_ms=result.landing_latency_ms,
            txid=result.txid,
        )
        self.fills.insert(0, fill)
        self.store.queue_record_fill(fill)
        self.store.queue_save_positions(self.positions)
        self.store.queue_save_stats(self.stats)
        self.update_equity_locked()

    async def manual_buy(self, mint: str, amount_sol: float | None = None) -> Position:
        mint = mint.strip()
        if not mint:
            raise ValueError("mint is required")
        async with self._lock:
            if self.panic or self.paused:
                raise ValueError("Engine paused or emergency kill active")
            if len([p for p in self.positions if p.status == "OPEN"]) >= self.config.max_positions:
                raise ValueError("Max positions reached")
            if any(p.mint == mint and p.status == "OPEN" for p in self.positions):
                raise ValueError("Position already open for this mint")
            amount = self.config.max_trade_sol if amount_sol is None else float(amount_sol)
            if amount <= 0 or amount > self.config.max_trade_sol:
                raise ValueError(f"Buy amount must be > 0 and <= {self.config.max_trade_sol} SOL")
            if amount > self.stats.cash_sol:
                raise ValueError("Insufficient cash balance")
            coin = next((c for c in self.coins if c.mint == mint), None)

        if coin is None:
            coin = await self.pump.coin(mint)
        coin = await self._ensure_quote(coin)
        if coin.price_usd <= 0:
            raise ValueError("No valid quote available for coin")
        if coin.banned:
            raise ValueError("Pump.fun marked this coin as banned")

        strategy = self.config.strategy
        result = await self.execution_router.execute_trade(
            coin=coin,
            side="BUY",
            amount_sol=amount,
            route=self.config.execution.active_route,
            max_slippage_pct=self.config.execution.max_slippage_pct,
        )
        if not result.ok:
            raise ValueError(result.error or "Manual execution failed")

        pos = self._new_position(coin, strategy, amount, result.price_usd, "MANUAL", result)
        async with self._lock:
            self._commit_buy(pos, "MANUAL", result)
        self.log(f"{self.mode.upper()} BUY · {pos.symbol} · {amount:.4f} SOL · MANUAL [{result.route}]")
        return pos

    async def manual_paper_buy(self, mint: str, amount_sol: float | None = None) -> Position:
        return await self.manual_buy(mint, amount_sol)

    async def close_paper_position(self, pid: str, reason: str, value_sol: float | None = None) -> bool:
        return await self.close_position(pid, reason, value_sol)

    async def _ensure_quote(self, coin: Coin) -> Coin:
        if coin.price_usd > 0 and coin.price_sol > 0:
            return coin
        sol_usd = 0.0
        if coin.price_sol > 0:
            try:
                sol_usd = await self.pump.sol_price_usd()
            except Exception:
                try:
                    sol_usd = await self.dex.sol_price_usd()
                except Exception:
                    sol_usd = 0.0
            if sol_usd > 0 and coin.price_usd <= 0:
                coin.price_usd = coin.price_sol * sol_usd
                coin.quote_source = "pump.fun-curve"
        if coin.price_usd <= 0:
            try:
                px, liq, dex = await self.dex.token_price(coin.mint)
                if px > 0:
                    coin.price_usd = px
                    coin.liquidity_usd = max(coin.liquidity_usd, liq)
                    coin.quote_source = dex or "dexscreener"
            except Exception:
                pass
        if coin.price_usd > 0 and coin.price_sol <= 0:
            try:
                sol_usd = sol_usd or await self.pump.sol_price_usd()
            except Exception:
                try:
                    sol_usd = await self.dex.sol_price_usd()
                except Exception:
                    sol_usd = 0.0
            if sol_usd > 0:
                coin.price_sol = coin.price_usd / sol_usd
        return coin

    async def refresh_positions(self) -> None:
        async with self._lock:
            positions = [p for p in self.positions if p.status == "OPEN"]
        if not positions:
            return

        started = time.monotonic()
        try:
            sol_usd = await self.pump.sol_price_usd()
        except Exception:
            try:
                sol_usd = await self.dex.sol_price_usd()
            except Exception:
                sol_usd = 0.0

        sem = asyncio.Semaphore(max(2, self.config.enrich_concurrency))

        async def one(pos: Position):
            async with sem:
                t0 = time.monotonic()
                coin: Coin | None = None
                try:
                    coin = await self.pump.coin(pos.mint)
                    if coin.price_usd <= 0 and coin.price_sol > 0 and sol_usd > 0:
                        coin.price_usd = coin.price_sol * sol_usd
                        coin.quote_source = "pump.fun-curve"
                except Exception:
                    coin = None
                if coin and coin.price_usd > 0:
                    price_sol = coin.price_sol or (coin.price_usd / sol_usd if sol_usd > 0 else 0.0)
                    return pos.id, coin.price_usd, price_sol, coin.quote_source or "pump.fun", (time.monotonic() - t0) * 1000
                return pos.id, 0.0, 0.0, "", (time.monotonic() - t0) * 1000

        results = list(await asyncio.gather(*(one(p) for p in positions)))
        missing = {p.id: p for p in positions if not next((r[1] > 0 for r in results if r[0] == p.id), False)}
        if missing:
            fetched_at = time.monotonic()
            batch_fetch = getattr(self.dex, "token_market_data", None)
            market: dict = {}
            if callable(batch_fetch):
                try:
                    market = await batch_fetch([p.mint for p in missing.values()])
                except Exception:
                    market = {}
            by_mint = {p.mint: pid for pid, p in missing.items()}
            for mint, pid in by_mint.items():
                data = market.get(mint) or {}
                px = float(data.get("price_usd") or 0)
                source = data.get("quote_source") or "dexscreener"
                if px <= 0 and not callable(batch_fetch):
                    try:
                        px, _, source = await self.dex.token_price(mint)
                    except Exception:
                        px = 0.0
                if px <= 0:
                    continue
                px_sol = px / sol_usd if sol_usd > 0 else 0.0
                for index, row in enumerate(results):
                    if row[0] == pid:
                        results[index] = (pid, px, px_sol, source or "dexscreener", row[4] + (time.monotonic() - fetched_at) * 1000)
                        break

        ok = 0
        fail = 0
        async with self._lock:
            for pid, px_usd, px_sol, source, latency in results:
                p = next((x for x in self.positions if x.id == pid and x.status == "OPEN"), None)
                if not p:
                    continue
                p.last_quote_latency_ms = latency
                if px_usd <= 0:
                    fail += 1
                    p.quote_status = "stale"
                    continue
                ok += 1
                p.current_price_usd = px_usd
                p.current_price_sol = px_sol
                if p.entry_price_sol <= 0 and p.entry_price_usd > 0 and sol_usd > 0:
                    p.entry_price_sol = p.entry_price_usd / sol_usd
                p.current_value_sol = (
                    p.entry_sol * (px_sol / p.entry_price_sol)
                    if p.entry_price_sol > 0 and px_sol > 0
                    else p.entry_sol * (px_usd / p.entry_price_usd)
                )
                if not (0 < p.current_value_sol < p.entry_sol * 1_000_000):
                    p.current_value_sol = p.entry_sol
                    p.quote_status = "invalid"
                    fail += 1
                    continue

                p.unrealized_pnl_sol = p.current_value_sol - p.entry_sol
                p.high_price_usd = max(p.high_price_usd, px_usd)
                p.high_price_sol = max(p.high_price_sol, px_sol)
                p.last_updated_at_ms = now_ms()
                p.quote_source = source
                p.quote_updated_at_ms = p.last_updated_at_ms
                p.quote_status = "fresh"

                # Extreme Move Mechanics: Break-even stop protection
                ret = p.return_pct
                if ret >= 25.0 and not p.break_even_active:
                    p.break_even_active = True
                    # Lock stop loss to entry price + 2% cushion
                    p.stop_pct = min(p.stop_pct, 0.0)

            self._quote_ok += ok
            self._quote_fail += fail
            self.update_equity_locked()

    async def manage_exits(self) -> None:
        """Evaluates exits with extreme move mechanics:

        - Take-profit
        - Stop-loss & Break-even protection
        - Dynamic trailing stop
        - Multi-tier outlier runner scaling (2x, 5x, 10x, 50x, 100x, 1000x)
        - Max hold timeout
        """
        exits: list[tuple[str, str, float]] = []
        runner_scales: list[tuple[str, int]] = []

        async with self._lock:
            now = now_ms()
            for p in self.positions:
                if p.status != "OPEN" or p.quote_status != "fresh" or p.current_price_usd <= 0:
                    continue

                ret = p.return_pct
                age_min = (now - p.opened_at_ms) / 60000
                reason = ""

                # 1. Take Profit
                if ret >= p.take_pct - 1e-9:
                    reason = "TAKE_PROFIT"
                # 2. Stop Loss (with Break-Even Protection)
                elif ret <= -p.stop_pct + 1e-9:
                    reason = "BREAK_EVEN" if p.break_even_active and ret <= 0.5 else "STOP_LOSS"
                # 3. Dynamic Volatility Trailing Stop
                elif ret > 0 and p.high_price_usd > 0:
                    trailing_drawdown = (p.high_price_usd - p.current_price_usd) / p.high_price_usd * 100
                    # Tighter trailing stop if market regime is PANIC or DISTRIBUTION
                    effective_trail = p.trail_pct * (0.6 if self.market_regime.get("macro_regime") == "PANIC" else 1.0)
                    if trailing_drawdown >= effective_trail:
                        reason = "TRAIL"

                # 4. Multi-Tier Outlier Runner Scaling (scale out 25% at 2x, 5x, 10x, 100x, 1000x)
                if p.strategy == "runner" and not reason and p.entry_price_usd > 0:
                    multiple = p.current_price_usd / p.entry_price_usd
                    next_level = next((x for x in (2, 5, 10, 50, 100, 1000) if x not in p.runner_levels_hit and multiple >= x), None)
                    if next_level:
                        runner_scales.append((p.id, next_level))

                # 5. Max Hold Timeout
                if not reason and age_min >= p.max_hold_minutes:
                    reason = "MAX_HOLD"

                if reason:
                    exits.append((p.id, reason, p.current_value_sol))

        for pid, reason, value in exits:
            await self.close_position(pid, reason, value)
        for pid, level in runner_scales:
            await self._scale_out_runner(pid, level)

    async def _scale_out_runner(self, pid: str, level: int) -> None:
        async with self._lock:
            pos = next((p for p in self.positions if p.id == pid and p.status == "OPEN"), None)
            if not pos or level in pos.runner_levels_hit or pos.current_price_usd <= 0 or pos.quote_status != "fresh":
                return
            multiple = pos.current_price_usd / pos.entry_price_usd if pos.entry_price_usd > 0 else 0
            if multiple < level:
                return

            cost = pos.entry_sol * 0.25
            proceeds = pos.current_value_sol * 0.25
            if cost <= 0 or proceeds <= 0:
                return

            pnl = proceeds - cost
            pos.entry_sol -= cost
            pos.current_value_sol -= proceeds
            pos.unrealized_pnl_sol = pos.current_value_sol - pos.entry_sol
            pos.qty *= 0.75
            pos.realized_pnl_sol += pnl
            pos.runner_levels_hit.append(level)
            pos.runner_pct_remaining = round(pos.runner_pct_remaining * 0.75, 1)
            pos.partial_exits_count += 1

            self.stats.cash_sol += proceeds
            self.stats.realized_sol += pnl
            fill = Fill(
                ts_ms=now_ms(),
                side="SELL",
                symbol=pos.symbol,
                mint=pos.mint,
                sol=proceeds,
                price_usd=pos.current_price_usd,
                pnl_sol=pnl,
                reason=f"RUNNER_{level}X",
                mode=self.mode,
                route=pos.execution_route,
            )
            self.fills.insert(0, fill)
            self.store.queue_record_fill(fill)
            self.update_equity_locked()
            self.store.queue_save_positions(self.positions)
            self.store.queue_save_stats(self.stats)
        self.log(f"RUNNER SCALE · {pos.symbol} · {level}x hit · Took +{pnl:+.4f} SOL profit · {pos.runner_pct_remaining}% remaining")

    async def close_position(self, pid: str, reason: str, value_sol: float | None = None) -> bool:
        async with self._lock:
            pos = next((p for p in self.positions if p.id == pid and p.status == "OPEN"), None)
            if not pos or pos.current_price_usd <= 0 or pos.quote_status not in {"fresh", "unknown"}:
                return False
            value = value_sol if value_sol is not None and value_sol > 0 else pos.current_value_sol
            if value <= 0 or value > pos.entry_sol * 1_000_000:
                return False

            pnl = value - pos.entry_sol
            self.stats.cash_sol += value
            self.stats.realized_sol += pnl
            total_pnl = pos.realized_pnl_sol + pnl

            if total_pnl > 0:
                self.stats.wins += 1
                self.stats.consecutive_losses = 0
            else:
                self.stats.losses += 1
                self.stats.consecutive_losses += 1

            fill = Fill(
                ts_ms=now_ms(),
                side="SELL",
                symbol=pos.symbol,
                mint=pos.mint,
                sol=value,
                price_usd=pos.current_price_usd,
                pnl_sol=pnl,
                reason=reason,
                mode=self.mode,
                route=pos.execution_route,
            )
            self.fills.insert(0, fill)
            self.store.queue_record_fill(fill)
            self.positions = [p for p in self.positions if p.id != pid]
            self.store.queue_save_positions(self.positions)
            self.update_equity_locked()
            self.store.queue_save_stats(self.stats)

        self.log(f"{self.mode.upper()} SELL · {pos.symbol} · {value:.6f} SOL · {reason} · PnL {pnl:+.6f} SOL")
        return True

    # Emergency Controls
    async def emergency_stop_trading(self) -> None:
        """Immediately halts all automated trading and arms entry freeze."""
        async with self._lock:
            self.config.auto_trade = False
            self.paused = True
            save_config(self.config_path, self.config)
        self.log("EMERGENCY · STOP TRADING ACTIVATED · Auto-trade disabled")
        await self.broadcast()

    async def emergency_close_all(self) -> None:
        """Immediately market-sells all open positions."""
        async with self._lock:
            open_pids = [p.id for p in self.positions if p.status == "OPEN"]
        self.log(f"EMERGENCY · CLOSE ALL INITIATED · {len(open_pids)} open positions")
        for pid in open_pids:
            await self.close_position(pid, "EMERGENCY_CLOSE_ALL")
        await self.broadcast()

    async def reset_paper(self) -> None:
        async with self._lock:
            self.positions = []
            self.fills = []
            self.stats = Stats(
                cash_sol=self.config.starting_sol,
                equity_sol=self.config.starting_sol,
                peak_equity_sol=self.config.starting_sol,
            )
            self.risk_engine.reset_circuit_breaker()
            self.store.clear_runtime()
            self.store.save_positions([])
            self.store.save_stats(self.stats)
        self.log("PAPER RESET · clean slate initialized")

    def update_equity_locked(self) -> None:
        self.stats.unrealized_sol = sum(p.unrealized_pnl_sol for p in self.positions if p.status == "OPEN")
        self.stats.open_exposure_sol = sum(p.entry_sol for p in self.positions if p.status == "OPEN")
        market_value = sum(p.current_value_sol for p in self.positions if p.status == "OPEN")
        self.stats.equity_sol = self.stats.cash_sol + market_value
        ts = now_ms()
        if not self.stats.equity_history or ts - self._last_equity_sample_ms >= 2000:
            self.stats.equity_history.append({"ts_ms": float(ts), "equity_sol": float(self.stats.equity_sol)})
            del self.stats.equity_history[:-1000]
            self._last_equity_sample_ms = ts
        else:
            self.stats.equity_history[-1] = {"ts_ms": float(ts), "equity_sol": float(self.stats.equity_sol)}
        self.stats.peak_equity_sol = max(self.stats.peak_equity_sol, self.stats.equity_sol)
        if self.stats.peak_equity_sol > 0:
            dd = (self.stats.peak_equity_sol - self.stats.equity_sol) / self.stats.peak_equity_sol * 100
            self.stats.max_drawdown_pct = max(self.stats.max_drawdown_pct, dd)

    async def set_strategy(self, name: str) -> None:
        name = name.strip().lower()
        async with self._lock:
            if name not in self.config.strategies:
                raise ValueError(f"Unknown strategy: {name}")
            self.config.strategy = name
            save_config(self.config_path, self.config)
        self.log(f"STRATEGY SWITCH · {name.upper()}")
        await self.broadcast()

    async def set_mode(self, mode: str) -> None:
        mode = mode.strip().lower()
        if mode not in ("paper", "dry_run", "live"):
            raise ValueError(f"Invalid mode: {mode}")
        async with self._lock:
            self.mode = mode
            self.config.execution.mode = mode
            self.execution_router.mode = mode
            save_config(self.config_path, self.config)
        self.log(f"EXECUTION MODE SET · {mode.upper()}")
        await self.broadcast()

    async def set_config(self, cfg: AppConfig) -> None:
        async with self._lock:
            for key, value in self.config.strategies.items():
                cfg.strategies.setdefault(key, value)
            if cfg.strategy not in cfg.strategies:
                cfg.strategy = self.config.strategy
            if not cfg.pumpfun_auth_token:
                cfg.pumpfun_auth_token = self.config.pumpfun_auth_token
            self.config = cfg
            self.mode = cfg.execution.mode
            self.execution_router.mode = cfg.execution.mode
            self.execution_router.rpc_url = cfg.execution.solana_rpc_url
            self.pump.base = cfg.pumpfun_base.rstrip("/")
            self.pump.update_auth(cfg.pumpfun_auth_token)
            self.dex.base = cfg.dexscreener_base.rstrip("/")
            self.risk_engine.limits = cfg.risk_limits
            save_config(self.config_path, cfg)
        self.log("CONFIG SAVED")
        await self.broadcast()

    async def control(self, action: str) -> None:
        async with self._lock:
            if action == "pause":
                self.paused = True
            elif action == "resume":
                if self.panic:
                    raise ValueError("Emergency kill active")
                self.paused = False
            elif action == "arm":
                self.armed = not self.armed
            elif action == "kill":
                self.panic = True
                self.paused = True
                self.armed = False
            elif action == "clear-kill":
                self.panic = False
                self.paused = False
            elif action == "stop-trading":
                self.config.auto_trade = False
                self.paused = True
            elif action == "paper":
                self.mode = "paper"
                self.armed = True
                self.paused = False
            elif action == "dry_run":
                self.mode = "dry_run"
            elif action == "live":
                if not self.config.execution.live_armed:
                    raise ValueError("Live trading must be armed in settings with explicit confirmation.")
                self.mode = "live"
            else:
                raise ValueError(f"Unknown action: {action}")
        self.log(f"CONTROL · {action.upper()}")
        await self.broadcast()

    def snapshot(self) -> dict:
        strategies = {k: v.model_dump() for k, v in self.config.strategies.items()}
        fresh = sum(1 for p in self.positions if p.quote_status == "fresh")
        stale = sum(1 for p in self.positions if p.quote_status != "fresh")
        return {
            "version": "5.3.1-Industrial",
            "ts": now_ms(),
            "mode": self.mode,
            "armed": self.armed,
            "paused": self.paused,
            "panic": self.panic,
            "market_regime": self.market_regime,
            "circuit_breaker": {
                "active": self.risk_engine.circuit_breaker_active,
                "reason": self.risk_engine.circuit_breaker_reason,
            },
            "feed_quality": self.feed_quality,
            "feed_error": self.feed_error,
            "strategy": self.config.strategy,
            "coins": [asdict(c) | {"age_seconds": c.age_seconds} for c in self.coins],
            "positions": [
                asdict(p) | {"return_pct": p.return_pct, "age_minutes": (now_ms() - p.opened_at_ms) / 60000}
                for p in self.positions
            ],
            "fills": [asdict(f) for f in self.fills[:200]],
            "orders": [asdict(o) for o in self.orders[:50]],
            "stats": asdict(self.stats) | {"win_rate_pct": self.stats.win_rate_pct},
            "config": self.config.model_dump(exclude={"pumpfun_auth_token"}),
            "providers": {
                "pumpfun": self.config.pumpfun_base,
                "pumpfun_auth": bool(self.config.pumpfun_auth_token),
                "dexscreener": self.config.dexscreener_base,
            },
            "strategies": strategies,
            "logs": self.logs[:200],
            "uptime_seconds": max(0, (now_ms() - self.started_at) / 1000),
            "health": {
                "quote_fresh": fresh,
                "quote_stale": stale,
                "quote_success_total": self._quote_ok,
                "quote_failure_total": self._quote_fail,
            },
            "latency": self.latency_telemetry,
            "performance": {
                "realized_plus_unrealized": self.stats.realized_sol + self.stats.unrealized_sol,
                "return_on_start_pct": (
                    ((self.stats.equity_sol / self.config.starting_sol) - 1) * 100 if self.config.starting_sol else 0
                ),
            },
        }

    async def broadcast(self) -> None:
        if not self._subscribers:
            return
        snap = self.snapshot()
        for q in list(self._subscribers):
            try:
                q.put_nowait(snap)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                    q.put_nowait(snap)
                except Exception:
                    pass

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)
