import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { Engine } from './engine.js';
import { runBacktest } from './backtest.js';
import { saveConfig } from './config.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const FRONTEND_DIR = path.resolve(process.cwd(), 'frontend');
const engine = new Engine();

app.use(cors());
app.use(express.json());

// Serve static frontend assets
app.get('/', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.get('/ui.css', (_req, res) => {
  res.setHeader('Content-Type', 'text/css');
  res.sendFile(path.join(FRONTEND_DIR, 'ui.css'));
});

app.get('/ui.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(FRONTEND_DIR, 'ui.js'));
});

// API Routes
app.get('/api/state', (_req, res) => {
  res.json(engine.snapshot());
});

app.get('/api/config', (_req, res) => {
  const snap = engine.snapshot();
  res.json(snap.config);
});

app.put('/api/config', (req, res) => {
  try {
    const newCfg = req.body;
    engine.config = {
      ...engine.config,
      ...newCfg,
      strategies: { ...engine.config.strategies, ...(newCfg.strategies || {}) },
      opportunity_weights: { ...engine.config.opportunity_weights, ...(newCfg.opportunity_weights || {}) },
      risk_limits: { ...engine.config.risk_limits, ...(newCfg.risk_limits || {}) },
      execution: { ...engine.config.execution, ...(newCfg.execution || {}) }
    };
    if (newCfg.execution?.mode) {
      engine.mode = newCfg.execution.mode;
    }
    if (newCfg.pumpfun_auth_token !== undefined) {
      engine.provider.updateAuth(newCfg.pumpfun_auth_token);
    }
    saveConfig(engine.config);
    engine.log('CONFIG SAVED');
    engine.broadcast();
    res.json({
      ok: true,
      strategy: engine.config.strategy,
      mode: engine.mode,
      pumpfun_auth: Boolean(engine.config.pumpfun_auth_token)
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Invalid configuration' });
  }
});

app.get('/api/strategy', (_req, res) => {
  const snap = engine.snapshot();
  res.json({ strategy: snap.strategy, strategies: snap.strategies });
});

app.post('/api/strategy', (req, res) => {
  const name = String(req.body?.strategy || '').trim().toLowerCase();
  if (!name || !engine.config.strategies[name]) {
    res.status(400).json({ error: `Unknown strategy: ${name}` });
    return;
  }
  engine.config.strategy = name;
  saveConfig(engine.config);
  engine.log(`STRATEGY SWITCH · ${name.toUpperCase()}`);
  engine.broadcast();
  res.json({ ok: true, strategy: name, active_strategies: engine.config.active_strategies });
});

app.post('/api/preset', (req, res) => {
  const preset = String(req.body?.preset || '').trim().toLowerCase() as any;
  if (!['safe_slow', 'normal', 'aggressive'].includes(preset)) {
    res.status(400).json({ error: `Unknown preset: ${preset}. Valid options: safe_slow, normal, aggressive` });
    return;
  }

  // Backup current custom strategies to preset_strategies for current preset
  if (!engine.config.preset_strategies) {
    engine.config.preset_strategies = { ...DEFAULT_PRESET_MAP };
  }
  const curPreset = engine.config.trading_preset || 'normal';
  engine.config.preset_strategies[curPreset] = { ...engine.config.strategies };

  // Load new preset
  engine.config.trading_preset = preset;
  engine.config.strategies = {
    ...DEFAULT_PRESET_MAP[preset as keyof typeof DEFAULT_PRESET_MAP],
    ...(engine.config.preset_strategies[preset as keyof typeof DEFAULT_PRESET_MAP] || {})
  };

  saveConfig(engine.config);
  engine.log(`EXECUTION PRESET SWITCH · ${preset.toUpperCase()}`);
  engine.broadcast();
  res.json({ ok: true, preset, strategies: engine.config.strategies });
});

app.post('/api/preset/save-strategy', (req, res) => {
  const preset = String(req.body?.preset || engine.config.trading_preset || 'normal').toLowerCase();
  const strategyName = String(req.body?.strategy || '').toLowerCase();
  const params = req.body?.params;

  if (!['safe_slow', 'normal', 'aggressive'].includes(preset)) {
    res.status(400).json({ error: 'Invalid preset' });
    return;
  }
  if (!strategyName || !engine.config.strategies[strategyName]) {
    res.status(400).json({ error: 'Invalid strategy' });
    return;
  }
  if (!params || typeof params !== 'object') {
    res.status(400).json({ error: 'Invalid params object' });
    return;
  }

  if (!engine.config.preset_strategies) {
    engine.config.preset_strategies = { ...DEFAULT_PRESET_MAP };
  }

  const pKey = preset as keyof typeof DEFAULT_PRESET_MAP;
  if (!engine.config.preset_strategies[pKey]) {
    engine.config.preset_strategies[pKey] = { ...DEFAULT_PRESET_MAP[pKey] };
  }

  engine.config.preset_strategies[pKey][strategyName] = {
    min_score: Number(params.min_score),
    stop_pct: Number(params.stop_pct),
    take_pct: Number(params.take_pct),
    trail_pct: Number(params.trail_pct),
    max_hold_minutes: Number(params.max_hold_minutes)
  };

  // If this preset is currently active, also update active strategies
  if (engine.config.trading_preset === preset) {
    engine.config.strategies[strategyName] = { ...engine.config.preset_strategies[pKey][strategyName] };
  }

  saveConfig(engine.config);
  engine.log(`PRESET STRATEGY UPDATED · [${preset.toUpperCase()}] ${strategyName.toUpperCase()}`);
  engine.broadcast();
  res.json({ ok: true, preset, strategy: strategyName, config: engine.config.preset_strategies[pKey][strategyName] });
});

app.post('/api/strategy/multi-toggle', (req, res) => {
  const name = String(req.body?.strategy || '').trim().toLowerCase();
  if (!name || !engine.config.strategies[name]) {
    res.status(400).json({ error: `Unknown strategy: ${name}` });
    return;
  }
  let actives = engine.config.active_strategies || [engine.config.strategy || 'combo'];
  if (actives.includes(name)) {
    // Cannot disable if it's the only active one
    if (actives.length > 1) {
      actives = actives.filter(s => s !== name);
    }
  } else {
    actives.push(name);
  }
  engine.config.active_strategies = actives;
  saveConfig(engine.config);
  engine.log(`MULTI-STRATEGY TOGGLE · Active: ${actives.join(', ').toUpperCase()}`);
  engine.broadcast();
  res.json({ ok: true, active_strategies: actives });
});

app.post('/api/control', (req, res) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();
    engine.control(action);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Control error' });
  }
});

app.post('/api/paper/buy', (req, res) => {
  try {
    const mint = String(req.body?.mint || '').trim();
    const amount = Number(req.body?.amount_sol) || engine.config.max_trade_sol || 0.1;
    let coin = engine.coins.find(c => c.mint === mint);
    if (!coin) {
      coin = {
        mint: mint || `SimCustom${Date.now()}`,
        name: 'Manual Target',
        symbol: 'TARGET',
        creator: '',
        image_uri: '',
        created_at_ms: Date.now() - 30000,
        last_trade_at_ms: Date.now(),
        complete: false,
        banned: false,
        venue: 'pump.fun',
        pool_address: '',
        price_usd: 0.0001,
        price_sol: 0.0001 / (engine.provider.cachedSolPrice || 145),
        market_cap_usd: 100000,
        liquidity_usd: 50000,
        volume_5m_usd: 15000,
        buys_5m: 25,
        sells_5m: 10,
        price_change_5m: 12.5,
        virtual_sol_reserves: 30,
        virtual_token_reserves: 1000000000,
        real_sol_reserves: 10,
        token_total_supply: 1000000000,
        is_new: false,
        risk_score: 10,
        risk_level: 'SAFE',
        signal_score: 75,
        strategy_agreement: 3,
        strategy_scores: {},
        source: 'pumpfun',
        observed_at_ms: Date.now(),
        quote_source: 'pump.fun',
        volatility_rank: 1,
        opportunity_score: 75,
        opportunity_breakdown: {},
        rug_risk_state: 'SAFE',
        rug_reasons: [],
        regime: 'TREND',
        chain: 'solana',
        dex: 'pump.fun',
        transaction_velocity: 1.5,
        volume_acceleration: 1.2,
        price_acceleration: 0.4,
        liquidity_acceleration: 0.1,
        top_holder_concentration: 12,
        creator_holding_pct: 2
      };
    }
    const pos = engine.openPaperBuy(coin, amount, engine.config.strategy);
    res.json({
      ok: true,
      position: {
        ...pos,
        return_pct: 0
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Buy failed' });
  }
});

app.post('/api/paper/exit', async (req, res) => {
  try {
    const id = String(req.body?.id || '');
    const ok = await engine.closePosition(id, 'MANUAL');
    if (!ok) {
      res.status(400).json({ error: 'Position not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Exit failed' });
  }
});

app.post('/api/paper/reset', (_req, res) => {
  engine.resetPaper();
  res.json({ ok: true });
});

// Emergency controls
app.post('/api/emergency/stop', async (_req, res) => {
  await engine.emergencyStopTrading();
  res.json({ ok: true, status: 'STOPPED' });
});

app.post('/api/emergency/close-all', async (_req, res) => {
  await engine.emergencyCloseAll();
  res.json({ ok: true, status: 'CLOSED_ALL' });
});

app.post('/api/emergency/cancel-all', (_req, res) => {
  engine.log('EMERGENCY · CANCEL ALL PENDING ORDERS');
  engine.broadcast();
  res.json({ ok: true, status: 'CANCELLED_ALL' });
});

// Backtest
app.post('/api/backtest/run', (req, res) => {
  try {
    const strat = String(req.body?.strategy || engine.config.strategy || 'combo');
    const amount = Number(req.body?.amount_sol) || engine.config.max_trade_sol || 0.1;
    const params = req.body?.parameters;
    const results = runBacktest(strat, params, amount, engine.config.starting_sol || 5.0);
    res.json({
      ok: true,
      strategy: strat,
      metrics: results
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Backtest error' });
  }
});

// Wallet Verification
app.post('/api/wallet/verify', (req, res) => {
  const address = String(req.body?.address || '').trim();
  const wallet = String(req.body?.wallet || 'phantom').toLowerCase();
  if (!address || address.length < 32 || address.length > 44) {
    res.status(400).json({ error: 'Invalid Solana address' });
    return;
  }
  res.json({
    ok: true,
    address,
    wallet,
    network: 'mainnet-beta',
    non_custodial: true
  });
});

// Simulation
app.post('/api/execution/simulate', (req, res) => {
  const route = String(req.body?.route || engine.config.execution.active_route || 'pumpfun');
  res.json({
    ok: true,
    price_usd: 0.00012,
    slippage_pct: 0.45,
    route,
    landing_latency_ms: 18.5,
    simulated: true
  });
});

// Telegram integration routes
app.post('/api/telegram/test', async (req, res) => {
  try {
    const token = req.body?.bot_token ? String(req.body.bot_token).trim() : engine.config.telegram?.bot_token;
    const chat = req.body?.chat_id ? String(req.body.chat_id).trim() : engine.config.telegram?.chat_id;

    if (req.body?.bot_token) {
      engine.telegram.updateConfig({ bot_token: token, chat_id: chat });
    }

    const testRes = await engine.telegram.testConnection();
    if (!testRes.ok) {
      res.status(400).json({ ok: false, error: testRes.error });
      return;
    }

    if (chat) {
      await engine.telegram.send('⚡ <b>HELIX 5.4 Industrial</b>\n• Telegram Alert-Verbindung erfolgreich hergestellt!\n• Du erhältst ab sofort Live-Signals & Trade-Benachrichtigungen.');
    }

    res.json({ ok: true, bot_name: testRes.bot_name, message: 'Verbindung erfolgreich' });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'Fehler beim Telegram-Test' });
  }
});

app.post('/api/telegram/config', (req, res) => {
  try {
    const { bot_token, chat_id, enabled, notify_buy, notify_exit, notify_rug, notify_tp_sl } = req.body || {};
    const tgConfig = {
      bot_token: String(bot_token || '').trim(),
      chat_id: String(chat_id || '').trim(),
      enabled: Boolean(enabled),
      notify_buy: notify_buy ?? true,
      notify_exit: notify_exit ?? true,
      notify_rug: notify_rug ?? true,
      notify_tp_sl: notify_tp_sl ?? true
    };

    engine.config.telegram = tgConfig;
    engine.telegram.updateConfig(tgConfig);
    saveConfig(engine.config);
    engine.log(`TELEGRAM CONFIG UPDATED · ${tgConfig.enabled ? 'ENABLED' : 'DISABLED'}`);
    engine.broadcast();
    res.json({ ok: true, telegram: tgConfig });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Fehler beim Speichern' });
  }
});

// Pro Subscription Model routes
app.post('/api/pro/activate', (req, res) => {
  const plan = String(req.body?.plan || 'pro_sniper').toLowerCase() as any;
  const licenseKey = String(req.body?.license_key || `HLX-PRO-${Date.now().toString(36).toUpperCase()}`);
  
  engine.config.pro_tier = {
    active: true,
    plan,
    expires_at_ms: Date.now() + (30 * 24 * 3600 * 1000), // 30 Tage
    license_key: licenseKey
  };
  saveConfig(engine.config);
  engine.log(`PRO TIER ACTIVATED · Plan: ${plan.toUpperCase()}`);
  engine.broadcast();
  res.json({ ok: true, pro_tier: engine.config.pro_tier });
});

// Diagnostics
app.get('/api/diagnostics/pumpfun', async (_req, res) => {
  const { coins, quality } = await engine.provider.listCoins(5);
  res.json({
    ok: true,
    quality,
    count: coins.length,
    mints: coins.map(c => c.mint),
    auth: Boolean(engine.config.pumpfun_auth_token)
  });
});

app.get('/api/diagnostics/system', (_req, res) => {
  const snap = engine.snapshot();
  res.json({
    ok: true,
    latency: snap.latency,
    market_regime: snap.market_regime,
    circuit_breaker: snap.circuit_breaker,
    health: snap.health,
    uptime_seconds: snap.uptime_seconds
  });
});

app.get('/api/health', (_req, res) => {
  const snap = engine.snapshot();
  res.json({
    ok: true,
    feed: snap.feed_quality,
    feed_error: snap.feed_error,
    positions: snap.positions.length,
    strategy: snap.strategy,
    mode: snap.mode,
    pumpfun_auth: snap.providers.pumpfun_auth,
    market_regime: snap.market_regime?.macro_regime || 'UNKNOWN',
    quote_sources: ['pump.fun', 'dexscreener']
  });
});

// WebSocket Handling
wss.on('connection', ws => {
  const listener = (data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  };

  engine.subscribe(listener);

  // Send immediate initial state
  try {
    ws.send(JSON.stringify(engine.snapshot()));
  } catch {
    // ignore
  }

  ws.on('close', () => {
    engine.unsubscribe(listener);
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`HELIX V5.3.1 Trading Terminal running at http://${HOST}:${PORT}`);
  engine.start().catch(e => console.error('Engine start error:', e));
});
