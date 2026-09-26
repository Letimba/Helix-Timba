from __future__ import annotations

import json
from pathlib import Path
from typing import Dict

from pydantic import AliasChoices, BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


STRATEGIES: Dict[str, dict] = {
    "combo": {"min_score": 55.0, "stop_pct": 9.0, "take_pct": 22.0, "trail_pct": 7.0, "max_hold_minutes": 45},
    "sniper": {"min_score": 58.0, "stop_pct": 10.0, "take_pct": 25.0, "trail_pct": 8.0, "max_hold_minutes": 20},
    "momentum": {"min_score": 55.0, "stop_pct": 9.0, "take_pct": 22.0, "trail_pct": 7.0, "max_hold_minutes": 30},
    "breakout": {"min_score": 54.0, "stop_pct": 9.0, "take_pct": 24.0, "trail_pct": 7.0, "max_hold_minutes": 30},
    "trend-following": {"min_score": 56.0, "stop_pct": 8.0, "take_pct": 28.0, "trail_pct": 6.5, "max_hold_minutes": 60},
    "pullback-continuation": {"min_score": 55.0, "stop_pct": 7.5, "take_pct": 20.0, "trail_pct": 6.0, "max_hold_minutes": 40},
    "volatility-expansion": {"min_score": 60.0, "stop_pct": 11.0, "take_pct": 30.0, "trail_pct": 9.0, "max_hold_minutes": 25},
    "micro-scalper": {"min_score": 58.0, "stop_pct": 3.0, "take_pct": 5.0, "trail_pct": 2.0, "max_hold_minutes": 3},
    "hft-scalper": {"min_score": 58.0, "stop_pct": 3.0, "take_pct": 5.0, "trail_pct": 2.0, "max_hold_minutes": 3},
    "runner": {"min_score": 60.0, "stop_pct": 35.0, "take_pct": 499900.0, "trail_pct": 25.0, "max_hold_minutes": 10080},
    "early-entry": {"min_score": 52.0, "stop_pct": 10.0, "take_pct": 25.0, "trail_pct": 8.0, "max_hold_minutes": 25},
    "graduation": {"min_score": 58.0, "stop_pct": 8.0, "take_pct": 20.0, "trail_pct": 6.0, "max_hold_minutes": 45},
    "liquidity": {"min_score": 54.0, "stop_pct": 8.0, "take_pct": 18.0, "trail_pct": 6.0, "max_hold_minutes": 60},
    "mean-reversion": {"min_score": 58.0, "stop_pct": 8.0, "take_pct": 18.0, "trail_pct": 6.0, "max_hold_minutes": 30},
}


class StrategyConfig(BaseModel):
    min_score: float = 55.0
    stop_pct: float = 9.0
    take_pct: float = 22.0
    trail_pct: float = 7.0
    max_hold_minutes: int = 45


class OpportunityWeights(BaseModel):
    liquidity_quality: float = 0.12
    volume_acceleration: float = 0.12
    buy_pressure: float = 0.14
    price_momentum: float = 0.14
    holder_growth: float = 0.08
    wallet_quality: float = 0.08
    market_cap_acceleration: float = 0.08
    liquidity_acceleration: float = 0.08
    trend_strength: float = 0.10
    execution_quality: float = 0.06
    risk_penalty: float = 0.15


class RiskLimits(BaseModel):
    max_daily_loss_sol: float = 0.50
    max_position_size_sol: float = 0.15
    max_portfolio_risk_pct: float = 10.0
    max_open_positions: int = 8
    max_slippage_pct: float = 2.5
    max_consecutive_losses: int = 5
    max_token_risk_score: float = 65.0
    max_liquidity_drop_pct: float = 30.0
    max_rpc_latency_ms: float = 800.0
    max_execution_latency_ms: float = 2500.0


class ExecutionConfig(BaseModel):
    mode: str = "paper"  # "paper", "dry_run", "live"
    live_armed: bool = False
    active_route: str = "pumpfun"  # "jito", "solana_rpc", "jupiter", "raydium", "pumpfun", "pancakeswap_bnb"
    solana_rpc_url: str = "https://api.mainnet-beta.solana.com"
    jito_block_engine_url: str = "https://mainnet.block-engine.jito.wtf"
    jito_tip_sol: float = 0.001
    priority_fee_micro_lamports: int = 100_000
    max_slippage_pct: float = 2.5
    simulate_before_submit: bool = True
    bnb_rpc_url: str = "https://bsc-dataseed.binance.org"
    pancakeswap_router_address: str = "0x10ED43C718714eb63d5aA57B78B54704E256024E"


class EnvSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_prefix="", case_sensitive=False)
    host: str = Field("127.0.0.1", validation_alias=AliasChoices("HELIX_HOST", "HOST"))
    port: int = Field(8088, validation_alias=AliasChoices("HELIX_PORT", "PORT"))
    pumpfun_base: str = Field("https://frontend-api-v3.pump.fun", validation_alias=AliasChoices("PUMPFUN_BASE", "HELIX_PUMPFUN_BASE"))
    pumpfun_auth_token: str = Field("", validation_alias=AliasChoices("PUMPFUN_AUTH_TOKEN", "HELIX_PUMPFUN_AUTH_TOKEN"))
    dexscreener_base: str = Field("https://api.dexscreener.com", validation_alias=AliasChoices("DEXSCREENER_BASE", "HELIX_DEXSCREENER_BASE"))
    poll_seconds: float = Field(1.5, validation_alias=AliasChoices("POLL_SECONDS", "HELIX_POLL_SECONDS"))
    position_refresh_seconds: float = Field(1.0, validation_alias=AliasChoices("POSITION_REFRESH_SECONDS", "HELIX_POSITION_REFRESH_SECONDS"))
    starting_sol: float = Field(5.0, validation_alias=AliasChoices("STARTING_SOL", "HELIX_STARTING_SOL"))
    auto_trade: bool = Field(True, validation_alias=AliasChoices("AUTO_TRADE", "HELIX_AUTO_TRADE"))
    max_positions: int = Field(8, validation_alias=AliasChoices("MAX_POSITIONS", "HELIX_MAX_POSITIONS"))
    max_trade_sol: float = Field(0.10, validation_alias=AliasChoices("MAX_TRADE_SOL", "HELIX_MAX_TRADE_SOL"))
    max_daily_loss_sol: float = Field(0.50, validation_alias=AliasChoices("MAX_DAILY_LOSS_SOL", "HELIX_MAX_DAILY_LOSS_SOL"))
    strategy: str = Field("combo", validation_alias=AliasChoices("STRATEGY", "HELIX_STRATEGY"))
    sniper_max_age_seconds: int = Field(60, validation_alias=AliasChoices("SNIPER_MAX_AGE_SECONDS", "HELIX_SNIPER_MAX_AGE_SECONDS"))
    sniper_min_score: float = Field(58.0, validation_alias=AliasChoices("SNIPER_MIN_SCORE", "HELIX_SNIPER_MIN_SCORE"))
    min_score: float = Field(55.0, validation_alias=AliasChoices("MIN_SCORE", "HELIX_MIN_SCORE"))
    take_profit_pct: float = Field(22.0, validation_alias=AliasChoices("TAKE_PROFIT_PCT", "HELIX_TAKE_PROFIT_PCT"))
    stop_loss_pct: float = Field(9.0, validation_alias=AliasChoices("STOP_LOSS_PCT", "HELIX_STOP_LOSS_PCT"))
    trail_pct: float = Field(7.0, validation_alias=AliasChoices("TRAIL_PCT", "HELIX_TRAIL_PCT"))
    max_hold_minutes: int = Field(45, validation_alias=AliasChoices("MAX_HOLD_MINUTES", "HELIX_MAX_HOLD_MINUTES"))
    feed_candidates: int = Field(40, validation_alias=AliasChoices("FEED_CANDIDATES", "HELIX_FEED_CANDIDATES"))
    enrich_concurrency: int = Field(8, validation_alias=AliasChoices("ENRICH_CONCURRENCY", "HELIX_ENRICH_CONCURRENCY"))
    hft_candidates: int = Field(5, validation_alias=AliasChoices("HFT_CANDIDATES", "HELIX_HFT_CANDIDATES"))
    hft_min_liquidity_usd: float = Field(10000.0, validation_alias=AliasChoices("HFT_MIN_LIQUIDITY_USD", "HELIX_HFT_MIN_LIQUIDITY_USD"))
    db_path: str = Field("", validation_alias=AliasChoices("HELIX_DB_PATH", "DB_PATH"))
    solana_rpc_url: str = Field("https://api.mainnet-beta.solana.com", validation_alias=AliasChoices("SOLANA_RPC_URL", "HELIX_SOLANA_RPC_URL"))
    trading_mode: str = Field("paper", validation_alias=AliasChoices("TRADING_MODE", "HELIX_TRADING_MODE"))


class AppConfig(BaseModel):
    poll_seconds: float = Field(default=1.5, ge=0.25, le=30)
    position_refresh_seconds: float = Field(default=1.0, ge=0.25, le=30)
    starting_sol: float = Field(default=5.0, gt=0)
    auto_trade: bool = True
    max_positions: int = Field(default=8, ge=1, le=100)
    max_trade_sol: float = Field(default=0.10, gt=0)
    max_daily_loss_sol: float = Field(default=0.50, gt=0)
    strategy: str = "combo"
    sniper_max_age_seconds: int = Field(default=60, ge=5, le=3600)
    sniper_min_score: float = Field(default=58.0, ge=0, le=100)
    feed_candidates: int = Field(default=40, ge=5, le=250)
    enrich_concurrency: int = Field(default=8, ge=1, le=32)
    hft_candidates: int = Field(default=5, ge=1, le=30)
    hft_min_liquidity_usd: float = Field(default=10000.0, ge=0)
    pumpfun_base: str = "https://frontend-api-v3.pump.fun"
    pumpfun_auth_token: str = ""
    dexscreener_base: str = "https://api.dexscreener.com"
    db_path: str = ""
    strategies: dict[str, StrategyConfig] = Field(default_factory=lambda: {k: StrategyConfig(**v) for k, v in STRATEGIES.items()})
    opportunity_weights: OpportunityWeights = Field(default_factory=OpportunityWeights)
    risk_limits: RiskLimits = Field(default_factory=RiskLimits)
    execution: ExecutionConfig = Field(default_factory=ExecutionConfig)


def load_config(path: Path, env: EnvSettings) -> AppConfig:
    cfg = AppConfig(
        poll_seconds=env.poll_seconds,
        position_refresh_seconds=env.position_refresh_seconds,
        starting_sol=env.starting_sol,
        auto_trade=env.auto_trade,
        max_positions=env.max_positions,
        max_trade_sol=env.max_trade_sol,
        max_daily_loss_sol=env.max_daily_loss_sol,
        strategy=env.strategy,
        sniper_max_age_seconds=env.sniper_max_age_seconds,
        sniper_min_score=env.sniper_min_score,
        feed_candidates=env.feed_candidates,
        enrich_concurrency=env.enrich_concurrency,
        hft_candidates=env.hft_candidates,
        hft_min_liquidity_usd=env.hft_min_liquidity_usd,
        pumpfun_base=env.pumpfun_base,
        pumpfun_auth_token=env.pumpfun_auth_token,
        dexscreener_base=env.dexscreener_base,
        db_path=env.db_path,
    )
    if env.take_profit_pct or env.stop_loss_pct or env.trail_pct or env.max_hold_minutes:
        cfg.strategies["combo"] = StrategyConfig(
            min_score=env.min_score,
            stop_pct=env.stop_loss_pct,
            take_pct=env.take_profit_pct,
            trail_pct=env.trail_pct,
            max_hold_minutes=env.max_hold_minutes,
        )
    if env.solana_rpc_url:
        cfg.execution.solana_rpc_url = env.solana_rpc_url
    if env.trading_mode:
        cfg.execution.mode = env.trading_mode
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            cfg = AppConfig.model_validate(data)
            # Config files intentionally do not contain secrets; environment values win.
            if env.pumpfun_auth_token:
                cfg.pumpfun_auth_token = env.pumpfun_auth_token
            if env.db_path:
                cfg.db_path = env.db_path
        except Exception:
            pass
    # Merge defaults so an older config can never remove newer strategy choices.
    for name, defaults in STRATEGIES.items():
        if name not in cfg.strategies:
            cfg.strategies[name] = StrategyConfig(**defaults)
    cfg.strategy = cfg.strategy if cfg.strategy in cfg.strategies else "combo"
    return cfg


def save_config(path: Path, cfg: AppConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = cfg.model_dump()
    # Keep JWTs out of the project config file. .env/environment owns secrets.
    payload["pumpfun_auth_token"] = ""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(path)
