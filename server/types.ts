export interface OpportunityBreakdown {
  liquidity_quality: number;
  volume_acceleration: number;
  buy_pressure: number;
  price_momentum: number;
  holder_growth: number;
  wallet_quality: number;
  market_cap_acceleration: number;
  liquidity_acceleration: number;
  trend_strength: number;
  execution_quality: number;
  risk_penalty: number;
  composite: number;
}

export interface Coin {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  image_uri: string;
  created_at_ms: number;
  last_trade_at_ms: number;
  complete: boolean;
  banned: boolean;
  venue: string;
  pool_address: string;
  price_usd: number;
  price_sol: number;
  market_cap_usd: number;
  liquidity_usd: number;
  volume_5m_usd: number;
  buys_5m: number;
  sells_5m: number;
  price_change_5m: number;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  real_sol_reserves: number;
  token_total_supply: number;
  is_new: boolean;
  risk_score: number;
  risk_level: string;
  signal_score: number;
  strategy_agreement: number;
  strategy_scores: Record<string, number>;
  source: string;
  observed_at_ms: number;
  quote_source: string;
  volatility_rank: number;
  opportunity_score: number;
  opportunity_breakdown: Record<string, number>;
  rug_risk_state: string;
  rug_reasons: string[];
  regime: string;
  chain: string;
  dex: string;
  transaction_velocity: number;
  volume_acceleration: number;
  price_acceleration: number;
  liquidity_acceleration: number;
  top_holder_concentration: number;
  creator_holding_pct: number;
  age_seconds?: number;
}

export interface Position {
  id: string;
  mint: string;
  symbol: string;
  strategy: string;
  entry_price_usd: number;
  entry_sol: number;
  qty: number;
  current_price_usd: number;
  high_price_usd: number;
  stop_pct: number;
  take_pct: number;
  trail_pct: number;
  opened_at_ms: number;
  last_updated_at_ms: number;
  status: "OPEN" | "CLOSED";
  current_value_sol: number;
  unrealized_pnl_sol: number;
  exit_reason: string;
  quote_source: string;
  quote_updated_at_ms: number;
  entry_price_sol: number;
  current_price_sol: number;
  high_price_sol: number;
  last_quote_latency_ms: number;
  quote_status: string;
  max_hold_minutes: number;
  realized_pnl_sol: number;
  runner_levels_hit: number[];
  break_even_active: boolean;
  trailing_stop_usd: number;
  runner_pct_remaining: number;
  partial_exits_count: number;
  execution_route: string;
  tx_signature: string;
  landing_latency_ms: number;
  regime_at_entry: string;
  opportunity_score_at_entry: number;
  return_pct?: number;
  age_minutes?: number;
}

export interface Fill {
  ts_ms: number;
  side: "BUY" | "SELL";
  symbol: string;
  mint: string;
  sol: number;
  price_usd: number;
  pnl_sol: number;
  reason: string;
  mode: string;
  route: string;
  slippage_pct: number;
  execution_latency_ms: number;
  txid: string;
  failure_class: string;
}

export interface Order {
  id: string;
  mint: string;
  symbol: string;
  side: "BUY" | "SELL";
  amount_sol: number;
  amount_tokens: number;
  price_usd: number;
  slippage_pct: number;
  route: string;
  status: "PENDING" | "SIMULATED" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "CANCELLED";
  mode: "paper" | "dry_run" | "live";
  idempotency_key: string;
  txid: string;
  created_at_ms: number;
  updated_at_ms: number;
  latency_ms: number;
  error: string;
}

export interface Stats {
  signals: number;
  trades: number;
  wins: number;
  losses: number;
  realized_sol: number;
  unrealized_sol: number;
  open_exposure_sol: number;
  cash_sol: number;
  equity_sol: number;
  peak_equity_sol: number;
  max_drawdown_pct: number;
  fees_sol: number;
  consecutive_losses: number;
  execution_failures: number;
  equity_history: Array<{ ts_ms: number; equity_sol: number }>;
  win_rate_pct?: number;
}

export type ExecutionPreset = "safe_slow" | "normal" | "aggressive";

export interface StrategyConfig {
  min_score: number;
  stop_pct: number;
  take_pct: number;
  trail_pct: number;
  max_hold_minutes: number;
}

export type PresetStrategiesMap = Record<ExecutionPreset, Record<string, StrategyConfig>>;

export interface OpportunityWeights {
  liquidity_quality: number;
  volume_acceleration: number;
  buy_pressure: number;
  price_momentum: number;
  holder_growth: number;
  wallet_quality: number;
  market_cap_acceleration: number;
  liquidity_acceleration: number;
  trend_strength: number;
  execution_quality: number;
  risk_penalty: number;
}

export interface RiskLimits {
  max_daily_loss_sol: number;
  max_position_size_sol: number;
  max_portfolio_risk_pct: number;
  max_open_positions: number;
  max_slippage_pct: number;
  max_consecutive_losses: number;
  max_token_risk_score: number;
  max_liquidity_drop_pct: number;
  max_rpc_latency_ms: number;
  max_execution_latency_ms: number;
}

export interface ExecutionConfig {
  mode: "paper" | "dry_run" | "live";
  live_armed: boolean;
  active_route: string;
  solana_rpc_url: string;
  jito_block_engine_url: string;
  jito_tip_sol: number;
  priority_fee_micro_lamports: number;
  max_slippage_pct: number;
  simulate_before_submit: boolean;
  bnb_rpc_url: string;
  pancakeswap_router_address: string;
}

export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  enabled: boolean;
  notify_buy: boolean;
  notify_exit: boolean;
  notify_rug: boolean;
  notify_tp_sl: boolean;
}

export interface AppConfig {
  poll_seconds: number;
  position_refresh_seconds: number;
  starting_sol: number;
  auto_trade: boolean;
  max_positions: number;
  max_trade_sol: number;
  max_daily_loss_sol: number;
  strategy: string;
  active_strategies?: string[];
  trading_preset?: ExecutionPreset;
  preset_strategies?: PresetStrategiesMap;
  sniper_max_age_seconds: number;
  sniper_min_score: number;
  feed_candidates: number;
  enrich_concurrency: number;
  hft_candidates: number;
  hft_min_liquidity_usd: number;
  pumpfun_base: string;
  pumpfun_auth_token: string;
  dexscreener_base: string;
  db_path: string;
  strategies: Record<string, StrategyConfig>;
  opportunity_weights: OpportunityWeights;
  risk_limits: RiskLimits;
  execution: ExecutionConfig;
  telegram?: TelegramConfig;
  pro_tier?: {
    active: boolean;
    plan: "community" | "pro_sniper" | "institutional";
    expires_at_ms: number;
    license_key: string;
  };
}
