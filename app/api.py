from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from .backtest import BacktestEngine
from .config import AppConfig, StrategyConfig
from .engine import Engine


def router(engine: Engine, frontend_path: Path) -> APIRouter:
    r = APIRouter()
    backtester = BacktestEngine(starting_capital_sol=engine.config.starting_sol)

    @r.get("/", response_class=HTMLResponse)
    async def index():
        return frontend_path.read_text(encoding="utf-8")

    @r.get("/api/state")
    async def state():
        return engine.snapshot()

    @r.get("/api/config")
    async def config():
        return engine.snapshot()["config"]

    @r.put("/api/config")
    async def update_config(cfg: AppConfig):
        try:
            await engine.set_config(cfg)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "ok": True,
            "strategy": engine.config.strategy,
            "mode": engine.mode,
            "pumpfun_auth": bool(engine.config.pumpfun_auth_token),
        }

    @r.get("/api/strategy")
    async def strategy_state():
        s = engine.snapshot()
        return {"strategy": s["strategy"], "strategies": s["strategies"]}

    @r.post("/api/strategy")
    async def update_strategy(payload: dict):
        name = str(payload.get("strategy", ""))
        try:
            await engine.set_strategy(name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "strategy": name}

    @r.post("/api/control")
    async def control(payload: dict):
        try:
            await engine.control(str(payload.get("action", "")))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True}

    @r.post("/api/paper/buy")
    async def manual_buy(payload: dict):
        try:
            pos = await engine.manual_buy(str(payload.get("mint", "")), payload.get("amount_sol"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        await engine.broadcast()
        return {"ok": True, "position": pos.__dict__ | {"return_pct": pos.return_pct}}

    @r.post("/api/paper/exit")
    async def manual_exit(payload: dict):
        ok = await engine.close_position(str(payload.get("id", "")), "MANUAL")
        if not ok:
            raise HTTPException(status_code=400, detail="Position not found or quote unavailable")
        await engine.broadcast()
        return {"ok": True}

    @r.post("/api/paper/reset")
    async def reset_paper():
        await engine.reset_paper()
        await engine.broadcast()
        return {"ok": True}

    # Emergency Controls
    @r.post("/api/emergency/stop")
    async def emergency_stop():
        await engine.emergency_stop_trading()
        return {"ok": True, "status": "STOPPED"}

    @r.post("/api/emergency/close-all")
    async def emergency_close_all():
        await engine.emergency_close_all()
        return {"ok": True, "status": "CLOSED_ALL"}

    @r.post("/api/emergency/cancel-all")
    async def emergency_cancel_all():
        engine.log("EMERGENCY · CANCEL ALL PENDING ORDERS")
        await engine.broadcast()
        return {"ok": True, "status": "CANCELLED_ALL"}

    # Backtesting Engine
    @r.post("/api/backtest/run")
    async def run_backtest(payload: dict):
        strategy = str(payload.get("strategy") or engine.config.strategy)
        params_dict = payload.get("parameters")
        params = StrategyConfig(**params_dict) if params_dict else None
        amount = float(payload.get("amount_sol") or engine.config.max_trade_sol)

        try:
            results = backtester.run_backtest(
                strategy_name=strategy,
                params=params,
                trade_amount_sol=amount,
            )
            return {
                "ok": True,
                "strategy": strategy,
                "metrics": results.__dict__,
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Backtest error: {exc}") from exc

    # Wallet Verification & Non-Custodial Preparation
    @r.post("/api/wallet/verify")
    async def verify_wallet(payload: dict):
        address = str(payload.get("address", "")).strip()
        wallet_type = str(payload.get("wallet", "phantom")).lower()
        if not address or len(address) < 32 or len(address) > 44:
            raise HTTPException(status_code=400, detail="Invalid Solana address")

        return {
            "ok": True,
            "address": address,
            "wallet": wallet_type,
            "network": "mainnet-beta",
            "non_custodial": True,
        }

    # Simulation Endpoint
    @r.post("/api/execution/simulate")
    async def simulate_tx(payload: dict):
        mint = str(payload.get("mint", ""))
        side = str(payload.get("side", "BUY"))
        amount = float(payload.get("amount_sol", 0.1))
        route = str(payload.get("route", engine.config.execution.active_route))

        coin = next((c for c in engine.coins if c.mint == mint), None)
        if not coin:
            coin = await engine.pump.coin(mint)

        result = await engine.execution_router.execute_trade(
            coin=coin,
            side=side,
            amount_sol=amount,
            route=route,
        )
        return {
            "ok": result.ok,
            "price_usd": result.price_usd,
            "slippage_pct": result.slippage_pct,
            "route": result.route,
            "landing_latency_ms": result.landing_latency_ms,
            "simulated": True,
        }

    @r.get("/api/diagnostics/pumpfun")
    async def pumpfun_diagnostics():
        try:
            coins, quality = await engine.pump.list_coins(3)
            return {
                "ok": True,
                "quality": quality,
                "count": len(coins),
                "mints": [c.mint for c in coins],
                "auth": bool(engine.config.pumpfun_auth_token),
            }
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @r.get("/api/diagnostics/system")
    async def system_diagnostics():
        s = engine.snapshot()
        return {
            "ok": True,
            "latency": s["latency"],
            "market_regime": s["market_regime"],
            "circuit_breaker": s["circuit_breaker"],
            "health": s["health"],
            "uptime_seconds": s["uptime_seconds"],
        }

    @r.get("/api/health")
    async def health():
        s = engine.snapshot()
        return {
            "ok": True,
            "feed": s["feed_quality"],
            "feed_error": s["feed_error"],
            "positions": len(s["positions"]),
            "strategy": s["strategy"],
            "mode": s["mode"],
            "pumpfun_auth": s["providers"]["pumpfun_auth"],
            "market_regime": s["market_regime"].get("macro_regime", "UNKNOWN"),
            "quote_sources": sorted({p["quote_source"] for p in s["positions"] if p.get("quote_source")}),
        }

    @r.websocket("/ws")
    async def websocket(ws: WebSocket):
        await ws.accept()
        q = engine.subscribe()
        try:
            await ws.send_text(json.dumps(engine.snapshot()))
            while True:
                snap = await q.get()
                await ws.send_text(json.dumps(snap))
        except WebSocketDisconnect:
            pass
        finally:
            engine.unsubscribe(q)

    return r
