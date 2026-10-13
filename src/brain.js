// src/brain.js — Phase A brain: sequential action-plan executor. Drives the sim
// strictly through the player API (autoWalk/gesture/jump) — never pokes sim state,
// so every locomotion invariant (ramping, steering, gesture gating) applies.
// Plan: [{do:'walk',forward,right,speed?}, {do:'turn',deg}, {do:'gesture',name},
//        {do:'jump'}, {do:'wait',s}] — hand frame: forward = +heading, right = 90° cw.
// 'turn' pivots in place (sim.pivot). Walks never steer through a big turn: the sim
// stops, pivots and goes for any command more than TURN_PIVOT off the heading.
import * as C from './tuning.js';
import * as M from './math.js';
import { GESTURES, morseGesture } from './gestures.js';
import { parseRules, isQuestion } from './rules.js';
import { makeLocalLLM, LOCAL_MODEL } from './llm.js';

const RUNNING = 0, DONE = 1;
const CROUCH_S = 0.16;                                   // s sim of crouch before a jump leaves (the anticipation)

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

export function makeBrain(sim, rig, camera, props = null) {
  const body = rig.mount;
  const st = { status: 'idle', detail: '', plan: [], i: -1, onstatus: null };
  let bClock = 0;                                        // brain time, s sim
  // walls are visual-only in the sim; the brain is the only control path, so every
  // walk target clamps to the room interior and Thing simply never leaves
  const ROOM = C.ROOM.half;
  const clampRoom = (p) => ({ x: M.clamp(p.x, -ROOM, ROOM), z: M.clamp(p.z, -ROOM, ROOM) });
  let statusAt = 0;                                      // bClock when the status last changed
  let asking = false;                                    // a question is out with a model (not: the model is downloading)
  const setStatus = (status, detail = '') => {
    st.status = status; st.detail = detail; statusAt = bClock;
    if (status !== 'thinking') asking = false;
    if (st.onstatus) st.onstatus(st);
  };
  const fail = (msg) => { sim.autoWalk(0, 0); st.i = -1; setStatus('error', msg); };

  const ACTIONS = {
    wait(a, dt) {
      a.left = (a.left ?? Math.min(a.s ?? 1, 30)) - dt;
      return a.left <= 0 ? DONE : RUNNING;
    },
    jump(a) {                                            // crouch, spring, squash on landing
      if (!a.phase) {
        // land a prior jump first, and push off all five: jump energy scales with planted
        // digits (a jump taken mid-step reached 1.68 u of the 2.32 it should)
        if (sim.s.airborne || sim.s.planted < 5 || sim.s.speed > C.V_MOVE) return RUNNING;
        if (sim.gesture('crouch')) a.phase = 'crouch';   // (refused while a hover or a pivot finishes)
        return RUNNING;
      }
      const g = sim.s.gesture;
      if (a.phase === 'crouch') {                        // spring from the bottom of the crouch
        if (g && g.name === 'crouch' && g.t < CROUCH_S) return RUNNING;
        sim.jump(); a.phase = 'air'; return RUNNING;
      }
      if (a.phase === 'air') {
        if (sim.s.airborne) return RUNNING;
        sim.gesture('land'); a.phase = 'land'; return RUNNING;
      }
      return g ? RUNNING : DONE;
    },
    gesture(a) {
      if (!a.started) {
        if (sim.s.airborne || sim.s.speed > C.V_MOVE) return RUNNING;  // settle first
        if (!GESTURES[a.name]) throw `unknown gesture "${a.name}"`;
        if (!sim.gesture(a.name)) return RUNNING;        // a hover or a pivot is finishing: try again
        a.started = true; return RUNNING;
      }
      return sim.s.gesture ? RUNNING : DONE;
    },
    morse(a) {                                           // tap `text` out in real Morse
      if (!a.started) {
        if (sim.s.airborne || sim.s.speed > C.V_MOVE) return RUNNING;
        const def = morseGesture(a.text ?? 'sos');
        if (!def) throw `nothing in "${a.text}" has a Morse code — use letters or digits`;
        GESTURES.morse = def;
        if (!sim.gesture('morse')) return RUNNING;       // busy: try again next tick
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
      // arrive at speed and stop hard: the sim brakes at STOP_DECEL, so command zero
      // one stopping distance out. No slow creep onto the target. Big course changes
      // are the sim's job too (stop, pivot, go — TURN_PIVOT), for every input path.
      const v = a.speed ?? C.SPEED.strut;
      const stopD = v * (v / (2 * C.STOP_DECEL) + C.ACCEL_TAU);
      if (a.stopping || d <= stopD + 0.02) {
        a.stopping = true;
        sim.autoWalk(0, 0);
        return sim.s.speed < 0.03 && sim.s.planted === 5 ? DONE : RUNNING;   // halted and stepped home
      }
      sim.autoWalk(dx / d * v, dz / d * v);
      return RUNNING;
    },
    walkTo(a, dt) {                                      // world-coordinate variant — the
      if (!a.target) {                                   // room map speaks in these
        a.target = clampRoom({ x: a.x ?? 0, z: a.z ?? 0 });
        // timeout from INITIAL distance, frozen — recomputing per-tick shrinks it
        // toward the floor as the hand approaches while elapsed keeps growing,
        // spuriously killing long slow walks (bit the napping behavior at 9s)
        a.tmo = 8 + 3 * Math.hypot(a.target.x - body.position.x, a.target.z - body.position.z);
      }
      return ACTIONS.walk(a, dt);                        // reuses walk wholesale
    },
    face(a) {                                            // turn to a WORLD heading (props have a front),
      if (!a.started) {                                  // or to the viewer, from where the hand stands then
        if (sim.s.airborne || sim.s.speed > C.V_MOVE) return RUNNING;
        const d = M.wrapAngle((a.viewer ? toViewer() + (a.off ?? 0) : a.heading) - sim.s.heading);
        if (Math.abs(d) < (a.within ?? 0.06)) return DONE;
        if (sim.pivot(d * 180 / Math.PI)) a.started = true;
        return RUNNING;
      }
      return sim.s.pivotTarget != null || sim.s.airborne ? RUNNING : DONE;
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
    gesture: (a) => (GESTURES[a.name]?.dur ?? 4) + 8,      // sleep is 16s — dur-aware. +8: it may wait out a hover (playDead, 6 s)
    morse: (a) => (morseGesture(a.text ?? 'sos')?.dur ?? 4) + 4,
    walk: (a) => 8 + 2 * Math.hypot(a.forward ?? 0, a.right ?? 0),  // includes a lead-in pivot
    walkTo: (a) => a.tmo ?? 30,
    turn: (a) => 3 + Math.abs(a.deg ?? 90) / 20,
    face: () => 8,
  };

  // routines: named bits made of plain actions. {do:'routine',name} expands in run().
  const FRONT = { x: 3.6, z: 3.6 };                      // the open corner nearest the viewer
  const toViewer = (p = body.position) => camera ? Math.atan2(-(camera.position.z - p.z), camera.position.x - p.x) : -Math.PI / 4;
  const FACE_WITHIN = 0.6;                               // rad off the viewer at which a sign still reads
  const ROUTINES = {
    // a hop-turn is the spin: dance, spin, dance, spin back, bow
    dance: () => [{ do: 'gesture', name: 'dance' }, { do: 'turn', deg: 180 }, { do: 'gesture', name: 'dance' },
      { do: 'turn', deg: 180 }, { do: 'jump' }, { do: 'gesture', name: 'bow' }],
    // come to the glass, rap on it, and wave at whoever is there
    knock: () => [{ do: 'walkTo', ...FRONT, speed: C.SPEED.scuttle }, { do: 'face', viewer: true },
      { do: 'gesture', name: 'knock' }, { do: 'wait', s: 0.4 }, { do: 'gesture', name: 'wave' }],
    // offended: one rude sign, then off to the far corner to sulk with its back turned
    sulk: () => [{ do: 'gesture', name: 'flipBird' }, { do: 'walkTo', x: -4, z: -4, speed: C.SPEED.scuttle },
      { do: 'face', heading: Math.PI * 0.75 }, { do: 'wait', s: 2 }],
  };

  // a sign is made AT someone (`face` in its def): turn to the viewer first, unless nearly there
  const facing = (plan) => !camera ? plan : plan.flatMap(a => a.do === 'gesture' && GESTURES[a.name]?.face
    ? [{ do: 'face', viewer: true, off: GESTURES[a.name].face === true ? 0 : GESTURES[a.name].face, within: FACE_WITHIN }, a] : [a]);
  function run(plan, tag = null) {
    if (!Array.isArray(plan) || !plan.length) { fail('empty plan'); return false; }
    // LLMs sometimes emit a gesture as an action ({"do":"sleep"}) — normalize
    plan = plan.map(a => !ACTIONS[a.do] && GESTURES[a.do] ? { do: 'gesture', name: a.do } : a);
    let noRoutine = null;
    plan = plan.flatMap(a => a.do !== 'routine' ? [a] : ROUTINES[a.name] ? ROUTINES[a.name]() : (noRoutine = a.name, []));
    if (noRoutine) { fail(`unknown routine "${noRoutine}" — have: ${Object.keys(ROUTINES).join(', ')}`); return false; }
    // {do:'use',target}: go to the prop's anchor, face it, then do what the prop asks for
    let unknown = null;
    plan = plan.flatMap(a => {
      if (a.do !== 'use') return [a];
      const p = props && props.get(a.target);
      if (!p) { unknown = a.target; return []; }
      const far = Math.hypot(p.anchor.x - body.position.x, p.anchor.z - body.position.z) > 2.5;
      const go = [{ do: 'walkTo', x: p.anchor.x, z: p.anchor.z, speed: p.speed ?? (far ? C.SPEED.scuttle : C.SPEED.strut) }];
      if (p.facing != null) go.push({ do: 'face', heading: p.facing });
      return [...go, ...p.plan()];
    });
    if (unknown) { fail(`unknown prop "${unknown}" — have: ${props ? props.ids.join(', ') : 'none'}`); return false; }
    plan = facing(plan);
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

  // ---- ONE command layer: keys, clicks, voice and idle behaviors all enter here.
  // A hand-on-the-controls source outranks a slower one: a voice reply that lands
  // while a key is held (or within OWN_HOLD s of a click) is dropped, not obeyed late.
  const RANK = { auto: 0, voice: 1, click: 2, key: 3 }, OWN_HOLD = 0.5;
  let owner = 'auto', ownerAt = -1e9;
  function command(plan, { source = 'click', tag = null } = {}) {
    if (RANK[source] === undefined) throw new Error(`brain.command: unknown source "${source}" — use key, click, voice or auto`);
    if (RANK[source] < RANK[owner] && st.i >= 0 && bClock - ownerAt < OWN_HOLD) return false;
    if (source !== 'auto') lastUserAt = bClock;          // real user input — behaviors reschedule
    if (!run(plan, tag)) return false;
    owner = source; ownerAt = bClock;
    return true;
  }
  const cancel = () => { owner = 'auto'; stop(); };

  // ---- reactions: the room tells the hand what just happened (props.onEvent) and it has an
  // opinion. Only a hand that is doing something, or just was, reacts: the QA gate drives
  // the sim with no plan at all, so nothing here can fire inside a scenario.
  const REACT = {
    lightsOff: () => [{ do: 'wait', s: 0.6 }, { do: 'gesture', name: 'peek' }],   // dead still in the dark, then a look round
    lightsOn: () => [{ do: 'gesture', name: 'thumbsUp' }],
    bell: () => [{ do: 'gesture', name: 'startle' }],
    wall: (at) => [{ do: 'face', heading: Math.atan2(-(at.z - body.position.z), at.x - body.position.x) }, { do: 'gesture', name: 'laugh' }],
  };
  const REACT_WINDOW = 2;                                // s since a plan last ran
  let planAt = -1e9;
  function react(ev, arg) {
    if (!REACT[ev] || bClock - planAt > REACT_WINDOW) return false;
    if (st.i >= 0 && st.plan.some((a, k) => k >= st.i && a.re === ev)) return false;   // one opinion per event, not a queue
    const plan = facing(REACT[ev](arg)).map(a => ({ ...a, re: ev }));
    if (st.i < 0) return command(plan, { source: 'auto', tag: 'reacting' });
    // right after what it is doing now (or before it, when that has not begun: the event
    // came in the tick its cause finished)
    st.plan.splice(st.plan[st.i].t ? st.i + 1 : st.i, 0, ...plan.map(a => ({ ...a, t: 0 })));
    return true;
  }
  if (props) props.onEvent = react;

  // ---- poked (a click on the hand itself): ticklish, then startled, then cross.
  // The count decays, so an occasional poke is always a giggle.
  const POKES = [[{ do: 'gesture', name: 'laugh' }], [{ do: 'jump' }], [{ do: 'gesture', name: 'shake' }],
    [{ do: 'gesture', name: 'tap' }], [{ do: 'routine', name: 'sulk' }]];
  let pokes = 0, pokedAt = -1e9;
  function poke() {
    if (bClock - pokedAt > C.POKE_FORGET) pokes = 0;
    pokedAt = bClock;
    const ok = command(POKES[pokes], { source: 'click' });
    pokes = (pokes + 1) % POKES.length;
    return ok;
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
    // the room is there to be played with
    { name: 'playing the piano', w: 3, plan: () => [{ do: 'use', target: 'piano' }] },
    // (it laughs when the ball hits the wall, and flinches at its own bell: reactions)
    { name: 'chasing the ball', w: 3, plan: () => [{ do: 'use', target: 'ball' }, { do: 'wait', s: 2 }] },
    { name: 'ringing the bell', w: 2, plan: () => [{ do: 'use', target: 'bell' }, { do: 'gesture', name: 'laugh' }] },
    { name: 'knocking on the glass', w: 3, plan: () => [{ do: 'routine', name: 'knock' }] },
    { name: 'dancing', w: 2, plan: () => [{ do: 'routine', name: 'dance' }] },
    { name: 'signalling', w: 1, plan: () => [{ do: 'morse', text: 'sos' }, { do: 'gesture', name: 'point' }] },
    { name: 'lights out', w: 1, plan: () => [{ do: 'use', target: 'switch' }, { do: 'use', target: 'rug' }, { do: 'use', target: 'switch' }] },
  ];
  let lastUserAt = 0, nextBehaviorAt = C.BEHAVE_AFTER, lastBehavior = null, thinkAt = 0;
  const THINK_GAP = 1.2;                                 // s still between two thinking beats
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
    const pool = BEHAVIORS.filter(x => x !== lastBehavior);  // never the same bit twice running
    let r = Math.random() * pool.reduce((a, b) => a + b.w, 0);
    const b = lastBehavior = pool.find(x => (r -= x.w) <= 0) ?? pool[0];
    run(b.plan(), b.name);
    nextBehaviorAt = bClock + C.BEHAVE_GAP * rnd(0.7, 1.5);
  }
  function tick(dt) {
    bClock += dt;
    // 'saying' and 'error' are not states to live in: idle behaviors need 'idle'
    if (st.i < 0 && (st.status === 'saying' || st.status === 'error') && bClock - statusAt > C.STATUS_HOLD) setStatus('idle');
    maybeBehave();
    // waiting on the model: the head cocks one way and the other, again after a pause. The plan
    // that comes back replaces it (a gesture cut short eases out)
    if (asking && st.i < 0 && bClock >= thinkAt && !sim.s.gesture && !sim.s.airborne
        && sim.s.speed <= C.V_MOVE && sim.gesture('thinking')) thinkAt = bClock + GESTURES.thinking.dur + THINK_GAP;
    if (st.i < 0) return;
    planAt = bClock;
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
- {"do":"gesture","name":"..."} — yes (nod), no (sits up and wags a finger), shake (a quick cross shake of the whole body), idk (shrug), wave (hello/goodbye), laugh, bow, point (at what's ahead), beckon (come here), thinking (hmm), peek (stand tall and look about), startle (a flinch), tap (impatient drumming), thumbsUp (strong approval/success), thumbsDown (strong disapproval/failure), flipBird (rude/dismissive — use RARELY, only for a joking insult or a clearly hostile request, never at the user unprompted), sleep (settle down for a 16s nap — for "take a nap", "go to sleep", "rest"), peace, horns, fingerGun, highFive (a slap on the glass), snap, doubleSnap (your remote: it works the light switch from anywhere), knock (rap on the glass)
- {"do":"walkTo","x":X,"z":Z,"speed":S} — walk to a WORLD position in your room (preferred for going places). "speed" (u/s): ~0.8 relaxed default, ~1.6 jog, ~3-3.4 FULL SPRINT — sprint when told to hurry/run/race or when excited.
- {"do":"walk","forward":F,"right":R,"speed":S} — walk a relative offset in YOUR body frame (for "back up a bit", "come closer"); negative allowed. You end up facing your travel direction.
- {"do":"turn","deg":D} — positive = left; you pivot in place (no translation) — fast, use it freely for "turn around", "face me", "look this way"
- {"do":"jump"}
- {"do":"wait","s":S}
- {"do":"use","target":ID} — go to a thing in the room and use it (the state line lists them)
- {"do":"morse","text":"SOS"} — tap a SHORT word (8 characters at most) on the floor in real Morse code
- {"do":"routine","name":N} — a set piece: dance (music, spins, a bow), knock (come to the glass, rap on it, wave), sulk (a rude sign, then off to the corner)
Answer questions with gestures wherever possible: agreement/yes → yes; refusal/negative → no; unknown → idk; funny → laugh; greeting → wave; pondering first → thinking. "say" is optional and SHORT — you speak in a dry, warm, upper-class British gentleman's voice, so phrase accordingly ("Right then", "I should think so", "Terribly sorry"). Only use say when a gesture cannot carry the answer.
YOUR ROOM (a diorama the user looks into from a FIXED camera): floor spans x,z from -${C.ROOM.half} to ${C.ROOM.half}. Solid walls on the west (-x) and north (-z) sides; the north wall has a doorway at (0,-4.5). The south/east sides are open, facing the viewer. Named spots: center (0,0); the little step (0, 2.4) — you can climb on it; back corner (-4,-4); doorway (0,-4.2); front-right corner (4,4) — nearest the viewer.
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
    return `[state: pos (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), heading ${(h * 180 / Math.PI).toFixed(0)}°${user}. ${props ? props.describe() : ''}]`;
  }
  let llmDown = false;                                   // set once /llm proves unreachable
  // run a rules plan. `noModel`: say so when there is no rule and no LLM to ask.
  function obey(plan, noModel = false) {
    if (plan && !plan.length) return { plan };           // "stop": ask() already stopped
    if (plan) { command(plan, { source: 'voice' }); return { plan }; }
    if (noModel) {
      command([{ do: 'gesture', name: 'idk' }], { source: 'voice' });
      const how = local.ready ? 'I did not follow that.'
        : local.supported ? `No language model yet: press "load brain" (${LOCAL_MODEL.size}, runs in this browser).`
        : 'No language model on this page.';
      setStatus('saying', `${how} Try: wave, go to the door, turn around, jump, take a nap.`);
    }
    return null;
  }
  // the in-browser model (src/llm.js): the LLM for a static host. Loaded on request only.
  const local = makeLocalLLM((msg) => setStatus('thinking', msg));
  async function loadLocal() {
    try { await local.load(); setStatus('saying', 'Brain loaded. Ask me anything.'); return true; }
    catch (e) { setStatus('error', `in-browser brain: ${e.message || e}`); return false; }
  }
  async function askLocal(text, gen, rules) {
    setStatus('thinking', text); asking = true;
    let plan = null;
    try {
      plan = isQuestion(text) ? [{ do: 'gesture', name: await local.answer(text) }]
        : await local.plan(text, body.position);
    } catch (e) {
      if (gen === askGen) setStatus('error', `in-browser brain: ${e.message || e}`);
      return null;
    }
    return gen === askGen ? obey(plan ?? rules, true) : null;
  }
  let askGen = 0;                                        // a newer ask() retires every older reply
  async function ask(text) {
    const gen = ++askGen;
    stop();
    lastUserAt = bClock;                                 // real user input — behaviors reschedule
    // keyword rules first: a plain command needs no model and no wait. Questions and
    // anything the rules do not cover go to the LLM, when one is reachable.
    const rules = parseRules(text, body.position);
    if (rules && !isQuestion(text)) return obey(rules);
    if (llmDown) return local.ready ? askLocal(text, gen, rules) : obey(rules, true);
    setStatus('thinking', text); asking = true;
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
      if (gen !== askGen) return null;
      // a static host answers /llm with a 404 page: no model here, and no point asking again
      if (e instanceof SyntaxError || e instanceof TypeError) {
        llmDown = true;
        return local.ready ? askLocal(text, gen, rules) : obey(rules, true);
      }
      setStatus('error', e.name === 'AbortError' ? 'brain timed out (20s)' : String(e.message || e));
      return null;
    }
    if (gen !== askGen) return null;                     // superseded while the LLM was thinking
    history.push({ role: 'model', parts: [{ text: JSON.stringify(reply) }] });
    if (reply.say) {
      setStatus('saying', reply.say);
      speak(reply.say);                                  // fire-and-forget: plan runs meanwhile
    }
    if (Array.isArray(reply.plan) && reply.plan.length) command(reply.plan.slice(0, 20), { source: 'voice' });
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
  return { st, run, stop, tick, ask, speak, behave, command, cancel, loadLocal, poke, react,
    get idle() { return st.i < 0 && st.status === 'idle'; },
    behaviors: BEHAVIORS.map(b => b.name), routines: Object.keys(ROUTINES),
    get needsLocal() { return llmDown && local.supported && !local.ready; } };
}
