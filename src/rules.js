// src/rules.js — typed or spoken text → plan, by keyword rules. No model, no network:
// this is what makes the page controllable by text on a static host, and it answers
// simple commands with zero latency even when an LLM is available.
// parseRules(text, {x, z}) → plan array, [] for "stop", or null when no rule matches.
import * as C from './tuning.js';

// room spots and screen directions (the camera is fixed, so these never move)
const SPOTS = [
  [/\b(cent(er|re)|middle of the room)\b/, { x: 0, z: 0 }],
  [/\b(step|box|block)\b/, { x: 0, z: 2.4 }],
  [/\b(corner|bed)\b/, { x: -4, z: -4 }],
  [/\b(door|doorway)\b/, { x: 0, z: -4.2 }],
  [/\b(come here|come closer|over here|to me|front)\b/, { x: 3.5, z: 3.5 }],
];
const S = Math.SQRT1_2;
const SCREEN = { left: [-S, S], right: [S, -S], closer: [S, S], forward: [S, S], back: [-S, -S], away: [-S, -S] };
const GESTURES = [
  [/\b(thumbs? up|good job|well done|nice one|great)\b/, 'thumbsUp'],
  [/\b(thumbs? down|boo)\b/, 'thumbsDown'],
  [/\b(middle finger|the bird|flip (me )?off)\b/, 'flipBird'],
  [/\b(peace|victory)\b/, 'peace'],
  [/\b(rock on|horns|metal)\b/, 'horns'],
  [/\b(finger gun|pew)\b/, 'fingerGun'],
  [/\bhigh five\b/, 'highFive'],
  [/\b(wave|hello|hi|hey|goodbye|bye)\b/, 'wave'],
  [/\b(nod|say yes)\b/, 'yes'],
  [/\b(shake|say no)\b/, 'no'],
  [/\b(shrug|dunno)\b/, 'idk'],
  [/\b(laugh|giggle|lol|haha)\b/, 'laugh'],
  [/\b(bow|curtsy)\b/, 'bow'],
  [/\bpoint\b/, 'point'],
  [/\bbeckon\b/, 'beckon'],
  [/\b(think|ponder|hmm+)\b/, 'thinking'],
  [/\b(tap|drum|impatient)\b/, 'tap'],
];
const clamp = (v) => Math.max(-C.ROOM.half, Math.min(C.ROOM.half, v));

function clause(t, pos) {
  if (/\b(don'?t|do not|never)\b/.test(t)) return null;      // do not invert a negation by keyword
  if (/\b(stop|halt|stay|freeze|whoa|hold still)\b/.test(t)) return [];
  if (/\b(morse|tap out|spell)\b/.test(t)) {                // "say hello in morse", "tap out sos"
    const text = t.replace(/\b(say|spell|tap|out|in|morse|code|for|please|me|something|it)\b/g, '').replace(/[^a-z0-9]/g, '');
    return [{ do: 'morse', text: text.slice(0, 8) || 'sos' }];
  }
  if (/\b(play dead|drop dead|die|bang)\b/.test(t)) return [{ do: 'gesture', name: 'playDead' }];
  if (/\b(dance|boogie|party|groove)\b/.test(t)) return [{ do: 'routine', name: 'dance' }];
  if (/\b(knock|get my attention)\b/.test(t)) return [{ do: 'routine', name: 'knock' }];
  if (/\b(piano|music|tune|song)\b/.test(t)) return [{ do: 'use', target: 'piano' }];
  if (/\b(sleep|nap|rest|go to bed|rug)\b/.test(t)) return [{ do: 'use', target: 'rug' }];
  if (/\b(lights?|switch|dark|bright)\b/.test(t)) return [{ do: 'use', target: 'switch' }];
  if (/\b(bell|ring|ding)\b/.test(t)) return [{ do: 'use', target: 'bell' }];
  if (/\b(ball|kick|play)\b/.test(t)) return [{ do: 'use', target: 'ball' }];
  if (/\bdouble snap\b/.test(t)) return [{ do: 'gesture', name: 'doubleSnap' }];
  if (/\b(snap|click your fingers)\b/.test(t)) return [{ do: 'gesture', name: 'snap' }];
  for (const [re, name] of GESTURES) if (re.test(t)) return [{ do: 'gesture', name }];
  if (/\b(jump|hop|leap|bounce)\b/.test(t)) return [{ do: 'jump' }];
  if (/\b(turn|face|rotate|spin)\b/.test(t)) {
    const deg = /\b(around|about|back|behind)\b/.test(t) ? 180 : /\bright\b/.test(t) ? -90 : 90;
    return [{ do: 'turn', deg }];
  }
  const speed = /\b(run|sprint|fast|hurry|quick|race)\b/.test(t) ? C.SPEED.sprint
    : /\b(jog|scuttle|scurry|trot)\b/.test(t) ? C.SPEED.scuttle : C.SPEED.strut;
  for (const [re, p] of SPOTS) if (re.test(t)) return [{ do: 'walkTo', x: p.x, z: p.z, speed }];
  if (/\b(wander|roam|explore|look around)\b/.test(t))
    return [{ do: 'walkTo', x: clamp(pos.x + 3 * Math.cos(pos.x * 7 + pos.z)), z: clamp(pos.z + 3 * Math.sin(pos.x + pos.z * 5)), speed }];
  const dir = Object.keys(SCREEN).find(k => new RegExp(`\\b${k}\\b`).test(t));
  if (dir || /\b(walk|go|move|run|jog|come|step|scuttle|scurry|sprint)\b/.test(t)) {
    const [ux, uz] = SCREEN[dir ?? 'forward'], far = /\b(far|all the way|across)\b/.test(t) ? 6 : /\b(bit|little|slightly)\b/.test(t) ? 1 : 2.5;
    return [{ do: 'walkTo', x: clamp(pos.x + ux * far), z: clamp(pos.z + uz * far), speed }];
  }
  return null;
}

export function parseRules(text, pos = { x: 0, z: 0 }) {
  const parts = ` ${text.toLowerCase().replace(/[.!?]+/g, ' ')} `.split(/\b(?:and then|then|after that|and)\b|,/).map(s => s.trim()).filter(Boolean);
  const plan = [];
  for (const p of parts) {
    const c = clause(` ${p} `, pos);
    if (c === null) return null;                             // one clause not understood: leave it to an LLM
    if (!c.length) return parts.length === 1 ? [] : null;    // "stop" only makes sense alone
    plan.push(...c);
  }
  return parts.length ? plan : null;
}

// a leading interrogative or a question mark: a question for the buddy, not a command
export const isQuestion = (text) =>
  /^\s*(do|does|did|is|are|was|were|can|could|will|would|should|am|have|has|what|who|why|how|where|when|which)\b/i.test(text)
  || text.trim().endsWith('?');
