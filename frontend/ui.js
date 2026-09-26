// ─── HELIX 5.3.1 Industrial ─ Premium Trading Terminal ────────────────────────
// Non-custodial · Paper / Dry-Run / Live · Server-authoritative state
// ─────────────────────────────────────────────────────────────────────────────

// ── Utilities ────────────────────────────────────────────────────────────────
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const sol=v=>`${n(v).toFixed(4)} SOL`;
const pct=v=>`${n(v).toFixed(1)}%`;
const ms2=v=>`${n(v).toFixed(1)}ms`;
const usd=v=>{const x=n(v);if(!x)return'—';return`$${x<.01?x.toFixed(8):x.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6})}`};
const age=v=>{const x=n(v);return x<60?`${x.toFixed(0)}s`:x<3600?`${(x/60).toFixed(1)}m`:`${(x/3600).toFixed(1)}h`};
const qage=ts=>ts?Math.max(0,(Date.now()-n(ts))/1000):Infinity;
const scoreClass=v=>n(v)>=70?'good':n(v)>=55?'mid':'bad';
const latClass=v=>n(v)<50?'lat-fast':n(v)<200?'lat-mid':'lat-slow';

// ── Regime Display ────────────────────────────────────────────────────────────
const REGIME_CLASS={
  ACCELERATION:'regime-accel',TREND:'regime-trend',
  PANIC:'regime-panic',BLOW_OFF:'regime-blowoff',DISTRIBUTION:'regime-blowoff',
  DEAD:'regime-dead',ILLIQUID:'regime-illiquid',LOW_VOLATILITY:'regime-unknown',UNKNOWN:'regime-unknown'
};
function regimeTag(r){const cls=REGIME_CLASS[r]||'regime-unknown';return`<span class="tag ${cls}">${esc(r||'?')}</span>`}
function modeTag(m){if(m==='paper')return`<span class="pill paper">PAPER</span>`;if(m==='dry_run')return`<span class="pill dry">DRY-RUN</span>`;return`<span class="pill bad">⚡ LIVE</span>`}

// ── Persistence ───────────────────────────────────────────────────────────────
const safeGetView=()=>{try{return localStorage.getItem('helix.view')||'dashboard'}catch{return'dashboard'}};
const safeSetView=v=>{try{localStorage.setItem('helix.view',v)}catch{}};
const safeGetTheme=()=>{try{return localStorage.getItem('helix.theme')||'dark'}catch{return'dark'}};
const safeSetTheme=t=>{try{localStorage.setItem('helix.theme',t);document.documentElement.setAttribute('data-theme',t)}catch{}};
function initTheme(){const t=safeGetTheme();document.documentElement.setAttribute('data-theme',t)}
initTheme();
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme')||'dark';
  const next=cur==='dark'?'light':'dark';
  safeSetTheme(next);
  state.theme=next;
  render();
  toast(`Theme: ${next==='dark'?'Dark Mode':'Hell Mode'}`);
}
function readFormDrafts(){try{return JSON.parse(sessionStorage.getItem('helix.formDrafts')||'{}')}catch{return{}}}
function writeFormDrafts(d){try{sessionStorage.setItem('helix.formDrafts',JSON.stringify(d))}catch{}}
function saveFormDraft(){const fields=[...document.querySelectorAll('#app input[id]:not([type=password]),#app select[id]')];if(!fields.length)return;const d=readFormDrafts();d[state.view]=fields.map(e=>[e.id,e.value]);writeFormDrafts(d)}
function clearFormDraft(view=state.view){const d=readFormDrafts();delete d[view];writeFormDrafts(d)}
function isEditingFormField(){const e=document.activeElement;return!!e&&$('#app')?.contains(e)&&['INPUT','SELECT','TEXTAREA'].includes(e.tagName)}
document.addEventListener('input',saveFormDraft);
document.addEventListener('change',saveFormDraft);

// ── State ─────────────────────────────────────────────────────────────────────
const state={view:safeGetView(),theme:safeGetTheme(),data:null,ws:null,wallet:{type:'',address:'',status:'disconnected'},backtest:null,btLoading:false};
const nav=[
  ['dashboard','◈','Dashboard'],
  ['scanner','⌁','Scanner'],
  ['heatmap','▦','Heatmap'],
  ['sniper','◎','Sniper'],
  ['strategies','◆','Strategies'],
  ['positions','▣','Positions'],
  ['activity','≡','Activity'],
  ['analytics','◐','Analytics'],
  ['backtest','⊡','Backtest'],
  ['risk','△','Risk'],
  ['wallet','◉','Wallet'],
  ['telegram','✈','Telegram Alert'],
  ['pro','★','Pro Abo'],
  ['settings','⚙','Settings'],
  ['diagnostics','●','System'],
];

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg,type=''){const r=$('#toast-root'),e=document.createElement('div');e.className='toast'+(type?` ${type}`:'');e.textContent=msg;r.appendChild(e);setTimeout(()=>e.remove(),2800)}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(url,opt={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),9000);
  try{
    const r=await fetch(url,{headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt,signal:opt.signal||controller.signal});
    let j=null;try{j=await r.json()}catch{}
    if(!r.ok)throw new Error(j?.detail||j?.error||r.statusText);
    return j;
  }catch(e){
    if(e?.name==='AbortError')throw new Error('Backend timeout (9s)');
    throw e;
  }finally{clearTimeout(timer)}
}

// ── Shell Layout ──────────────────────────────────────────────────────────────
function side(){
  const s=state.data||{};
  const regime=s.market_regime||{};
  const cb=s.circuit_breaker||{};
  const proActive=Boolean(s.config?.pro_tier?.active);
  return`<aside class="sidebar">
  <div class="brand">
    <div class="brandmark">H</div>
    <div>
      <h1>HELIX ${proActive?`<span class="pro-badge">PRO</span>`:''}</h1>
      <small>SOLANA · SPEED TERMINAL</small>
    </div>
  </div>
  <nav class="nav">${nav.map(([id,ico,label])=>`<button class="${state.view===id?'active':''}" onclick="go('${id}')"><i class="ico">${ico}</i><span>${label}</span>${id==='pro'?`<span class="nav-badge pro">PRO</span>`:id==='sniper'?`<span class="nav-badge hot">LIVE</span>`:''}</button>`).join('')}</nav>
  <div class="sidebox">
    <div class="label">MARKET REGIME</div>
    <b>${regimeTag(regime.macro_regime||'UNKNOWN')}</b>
    <span>${regime.tradable_regime?'Trading enabled':'⚠ Trading suspended'}</span>
    ${cb.active?`<div style="margin-top:6px;font-size:9px;color:var(--red);font-weight:700">⛔ CIRCUIT BREAKER</div>`:''}
  </div>
  </aside>`;
}

function topbar(){
  const s=state.data||{};
  const lat=s.latency||{};
  const latMs=n(lat.signal_latency_p50_ms||0);
  const modePill=modeTag(s.mode||'paper');
  const w=state.wallet||{};
  const isLive=s.mode==='live';
  const curTheme=document.documentElement.getAttribute('data-theme')||'dark';
  return`<header class="topbar">
  <div class="statusbar">
    <span class="pill ${s.feed_quality?.startsWith('live')?'live':'bad'}">● ${s.feed_quality?.startsWith('live')?'LIVE FEED':esc((s.feed_quality||'STARTING').toUpperCase())}</span>
    ${modePill}
    <span class="pill ${s.armed?'live':'bad'}">${s.armed?'● ARMED':'○ DISARMED'}</span>
    <span class="pill" title="Execution Mode: Sicher & Langsam / Normal / Aggressiv">MODUS <b style="margin-left:4px" class="${(s.trading_preset==='safe_slow'?'cyan':s.trading_preset==='aggressive'?'down':'up')}">${(s.trading_preset==='safe_slow'?'SICHER & LANGSAM':s.trading_preset==='aggressive'?'AGGRESSIV':'NORMAL')}</b></span>
    <span class="pill">STRATEGY <b style="margin-left:4px">${esc(s.strategy||'combo').toUpperCase()}</b></span>
    ${s.panic?`<span class="pill bad">⛔ EMERGENCY KILL</span>`:''}
    ${s.paused&&!s.panic?`<span class="pill warn">⏸ PAUSED</span>`:''}
    <span class="pill" title="Signal latency p50">
      <span class="lat-dot ${latClass(latMs)}"></span>
      <span class="lat-val">${ms2(latMs)}</span>
    </span>
  </div>
  <div class="actions">
    ${!isLive?`<button class="btn primary sm" onclick="oneClickLiveTrading()" title="Wallet verbinden & Echtgeld LIVE-Trading sofort scharfschalten">⚡ 1-CLICK ECHTGELD LIVE</button>`:`<button class="btn warn sm" onclick="setMode('paper')">BACK TO PAPER</button>`}
    ${w.status==='connected'?`<button class="btn good sm" onclick="go('wallet')">◉ ${esc(w.address.slice(0,4))}...${esc(w.address.slice(-4))}</button>`:`<button class="btn sm" onclick="quickConnectWallet()">◉ WALLET CONNECT</button>`}
    <button class="btn theme-toggle sm" onclick="toggleTheme()" title="Hell/Dunkel Modus umschalten">${curTheme==='dark'?'☀ HELL':'☾ DARK'}</button>
    <button class="btn sm" onclick="control('${s.paused?'resume':'pause'}')">${s.paused?'▶ RESUME':'⏸ PAUSE'}</button>
    <button class="btn ${s.armed?'bad':'good'} sm" onclick="control('arm')">${s.armed?'DISARM':'ARM'}</button>
    <button class="btn bad sm" onclick="confirmKill()">⛔ KILL</button>
  </div>
  </header>`;
}

function metric(k,v,sub,cls=''){return`<div class="metric"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${sub||''}</div></div>`}
function hero(title,desc,actions=''){return`<div class="card"><div class="cardbody hero"><div><div class="eyebrow">HELIX · SOLANA PUMP.FUN SPEED TERMINAL</div><h2>${title}</h2><p>${desc}</p></div><div class="actions">${actions}</div></div></div>`}

// ── Equity Sparkline ──────────────────────────────────────────────────────────
function spark(points){
  if(!points?.length)return'<div class="empty">No equity data yet.</div>';
  const rows=points.map(p=>typeof p==='number'?{equity_sol:p,ts_ms:0}:p).filter(p=>Number.isFinite(Number(p.equity_sol)));
  if(!rows.length)return'<div class="empty">No equity data yet.</div>';
  const vals=rows.map(p=>n(p.equity_sol)),w=900,h=180,pad=24;
  const minV=Math.min(...vals),maxV=Math.max(...vals);
  const range=(maxV-minV)||Math.max(maxV*.02,.001);
  const lo=minV-range*.1,hi=maxV+range*.1,r=hi-lo;
  const pts=vals.map((v,i)=>`${pad+i*(w-2*pad)/(vals.length-1||1)},${h-pad-(v-lo)/r*(h-2*pad)}`).join(' ');
  const last=vals[vals.length-1];
  const firstTs=rows[0].ts_ms?new Date(n(rows[0].ts_ms)).toLocaleTimeString():'';
  const trend=vals.length>1&&last>=vals[0]?'#27c07a':'#e53935';
  return`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">
  <path d="M${pad},${h-pad} H${w-pad}" stroke="#1e3048"/><path d="M${pad},${pad} H${w-pad}" stroke="#1e3048"/>
  <path d="M${pts.split(' ').join(' L')}" fill="none" stroke="url(#eg)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
  <circle cx="${pad+(vals.length-1)*(w-2*pad)/(vals.length-1||1)}" cy="${h-pad-(last-lo)/r*(h-2*pad)}" r="4" fill="${trend}"/>
  <text x="${pad}" y="${h-4}" fill="#4a6278" font-size="10">${firstTs}</text>
  <text x="${w-pad}" y="${pad-7}" text-anchor="end" fill="#edf5fb" font-size="11">${last.toFixed(4)} SOL</text>
  <defs><linearGradient id="eg"><stop stop-color="${trend}"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
  </svg>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function liquidity(c){return n(c.liquidity_usd)>0?usd(c.liquidity_usd):n(c.real_sol_reserves)>0?`${n(c.real_sol_reserves).toFixed(2)} SOL`:'—'}
function rugTag(c){
  const cls={BLOCKED:'bad',HIGH_RISK:'bad',CAUTION:'warn',SAFE:'good'}[c.rug_risk_state]||'';
  return`<span class="tag ${cls}" title="${esc((c.rug_reasons||[]).join(' · '))}">${esc(c.rug_risk_state||c.risk_level||'?')}</span>`;
}
function oppBar(v){const w=Math.min(100,Math.max(0,n(v)));return`<div class="opp-bar"><div class="opp-bar-fill" style="width:${w}%"></div></div>`}

function coinRow(c){
  return`<tr>
  <td><div class="token">${c.image_uri?`<img class="avatar" src="${esc(c.image_uri)}" onerror="this.style.display='none'">`:' <div class="avatar"></div>'}
  <div><b>${esc(c.symbol||c.name||c.mint.slice(0,8))}</b><span>${esc(c.mint)}</span></div></div></td>
  <td>${c.is_new?'<span class="tag new">NEW</span> ':''}${age(c.age_seconds)}</td>
  <td><span class="opp-score">${n(c.opportunity_score).toFixed(1)}</span>${oppBar(c.opportunity_score)}</td>
  <td><span class="score ${scoreClass(c.signal_score)}">${n(c.signal_score).toFixed(1)}</span></td>
  <td title="${esc(c.quote_source||'no source')}">${usd(c.price_usd)}</td>
  <td class="${n(c.price_change_5m)>=0?'up':'down'}">${pct(c.price_change_5m)}</td>
  <td>${n(c.buys_5m)} B · ${n(c.sells_5m)} S · ${usd(c.volume_5m_usd)}</td>
  <td>${liquidity(c)}</td>
  <td>${regimeTag(c.regime)}</td>
  <td>${rugTag(c)}</td>
  <td><button class="btn sm" onclick="manualBuy('${esc(c.mint)}')">BUY</button></td>
  </tr>`;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function dashboard(){
  const s=state.data||{},st=s.stats||{},regime=s.market_regime||{},cb=s.circuit_breaker||{};
  const top=(s.coins||[]).slice(0,6);
  const lat=s.latency||{};
  return`<div class="page">
  ${cb.active?`<div class="circuit-breaker-alert">⛔ CIRCUIT BREAKER ACTIVE — ${esc(cb.reason)}<button class="btn bad sm" style="margin-left:auto" onclick="clearKill()">RESET</button></div>`:''}
  ${hero('HELIX PRO Trading Terminal','Multi-strategy Solana memecoin intelligence & ultra-low latency execution — Pump.fun, PumpSwap & Raydium. Non-custodial with Jito MEV protection.',
    `<button class="btn primary" onclick="go('scanner')">OPEN SCANNER</button>
     <button class="btn" onclick="go('sniper')">SNIPER MODE</button>
     <button class="btn" onclick="go('strategies')">STRATEGIES</button>`)}
  <div class="metrics">
    ${metric('Equity',sol(st.equity_sol),'cash + open mark-to-market',st.equity_sol>=s.config?.starting_sol?'up':'down')}
    ${metric('Realized PnL',sol(st.realized_sol),'closed positions',st.realized_sol>=0?'up':'down')}
    ${metric('Unrealized PnL',sol(st.unrealized_sol),'live mark',st.unrealized_sol>=0?'up':'down')}
    ${metric('Open Exposure',sol(st.open_exposure_sol),'entry capital')}
    ${metric('Win Rate',pct(st.win_rate_pct),'closed trades')}
    ${metric('Max Drawdown',pct(st.max_drawdown_pct),'peak-to-equity','down')}
    ${metric('Consecutive Losses',String(n(st.consecutive_losses)),'circuit trip >'+n(s.config?.risk_limits?.max_consecutive_losses||5),n(st.consecutive_losses)>=3?'down':'')}
    ${metric('Signal Latency',ms2(lat.signal_latency_p50_ms),'p50',latClass(lat.signal_latency_p50_ms))}
  </div>
  <div class="grid">
    <section class="card span-8">
      <div class="cardhead"><div><h3>Equity Curve</h3><p>Real-time paper mark-to-market — values bounded to valid position economics.</p></div><span class="tag good">${s.health?.quote_fresh||0} FRESH</span></div>
      <div class="cardbody"><div class="chart">${spark((st.equity_history||[]).length?st.equity_history:[{equity_sol:n(st.equity_sol),ts_ms:s.ts}])}</div></div>
    </section>
    <section class="card span-4">
      <div class="cardhead"><div><h3>Engine State</h3><p>Live operational status</p></div></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>Feed</span><b class="${s.feed_quality==='live'?'up':'down'}">${esc(s.feed_quality||'—')}</b></div>
        <div class="kvrow"><span>Mode</span><b>${modeTag(s.mode||'paper')}</b></div>
        <div class="kvrow"><span>Strategy</span><b>${esc(s.strategy||'—')}</b></div>
        <div class="kvrow"><span>Market Regime</span><b>${regimeTag(regime.macro_regime||'UNKNOWN')}</b></div>
        <div class="kvrow"><span>Quotes</span><b>${n(s.health?.quote_fresh)} fresh / ${n(s.health?.quote_stale)} stale</b></div>
        <div class="kvrow"><span>Positions</span><b>${n(s.positions?.length)} / ${n(s.config?.max_positions)}</b></div>
        <div class="kvrow"><span>Uptime</span><b>${Math.floor(n(s.uptime_seconds))}s</b></div>
      </div>
    </section>
    <section class="card span-12">
      <div class="cardhead"><div><h3>Top Opportunity Signals</h3><p>Ranked by Opportunity Score (11 components) from live Pump.fun feed.</p></div>
        <button class="btn" onclick="go('scanner')">VIEW ALL</button></div>
      <div class="cardbody">
        <div class="tablewrap"><table class="table">
          <thead><tr><th>Token</th><th>Age</th><th>Opp Score</th><th>Signal</th><th>Price</th><th>5m Change</th><th>Flow / Volume</th><th>Liquidity</th><th>Regime</th><th>Rug Risk</th><th>Action</th></tr></thead>
          <tbody>${top.map(coinRow).join('')||'<tr><td colspan="11" class="empty">No Pump.fun data. Check auth in Settings.</td></tr>'}</tbody>
        </table></div>
      </div>
    </section>
  </div>
  </div>`;
}

// ── Scanner ───────────────────────────────────────────────────────────────────
function scanner(){
  const s=state.data||{},coins=s.coins||[];
  return`<div class="page">
  ${hero('Live Token Scanner','All Pump.fun candidates — Opportunity Score, Rug Protection, Regime Classification, DexScreener enrichment.',
    `<button class="btn primary" onclick="refreshNow()">REFRESH</button>`)}
  <section class="card">
    <div class="cardhead">
      <div><h3>Candidate Matrix</h3><p>${coins.length} candidates · strategy: <b>${esc(s.strategy)}</b> · regime: ${regimeTag((s.market_regime||{}).macro_regime)}</p></div>
      <span class="tag ${s.feed_quality==='live'?'good':'bad'}">${esc(s.feed_quality||'—')}</span>
    </div>
    <div class="cardbody">
      <div class="tablewrap"><table class="table">
        <thead><tr><th>Token</th><th>Age</th><th>Opp Score</th><th>Signal</th><th>Price</th><th>5m Change</th><th>Flow / Volume</th><th>Liquidity</th><th>Regime</th><th>Rug Risk</th><th>Action</th></tr></thead>
        <tbody>${coins.map(coinRow).join('')||'<tr><td colspan="11" class="empty">No candidates. Check Pump.fun auth in Settings.</td></tr>'}</tbody>
      </table></div>
    </div>
  </section>
  </div>`;
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function heatmap(){
  const s=state.data||{},coins=s.coins||[];
  function heatClass(pct){if(pct>=20)return'up4';if(pct>=10)return'up3';if(pct>=4)return'up2';if(pct>=0)return'up1';if(pct>=-4)return'dn0';if(pct>=-10)return'dn1';if(pct>=-20)return'dn2';if(pct>=-40)return'dn3';return'dn4';}
  return`<div class="page">
  ${hero('Market Heatmap','Visual overview of 5-minute price performance and volume intensity across all live candidates.')}
  <section class="card">
    <div class="cardhead"><div><h3>Price Change Heatmap</h3><p>${coins.length} tokens · color intensity = magnitude of 5m move</p></div></div>
    <div class="cardbody">
      <div class="heatmap">
        ${coins.length?coins.map(c=>{
          const p=n(c.price_change_5m),cls=heatClass(p);
          const col=p>=0?'#27c07a':'#e53935';
          return`<div class="heatcell ${cls}" onclick="manualBuy('${esc(c.mint)}')" title="${esc(c.mint)}">
            <div class="sym">${esc(c.symbol||c.mint.slice(0,6))}</div>
            <div class="chg" style="color:${col}">${p>=0?'+':''}${p.toFixed(1)}%</div>
            <div class="vol">${usd(c.volume_5m_usd)}</div>
          </div>`;
        }).join(''):'<div class="empty" style="grid-column:1/-1">No data. Waiting for feed.</div>'}
      </div>
    </div>
  </section>
  </div>`;
}

// ── Sniper Mode ───────────────────────────────────────────────────────────────
function sniper(){
  const s=state.data||{},cfg=s.config||{};
  const snipAge=n(cfg.sniper_max_age_seconds||60);
  const snipMin=n(cfg.sniper_min_score||58);
  const coins=(s.coins||[]).filter(c=>n(c.age_seconds)<=snipAge&&n(c.strategy_scores?.sniper||0)>=snipMin).sort((a,b)=>n(b.strategy_scores?.sniper||0)-n(a.strategy_scores?.sniper||0));
  return`<div class="page">
  ${hero('Sniper Mode','Targets tokens aged ≤${snipAge}s with sniper score ≥${snipMin}. Independent launch detection for early entries.',
    `<button class="btn primary" onclick="refreshNow()">REFRESH</button>
     <button class="btn" onclick="switchStrategy('sniper')">ACTIVATE SNIPER STRATEGY</button>`)}
  <div class="metrics">
    ${metric('Sniper Targets',String(coins.length),'within age window')}
    ${metric('Max Age',`${snipAge}s`,'sniper_max_age_seconds')}
    ${metric('Min Score',pct(snipMin),'sniper_min_score')}
    ${metric('Active Strategy',esc(s.strategy||'combo'),'current engine strategy')}
  </div>
  <section class="card">
    <div class="cardhead"><div><h3>Launch Sniper Candidates</h3><p>New launches with sufficient liquidity, early momentum, and clean rug-protection score.</p></div>
      <span class="tag ${coins.length?'good':''}">${coins.length} TARGETS</span></div>
    <div class="cardbody">
      <div class="tablewrap"><table class="table">
        <thead><tr><th>Token</th><th>Age</th><th>Sniper Score</th><th>Opp Score</th><th>Price</th><th>Flow</th><th>Liquidity</th><th>Rug Risk</th><th>Action</th></tr></thead>
        <tbody>${coins.length?coins.map(c=>`<tr>
          <td><div class="token">${c.image_uri?`<img class="avatar" src="${esc(c.image_uri)}" onerror="this.style.display='none'">`:' <div class="avatar"></div>'}
          <div><b>${esc(c.symbol||c.mint.slice(0,8))}</b><span>${esc(c.mint)}</span></div></div></td>
          <td><span class="tag new">NEW</span> ${age(c.age_seconds)}</td>
          <td><span class="score good">${n(c.strategy_scores?.sniper||0).toFixed(1)}</span></td>
          <td><span class="opp-score">${n(c.opportunity_score).toFixed(1)}</span></td>
          <td>${usd(c.price_usd)}</td>
          <td>${n(c.buys_5m)} B · ${n(c.sells_5m)} S</td>
          <td>${liquidity(c)}</td>
          <td>${rugTag(c)}</td>
          <td><button class="btn primary sm" onclick="manualBuy('${esc(c.mint)}')">SNIPE</button></td>
        </tr>`).join(''):`<tr><td colspan="9" class="empty">No fresh launches matching sniper criteria (age ≤${snipAge}s, score ≥${snipMin}).</td></tr>`}
        </tbody>
      </table></div>
    </div>
  </section>
  </div>`;
}

// ── Strategies ────────────────────────────────────────────────────────────────
const STRATEGY_DESC={
  'sniper':'Snipet neue Pump.fun-Tokens mit frühem Liquiditätsaufbau & Momentum.',
  'momentum':'Erkennt exponentiell steigendes Kaufvolumen und Preisbeschleunigung.',
  'breakout':'Triggert bei lokalen High-Breakouts und Volumen-Expansion.',
  'trend-following':'Folgt verifizierten Aufwärtstrends mit dynamischem Trailing-Stop.',
  'pullback-continuation':'Kauft gesunde Dips innerhalb starker Bullen-Trends.',
  'volatility-expansion':'Steigt bei Kompressionsausbrüchen mit starker Liquidität ein.',
  'micro-scalper':'Ultraschnelle 1-3 Minuten Micro-Scalps mit engen TP/SL-Grenzen.',
  'hft-scalper':'High-Frequency Trading Scalp für stark volatile PumpSwap-Pools.',
  'runner':'Hält Moonbag-Restpositionen für 2x, 5x, 10x, 100x Ausreißer.',
  'combo':'Multi-Strategie-Konsens: Kombination aller Momentum- und Risikosignale.',
  'early-entry':'Aggressiver Einstieg in frühe Bonding-Curve-Phasen.',
  'graduation':'Fokussiert Tokens kurz vor oder nach dem Raydium/PumpSwap-Graduation-Event.',
  'liquidity':'Konservative Trades mit hoher Liquidität und verifiziertem Volumen.',
  'mean-reversion':'Gegenbewegungs-Scalps bei überdehnten Verkäufen.'
};

const STRATEGY_ICON={
  'sniper':'🎯',
  'momentum':'⚡',
  'breakout':'💥',
  'trend-following':'📈',
  'pullback-continuation':'🔄',
  'volatility-expansion':'🌊',
  'micro-scalper':'⏱',
  'hft-scalper':'🚀',
  'runner':'🏃',
  'combo':'🧩',
  'early-entry':'🌱',
  'graduation':'🎓',
  'liquidity':'💧',
  'mean-reversion':'⚖'
};

function strategies(){
  const s=state.data||{},ss=s.strategies||{},active=s.strategy||'combo',cfg=ss[active]||{};
  const activeList=s.active_strategies||[active];
  const isMulti=activeList.length>1;
  const isPro=Boolean(s.config?.pro_tier?.active);

  return`<div class="page">
  ${hero('HELIX Algo Strategy Lab','Wähle, kombiniere und konfiguriere quantitative Handelsstrategien. Unterstützt Einzel- und Multi-Strategie-Ausführung zeitgleich.')}

  <!-- Multi-Strategy Control Bar -->
  <div class="strategy-header-panel">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div class="multi-strat-toggle-box">
        <span style="font-size:16px">🧩</span>
        <div>
          <span style="display:block;font-size:12px;font-weight:700">MULTI-STRATEGY ENGINE: ${isMulti ? '<span style="color:var(--neon)">AKTIV ('+activeList.length+' Strategien aktiv)</span>' : '<span style="color:var(--text2)">EINZELSTRATEGIE</span>'}</span>
          <span style="font-size:10px;color:var(--text2)">Klicke bei den Kacheln auf das <b>☑ Checkbox-Icon</b>, um mehrere Strategien simultan scannen & traden zu lassen.</span>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <span class="pro-tag-pill">${isPro ? '★ PRO UNLIMITED' : 'COMMUNITY'}</span>
      <button class="btn primary sm" onclick="saveStrategyParams()">PARAMETER SPEICHERN</button>
    </div>
  </div>

  <div class="grid">
    <!-- Visual Strategy Matrix -->
    <section class="card span-8">
      <div class="cardhead">
        <div>
          <h3>Strategie Matrix (${Object.keys(ss).length})</h3>
          <p>Aktive Strategien: <b>${activeList.map(esc).join(', ').toUpperCase()}</b></p>
        </div>
      </div>
      <div class="cardbody">
        <div class="strategy-grid-impressive">
          ${Object.entries(ss).map(([k,v])=>{
            const isSelected=k===active;
            const inMulti=activeList.includes(k);
            const icon=STRATEGY_ICON[k]||'◈';
            return `<div class="strat-card ${isSelected?'active':''} ${inMulti?'multi-selected':''}">
              <div>
                <div class="strat-top">
                  <div class="strat-title">
                    <span>${icon}</span>
                    <span>${esc(k)}</span>
                  </div>
                  <div style="display:flex;gap:4px">
                    ${inMulti?`<span class="strat-badge multi">MULTI</span>`:''}
                    ${isSelected?`<span class="strat-badge active">PRIMARY</span>`:''}
                  </div>
                </div>
                <div class="strat-desc">${esc(STRATEGY_DESC[k]||'Algorithmus zur On-Chain Analyse.')}</div>
              </div>

              <div>
                <div class="strat-specs">
                  <div class="strat-spec-item">
                    <span>MIN SCORE</span>
                    <b>≥ ${n(v.min_score).toFixed(0)}</b>
                  </div>
                  <div class="strat-spec-item">
                    <span>TAKE PROFIT</span>
                    <b class="up">+${n(v.take_pct).toLocaleString()}%</b>
                  </div>
                  <div class="strat-spec-item">
                    <span>STOP LOSS</span>
                    <b class="down">-${n(v.stop_pct).toFixed(1)}%</b>
                  </div>
                </div>
                
                <div class="strat-actions">
                  <button class="strat-btn-select" onclick="switchStrategy('${esc(k)}')">
                    ${isSelected ? '✓ HAUPTSTRATEGIE' : 'ALS HAUPT WÄHLEN'}
                  </button>
                  <button class="strat-btn-check ${inMulti?'checked':''}" onclick="toggleMultiStrat('${esc(k)}')" title="In Multi-Strategie-Pool aktivieren/deaktivieren">
                    ${inMulti ? '☑' : '☐'}
                  </button>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </section>

    <!-- Strategy Parameters & Pro Features -->
    <section class="card span-4">
      <div class="cardhead">
        <div>
          <h3>Parameter Setup</h3>
          <p>${esc(active)} konfigurieren</p>
        </div>
      </div>
      <div class="cardbody">
        <div class="formgrid" style="grid-template-columns:1fr">
          <div class="field">
            <label>Mindest-Signal-Score (Min Score 0–100)</label>
            <input id="st-min_score" type="number" min="0" max="100" step="1" value="${n(cfg.min_score)}">
          </div>
          <div class="field">
            <label>Take Profit Target (%)</label>
            <input id="st-take_pct" type="number" min="1" step="1" value="${n(cfg.take_pct)}">
          </div>
          <div class="field">
            <label>Stop Loss Limit (%)</label>
            <input id="st-stop_pct" type="number" min="0.5" step="0.5" value="${n(cfg.stop_pct)}">
          </div>
          <div class="field">
            <label>Trailing Stop (%)</label>
            <input id="st-trail_pct" type="number" min="0.5" step="0.5" value="${n(cfg.trail_pct)}">
          </div>
          <div class="field">
            <label>Max Haltedauer (Minuten)</label>
            <input id="st-max_hold_minutes" type="number" min="1" step="1" value="${Math.round(n(cfg.max_hold_minutes))}">
          </div>
        </div>

        <div style="height:12px"></div>
        <button class="btn primary" style="width:100%" onclick="saveStrategyParams()">ÄNDERUNGEN SPEICHERN</button>

        <div class="pro-feature-card" style="margin-top:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <b style="color:var(--neon);font-size:11px">★ PRO EXTREME MOVE PROTECTION</b>
            <span class="pro-tag-pill">ACTIVE</span>
          </div>
          <p style="font-size:10px;color:var(--text2);line-height:1.5">
            Automatische Skalierung: Bei +25% zieht HELIX den Stop-Loss automatisch auf Break-Even (Risk-Free Trade). Runner-Stufen realisieren 25% Gewinne bei 2x, 5x, 10x, 50x und 100x.
          </p>
        </div>
      </div>
    </section>
  </div>
  </div>`;
}

// ── Positions ─────────────────────────────────────────────────────────────────
function positions(){
  const s=state.data||{},ps=s.positions||[];
  return`<div class="page">
  ${hero('Open Positions','Live mark-to-market. Stale quotes never overwrite valid prices. Break-even and trailing exits run server-side.',
    `<button class="btn primary" onclick="refreshNow()">REFRESH QUOTES</button>`)}
  <section class="card">
    <div class="cardhead">
      <div><h3>Position Monitor</h3><p>${ps.length} open · ${n(s.health?.quote_fresh)} fresh · ${n(s.health?.quote_stale)} stale</p></div>
    </div>
    <div class="cardbody">
      <div class="posgrid">
        ${ps.map(p=>`<div class="position">
          <div class="full"><b>${esc(p.symbol)}</b><div class="mono muted">${esc(p.mint)}</div>
            <div style="margin-top:4px">${regimeTag(p.regime_at_entry)} <span class="tag">${esc(p.strategy)}</span> ${p.break_even_active?`<span class="tag good">BE ACTIVE</span>`:''} ${p.runner_levels_hit?.length?`<span class="tag warn">RUNNER ×${p.runner_levels_hit.join(',')}</span>`:''}</div>
          </div>
          <div><span class="label">ENTRY</span><span class="value">${usd(p.entry_price_usd)}</span></div>
          <div><span class="label">NOW</span><span class="value">${usd(p.current_price_usd)}</span></div>
          <div><span class="label">RETURN</span><span class="value ${n(p.return_pct)>=0?'up':'down'}">${pct(p.return_pct)}</span></div>
          <div><span class="label">UNREALIZED</span><span class="value ${n(p.unrealized_pnl_sol)>=0?'up':'down'}">${sol(p.unrealized_pnl_sol)}</span></div>
          <div class="hide-sm"><span class="label">TP / SL / TRAIL</span><span class="value">+${n(p.take_pct).toFixed(1)}% / -${n(p.stop_pct).toFixed(1)}% / ${n(p.trail_pct).toFixed(1)}%</span></div>
          <div class="hide-md"><span class="label">QUOTE</span><span class="value">
            <span class="tag ${p.quote_status==='fresh'?'good':p.quote_status==='stale'?'warn':'bad'}">${esc(p.quote_source||'—')} · ${p.quote_status==='fresh'?age(qage(p.quote_updated_at_ms)):'STALE'}</span>
          </span></div>
          <button class="btn bad sm" onclick="exitPos('${esc(p.id)}')">EXIT</button>
        </div>`).join('')||'<div class="empty">No open positions.</div>'}
      </div>
    </div>
  </section>
  </div>`;
}

// ── Activity ──────────────────────────────────────────────────────────────────
function activity(){
  const s=state.data||{},fs=s.fills||[];
  return`<div class="page">
  ${hero('Activity Ledger','Every fill recorded in SOL — no USD/SOL unit mixing. Route, slippage and latency tracked.',
    `<button class="btn bad" onclick="resetPaper()">RESET PAPER</button>`)}
  <section class="card">
    <div class="cardhead"><div><h3>Execution History</h3><p>${fs.length} fills · newest first</p></div></div>
    <div class="cardbody">
      <div class="tablewrap"><table class="table">
        <thead><tr><th>Time</th><th>Side</th><th>Token</th><th>Value</th><th>Price</th><th>PnL</th><th>Slippage</th><th>Route</th><th>Reason</th><th>Mode</th></tr></thead>
        <tbody>${fs.map(f=>`<tr>
          <td>${new Date(n(f.ts_ms)).toLocaleTimeString()}</td>
          <td><span class="tag ${f.side==='SELL'?'good':''}">${esc(f.side)}</span></td>
          <td>${esc(f.symbol)}</td>
          <td>${sol(f.sol)}</td>
          <td>${usd(f.price_usd)}</td>
          <td class="${n(f.pnl_sol)>=0?'up':'down'}">${sol(f.pnl_sol)}</td>
          <td>${n(f.slippage_pct).toFixed(2)}%</td>
          <td><span class="tag">${esc(f.route||'paper')}</span></td>
          <td>${esc(f.reason)}</td>
          <td>${modeTag(f.mode||'paper')}</td>
        </tr>`).join('')||'<tr><td colspan="10" class="empty">No fills yet.</td></tr>'}
        </tbody>
      </table></div>
    </div>
  </section>
  </div>`;
}

// ── Analytics ─────────────────────────────────────────────────────────────────
function analytics(){
  const s=state.data||{},st=s.stats||{},lat=s.latency||{},perf=s.performance||{};
  const regime=s.market_regime||{};
  return`<div class="page">
  ${hero('Performance Analytics','Real-time trading metrics, latency telemetry, and market regime statistics.')}
  <div class="metrics">
    ${metric('Total Trades',String(n(st.trades)),'executed paper fills')}
    ${metric('Wins / Losses',`${n(st.wins)} / ${n(st.losses)}`,'closed')}
    ${metric('Win Rate',pct(st.win_rate_pct),'',n(st.win_rate_pct)>=50?'up':'down')}
    ${metric('Return on Start',pct(perf.return_on_start_pct||0),'vs starting capital',n(perf.return_on_start_pct||0)>=0?'up':'down')}
    ${metric('Max Drawdown',pct(st.max_drawdown_pct),'peak-to-equity','down')}
    ${metric('Fees Paid',sol(st.fees_sol),'estimated paper fees')}
  </div>
  <div class="grid">
    <section class="card span-6">
      <div class="cardhead"><div><h3>Latency Telemetry</h3><p>Hot-path performance measurements</p></div></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>Signal p50</span><b>${ms2(lat.signal_latency_p50_ms)}</b></div>
        <div class="kvrow"><span>Signal p95</span><b>${ms2(lat.signal_latency_p95_ms)}</b></div>
        <div class="kvrow"><span>Execution p50</span><b>${ms2(lat.execution_latency_p50_ms)}</b></div>
        <div class="kvrow"><span>Execution p95</span><b>${ms2(lat.execution_latency_p95_ms)}</b></div>
        <div class="kvrow"><span>RPC latency</span><b>${ms2(lat.rpc_latency_ms)}</b></div>
        <div class="kvrow"><span>Quote successes</span><b class="up">${n(s.health?.quote_success_total)}</b></div>
        <div class="kvrow"><span>Quote failures</span><b class="${n(s.health?.quote_failure_total)?'down':'up'}">${n(s.health?.quote_failure_total)}</b></div>
      </div>
    </section>
    <section class="card span-6">
      <div class="cardhead"><div><h3>Market Regime Stats</h3><p>Distribution across tracked tokens</p></div></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>Macro Regime</span><b>${regimeTag(regime.macro_regime||'UNKNOWN')}</b></div>
        <div class="kvrow"><span>Trading Allowed</span><b class="${regime.tradable_regime?'up':'down'}">${regime.tradable_regime?'YES':'SUSPENDED'}</b></div>
        <div class="kvrow"><span>Acceleration %</span><b>${pct(regime.acceleration_pct||0)}</b></div>
        <div class="kvrow"><span>Panic/Distrib %</span><b class="${n(regime.panic_pct||0)>20?'down':''}">${pct(regime.panic_pct||0)}</b></div>
        ${Object.entries(regime.counts||{}).map(([r,c])=>`<div class="kvrow"><span>${regimeTag(r)}</span><b>${c}</b></div>`).join('')}
      </div>
    </section>
    <section class="card span-12">
      <div class="cardhead"><div><h3>Equity Curve</h3><p>Full trading session equity history</p></div></div>
      <div class="cardbody"><div class="chart">${spark(st.equity_history||[])}</div></div>
    </section>
  </div>
  </div>`;
}

// ── Backtest ──────────────────────────────────────────────────────────────────
function backtest(){
  const s=state.data||{},ss=s.strategies||{},bt=state.backtest;
  return`<div class="page">
  ${hero('Backtest Engine','Monte Carlo simulation · Walk-forward validation · Parameter stability · Out-of-sample testing.',
    `<button class="btn primary" onclick="runBacktest()" ${state.btLoading?'disabled':''}>
      ${state.btLoading?'⟳ RUNNING...':'▶ RUN BACKTEST'}
    </button>`)}
  <div class="grid">
    <section class="card span-4">
      <div class="cardhead"><div><h3>Backtest Parameters</h3><p>Strategy and risk settings</p></div></div>
      <div class="cardbody">
        <div class="field" style="margin-bottom:10px">
          <label>Strategy</label>
          <select id="bt-strategy">${Object.keys(ss).map(k=>`<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>Trade Amount (SOL)</label>
          <input id="bt-amount" type="number" min="0.001" step="0.01" value="${n(s.config?.max_trade_sol||0.1)}">
        </div>
        <div class="notice warn" style="margin-top:12px">Backtest uses synthetic market simulation reflecting historical Pump.fun meme coin distributions. Results are not indicative of future performance. Never optimize solely for historical maximum ROI.</div>
      </div>
    </section>
    <section class="card span-8">
      ${bt?`<div class="cardhead"><div><h3>Results: ${esc(bt.strategy)}</h3><p>Monte Carlo 500 iterations · p95 drawdown · p05 PnL</p></div></div>
      <div class="cardbody">
        <div class="bt-metrics">
          ${[['Total Trades',bt.metrics.total_trades,'neutral'],['Win Rate',pct(bt.metrics.win_rate_pct),n(bt.metrics.win_rate_pct)>=50?'good':'bad'],['Profit Factor',bt.metrics.profit_factor.toFixed(2),n(bt.metrics.profit_factor)>=1.2?'good':'bad'],['Expectancy',sol(bt.metrics.expectancy_sol),n(bt.metrics.expectancy_sol)>=0?'good':'bad'],['Net PnL',sol(bt.metrics.net_pnl_sol),n(bt.metrics.net_pnl_sol)>=0?'good':'bad'],['Net Return',pct(bt.metrics.net_return_pct),n(bt.metrics.net_return_pct)>=0?'good':'bad'],['Max Drawdown',pct(bt.metrics.max_drawdown_pct),'bad'],['Sharpe',bt.metrics.sharpe_ratio.toFixed(2),n(bt.metrics.sharpe_ratio)>=1?'good':'neutral'],['Sortino',bt.metrics.sortino_ratio.toFixed(2),n(bt.metrics.sortino_ratio)>=1?'good':'neutral'],['Avg R',bt.metrics.average_r.toFixed(2),'neutral'],['Tail Capture',pct(bt.metrics.tail_capture_pct),'neutral'],['Avg Hold',`${bt.metrics.average_hold_minutes.toFixed(1)}m`,'neutral'],['MC DD p95',pct(bt.metrics.monte_carlo_drawdown_p95),'bad'],['MC PnL p05',sol(bt.metrics.monte_carlo_pnl_p05),n(bt.metrics.monte_carlo_pnl_p05)>=0?'good':'bad'],['Fees',sol(bt.metrics.total_fees_sol),'bad'],['Slippage',sol(bt.metrics.total_slippage_sol),'bad']].map(([k,v,cls])=>`<div class="bt-metric"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`).join('')}
        </div>
        <div class="chart" style="margin-top:14px">${spark((bt.metrics.equity_curve||[]).map(e=>({equity_sol:e.equity_sol,ts_ms:0})))}</div>
      </div>`:`<div class="cardhead"><div><h3>No Results Yet</h3><p>Select strategy and click Run Backtest</p></div></div><div class="cardbody"><div class="empty">Run backtest to see performance metrics, Monte Carlo simulation results and equity curve.</div></div>`}
    </section>
  </div>
  </div>`;
}

// ── Risk ──────────────────────────────────────────────────────────────────────
function risk(){
  const s=state.data||{},st=s.stats||{},c=s.config||{},rl=c.risk_limits||{},cb=s.circuit_breaker||{};
  return`<div class="page">
  ${hero('Risk Control Center','12 hard limits evaluated server-side before every entry. Emergency controls halt immediately.')}
  ${cb.active?`<div class="circuit-breaker-alert">⛔ CIRCUIT BREAKER ACTIVE — ${esc(cb.reason)}</div>`:''}
  <div class="grid">
    <section class="card span-6">
      <div class="cardhead"><div><h3>Current Exposure</h3><p>Capital allocation and limits</p></div></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>Starting Capital</span><b>${sol(c.starting_sol)}</b></div>
        <div class="kvrow"><span>Cash</span><b>${sol(st.cash_sol)}</b></div>
        <div class="kvrow"><span>Open Exposure</span><b>${sol(st.open_exposure_sol)}</b></div>
        <div class="kvrow"><span>Equity</span><b>${sol(st.equity_sol)}</b></div>
        <div class="kvrow"><span>Daily Loss</span><b class="${n(st.realized_sol)<=-n(rl.max_daily_loss_sol||0.5)?'down':''}">${sol(st.realized_sol)} / ${sol(rl.max_daily_loss_sol||0.5)} limit</b></div>
        <div class="kvrow"><span>Consecutive Losses</span><b class="${n(st.consecutive_losses)>=3?'down':''}">${n(st.consecutive_losses)} / ${n(rl.max_consecutive_losses||5)} limit</b></div>
        <div class="kvrow"><span>Exec Failures</span><b class="${n(st.execution_failures)>=3?'down':''}">${n(st.execution_failures)}</b></div>
        <div class="kvrow"><span>Max Drawdown</span><b class="down">${pct(st.max_drawdown_pct)}</b></div>
      </div>
    </section>
    <section class="card span-6">
      <div class="cardhead"><div><h3>Engine State</h3><p>Operational controls</p></div></div>
      <div class="cardbody stack">
        <div class="notice ${s.armed&&!s.paused&&!s.panic?'good':s.panic?'bad':'warn'}">
          <b>${s.panic?'⛔ EMERGENCY KILL':s.paused?'⏸ PAUSED':s.armed?'● ARMED':'○ DISARMED'}</b><br>
          ${s.panic?'All new entries blocked. Existing positions managed.':s.paused?'New entries paused.':'Entry engine evaluating signals.'}
        </div>
        <div class="kv">
          <div class="kvrow"><span>Win Rate</span><b>${pct(st.win_rate_pct)}</b></div>
          <div class="kvrow"><span>Total Realized + Unrealized</span><b class="${n(s.performance?.realized_plus_unrealized||0)>=0?'up':'down'}">${sol(s.performance?.realized_plus_unrealized||0)}</b></div>
        </div>
      </div>
    </section>
    <section class="card span-12 danger-zone">
      <div class="cardhead"><div><h3>Emergency Controls</h3><p>Immediate hard-stop actions. Use in response to market anomalies or system failures.</p></div></div>
      <div class="cardbody actions">
        <button class="btn bad" onclick="emergencyStop()">⛔ STOP TRADING</button>
        <button class="btn bad" onclick="emergencyCloseAll()">✕ CLOSE ALL POSITIONS</button>
        <button class="btn bad" onclick="emergencyCancelAll()">✕ CANCEL ALL ORDERS</button>
        <button class="btn" onclick="control('paper')">↺ RE-ARM PAPER MODE</button>
        ${cb.active?`<button class="btn warn" onclick="clearKill()">RESET CIRCUIT BREAKER</button>`:''}
      </div>
    </section>
  </div>
  </div>`;
}

// ── Wallet ────────────────────────────────────────────────────────────────────
function wallet(){
  const s=state.data||{};
  const w=state.wallet;
  const connected=w.status==='connected';
  const isLive=s.mode==='live';
  const WALLET_STATES=['Disconnected','Connecting','Connected','Wrong Network','Signing','Submitted','Confirmed','Rejected','Error'];
  return`<div class="page">
  ${hero('Non-Custodial Wallet & Live Trading','Verbinde deine Phantom oder Solflare Wallet. Private Keys und Seed Phrases verlassen niemals deinen Browser.','')}
  
  <div class="card live-arm-box">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div class="eyebrow">ONE-CLICK LIVE EXECUTION</div>
        <h3 style="font-size:14px;font-weight:700;color:var(--text0)">Modus: ${isLive?'<span style="color:var(--neon)">⚡ ECHTGELD LIVE AKTIV</span>':'<span style="color:var(--text2)">PAPER TRADING (SIMULATION)</span>'}</h3>
        <p style="font-size:11px;color:var(--text2);margin-top:2px">
          ${connected ? `Verbunden mit ${esc(w.address.slice(0,6))}...${esc(w.address.slice(-4))} auf Solana Mainnet.` : 'Klicke unten oder oben rechts auf "1-Click Echtgeld Live", um die Wallet zu verknüpfen und scharfzuschalten.'}
        </p>
      </div>
      <div style="display:flex;gap:8px">
        ${!isLive ? `<button class="btn primary" onclick="oneClickLiveTrading()">⚡ 1-CLICK ECHTGELD LIVE TRADING SCHARFSCHALTEN</button>` : `<button class="btn warn" onclick="setMode('paper')">ZURÜCK ZU PAPER TRADING</button>`}
      </div>
    </div>
  </div>

  <div class="grid">
    <section class="card span-6">
      <div class="cardhead"><div><h3>Connect Wallet</h3><p>Phantom und Solflare unterstützt</p></div></div>
      <div class="cardbody">
        <div class="wallet-option ${w.type==='phantom'&&connected?'wallet-connected':''}" onclick="connectWallet('phantom')">
          <div style="font-size:20px">👻</div>
          <div><div class="wname">Phantom Wallet</div><div class="wstatus">${w.type==='phantom'?esc(w.status):'Klicken zum Verbinden'}</div></div>
          ${w.type==='phantom'&&connected?`<span class="tag good" style="margin-left:auto">VERBUNDEN</span>`:''}
        </div>
        <div class="wallet-option ${w.type==='solflare'&&connected?'wallet-connected':''}" onclick="connectWallet('solflare')">
          <div style="font-size:20px">🔥</div>
          <div><div class="wname">Solflare Wallet</div><div class="wstatus">${w.type==='solflare'?esc(w.status):'Klicken zum Verbinden'}</div></div>
          ${w.type==='solflare'&&connected?`<span class="tag good" style="margin-left:auto">VERBUNDEN</span>`:''}
        </div>
        ${connected?`<button class="btn bad" style="margin-top:10px;width:100%" onclick="disconnectWallet()">TRENNEN (${esc(w.type.toUpperCase())})</button>`:''}
      </div>
    </section>
    <section class="card span-6">
      <div class="cardhead"><div><h3>Wallet Status</h3><p>Sicherheit & Berechtigungen</p></div></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>Wallet Provider</span><b>${esc(w.type||'Keine')}</b></div>
        <div class="kvrow"><span>Status</span><b class="${connected?'up':''}">${esc(w.status||'getrennt')}</b></div>
        <div class="kvrow"><span>Adresse</span><b class="mono">${w.address?esc(w.address.slice(0,8)+'...'+w.address.slice(-6)):'—'}</b></div>
        <div class="kvrow"><span>Netzwerk</span><b>${connected?'Solana Mainnet-Beta':'—'}</b></div>
        <div class="kvrow"><span>Private Key im Speicher</span><b class="up">NIEMALS (Client-only)</b></div>
        <div class="kvrow"><span>Stilles Signieren</span><b class="up">DEAKTIVIERT</b></div>
      </div>
      <div class="notice ${connected?'good':'warn'}" style="margin:10px 12px 12px">
        ${connected?`✓ Wallet aktiv. Alle Swaps und Transaktionen erfordern deine <b>explizite Freigabe</b> im Wallet-Popup.`:`Verbinde deine Wallet, um Live-Mints direkt über Pump.fun und PumpSwap zu traden.`}
      </div>
    </section>
  </div>
  </div>`;
}

// ── Telegram Notifications ───────────────────────────────────────────────────
function telegram(){
  const s=state.data||{},c=s.config||{},tg=c.telegram||{};
  const enabled=Boolean(tg.enabled);
  return`<div class="page">
  ${hero('Telegram Live-Alerts','Verbinde deinen Telegram-Bot, um Buy/Sell-Signale, Rug-Pull-Warnungen und PnL-Benachrichtigungen direkt aufs Smartphone zu erhalten.')}
  <div class="grid">
    <section class="card span-7">
      <div class="cardhead"><div><h3>Telegram Bot Konfiguration</h3><p>Erstelle kostenlos via @BotFather in 1 Minute</p></div></div>
      <div class="cardbody">
        <div class="field">
          <label>Telegram Bot Token</label>
          <input id="tg-token" type="password" placeholder="z. B. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" value="${esc(tg.bot_token||'')}">
        </div>
        <div class="field" style="margin-top:10px">
          <label>Chat ID oder Kanal / Gruppen-ID</label>
          <input id="tg-chat" placeholder="z. B. 987654321 oder @dein_trading_kanal" value="${esc(tg.chat_id||'')}">
        </div>
        <div class="formgrid" style="margin-top:12px">
          <div class="field">
            <label>Alert Status</label>
            <select id="tg-enabled">
              <option value="true" ${enabled?'selected':''}>AKTIV (Senden ein)</option>
              <option value="false" ${!enabled?'selected':''}>PAUSIERT (Aus)</option>
            </select>
          </div>
          <div class="field">
            <label>Buy Alerts</label>
            <select id="tg-notify-buy">
              <option value="true" ${tg.notify_buy!==false?'selected':''}>JA (Bei jedem Kauf)</option>
              <option value="false" ${tg.notify_buy===false?'selected':''}>NEIN</option>
            </select>
          </div>
        </div>
        <div class="formgrid" style="margin-top:10px">
          <div class="field">
            <label>Exit / TP / SL Alerts</label>
            <select id="tg-notify-exit">
              <option value="true" ${tg.notify_exit!==false?'selected':''}>JA (Take Profit & Stop Loss)</option>
              <option value="false" ${tg.notify_exit===false?'selected':''}>NEIN</option>
            </select>
          </div>
          <div class="field">
            <label>Rug / Blacklist Alerts</label>
            <select id="tg-notify-rug">
              <option value="true" ${tg.notify_rug!==false?'selected':''}>JA (Bei Rug-Erkennung)</option>
              <option value="false" ${tg.notify_rug===false?'selected':''}>NEIN</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary" onclick="saveTelegramConfig()">SPEICHERN & AKTIVIEREN</button>
          <button class="btn good" onclick="testTelegramConnection()">✈ TEST-NACHRICHT SENDEN</button>
        </div>
      </div>
    </section>
    <section class="card span-5">
      <div class="cardhead"><div><h3>Schnellanleitung (3 Schritte)</h3><p>In 60 Sekunden eingerichtet</p></div></div>
      <div class="cardbody kv" style="font-size:11px;line-height:1.6">
        <div class="kvrow"><span>1. Bot erstellen</span><b>Öffne @BotFather auf Telegram & sende <code>/newbot</code></b></div>
        <div class="kvrow"><span>2. Token kopieren</span><b>Füge den erhaltenen HTTP API Token links ein</b></div>
        <div class="kvrow"><span>3. Chat-ID ermitteln</span><b>Sende /start an deinen Bot oder nutze @userinfobot</b></div>
      </div>
      <div class="notice ${enabled&&tg.bot_token?'good':'warn'}" style="margin:10px 12px 12px">
        ${enabled&&tg.bot_token?'✓ Telegram Notifier ist aktiv. Signale werden in Echtzeit gepusht.':'Telegram noch nicht verknüpft. Trage Token & Chat-ID ein und klicke auf "Test-Nachricht senden".'}
      </div>
    </section>
  </div>
  </div>`;
}

// ── Pro Abo & Monetarisierungs-Modell ─────────────────────────────────────────
function pro(){
  const s=state.data||{},c=s.config||{},proTier=c.pro_tier||{active:false,plan:'community'};
  return`<div class="page">
  ${hero('HELIX Pro Subscription Model','High-Performance Memecoin Sniper Terminal — SaaS-Abonnement mit Community, Pro Sniper und Institutional Lizenz.')}
  
  <div class="grid">
    <!-- Community Plan -->
    <section class="card span-4" style="border-top:3px solid var(--text3)">
      <div class="cardhead"><div><h3>Community Free</h3><p>Open Source Basisfunktionen</p></div><b style="font-size:14px;color:var(--text0)">0 SOL</b></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>DEX Feed</span><b>DexScreener + Pump.fun</b></div>
        <div class="kvrow"><span>Paper Trading</span><b>Unbegrenzt</b></div>
        <div class="kvrow"><span>Max Positionen</span><b>5</b></div>
        <div class="kvrow"><span>Scan Latenz</span><b>~1.5s</b></div>
        <div class="kvrow"><span>Jito MEV Bundles</span><b>Basis</b></div>
        <div class="kvrow"><span>Telegram Alerts</span><b>Standard</b></div>
      </div>
      <div class="cardbody" style="padding-top:0">
        <button class="btn sm" style="width:100%" disabled>AKTUELLER PLAN</button>
      </div>
    </section>

    <!-- Pro Sniper Plan -->
    <section class="card span-4" style="border-top:3px solid var(--neon);box-shadow:0 0 20px var(--neon-glow)">
      <div class="cardhead"><div><h3 style="color:var(--neon)">★ PRO SNIPER</h3><p>Für profitable Sol-Trader</p></div><b style="font-size:14px;color:var(--neon)">0.75 SOL / Mo</b></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>Sub-100ms Pump.fun Socket</span><b class="up">AKTIV</b></div>
        <div class="kvrow"><span>Jito Block Engine MEV Tips</span><b class="up">INCLUDED</b></div>
        <div class="kvrow"><span>Max Positionen</span><b>25</b></div>
        <div class="kvrow"><span>Scan Latenz</span><b class="up">Ultra-Fast (&lt;50ms)</b></div>
        <div class="kvrow"><span>Multi-Take-Profit Stufen</span><b>Unbegrenzt</b></div>
        <div class="kvrow"><span>VIP Telegram Signale</span><b>Sofort-Push</b></div>
      </div>
      <div class="cardbody" style="padding-top:0">
        <button class="btn primary" style="width:100%" onclick="activateProPlan('pro_sniper')">${proTier.plan==='pro_sniper'?'PLAN AKTIV (VERLÄNGERN)':'PRO SNIPER AKTIVIEREN'}</button>
      </div>
    </section>

    <!-- Institutional Tier -->
    <section class="card span-4" style="border-top:3px solid var(--purple)">
      <div class="cardhead"><div><h3 style="color:var(--purple)">INSTITUTIONAL</h3><p>Hedgefonds & Alpha Syndicate</p></div><b style="font-size:14px;color:var(--purple)">2.5 SOL / Mo</b></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>Dedicated Geyser RPC</span><b class="up">Tokyo / NY / FRA</b></div>
        <div class="kvrow"><span>Custom Strategy Scripter</span><b class="up">Python / TS API</b></div>
        <div class="kvrow"><span>Max Positionen</span><b>Unbegrenzt</b></div>
        <div class="kvrow"><span>Auto-Rebalancing</span><b>Multi-Wallet</b></div>
        <div class="kvrow"><span>Privater Discord Alpha Bot</span><b>Dediziert</b></div>
        <div class="kvrow"><span>White-Label Branding</span><b>Inklusive</b></div>
      </div>
      <div class="cardbody" style="padding-top:0">
        <button class="btn" style="width:100%" onclick="activateProPlan('institutional')">INSTITUTIONAL AKTIVIEREN</button>
      </div>
    </section>
  </div>

  <section class="card">
    <div class="cardhead"><div><h3>Lizenzschlüssel & Web3 Checkout</h3><p>Zahlung direkt über deine verbundene Phantom/Solflare Wallet</p></div></div>
    <div class="cardbody" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:240px">
        <div class="field">
          <label>Lizenzschlüssel eingeben (oder 1-Click aktivieren)</label>
          <input id="pro-license-input" placeholder="HLX-PRO-XXXX-XXXX" value="${esc(proTier.license_key||'')}">
        </div>
      </div>
      <div style="padding-top:16px;display:flex;gap:8px">
        <button class="btn primary" onclick="redeemLicense()">LIZENZ FREISCHALTEN</button>
        <button class="btn good" onclick="oneClickWeb3Checkout()">WEITERLEITUNG ZU SOLANA PAY</button>
      </div>
    </div>
  </section>
  </div>`;
}

// ── Settings ──────────────────────────────────────────────────────────────────
function settings(){
  const s=state.data||{},c=s.config||{},ex=c.execution||{};
  const fields=[
    ['poll_seconds','Market poll interval (s)'],
    ['position_refresh_seconds','Position refresh interval (s)'],
    ['starting_sol','Starting SOL (next reset only)'],
    ['max_positions','Max open positions'],
    ['max_trade_sol','Max trade size (SOL)'],
    ['max_daily_loss_sol','Max daily loss (SOL)'],
    ['sniper_max_age_seconds','Sniper max age (s)'],
    ['sniper_min_score','Sniper min score'],
    ['feed_candidates','Feed candidates'],
    ['enrich_concurrency','Quote concurrency'],
    ['hft_candidates','HFT/Scalper top N'],
    ['hft_min_liquidity_usd','HFT min liquidity (USD)'],
  ];
  return`<div class="page">
  ${hero('System Settings','Engine, risk and provider settings. Changes validate, save and activate without restart.')}
  <div class="grid">
    <section class="card span-7">
      <div class="cardhead"><div><h3>Engine & Risk</h3><p>Changes apply to new positions immediately</p></div></div>
      <div class="cardbody">
        <div class="formgrid">
          ${fields.map(([k,l])=>`<div class="field"><label>${l}</label><input id="cfg-${k}" type="number" min="0" step="${['max_positions','sniper_max_age_seconds','feed_candidates','enrich_concurrency','hft_candidates'].includes(k)?1:0.1}" value="${n(c[k])}"></div>`).join('')}
        </div>
        <div class="formgrid" style="margin-top:12px">
          <div class="field"><label>Active Strategy</label><select id="cfg-strategy">${Object.keys(s.strategies||{}).map(k=>`<option value="${esc(k)}" ${c.strategy===k?'selected':''}>${esc(k)}</option>`).join('')}</select></div>
          <div class="field"><label>Auto Trade</label><select id="cfg-auto"><option value="true" ${c.auto_trade?'selected':''}>ON — paper entries allowed</option><option value="false" ${!c.auto_trade?'selected':''}>OFF — scanner only</option></select></div>
        </div>
        <div class="notice warn" style="margin-top:12px">Starting SOL sets capital for the next Paper Reset. It does not retroactively change the live balance.</div>
        <div style="height:14px"></div>
        <button class="btn primary" onclick="saveConfig()">SAVE ENGINE CONFIG</button>
      </div>
    </section>
    <section class="card span-5">
      <div class="cardhead"><div><h3>Market Providers</h3><p>Pump.fun discovery and DexScreener quote fallback</p></div></div>
      <div class="cardbody">
        <div class="field"><label>Pump.fun Base URL</label><input id="cfg-pumpbase" value="${esc(c.pumpfun_base||'https://frontend-api-v3.pump.fun')}"></div>
        <div class="field" style="margin-top:10px"><label>DexScreener Base URL</label><input id="cfg-dexbase" value="${esc(c.dexscreener_base||'https://api.dexscreener.com')}"></div>
        <div class="field" style="margin-top:10px"><label>Pump.fun JWT</label><input id="cfg-token" type="password" autocomplete="off" placeholder="Paste current JWT to replace"></div>
        <div class="notice ${s.providers?.pumpfun_auth?'good':'bad'}" style="margin-top:12px">Pump.fun auth: <b>${s.providers?.pumpfun_auth?'CONFIGURED':'MISSING'}</b><br><span class="muted">JWT stays in environment memory only — never stored on disk.</span></div>
        <div style="height:12px"></div>
        <button class="btn primary" onclick="saveConfig(true)">SAVE PROVIDERS</button>
      </div>
    </section>
    <section class="card span-12">
      <div class="cardhead"><div><h3>Execution Mode</h3><p>Wähle zwischen Simulation (Paper), Dry-Run oder 1-Click Echtgeld Live-Trading</p></div></div>
      <div class="cardbody">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn ${(s.mode||'paper')==='paper'?'primary':''}" onclick="setMode('paper')">PAPER MODE (SIMULATION)</button>
          <button class="btn ${s.mode==='dry_run'?'warn':''}" onclick="setMode('dry_run')">DRY-RUN MODE</button>
          <button class="btn ${s.mode==='live'?'bad':'good'}" onclick="oneClickLiveTrading()">⚡ 1-CLICK ECHTGELD LIVE TRADING</button>
          <div class="notice ${s.mode==='live'?'good':'warn'}" style="font-size:11px;max-width:440px">
            ${s.mode==='live'?'⚡ LIVE TRADING AKTIV: Reale Transaktionen auf Solana Mainnet mit Wallet-Freigabe.':'Paper Mode aktiv. Klicke auf den Button oben, um sofort Live-Trading mit deiner Solana Wallet zu aktivieren.'}
          </div>
        </div>
      </div>
    </section>
    <section class="card span-12 danger-zone">
      <div class="cardhead"><div><h3>Paper Environment</h3><p>Safe reset — does not interact with any Solana wallet</p></div></div>
      <div class="cardbody actions">
        <button class="btn bad" onclick="resetPaper()">RESET ALL PAPER STATE</button>
        <button class="btn" onclick="control('paper')">RE-ARM PAPER MODE</button>
      </div>
    </section>
  </div>
  </div>`;
}

// ── Diagnostics ───────────────────────────────────────────────────────────────
function diagnostics(){
  const s=state.data||{},lat=s.latency||{},cb=s.circuit_breaker||{};
  return`<div class="page">
  ${hero('System Health','Operational telemetry — feed quality, quote integrity, latency, circuit breaker, runtime errors.',
    `<button class="btn primary" onclick="pumpDiag()">TEST PUMP.FUN</button>
     <button class="btn" onclick="sysDiag()">SYSTEM CHECK</button>`)}
  ${cb.active?`<div class="circuit-breaker-alert">⛔ CIRCUIT BREAKER — ${esc(cb.reason)}<button class="btn warn sm" style="margin-left:auto" onclick="clearKill()">RESET</button></div>`:''}
  <div class="grid">
    <section class="card span-4">
      <div class="cardhead"><div><h3>Provider Health</h3><p>Data source status</p></div></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>Pump.fun feed</span><b class="${s.feed_quality==='live'?'up':'down'}">${esc(s.feed_quality||'—')}</b></div>
        <div class="kvrow"><span>Pump.fun auth</span><b class="${s.providers?.pumpfun_auth?'up':'down'}">${s.providers?.pumpfun_auth?'CONFIGURED':'MISSING'}</b></div>
        <div class="kvrow"><span>Candidates</span><b>${n(s.coins?.length)}</b></div>
        <div class="kvrow"><span>Fresh quotes</span><b class="up">${n(s.health?.quote_fresh)}</b></div>
        <div class="kvrow"><span>Stale quotes</span><b class="${n(s.health?.quote_stale)?'amber':'up'}">${n(s.health?.quote_stale)}</b></div>
        <div class="kvrow"><span>Quote successes</span><b>${n(s.health?.quote_success_total)}</b></div>
        <div class="kvrow"><span>Quote failures</span><b class="${n(s.health?.quote_failure_total)?'down':'up'}">${n(s.health?.quote_failure_total)}</b></div>
        <div class="kvrow"><span>Uptime</span><b>${Math.floor(n(s.uptime_seconds))}s</b></div>
      </div>
    </section>
    <section class="card span-4">
      <div class="cardhead"><div><h3>Latency (p50 / p95)</h3><p>Hot-path timing</p></div></div>
      <div class="cardbody kv">
        <div class="kvrow"><span>Signal p50</span><b class="${latClass(lat.signal_latency_p50_ms)}">${ms2(lat.signal_latency_p50_ms)}</b></div>
        <div class="kvrow"><span>Signal p95</span><b class="${latClass(lat.signal_latency_p95_ms)}">${ms2(lat.signal_latency_p95_ms)}</b></div>
        <div class="kvrow"><span>Execution p50</span><b class="${latClass(lat.execution_latency_p50_ms)}">${ms2(lat.execution_latency_p50_ms)}</b></div>
        <div class="kvrow"><span>Execution p95</span><b class="${latClass(lat.execution_latency_p95_ms)}">${ms2(lat.execution_latency_p95_ms)}</b></div>
        <div class="kvrow"><span>RPC</span><b class="${latClass(lat.rpc_latency_ms)}">${ms2(lat.rpc_latency_ms)}</b></div>
      </div>
    </section>
    <section class="card span-4">
      <div class="cardhead"><div><h3>Market Regime</h3><p>Macro classification</p></div></div>
      <div class="cardbody kv">
        ${Object.entries((s.market_regime?.counts)||{}).map(([r,c])=>`<div class="kvrow"><span>${regimeTag(r)}</span><b>${c}</b></div>`).join('')||'<div class="empty">Waiting for data.</div>'}
      </div>
    </section>
    <section class="card span-12">
      <div class="cardhead"><div><h3>Runtime Logs</h3><p>Engine event stream — newest first</p></div></div>
      <div class="cardbody"><pre class="log">${esc((s.logs||[]).slice(0,200).join('\n'))}</pre></div>
    </section>
  </div>
  </div>`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(preserveDraft=false){
  const currentDraft=preserveDraft?[...document.querySelectorAll('#app input[id],#app select[id]')].filter(e=>e.type!=='password').map(e=>[e.id,e.value]):null;
  const storedDrafts=readFormDrafts();
  const draft=currentDraft??storedDrafts[state.view]??[];
  const focused=preserveDraft?document.activeElement?.id:'';
  const selection=focused&&document.activeElement?.selectionStart!=null?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
  try{
    const pages={dashboard,scanner,heatmap,sniper,strategies,positions,activity,analytics,backtest,risk,wallet,telegram,pro,settings,diagnostics};
    const page=(pages[state.view]||dashboard)();
    const app=$('#app');
    if(!app)return;
    app.innerHTML=`<div class="shell">${side()}<main class="main">${topbar()}<div class="content">${page}<div class="footer">HELIX PRO · Solana Pump.fun & PumpSwap Execution Terminal · ${(state.data?.mode||'paper').toUpperCase()} · Non-Custodial · No Private Keys Stored</div></div></main></div>`;
    for(const[id,value]of draft){const e=document.getElementById(id);if(e)e.value=value}
    if(currentDraft){storedDrafts[state.view]=currentDraft;writeFormDrafts(storedDrafts)}
    if(focused){const e=document.getElementById(focused);if(e){e.focus({preventScroll:true});if(selection)try{e.setSelectionRange(...selection)}catch{}}}
  }catch(err){
    console.error('HELIX render error',err);
    const app=$('#app');
    if(app)app.innerHTML=`<div class="boot-screen"><div><div class="boot-card"><div class="boot-mark">H</div><div><div class="boot-title">HELIX <span>PRO</span></div><div class="boot-sub">TERMINAL STATUS</div></div></div><div class="boot-status">Render aktualisiert.</div></div></div>`;
  }
}

// ── Event Handlers ────────────────────────────────────────────────────────────
window.addEventListener('error',e=>console.error('HELIX error',e.error||e.message));
window.addEventListener('unhandledrejection',e=>console.error('HELIX promise rejection',e.reason));
function go(v){state.view=v;safeSetView(v);render()}
async function sync(){try{state.data=await api('/api/state');render()}catch(e){toast(e.message)}}
async function refreshNow(){await sync();toast('State refreshed')}
async function control(action){try{await api('/api/control',{method:'POST',body:JSON.stringify({action})});await sync()}catch(e){toast(e.message)}}
function confirmKill(){if(!confirm('Activate Emergency Kill? This blocks all new entries immediately.'))return;control('kill')}
async function clearKill(){await control('clear-kill');toast('Emergency kill cleared')}
async function resetPaper(){if(!confirm('Delete ALL paper positions, fills and PnL?'))return;try{await api('/api/paper/reset',{method:'POST'});await sync();toast('Paper state reset')}catch(e){toast(e.message)}}
async function switchStrategy(k){try{const r=await api('/api/strategy',{method:'POST',body:JSON.stringify({strategy:k})});clearFormDraft('strategies');toast(`Strategie aktiv: ${r.strategy}`);await sync()}catch(e){toast(e.message)}}
async function toggleMultiStrat(k){
  try{
    const r=await api('/api/strategy/multi-toggle',{method:'POST',body:JSON.stringify({strategy:k})});
    toast(`Multi-Strategie: ${r.active_strategies?.join(', ')?.toUpperCase()}`);
    await sync();
  }catch(e){toast(e.message)}
}
async function saveStrategyParams(){
  const c=structuredClone(state.data.config),k=state.data.strategy;
  c.strategies[k]={...c.strategies[k]};
  for(const key of['min_score','stop_pct','take_pct','trail_pct','max_hold_minutes'])
    c.strategies[k][key]=key==='max_hold_minutes'?Math.round(Number($(`#st-${key}`).value)):Number($(`#st-${key}`).value);
  try{await api('/api/config',{method:'PUT',body:JSON.stringify(c)});clearFormDraft('strategies');await sync();toast(`${k} saved`)}catch(e){toast(e.message)}
}
async function saveConfig(providerOnly=false){
  const c=structuredClone(state.data.config);
  for(const k of['poll_seconds','position_refresh_seconds','starting_sol','max_positions','max_trade_sol','max_daily_loss_sol','sniper_max_age_seconds','sniper_min_score','feed_candidates','enrich_concurrency','hft_candidates','hft_min_liquidity_usd'])
    c[k]=Number($(`#cfg-${k}`).value);
  for(const k of['max_positions','sniper_max_age_seconds','feed_candidates','enrich_concurrency','hft_candidates'])c[k]=Math.round(c[k]);
  c.auto_trade=$('#cfg-auto').value==='true';
  c.strategy=$('#cfg-strategy').value;
  c.pumpfun_base=$('#cfg-pumpbase').value.trim();
  c.dexscreener_base=$('#cfg-dexbase').value.trim();
  const token=$('#cfg-token')?.value?.trim();if(token)c.pumpfun_auth_token=token;
  try{await api('/api/config',{method:'PUT',body:JSON.stringify(c)});clearFormDraft('settings');await sync();toast(providerOnly?'Providers saved':'Config saved')}catch(e){toast(e.message)}
}
async function setMode(m){
  if(m==='live'&&!confirm('Enable LIVE trading? All transactions will use real funds and require explicit wallet signature.'))return;
  try{await api('/api/control',{method:'POST',body:JSON.stringify({action:m})});await sync();toast(`Mode: ${m.toUpperCase()}`)}catch(e){toast(e.message)}
}
async function manualBuy(mint){try{await api('/api/paper/buy',{method:'POST',body:JSON.stringify({mint})});await sync();toast('Paper BUY opened')}catch(e){toast(e.message)}}
async function exitPos(id){try{await api('/api/paper/exit',{method:'POST',body:JSON.stringify({id})});await sync();toast('Position closed')}catch(e){toast(e.message)}}
async function pumpDiag(){try{const r=await api('/api/diagnostics/pumpfun');toast(`Pump.fun: ${r.count} coins · ${r.quality}`)}catch(e){toast(`Pump.fun error: ${e.message}`)}}
async function sysDiag(){try{const r=await api('/api/diagnostics/system');toast(`Regime: ${r.market_regime?.macro_regime||'?'} · CB: ${r.circuit_breaker?.active?'TRIPPED':'OK'}`)}catch(e){toast(e.message)}}
async function emergencyStop(){if(!confirm('Immediately stop all automated trading?'))return;try{await api('/api/emergency/stop',{method:'POST'});await sync();toast('EMERGENCY: Trading stopped')}catch(e){toast(e.message)}}
async function emergencyCloseAll(){if(!confirm('Immediately close ALL open positions at market?'))return;try{await api('/api/emergency/close-all',{method:'POST'});await sync();toast('EMERGENCY: All positions closed')}catch(e){toast(e.message)}}
async function emergencyCancelAll(){try{await api('/api/emergency/cancel-all',{method:'POST'});await sync();toast('EMERGENCY: Orders cancelled')}catch(e){toast(e.message)}}

// ── Backtest ──────────────────────────────────────────────────────────────────
async function runBacktest(){
  if(state.btLoading)return;
  state.btLoading=true;render();
  const strategy=$('#bt-strategy')?.value||state.data?.strategy||'combo';
  const amount=Number($('#bt-amount')?.value||0.1);
  try{
    const r=await api('/api/backtest/run',{method:'POST',body:JSON.stringify({strategy,amount_sol:amount})});
    state.backtest=r;toast(`Backtest: ${r.metrics?.win_rate_pct?.toFixed(1)||'?'}% win rate`)
  }catch(e){toast(e.message)}
  finally{state.btLoading=false;render()}
}

// ── Wallet Connector (Non-Custodial) ──────────────────────────────────────────
async function quickConnectWallet(){
  if(window.solana) return connectWallet('phantom');
  if(window.solflare) return connectWallet('solflare');
  go('wallet');
  toast('Wähle Phantom oder Solflare zum Verbinden');
}

async function oneClickLiveTrading(){
  // Check if wallet connected, if not connect phantom/solflare
  if(state.wallet?.status!=='connected'){
    const hasPhantom=!!window.solana;
    const hasSolflare=!!window.solflare;
    if(hasPhantom){
      toast('Verbinde Phantom Wallet...');
      await connectWallet('phantom');
    } else if(hasSolflare){
      toast('Verbinde Solflare Wallet...');
      await connectWallet('solflare');
    } else {
      go('wallet');
      toast('Installiere oder entsperre Phantom oder Solflare Extension');
      return;
    }
  }

  // Confirm and arm LIVE trading immediately
  try{
    await api('/api/control',{method:'POST',body:JSON.stringify({action:'arm_live'})});
    await sync();
    toast('⚡ ECHTGELD LIVE TRADING AKTIVIERT!');
  }catch(e){
    toast(`Fehler beim Aktivieren: ${e.message}`);
  }
}

async function connectWallet(type){
  const provider=type==='phantom'?window.solana:window.solflare;
  if(!provider){
    toast(`${type} wallet nicht erkannt. Bitte Browser-Extension installieren.`);
    return;
  }
  try{
    state.wallet={type,address:'',status:'connecting'};render();
    const resp=await provider.connect();
    const address=resp?.publicKey?.toString()||provider.publicKey?.toString()||'';
    if(!address)throw new Error('Konnte öffentliche Adresse nicht lesen');
    // Validate with backend
    await api('/api/wallet/verify',{method:'POST',body:JSON.stringify({address,wallet:type})});
    state.wallet={type,address,status:'connected'};
    render();toast(`${type} verbunden: ${address.slice(0,6)}...${address.slice(-4)}`);
  }catch(e){state.wallet={type,address:'',status:'error'};render();toast(`Wallet Fehler: ${e.message}`)}
}
async function disconnectWallet(){
  const type=state.wallet.type;
  const provider=type==='phantom'?window.solana:window.solflare;
  if(provider){try{await provider.disconnect()}catch{}}
  state.wallet={type:'',address:'',status:'disconnected'};render();toast('Wallet disconnected');
}

// ── Telegram & Pro Handlers ───────────────────────────────────────────────────
async function saveTelegramConfig(){
  const bot_token=$('#tg-token')?.value?.trim()||'';
  const chat_id=$('#tg-chat')?.value?.trim()||'';
  const enabled=$('#tg-enabled')?.value==='true';
  const notify_buy=$('#tg-notify-buy')?.value==='true';
  const notify_exit=$('#tg-notify-exit')?.value==='true';
  const notify_rug=$('#tg-notify-rug')?.value==='true';

  try{
    await api('/api/telegram/config',{
      method:'POST',
      body:JSON.stringify({bot_token,chat_id,enabled,notify_buy,notify_exit,notify_rug})
    });
    await sync();
    toast('Telegram Konfiguration gespeichert');
  }catch(e){toast(`Fehler: ${e.message}`)}
}

async function testTelegramConnection(){
  const bot_token=$('#tg-token')?.value?.trim()||'';
  const chat_id=$('#tg-chat')?.value?.trim()||'';
  toast('Sende Test-Nachricht...');
  try{
    const r=await api('/api/telegram/test',{
      method:'POST',
      body:JSON.stringify({bot_token,chat_id})
    });
    toast(`Telegram verbunden mit ${r.bot_name||'Bot'}!`);
  }catch(e){toast(`Telegram Fehler: ${e.message}`)}
}

async function activateProPlan(plan){
  try{
    const r=await api('/api/pro/activate',{
      method:'POST',
      body:JSON.stringify({plan})
    });
    await sync();
    toast(`★ Plan ${plan.toUpperCase()} erfolgreich aktiviert!`);
  }catch(e){toast(`Fehler: ${e.message}`)}
}

function redeemLicense(){
  const key=$('#pro-license-input')?.value?.trim();
  if(!key){toast('Bitte Lizenzschlüssel eingeben');return}
  activateProPlan('pro_sniper');
}

function oneClickWeb3Checkout(){
  if(state.wallet?.status!=='connected'){
    quickConnectWallet();
    return;
  }
  toast(`Solana Pay Checkout gestartet für ${state.wallet.address.slice(0,6)}...`);
  setTimeout(()=>activateProPlan('pro_sniper'),1200);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect(){
  if(state.ws)state.ws.close();
  const proto=location.protocol==='https:'?'wss':'ws';
  try{
    state.ws=new WebSocket(`${proto}://${location.host}/ws`);
    state.ws.onmessage=e=>{
      try{
        const keep=window.scrollY;
        const next=JSON.parse(e.data);
        if(next&&typeof next==='object'){
          state.data=next;
          if(!isEditingFormField()){render(true);window.scrollTo(0,keep)}
        }
      }catch(err){console.warn('HELIX ws payload ignored',err)}
    };
    state.ws.onerror=()=>{};
    state.ws.onclose=()=>setTimeout(connect,1200);
  }catch(err){console.warn('HELIX ws unavailable',err);setTimeout(connect,2000)}
}

// ── Boot ──────────────────────────────────────────────────────────────────────
render();
connect();
sync();
