// src/brain.js — Phase A brain: sequential action-plan executor. Drives the sim
// strictly through the player API (autoWalk/gesture/jump) — never pokes sim state,
// so every locomotion invariant (ramping, steering, gesture gating) applies.
// Plan: [{do:'walk',forward,right,speed?}, {do:'turn',deg}, {do:'gesture',name},
//        {do:'jump'}, {do:'wait',s}] — hand frame: forward = +heading, right = 90° cw.
// 'turn' pivots in place (sim.pivot) — a separate gait from continuous walk-and-turn,
// which stays limited by the anatomical finger-yaw cone (turnCycle red-by-choice).
import * as C from './tuning.js';
import * as M from './math.js';
import { GESTURES } from './gestures.js';

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
  // walls are visual-only in the sim; the brain is the only control path, so every
  // walk target clamps to the room interior and Thing simply never leaves
  const ROOM = 4.8;
  const clampRoom = (p) => ({ x: M.clamp(p.x, -ROOM, ROOM), z: M.clamp(p.z, -ROOM, ROOM) });
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
        a.target = clampRoom({
          x: body.position.x + f * Math.cos(h) + r * Math.sin(h),
          z: body.position.z - f * Math.sin(h) + r * Math.cos(h),
        });
      }
      const dx = a.target.x - body.position.x, dz = a.target.z - body.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) { sim.autoWalk(0, 0); return DONE; }
      // face big course changes with a pivot first — steering while walking turns
      // via a slow wide arc (the "turn around and walk back" long-way-around bug);
      // pivoting is what makes reversals read nimble. One pivot max per action.
      const bearingErr = M.wrapAngle(Math.atan2(-dz, dx) - sim.s.heading);
      if (!a.pivoted && Math.abs(bearingErr) > 1.0 && d > 0.5) {
        if (sim.s.pivotTarget != null) return RUNNING;   // pivot in progress
        sim.autoWalk(0, 0);
        if (sim.s.speed > C.V_MOVE) return RUNNING;      // brake to stance first
        if (sim.pivot(bearingErr * 180 / Math.PI)) return RUNNING;
        a.pivoted = true;                                // refused (busy) — walk the arc
      }
      if (sim.s.pivotTarget != null) return RUNNING;
      a.pivoted = true;
      const v = Math.min(a.speed ?? 0.8, Math.max(0.4, 2 * d));  // arrival damping
      sim.autoWalk(dx / d * v, dz / d * v);
      return RUNNING;
    },
    walkTo(a, dt) {                                      // world-coordinate variant — the
      if (!a.target) {                                   // room map speaks in these
        a.target = clampRoom({ x: a.x ?? 0, z: a.z ?? 0 });
        // timeout from INITIAL distance, frozen — recomputing per-tick shrinks it
        // toward the floor as the hand approaches while elapsed keeps growing,
        // spuriously killing long slow walks (bit the napping behavior at 9s)
        a.tmo = 6 + 3 * Math.hypot(a.target.x - body.position.x, a.target.z - body.position.z);
      }
      return ACTIONS.walk(a, dt);                        // reuses walk wholesale
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
    gesture: (a) => (GESTURES[a.name]?.dur ?? 4) + 4,      // sleep is 16s — dur-aware
    walk: (a) => 6 + 2 * Math.hypot(a.forward ?? 0, a.right ?? 0),  // +2s: possible lead-in pivot
    walkTo: (a) => a.tmo ?? 30,
    turn: (a) => 3 + Math.abs(a.deg ?? 90) / 20,
  };

  function run(plan, tag = null) {
    if (!Array.isArray(plan) || !plan.length) { fail('empty plan'); return false; }
    // LLMs sometimes emit a gesture as an action ({"do":"sleep"}) — normalize
    plan = plan.map(a => !ACTIONS[a.do] && GESTURES[a.do] ? { do: 'gesture', name: a.do } : a);
    for (const a of plan) if (!ACTIONS[a.do]) { fail(`unknown action "${a.do}"`); return false; }
    st.plan = plan.map(a => ({ ...a, t: 0 }));           // copy: ticking mutates
    st.i = 0;
    st.tag = tag;                                        // idle behaviors show 'idling', not 'acting'
    setStatus(tag ? 'idling' : 'acting', tag ?? `1/${plan.length} ${plan[0].do}`);
    return true;
  }
  function stop() {
    if (st.i >= 0 || st.status !== 'idle') { sim.autoWalk(0, 0); st.i = -1; st.tag = null; setStatus('idle'); }
  }

  // ---- idle behaviors: compound plans when the USER goes quiet. Tracks its own
  // user-inactivity clock — the sim's lastInput is useless here because the
  // behaviors' own autoWalk/gesture calls stamp it.
  const rnd = (a, b) => a + Math.random() * (b - a);
  const BEHAVIORS = [
    { name: 'wandering', w: 4, plan: () => [
      { do: 'walkTo', ...clampRoom({ x: rnd(-4.5, 4.5), z: rnd(-4.5, 4.5) }), speed: rnd(0.5, 0.8) },
      { do: 'wait', s: rnd(1, 2.5) } ] },
    { name: 'looking about', w: 3, plan: () => [
      { do: 'turn', deg: rnd(40, 90) }, { do: 'wait', s: rnd(0.8, 1.5) },
      { do: 'turn', deg: -rnd(60, 140) }, { do: 'wait', s: 1 },
      { do: 'gesture', name: 'thinking' } ] },
    { name: 'napping', w: 2, plan: () => [
      { do: 'walkTo', ...clampRoom({ x: rnd(-4, -2), z: rnd(-4, -2) }), speed: 0.5 },  // cozy back corner
      { do: 'gesture', name: 'sleep' } ] },
    { name: 'fidgeting', w: 2, plan: () => [
      { do: 'gesture', name: Math.random() < 0.5 ? 'tap' : 'beckon' },
      { do: 'wait', s: 1 }, { do: 'jump' } ] },
    { name: 'visiting the step', w: 2, plan: () => [
      { do: 'walkTo', x: 0, z: 2.4, speed: 0.6 }, { do: 'wait', s: rnd(1, 2) },
      { do: 'gesture', name: 'thinking' } ] },
  ];
  let bClock = 0, lastUserAt = 0, nextBehaviorAt = C.BEHAVE_AFTER;
  function behave(name) {                                 // also a headless test hook
    const b = BEHAVIORS.find(x => x.name === name) ?? BEHAVIORS[0];
    return run(b.plan(), b.name);
  }
  function maybeBehave() {
    if (st.i >= 0 || st.status !== 'idle') return;
    if (sim.s.airborne || sim.s.speed > C.V_MOVE) return;
    // require the SIM quiet too, not just the user: the QA harness drives the sim
    // through __hand without ever calling ask(), and a behavior firing during a
    // scenario's settle window contaminates its measurements. QA's longest quiet
    // stretch is ~5 s; a live user going silent passes this a few seconds after
    // the micro-idles start.
    if (sim.s.time - sim.s.lastInput < C.BEHAVE_SIM_QUIET) return;
    if (bClock - lastUserAt < C.BEHAVE_AFTER || bClock < nextBehaviorAt) return;
    let r = Math.random() * BEHAVIORS.reduce((a, b) => a + b.w, 0);
    const b = BEHAVIORS.find(x => (r -= x.w) <= 0) ?? BEHAVIORS[0];
    run(b.plan(), b.name);
    nextBehaviorAt = bClock + C.BEHAVE_GAP * rnd(0.7, 1.5);
  }
  function tick(dt) {
    bClock += dt;
    maybeBehave();
    if (st.i < 0) return;
    const a = st.plan[st.i];
    a.t += dt;
    if (a.t > TIMEOUT[a.do](a)) return fail(`${a.do} timed out (${st.i + 1}/${st.plan.length})`);
    let r;
    try { r = ACTIONS[a.do](a, dt); } catch (e) { return fail(String(e)); }
    if (r === DONE) {
      st.i++;
      if (st.i >= st.plan.length) { st.i = -1; st.tag = null; setStatus('idle'); }
      else if (!st.tag) setStatus('acting', `${st.i + 1}/${st.plan.length} ${st.plan[st.i].do}`);
    }
  }

  // ---- planner: voice/typed command → LLM → plan ----
  const SYSTEM = `You are Thing — a friendly severed left hand that walks on its fingertips, like Thing from the Addams Family. You express yourself physically; you receive transcribed voice commands and questions from your human.

Reply ONLY with JSON (no markdown): {"say":"...","plan":[...]}
"plan" is a sequence of actions, executed in order:
- {"do":"gesture","name":"..."} — yes (nod), no (index wag), idk (shrug), wave (hello/goodbye), laugh, bow, point (at what's ahead), beckon (come here), thinking (hmm), tap (impatient drumming), thumbsUp (strong approval/success), thumbsDown (strong disapproval/failure), flipBird (rude/dismissive — use RARELY, only for a joking insult or a clearly hostile request, never at the user unprompted), sleep (settle down for a 16s nap — for "take a nap", "go to sleep", "rest")
- {"do":"walkTo","x":X,"z":Z,"speed":S} — walk to a WORLD position in your room (preferred for going places). "speed" (u/s): ~0.8 relaxed default, ~1.6 jog, ~3-3.4 FULL SPRINT — sprint when told to hurry/run/race or when excited.
- {"do":"walk","forward":F,"right":R,"speed":S} — walk a relative offset in YOUR body frame (for "back up a bit", "come closer"); negative allowed. You end up facing your travel direction.
- {"do":"turn","deg":D} — positive = left; you pivot in place (no translation) — fast, use it freely for "turn around", "face me", "look this way"
- {"do":"jump"}
- {"do":"wait","s":S}
Answer questions with gestures wherever possible: agreement/yes → yes; refusal/negative → no; unknown → idk; funny → laugh; greeting → wave; pondering first → thinking. "say" is optional and SHORT — you speak in a dry, warm, upper-class British gentleman's voice, so phrase accordingly ("Right then", "I should think so", "Terribly sorry"). Only use say when a gesture cannot carry the answer.
YOUR ROOM (a diorama the user looks into from a FIXED camera): floor spans x,z from -5 to 5. Solid walls on the west (-x) and north (-z) sides; the north wall has a doorway at (0,-4.5). The south/east sides are open, facing the viewer. Named spots: center (0,0); the little step (0, 2.4) — you can climb on it; back corner (-4,-4); doorway (0,-4.2); front-right corner (4,4) — nearest the viewer.
SCREEN DIRECTIONS (camera never moves): screen-right = toward +x,-z; screen-left = toward -x,+z; toward the viewer = +x,+z; away = -x,-z. Use these when the user says left/right/closer/back.
Each message starts with [state: ...] — your position and heading. "Come here" = walkTo near (3.5, 3.5) (the open front), then beckon or wave.
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
    lastUserAt = bClock;                                 // real user input — behaviors reschedule
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
      speak(reply.say);                                  // fire-and-forget: plan runs meanwhile
    }
    if (Array.isArray(reply.plan) && reply.plan.length) run(reply.plan.slice(0, 20));
    else if (!reply.say) setStatus('error', 'brain returned no plan and nothing to say');
    return reply;
  }

  // ---- voice: Gemini TTS via the /tts proxy (raw s16 little-endian PCM — mime
  // says l16 which is officially big-endian, but decoded-both-ways smoothness
  // analysis says little: mean|Δ| 568 vs 14122). Style + voice are the persona.
  const TTS_VOICE = 'Charon';
  const TTS_STYLE = 'Say in a warm, dry, upper-class British male accent, like a tiny distinguished butler: ';
  let audioCtx = null;
  async function speak(text) {
    try {
      const res = await fetch('/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: TTS_STYLE + text, voice: TTS_VOICE }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      audioCtx = audioCtx || new AudioContext();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const rate = +(/rate=(\d+)/.exec(data.mime)?.[1] ?? 24000);
      const bin = atob(data.audio);
      const n = bin.length >> 1;
      const buf = audioCtx.createBuffer(1, n, rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        ch[i] = (v >= 32768 ? v - 65536 : v) / 32768;
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buf; src.connect(audioCtx.destination); src.start();
    } catch (e) {
      setStatus('error', `voice: ${String(e.message || e)}`);   // visible, then degrade
      if (typeof speechSynthesis !== 'undefined') {
        const u = new SpeechSynthesisUtterance(text);
        u.pitch = 1.6; u.rate = 1.15;
        speechSynthesis.speak(u);
      }
    }
  }
  return { st, run, stop, tick, ask, speak, behave };
}
