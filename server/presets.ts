import { ExecutionPreset, StrategyConfig, PresetStrategiesMap } from './types.js';

export const SAFE_SLOW_STRATEGIES: Record<string, StrategyConfig> = {
  combo: { min_score: 72.0, stop_pct: 6.0, take_pct: 18.0, trail_pct: 4.0, max_hold_minutes: 35 },
  sniper: { min_score: 75.0, stop_pct: 5.0, take_pct: 20.0, trail_pct: 5.0, max_hold_minutes: 25 },
  momentum: { min_score: 70.0, stop_pct: 7.0, take_pct: 22.0, trail_pct: 5.5, max_hold_minutes: 30 },
  breakout: { min_score: 68.0, stop_pct: 6.0, take_pct: 20.0, trail_pct: 4.5, max_hold_minutes: 45 },
  "early-entry": { min_score: 74.0, stop_pct: 6.0, take_pct: 22.0, trail_pct: 5.0, max_hold_minutes: 30 },
  graduation: { min_score: 70.0, stop_pct: 10.0, take_pct: 50.0, trail_pct: 8.0, max_hold_minutes: 10 },
  volatility: { min_score: 75.0, stop_pct: 8.0, take_pct: 80.0, trail_pct: 10.0, max_hold_minutes: 10 },
  liquidity: { min_score: 65.0, stop_pct: 5.0, take_pct: 15.0, trail_pct: 4.0, max_hold_minutes: 90 },
  "mean-reversion": { min_score: 70.0, stop_pct: 5.0, take_pct: 12.0, trail_pct: 4.0, max_hold_minutes: 40 },
  "hft-scalper": { min_score: 72.0, stop_pct: 5.0, take_pct: 15.0, trail_pct: 4.0, max_hold_minutes: 15 },
  runner: { min_score: 75.0, stop_pct: 6.0, take_pct: 50.0, trail_pct: 8.0, max_hold_minutes: 60 },
  "trend-following": { min_score: 68.0, stop_pct: 8.0, take_pct: 150.0, trail_pct: 7.0, max_hold_minutes: 60 },
  "pullback-continuation": { min_score: 68.0, stop_pct: 8.0, take_pct: 45.0, trail_pct: 6.0, max_hold_minutes: 15 },
  "volatility-expansion": { min_score: 70.0, stop_pct: 8.0, take_pct: 50.0, trail_pct: 7.0, max_hold_minutes: 15 },
  "micro-scalper": { min_score: 72.0, stop_pct: 2.0, take_pct: 4.0, trail_pct: 1.5, max_hold_minutes: 4 }
};

export const NORMAL_STRATEGIES: Record<string, StrategyConfig> = {
  combo: { min_score: 58.0, stop_pct: 10.0, take_pct: 25.0, trail_pct: 8.0, max_hold_minutes: 20 },
  sniper: { min_score: 58.0, stop_pct: 10.0, take_pct: 25.0, trail_pct: 8.0, max_hold_minutes: 20 },
  momentum: { min_score: 58.0, stop_pct: 10.0, take_pct: 25.0, trail_pct: 8.0, max_hold_minutes: 20 },
  breakout: { min_score: 54.0, stop_pct: 9.0, take_pct: 24.0, trail_pct: 7.0, max_hold_minutes: 30 },
  "early-entry": { min_score: 52.0, stop_pct: 10.0, take_pct: 25.0, trail_pct: 8.0, max_hold_minutes: 25 },
  graduation: { min_score: 55.0, stop_pct: 19.6, take_pct: 85.0, trail_pct: 11.0, max_hold_minutes: 5 },
  volatility: { min_score: 55.0, stop_pct: 19.6, take_pct: 500.0, trail_pct: 20.0, max_hold_minutes: 5 },
  liquidity: { min_score: 54.0, stop_pct: 8.0, take_pct: 18.0, trail_pct: 6.0, max_hold_minutes: 60 },
  "mean-reversion": { min_score: 58.0, stop_pct: 8.0, take_pct: 18.0, trail_pct: 6.0, max_hold_minutes: 30 },
  "hft-scalper": { min_score: 58.0, stop_pct: 10.0, take_pct: 25.0, trail_pct: 8.0, max_hold_minutes: 20 },
  runner: { min_score: 58.0, stop_pct: 10.0, take_pct: 25.0, trail_pct: 8.0, max_hold_minutes: 20 },
  "trend-following": { min_score: 55.0, stop_pct: 15.0, take_pct: 1850.0, trail_pct: 11.0, max_hold_minutes: 45 },
  "pullback-continuation": { min_score: 55.0, stop_pct: 19.6, take_pct: 85.0, trail_pct: 11.0, max_hold_minutes: 5 },
  "volatility-expansion": { min_score: 55.0, stop_pct: 19.6, take_pct: 85.0, trail_pct: 11.0, max_hold_minutes: 5 },
  "micro-scalper": { min_score: 58.0, stop_pct: 3.0, take_pct: 5.0, trail_pct: 2.0, max_hold_minutes: 3 }
};

export const AGGRESSIVE_STRATEGIES: Record<string, StrategyConfig> = {
  combo: { min_score: 45.0, stop_pct: 18.0, take_pct: 60.0, trail_pct: 12.0, max_hold_minutes: 15 },
  sniper: { min_score: 42.0, stop_pct: 20.0, take_pct: 100.0, trail_pct: 15.0, max_hold_minutes: 12 },
  momentum: { min_score: 46.0, stop_pct: 18.0, take_pct: 75.0, trail_pct: 12.0, max_hold_minutes: 15 },
  breakout: { min_score: 44.0, stop_pct: 16.0, take_pct: 80.0, trail_pct: 11.0, max_hold_minutes: 20 },
  "early-entry": { min_score: 38.0, stop_pct: 22.0, take_pct: 120.0, trail_pct: 16.0, max_hold_minutes: 15 },
  graduation: { min_score: 45.0, stop_pct: 25.0, take_pct: 250.0, trail_pct: 18.0, max_hold_minutes: 8 },
  volatility: { min_score: 42.0, stop_pct: 28.0, take_pct: 5000.0, trail_pct: 25.0, max_hold_minutes: 8 },
  liquidity: { min_score: 48.0, stop_pct: 14.0, take_pct: 40.0, trail_pct: 9.0, max_hold_minutes: 40 },
  "mean-reversion": { min_score: 48.0, stop_pct: 14.0, take_pct: 35.0, trail_pct: 9.0, max_hold_minutes: 20 },
  "hft-scalper": { min_score: 45.0, stop_pct: 15.0, take_pct: 45.0, trail_pct: 9.0, max_hold_minutes: 10 },
  runner: { min_score: 45.0, stop_pct: 25.0, take_pct: 1000.0, trail_pct: 20.0, max_hold_minutes: 30 },
  "trend-following": { min_score: 44.0, stop_pct: 22.0, take_pct: 3000.0, trail_pct: 16.0, max_hold_minutes: 30 },
  "pullback-continuation": { min_score: 46.0, stop_pct: 22.0, take_pct: 150.0, trail_pct: 14.0, max_hold_minutes: 8 },
  "volatility-expansion": { min_score: 44.0, stop_pct: 24.0, take_pct: 180.0, trail_pct: 15.0, max_hold_minutes: 8 },
  "micro-scalper": { min_score: 48.0, stop_pct: 4.5, take_pct: 8.0, trail_pct: 3.0, max_hold_minutes: 2 }
};

export const DEFAULT_PRESET_MAP: PresetStrategiesMap = {
  safe_slow: SAFE_SLOW_STRATEGIES,
  normal: NORMAL_STRATEGIES,
  aggressive: AGGRESSIVE_STRATEGIES
};
