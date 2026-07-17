// src/brain.js — Phase A brain: sequential action-plan executor. Drives the sim
// strictly through the player API (autoWalk/gesture/jump) — never pokes sim state,
// so every locomotion invariant (ramping, steering, gesture gating) applies.
// Plan: [{do:'walk',forward,right,speed?}, {do:'turn',deg}, {do:'gesture',name},
//        {do:'jump'}, {do:'wait',s}] — hand frame: forward = +heading, right = 90° cw.
// 'turn' pivots in place (sim.pivot) — a separate gait from continuous walk-and-turn,
// which stays limited by the anatomical finger-yaw cone (turnCycle red-by-choice).
import * as C from './tuning.js';
import * as M from './math.js';

const RUNNING = 0, DONE = 1;

// Gemini's JSON mode isn't airtight — it sometimes appends trailing "thinking out
// loud" text after a complete, valid JSON object. Parse just the first balanced
// {...} instead of assuming the whole string is clean JSON.
function parseFirstJSON(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON object in reply');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('unterminated JSON object in reply');
}

export function makeBrain(sim, rig, camera) {
  const body = rig.mount;
  const st = { status: 'idle', detail: '', plan: [], i: -1, onstatus: null };
  const setStatus = (status, detail = '') => {
    st.status = status; st.detail = detail;
    if (st.onstatus) st.onstatus(st);
  };
  const fail = (msg) => { sim.autoWalk(0, 0); st.i = -1; setStatus('error', msg); };

  const ACTIONS = {
    wait(a, dt) {
      a.left = (a.left ?? Math.min(a.s ?? 1, 30)) - dt;
      return a.left <= 0 ? DONE : RUNNING;
    },
    jump(a) {
      if (!a.started) {
        if (sim.s.airborne) return RUNNING;              // land a prior jump first
        sim.jump(); a.started = true; return RUNNING;
      }
      return sim.s.airborne ? RUNNING : DONE;
    },
    gesture(a) {
      if (!a.started) {
        if (sim.s.airborne || sim.s.speed > C.V_MOVE) return RUNNING;  // settle first
        if (!sim.gesture(a.name)) throw `unknown gesture "${a.name}"`;
        a.started = true; return RUNNING;
      }
      return sim.s.gesture ? RUNNING : DONE;
    },
    walk(a) {
      if (!a.target) {                                   // hand frame → world, once
        const h = sim.s.heading, f = a.forward ?? 0, r = a.right ?? 0;
        a.target = {
          x: body.position.x + f * Math.cos(h) + r * Math.sin(h),
          z: body.position.z - f * Math.sin(h) + r * Math.cos(h),
        };
      }
      const dx = a.target.x - body.position.x, dz = a.target.z - body.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) { sim.autoWalk(0, 0); return DONE; }
      const v = Math.min(a.speed ?? 0.8, Math.max(0.4, 2 * d));  // arrival damping
      sim.autoWalk(dx / d * v, dz / d * v);
      return RUNNING;
    },
    turn(a) {                                            // pivot-in-place, zero translation
      if (!a.started) {
        if (sim.s.airborne || sim.s.speed > C.V_MOVE) return RUNNING;  // settle first
        if (!sim.pivot(a.deg ?? 90)) throw 'pivot refused (busy)';
        a.started = true; return RUNNING;
      }
      return sim.s.pivotTarget != null ? RUNNING : DONE;
    },
  };
  const TIMEOUT = {
    wait: (a) => (a.s ?? 1) + 1,
    jump: () => 5,
    gesture: () => 8,
    walk: (a) => 4 + 2 * Math.hypot(a.forward ?? 0, a.right ?? 0),
    turn: (a) => 3 + Math.abs(a.deg ?? 90) / 20,
  };

  function run(plan) {
    if (!Array.isArray(plan) || !plan.length) { fail('empty plan'); return false; }
    for (const a of plan) if (!ACTIONS[a.do]) { fail(`unknown action "${a.do}"`); return false; }
    st.plan = plan.map(a => ({ ...a, t: 0 }));           // copy: ticking mutates
    st.i = 0;
    setStatus('acting', `1/${plan.length} ${plan[0].do}`);
    return true;
  }
  function stop() {
    if (st.i >= 0 || st.status !== 'idle') { sim.autoWalk(0, 0); st.i = -1; setStatus('idle'); }
  }
  function tick(dt) {
    if (st.i < 0) return;
    const a = st.plan[st.i];
    a.t += dt;
    if (a.t > TIMEOUT[a.do](a)) return fail(`${a.do} timed out (${st.i + 1}/${st.plan.length})`);
    let r;
    try { r = ACTIONS[a.do](a, dt); } catch (e) { return fail(String(e)); }
    if (r === DONE) {
      st.i++;
      if (st.i >= st.plan.length) { st.i = -1; setStatus('idle'); }
      else setStatus('acting', `${st.i + 1}/${st.plan.length} ${st.plan[st.i].do}`);
    }
  }

  // ---- planner: voice/typed command → LLM → plan ----
  const SYSTEM = `You are Thing — a friendly severed left hand that walks on its fingertips, like Thing from the Addams Family. You express yourself physically; you receive transcribed voice commands and questions from your human.

Reply ONLY with JSON (no markdown): {"say":"...","plan":[...]}
"plan" is a sequence of actions, executed in order:
- {"do":"gesture","name":"..."} — yes (nod), no (index wag), idk (shrug), wave (hello/goodbye), laugh, bow, point (at what's ahead), beckon (come here), thinking (hmm), tap (impatient drumming), thumbsUp (strong approval/success), thumbsDown (strong disapproval/failure), flipBird (rude/dismissive — use RARELY, only for a joking insult or a clearly hostile request, never at the user unprompted)
- {"do":"walk","forward":F,"right":R,"speed":S} — walk to an offset in YOUR body frame; negative allowed. You end up facing your direction of travel. Units: world units, your body is ~2 long; typical distances 1-6. "speed" (u/s) sets your pace: ~0.8 (default, relaxed) for a normal walk, ~1.5 for a jog/trot, ~2.2-2.5 for a full run — use a higher speed whenever told to hurry, run, or race, or when the situation is urgent/excited.
- {"do":"turn","deg":D} — positive = left; you pivot in place (no translation) — fast, use it freely for "turn around", "face me", "look this way"
- {"do":"jump"}
- {"do":"wait","s":S}
Answer questions with gestures wherever possible: agreement/yes → yes; refusal/negative → no; unknown → idk; funny → laugh; greeting → wave; pondering first → thinking. "say" is optional and SHORT (tiny robot voice) — only when a gesture cannot carry the answer.
Each message starts with [state: ...] — your position, heading, and where the user watches from (their camera). "Come here" = walk toward the user, stop ~1.5 units short, then beckon or wave.
Keep plans ≤ 12 actions. Impossible or nonsense requests → gesture no or idk, say why briefly.`;

  const history = [];                                    // Gemini contents format
  function stateLine() {
    const h = sim.s.heading, p = body.position;
    let user = '';
    if (camera) {
      const dx = camera.position.x - p.x, dz = camera.position.z - p.z;
      const fwd = dx * Math.cos(h) - dz * Math.sin(h);
      const rgt = dx * Math.sin(h) + dz * Math.cos(h);
      user = `; user at forward ${fwd.toFixed(1)}, right ${rgt.toFixed(1)}, dist ${Math.hypot(dx, dz).toFixed(1)}`;
    }
    return `[state: pos (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), heading ${(h * 180 / Math.PI).toFixed(0)}°${user}]`;
  }
  async function ask(text) {
    stop();
    setStatus('thinking', text);
    history.push({ role: 'user', parts: [{ text: `${stateLine()} ${text}` }] });
    while (history.length > 12) history.shift();
    let reply;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch('/llm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: SYSTEM, contents: history }),
        signal: ctl.signal,
      });
      clearTimeout(t);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      reply = parseFirstJSON(data.text);
    } catch (e) {
      setStatus('error', e.name === 'AbortError' ? 'brain timed out (20s)' : String(e.message || e));
      return null;
    }
    history.push({ role: 'model', parts: [{ text: JSON.stringify(reply) }] });
    if (reply.say) {
      setStatus('saying', reply.say);
      if (typeof speechSynthesis !== 'undefined') {
        const u = new SpeechSynthesisUtterance(reply.say);
        u.pitch = 1.6; u.rate = 1.15;                    // tiny robot voice
        speechSynthesis.speak(u);
      }
    }
    if (Array.isArray(reply.plan) && reply.plan.length) run(reply.plan.slice(0, 20));
    else if (!reply.say) setStatus('error', 'brain returned no plan and nothing to say');
    return reply;
  }
  return { st, run, stop, tick, ask };
}
