import asyncio
import json
from pathlib import Path

from app.engine import Engine
from app.models import Coin
from app.storage import Store
from app.config import AppConfig, StrategyConfig


class Pump:
    def __init__(self):
        self.price = 1.0
        self.base = ""
        self.auth_token = ""
    def update_auth(self, token): self.auth_token = token
    async def sol_price_usd(self): return 100.0
    async def list_coins(self, limit=40):
        return [Coin(mint="M1", symbol="TEST", price_usd=self.price, price_sol=self.price/100, is_new=True, buys_5m=20, sells_5m=5, liquidity_usd=50000)], "live"
    async def coin(self, mint):
        return Coin(mint=mint, symbol="TEST", price_usd=self.price, price_sol=self.price/100, is_new=False, buys_5m=20, sells_5m=5, liquidity_usd=50000)
    async def close(self): pass


class Dex:
    async def sol_price_usd(self): return 100.0
    async def token_price(self, mint): return 0.0, 0.0, ""
    async def close(self): pass


def make(tmp: Path):
    cfg=AppConfig(starting_sol=1, max_positions=3, max_trade_sol=.1)
    cfg.strategies["combo"]=StrategyConfig(min_score=20, stop_pct=9, take_pct=22, trail_pct=7, max_hold_minutes=45)
    e=Engine(cfg,tmp/'cfg.json',Store(tmp/'db.sqlite'));e.pump=Pump();e.dex=Dex();return e


def test_exact_tp_and_realistic_pnl(tmp_path):
    e=make(tmp_path); asyncio.run(e.market_tick()); p=e.positions[0]
    assert p.entry_sol == .1
    e.pump.price=p.entry_price_usd*1.22
    asyncio.run(e.refresh_positions())
    assert abs(e.positions[0].unrealized_pnl_sol-.022)<1e-9
    asyncio.run(e.manage_exits())
    assert not e.positions
    assert abs(e.stats.realized_sol-.022)<1e-9
    assert e.fills[0].reason=='TAKE_PROFIT'
    e.store.close()


def test_strategy_switch_allows_each_configured_strategy(tmp_path):
    e=make(tmp_path)
    for name in e.config.strategies:
        asyncio.run(e.set_strategy(name)); assert e.config.strategy==name
    e.store.close()


def test_storage_rejects_impossible_legacy_position(tmp_path):
    db=tmp_path/'db.sqlite'; s=Store(db)
    payload={"id":"bad","mint":"M","symbol":"BAD","strategy":"combo","entry_price_usd":1e-8,"entry_sol":.1,"qty":1,"current_price_usd":1,"high_price_usd":1,"stop_pct":9,"take_pct":22,"trail_pct":7,"opened_at_ms":1,"last_updated_at_ms":1,"current_value_sol":50000}
    s.db.execute("INSERT INTO positions(id,payload) VALUES(?,?)",("bad",json.dumps(payload)));s.db.commit()
    assert s.load_positions()==[]
    s.close()
