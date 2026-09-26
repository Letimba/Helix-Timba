import fs from 'node:fs';
import path from 'node:path';
import { AppConfig, StrategyConfig } from './types.js';
import { DEFAULT_PRESET_MAP, NORMAL_STRATEGIES } from './presets.js';

export const DEFAULT_STRATEGIES: Record<string, StrategyConfig> = { ...NORMAL_STRATEGIES };

export const DEFAULT_CONFIG: AppConfig = {
  poll_seconds: 1.5,
  position_refresh_seconds: 1.0,
  starting_sol: 10.0,
  auto_trade: true,
  max_positions: 15,
  max_trade_sol: 1.00,
  max_daily_loss_sol: 10.00,
  strategy: "trend-following",
  trading_preset: "normal",
  preset_strategies: DEFAULT_PRESET_MAP,
  sniper_max_age_seconds: 60,
  sniper_min_score: 58.0,
  feed_candidates: 80,
  enrich_concurrency: 8,
  hft_candidates: 10,
  hft_min_liquidity_usd: 150000.0,
  pumpfun_base: "https://frontend-api-v3.pump.fun",
  pumpfun_auth_token: "",
  dexscreener_base: "https://api.dexscreener.com",
  db_path: "",
  strategies: DEFAULT_STRATEGIES,
  opportunity_weights: {
    liquidity_quality: 0.12,
    volume_acceleration: 0.12,
    buy_pressure: 0.14,
    price_momentum: 0.14,
    holder_growth: 0.08,
    wallet_quality: 0.08,
    market_cap_acceleration: 0.08,
    liquidity_acceleration: 0.08,
    trend_strength: 0.1,
    execution_quality: 0.06,
    risk_penalty: 0.15
  },
  risk_limits: {
    max_daily_loss_sol: 10.0,
    max_position_size_sol: 1.0,
    max_portfolio_risk_pct: 80.0,
    max_open_positions: 15,
    max_slippage_pct: 2.5,
    max_consecutive_losses: 15,
    max_token_risk_score: 65.0,
    max_liquidity_drop_pct: 30.0,
    max_rpc_latency_ms: 800.0,
    max_execution_latency_ms: 2500.0
  },
  execution: {
    mode: "paper",
    live_armed: false,
    active_route: "pumpfun",
    solana_rpc_url: "https://api.mainnet-beta.solana.com",
    jito_block_engine_url: "https://mainnet.block-engine.jito.wtf",
    jito_tip_sol: 0.001,
    priority_fee_micro_lamports: 100000,
    max_slippage_pct: 2.5,
    simulate_before_submit: true,
    bnb_rpc_url: "https://bsc-dataseed.binance.org",
    pancakeswap_router_address: "0x10ED43C718714eb63d5aA57B78B54704E256024E"
  }
};

const CONFIG_PATH = path.resolve(process.cwd(), 'helix.config.json');

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      const preset = data.trading_preset || "normal";
      const presetStrategies = {
        safe_slow: { ...DEFAULT_PRESET_MAP.safe_slow, ...(data.preset_strategies?.safe_slow || {}) },
        normal: { ...DEFAULT_PRESET_MAP.normal, ...(data.preset_strategies?.normal || {}) },
        aggressive: { ...DEFAULT_PRESET_MAP.aggressive, ...(data.preset_strategies?.aggressive || {}) }
      };

      // Active strategies reflect current preset unless specifically customized
      const currentStrategies = data.strategies || presetStrategies[preset as keyof typeof presetStrategies] || DEFAULT_STRATEGIES;

      return {
        ...DEFAULT_CONFIG,
        ...data,
        trading_preset: preset,
        preset_strategies: presetStrategies,
        strategies: { ...DEFAULT_STRATEGIES, ...currentStrategies },
        opportunity_weights: { ...DEFAULT_CONFIG.opportunity_weights, ...(data.opportunity_weights || {}) },
        risk_limits: { ...DEFAULT_CONFIG.risk_limits, ...(data.risk_limits || {}) },
        execution: { ...DEFAULT_CONFIG.execution, ...(data.execution || {}) }
      };
    }
  } catch (e) {
    console.warn('Error reading config file, falling back to defaults:', e);
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(cfg: AppConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Failed to write helix.config.json:', e);
  }
}
