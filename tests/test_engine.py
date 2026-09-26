import asyncio
from pathlib import Path

from app.config import AppConfig, StrategyConfig
from app.engine import Engine
from app.models import Coin
from app.storage import Store


class FakePump:
    def __init__(self):
        self.price = 1.0
        self.base = ""
        self.auth_token = ""
        self.invalid_quote = False

    def update_auth(self, token):
        self.auth_token = token

    async def list_coins(self, limit=40):
        px = 0.0 if self.invalid_quote else self.price
        return [Coin(mint="M1", symbol="HELIX", name="Helix", price_usd=px, market_cap_usd=1e6, liquidity_usd=1e5, buys_5m=30, sells_5m=10, volume_5m_usd=1e5, price_change_5m=5, is_new=True, created_at_ms=1)], "live"

    async def coin(self, mint):
        px = 0.0 if self.invalid_quote else self.price
        return Coin(mint=mint, symbol="HELIX", price_usd=px, market_cap_usd=1e6, liquidity_usd=1e5, buys_5m=30, sells_5m=10, volume_5m_usd=1e5, price_change_5m=5)

    async def close(self):
        pass


class FakeDex:
    def __init__(self):
        self.price = 0.0

    async def token_price(self, mint):
        return self.price, 100000.0 if self.price > 0 else 0.0, "dexscreener" if self.price > 0 else ""

    async def close(self):
        pass


def make_engine(tmp_path: Path) -> Engine:
    cfg = AppConfig(starting_sol=1.0, auto_trade=True, max_positions=2, max_trade_sol=0.1, strategy="combo")
    cfg.strategies["combo"] = StrategyConfig(min_score=20, stop_pct=9, take_pct=22, trail_pct=7, max_hold_minutes=45)
    store = Store(tmp_path / "test.db")
    e = Engine(cfg, tmp_path / "cfg.json", store)
    e.pump = FakePump()
    e.dex = FakeDex()
    return e


def cleanup(e: Engine):
    e.store.close()


def test_strategy_switch_persists(tmp_path):
    e = make_engine(tmp_path)
    asyncio.run(e.set_strategy("sniper"))
    assert e.config.strategy == "sniper"
    assert e.config_path.exists()
    cleanup(e)


def test_take_profit_closes_position_at_exact_boundary(tmp_path):
    e = make_engine(tmp_path)
    asyncio.run(e.market_tick())
    assert len(e.positions) == 1
    pos = e.positions[0]
    e.pump.price = pos.entry_price_usd * 1.22
    asyncio.run(e.refresh_positions())
    asyncio.run(e.manage_exits())
    assert not e.positions
    assert e.stats.realized_sol > 0
    assert e.fills[0].reason == "TAKE_PROFIT"
    cleanup(e)


def test_stop_loss_closes_position(tmp_path):
    e = make_engine(tmp_path)
    asyncio.run(e.market_tick())
    pos = e.positions[0]
    e.pump.price = pos.entry_price_usd * 0.85
    asyncio.run(e.refresh_positions())
    asyncio.run(e.manage_exits())
    assert not e.positions
    assert e.stats.realized_sol < 0
    assert e.fills[0].reason == "STOP_LOSS"
    cleanup(e)


def test_last_good_quote_is_not_overwritten_by_zero(tmp_path):
    e = make_engine(tmp_path)
    asyncio.run(e.market_tick())
    pos = e.positions[0]
    e.pump.invalid_quote = True
    asyncio.run(e.refresh_positions())
    assert e.positions[0].current_price_usd == pos.current_price_usd
    cleanup(e)


def test_dex_quote_fallback_updates_position(tmp_path):
    e = make_engine(tmp_path)
    asyncio.run(e.market_tick())
    e.pump.invalid_quote = True
    e.dex.price = e.positions[0].entry_price_usd * 1.30
    asyncio.run(e.refresh_positions())
    asyncio.run(e.manage_exits())
    assert not e.positions
    assert e.fills[0].reason == "TAKE_PROFIT"
    assert e.fills[0].price_usd > 0
    cleanup(e)


def test_manual_paper_buy_uses_real_scanner_coin(tmp_path):
    e = make_engine(tmp_path)
    asyncio.run(e.market_tick())
    e.config.auto_trade = False
    asyncio.run(e.reset_paper())
    asyncio.run(e.manual_paper_buy("M1", 0.05))
    assert len(e.positions) == 1
    assert e.positions[0].mint == "M1"
    assert e.stats.cash_sol == 0.95
    cleanup(e)


def test_persistence_restores_positions_and_stats(tmp_path):
    e = make_engine(tmp_path)
    asyncio.run(e.market_tick())
    e.stats.cash_sol = 0.9
    e.store.save_positions(e.positions)
    e.store.save_stats(e.stats)
    store2 = Store(tmp_path / "test.db")
    e2 = Engine(e.config, tmp_path / "cfg2.json", store2)
    assert len(e2.positions) == 1
    assert round(e2.stats.cash_sol, 6) == 0.9
    e.store.close()
    e2.store.close()


def test_pumpfun_bonding_curve_price_conversion():
    from app.providers.pumpfun import PumpFunProvider

    coin = Coin(
        mint="M2",
        virtual_sol_reserves=30_000_000_000,
        virtual_token_reserves=1_073_000_000_000_000,
    )
    px = PumpFunProvider.reserve_price_sol(coin)
    assert round(px, 12) == round(30 / 1_073_000_000, 12)


def test_saved_config_does_not_erase_environment_jwt(tmp_path, monkeypatch):
    import json
    from app.config import EnvSettings, load_config, save_config

    cfg_path = tmp_path / "helix.config.json"
    cfg = AppConfig(strategy="momentum")
    save_config(cfg_path, cfg)
    data = json.loads(cfg_path.read_text())
    assert data["pumpfun_auth_token"] == ""
    monkeypatch.setenv("PUMPFUN_AUTH_TOKEN", "JWT_FROM_ENV")
    env = EnvSettings(_env_file=None)
    loaded = load_config(cfg_path, env)
    assert loaded.pumpfun_auth_token == "JWT_FROM_ENV"
    assert loaded.strategy == "momentum"
