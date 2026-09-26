import asyncio
from pathlib import Path

import httpx
from fastapi import FastAPI

from app.api import router
from app.config import AppConfig
from app.engine import Engine
from app.models import Coin
from app.storage import Store


class FakePump:
    base = ""
    auth_token = ""

    def update_auth(self, token):
        self.auth_token = token

    async def coin(self, mint):
        return Coin(mint=mint, symbol="API", price_usd=2.0, liquidity_usd=100000, buys_5m=30, sells_5m=10)

    async def close(self):
        pass


class FakeDex:
    async def token_price(self, mint):
        return 0.0, 0.0, ""

    async def close(self):
        pass


async def request(app, method, url, **kwargs):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, url, **kwargs)


def make_app(tmp_path: Path):
    engine = Engine(AppConfig(starting_sol=1, max_trade_sol=0.1), tmp_path / "cfg.json", Store(tmp_path / "db.sqlite"))
    engine.pump = FakePump()
    engine.dex = FakeDex()
    app = FastAPI()
    app.include_router(router(engine, tmp_path / "index.html"))
    return app, engine


def test_strategy_endpoint_is_server_authoritative(tmp_path):
    app, engine = make_app(tmp_path)
    r = asyncio.run(request(app, "POST", "/api/strategy", json={"strategy": "sniper"}))
    assert r.status_code == 200
    assert engine.config.strategy == "sniper"
    cleanup = engine.store.close
    cleanup()


def test_manual_buy_endpoint_creates_position(tmp_path):
    app, engine = make_app(tmp_path)
    engine.coins = [Coin(mint="M1", symbol="API", price_usd=2.0, liquidity_usd=100000)]
    r = asyncio.run(request(app, "POST", "/api/paper/buy", json={"mint": "M1", "amount_sol": 0.05}))
    assert r.status_code == 200
    assert len(engine.positions) == 1
    assert engine.positions[0].entry_price_usd == 2.0
    engine.store.close()


def test_strategy_get_endpoint_is_server_authoritative(tmp_path):
    app, engine = make_app(tmp_path)
    r = asyncio.run(request(app, "GET", "/api/strategy"))
    assert r.status_code == 200
    assert r.json()["strategy"] == engine.config.strategy
    engine.store.close()
