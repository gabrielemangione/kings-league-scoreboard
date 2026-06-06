const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let filePath = '.' + req.url;
  if (filePath === './') filePath = './controller.html';
  const extMap = {
    '.html':'text/html','.js':'application/javascript',
    '.css':'text/css','.png':'image/png','.jpg':'image/jpeg',
    '.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp',
  };
  const ext  = path.extname(filePath);
  const mime = extMap[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  leftTeam:  { abbr:'STL', color:'#1e90ff', score:0, logo:null },
  rightTeam: { abbr:'PBL', color:'#ff2d8d', score:0, logo:null },
  centerLogo: null,
  timer: { seconds:0, running:false, limit:600, period:'1° TEMPO' },
  powerCards: {
    left:  { presidential:true, secret:true },
    right: { presidential:true, secret:true },
  },
  activeEvent: null,
  starPlayer:  null,
  matchPhase:  null,
  goalX2Badge: false,
  penalties: [],
};

let timerInterval = null;
let penaltyIdCounter = 0;

// ── Broadcast helpers ──────────────────────────────────────────────────────────

// Stato completo SENZA loghi (loghi mandati separatamente solo a chi si connette)
function stateWithoutLogos() {
  return {
    ...state,
    leftTeam:  { ...state.leftTeam,  logo: state.leftTeam.logo  ? '__LOGO_L__' : null },
    rightTeam: { ...state.rightTeam, logo: state.rightTeam.logo ? '__LOGO_R__' : null },
    centerLogo: state.centerLogo ? '__LOGO_C__' : null,
  };
}

// Broadcast leggero — stato senza loghi
function broadcast(msg) {
  const str = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}

// Broadcast stato completo CON loghi (solo per nuove connessioni)
function sendFullState(ws) {
  ws.send(JSON.stringify({ type:'state', state }));
}

// Broadcast stato senza loghi (per tutti i comandi real-time)
function broadcastState() {
  broadcast({ type:'state', state: stateWithoutLogos() });
}

// Tick timer leggero
function broadcastTimerTick() {
  const str = JSON.stringify({
    type: 'tick',
    seconds: state.timer.seconds,
    penalties: state.penalties,
    matchPhase: state.matchPhase,
  });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}

// ── Timer ──────────────────────────────────────────────────────────────────────
function startTimer() {
  if (timerInterval) return;
  state.timer.running = true;
  timerInterval = setInterval(() => {

    // Conta in avanti
    state.timer.seconds++;

    // Ferma al limite
    if (state.timer.seconds >= state.timer.limit) {
      state.timer.seconds = state.timer.limit;
      stopTimer();
      broadcastState();
      return;
    }

    // Penalties sincronizzate col timer (scalano di 1 secondo)
    state.penalties = state.penalties.map(p => {
      if (p.seconds > 0) p.seconds--;
      return p;
    }).filter(p => p.seconds > 0);

    broadcastTimerTick();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  state.timer.running = false;
}

function scheduleEventClear(evId) {
  setTimeout(() => {
    if (state.activeEvent && state.activeEvent.id === evId) {
      state.activeEvent = null;
      broadcastState();
    }
  }, 4000);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', ws => {
  // Nuova connessione: manda stato COMPLETO con loghi
  sendFullState(ws);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'timer_start': startTimer(); break;
      case 'timer_stop':  stopTimer();  break;

      case 'timer_reset':
        stopTimer();
        state.timer.seconds = 0;
        state.timer.limit   = msg.limit ?? 600;
        state.timer.period  = msg.period ?? '1° TEMPO';
        break;

      case 'timer_set_limit':
        state.timer.limit = msg.limit;
        break;

      case 'period_set':
        state.timer.period = msg.period;
        break;

      case 'score':
        if (msg.side === 'left')  state.leftTeam.score  = Math.max(0, state.leftTeam.score  + (msg.delta||0));
        if (msg.side === 'right') state.rightTeam.score = Math.max(0, state.rightTeam.score + (msg.delta||0));
        break;

      case 'team_config':
        if (msg.side === 'left')  Object.assign(state.leftTeam,  msg.data);
        if (msg.side === 'right') Object.assign(state.rightTeam, msg.data);
        // Config con logo: manda stato completo
        broadcastState();
        return;

      case 'center_logo':
        state.centerLogo = msg.logo;
        broadcastState();
        return;

      case 'power_card':
        state.powerCards[msg.side][msg.card] = msg.value;
        break;

      case 'secret_card': {
        if (msg.active) {
          const scId = Date.now() + Math.random();
          state.activeEvent = { kind:'secret_card', side:msg.side, id:scId };
          scheduleEventClear(scId);
        } else {
          state.activeEvent = null;
        }
        break;
      }

      case 'presidential': {
        if (msg.active) {
          const prId = Date.now() + Math.random();
          state.activeEvent = { kind:'presidential', side:msg.side, id:prId };
          scheduleEventClear(prId);
        } else {
          state.activeEvent = null;
        }
        break;
      }

      case 'goal':
        if (msg.side === 'left')  state.leftTeam.score  += msg.double ? 2 : 1;
        if (msg.side === 'right') state.rightTeam.score += msg.double ? 2 : 1;
        const gId = Date.now() + Math.random();
        state.activeEvent = { kind: msg.double ? 'goal_double' : 'goal', side: msg.side, id: gId };
        scheduleEventClear(gId);
        break;

      case 'clear_event':
        state.activeEvent = null;
        break;

      case 'star_player':
        state.starPlayer = msg.active ? { side:msg.side, name:msg.name } : null;
        break;

      case 'penalty_add':
        state.penalties.push({
          id: ++penaltyIdCounter,
          side: msg.side, kind: msg.kind,
          name: msg.name, seconds: msg.kind === 'expulsion' ? 300 : 120,
        });
        break;

      case 'penalty_remove':
        state.penalties = state.penalties.filter(p => p.id !== msg.id);
        break;

      case 'penalty_clear':
        state.penalties = state.penalties.filter(p => p.side !== msg.side);
        break;

      case 'penalty_clear_all':
        state.penalties = [];
        break;

      case 'match_phase':
        state.matchPhase = msg.phase;
        break;

      case 'goal_x2_badge':
        state.goalX2Badge = msg.active;
        break;

      case 'activatePowerCard':
        state.powerCards[msg.side][msg.card] = false;
        const kind = msg.card === 'presidential' ? 'presidential' : 'secret_card';
        const pcId = Date.now() + Math.random();
        state.activeEvent = { kind, side: msg.side, id: pcId };
        scheduleEventClear(pcId);
        break;
    }

    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`Kings League Scoreboard running on http://localhost:${PORT}`);
  console.log(`Overlay:    http://localhost:${PORT}/overlay.html`);
  console.log(`Controller: http://localhost:${PORT}/controller.html`);
});
