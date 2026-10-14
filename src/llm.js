// src/llm.js — in-browser language model (Web-LLM on WebGPU): what answers free-form
// requests on a static host, where there is no /llm proxy. It loads only after the
// person presses the button (a 340 MB download), and every failure falls back to
// the keyword rules. A 0.6B model cannot fill the full Gemini plan schema, so it gets
// a small closed vocabulary, which stepsToPlan() maps onto plan actions.
import * as C from './tuning.js';
import { GESTURES } from './gestures.js';

// PINNED: this is remote code running in the page's origin. An exact version, never a
// floating tag. Checked 2026-10-09: this build exports CreateMLCEngine and knows the model id.
const WEBLLM = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';
export const LOCAL_MODEL = { id: 'Qwen3-0.6B-q4f16_1-MLC' };

const PLACES = { center: [0, 0], step: [0, 2.4], corner: [-4, -4], door: [0, -4.2], front: [3.5, 3.5] };
const S = Math.SQRT1_2;
const DIRS = { left: [-S, S], right: [S, -S], closer: [S, S], back: [-S, -S] };
const THINGS = ['switch', 'bell', 'ball', 'rug', 'piano'];
const NAMES = ['wave', 'yes', 'no', 'idk', 'laugh', 'bow', 'point', 'beckon', 'thinking', 'tap', 'thumbsUp', 'thumbsDown', 'sleep', 'dance', 'knock', 'playDead',
  'shake', 'peek', 'startle', 'peace', 'horns', 'highFive', 'snap'];

const SYS = `You control Thing, a severed hand that walks on its fingertips in a small room. Turn the request into JSON: {"steps":[...]}. Each step is EXACTLY one of:
{"do":"go","to":"center"} — to is one of: center, step, corner, door, front
{"do":"move","dir":"left"} — dir is one of: left, right, closer, back
{"do":"turn","dir":"left"} — dir is one of: left, right, around
{"do":"jump"}
{"do":"use","thing":"switch"} — thing is one of: switch (the light switch), bell, ball, rug (nap), piano
{"do":"gesture","name":"wave"} — name is one of: ${NAMES.join(', ')}
Add "fast":true to a go or move step to run. Output ONLY the JSON object. If you do not understand, output {"steps":[]}.

User: go to the door and wave
Assistant: {"steps":[{"do":"go","to":"door"},{"do":"gesture","name":"wave"}]}
User: run over to the step, jump twice, then come back to me
Assistant: {"steps":[{"do":"go","to":"step","fast":true},{"do":"jump"},{"do":"jump"},{"do":"go","to":"front"}]}
User: spin around and take a bow
Assistant: {"steps":[{"do":"turn","dir":"around"},{"do":"gesture","name":"bow"}]}`;

const ANSWER_SYS = `You are Thing, a cheeky, opinionated severed hand that answers only with gestures. Reply with ONLY one JSON object: {"answer":"yes"} or {"answer":"no"} or {"answer":"unsure"} or {"answer":"laugh"} or {"answer":"love"}. Factual questions get the true answer. Questions of taste: commit to yes or no. "laugh" is for jokes and absurd questions. "love" is an enthusiastic yes. "unsure" only when yes or no cannot answer it.`;
const ANSWERS = { yes: 'yes', no: 'no', unsure: 'idk', laugh: 'laugh', love: 'thumbsUp' };

// the model's closed vocabulary → plan actions. Unknown steps are dropped; an empty
// result is null so the caller can say it did not understand.
export function stepsToPlan(steps, pos = { x: 0, z: 0 }) {
  const clamp = (v) => Math.max(-C.ROOM.half, Math.min(C.ROOM.half, v)), plan = [];
  let x = pos.x, z = pos.z;                               // moves chain from where the last step ends
  for (const s of Array.isArray(steps) ? steps.slice(0, 12) : []) {
    if (!s || typeof s !== 'object') continue;
    const speed = s.fast ? C.SPEED.sprint : C.SPEED.strut;
    if (s.do === 'go' && Object.hasOwn(PLACES, s.to)) { [x, z] = PLACES[s.to].map(clamp); plan.push({ do: 'walkTo', x, z, speed }); }
    else if (s.do === 'move' && Object.hasOwn(DIRS, s.dir)) {
      x = clamp(x + DIRS[s.dir][0] * 2.5); z = clamp(z + DIRS[s.dir][1] * 2.5);
      plan.push({ do: 'walkTo', x, z, speed });
    } else if (s.do === 'turn') plan.push({ do: 'turn', deg: s.dir === 'around' ? 180 : s.dir === 'right' ? -90 : 90 });
    else if (s.do === 'jump') plan.push({ do: 'jump' });
    else if (s.do === 'use' && THINGS.includes(s.thing)) plan.push({ do: 'use', target: s.thing });
    else if (s.do === 'gesture' && Object.hasOwn(GESTURES, s.name)) plan.push({ do: 'gesture', name: s.name });
  }
  return plan.length ? plan : null;
}

// Qwen3 can emit <think>…</think> and code fences around the JSON: take the first object
export function firstObject(raw) {
  const t = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in the model reply');
  return JSON.parse(t.slice(a, b + 1));
}

export function makeLocalLLM(onProgress = () => {}) {       // onProgress(pct): 0-100, or null when unknown
  let engine = null, loading = null;
  const chat = async (system, text) => {
    const r = await engine.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
      temperature: 0, extra_body: { enable_thinking: false },   // Qwen3: skip the think block
    });
    return firstObject(r.choices[0].message.content || '');
  };
  return {
    get supported() { return typeof navigator !== 'undefined' && !!navigator.gpu; },
    get ready() { return !!engine; },
    // call only from a user gesture that agreed to the download
    load() {
      if (engine) return Promise.resolve(true);
      if (!this.supported) return Promise.reject(new Error('this browser has no WebGPU — use a current Chrome, Edge or Safari'));
      return loading ??= (async () => {
        try {
          onProgress(null);
          const webllm = await import(WEBLLM);
          engine = await webllm.CreateMLCEngine(LOCAL_MODEL.id, {
            initProgressCallback: (p) => onProgress(p.progress != null ? Math.round(p.progress * 100) : null),
          });
          return true;
        } finally { loading = null; }
      })();
    },
    plan: async (text, pos) => stepsToPlan((await chat(SYS, text)).steps, pos),
    answer: async (text) => ANSWERS[(await chat(ANSWER_SYS, text)).answer] ?? 'idk',
  };
}
