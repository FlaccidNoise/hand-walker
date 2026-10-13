// src/ui.js — the page around the room. Everything a visitor can press here ends in
// brain.ask(text) or brain.command(plan, {source}); the rest only reads (the camera,
// the plan, the sim's gesture) to say what the hand is doing.
//   caption     follows the hand: line 1 what it does, line 2 what it says (own timer)
//   cards       one row of commands, and a palette of the rest ("more…", or type "help")
//   talk        one text box, a hold-to-speak button (the V key), a send button on touch
//   sound, help top right            hints   three first-run prompts, each gone once done
import * as THREE from 'three';
import * as C from './tuning.js';
import { audio, unlockAudio } from './props.js';
import { isHelp } from './rules.js';

const $ = (id) => document.getElementById(id);
const TOUCH = matchMedia('(pointer: coarse)').matches;

// line 1 copy. A gesture with no entry reads as its own name in plain words.
const GESTURE = { wave: 'waving', yes: 'nodding', no: 'wagging a finger', idk: 'shrugging', laugh: 'laughing', bow: 'bowing',
  point: 'pointing', beckon: 'beckoning', thinking: 'thinking', tap: 'drumming its fingers', flipBird: 'being rude',
  snap: 'snap', doubleSnap: 'snap, snap', knock: 'knocking on the glass', dance: 'dancing', playDead: 'playing dead', sleep: 'napping',
  rpsRock: 'rock, paper, scissors', rpsPaper: 'rock, paper, scissors', rpsScissors: 'rock, paper, scissors',
  rouse: 'waking up', nestle: 'settling in', emerge: 'coming out', stretch: 'stretching', startle: 'startled', peek: 'having a look',
  shake: 'no, no', crouch: '', land: '' };
const ERRAND = { switch: 'off to the light switch', bell: 'off to ring the bell', ball: 'after the ball', rug: 'off for a nap', piano: 'playing the piano', box: 'going home' };
const plain = (name) => String(name).replace(/([A-Z])/g, ' $1').toLowerCase();
const HINTS = [['floor', TOUCH ? 'tap the floor' : 'click anywhere on the floor'], ['hand', TOUCH ? 'now tap me' : 'now click me'],
  ['prop', 'try the bell, the ball, the piano, the switch']];
const HINT_AFTER = 1.5, HINT_FOR = 20, KNOCK_AFTER = 6;      // s wall
const CAP_GAP = 14, CAP_EASE = 0.15;                          // px above the hand as drawn · s the caption takes to follow it
const STUMP = 0.3, PAD = 0.14;                                // u — the stump past the wrist joint · flesh past a fingertip joint

export function initUI({ renderer, camera, rig, sim, brain, dev = false }) {
  const cv = renderer.domElement, body = rig.mount.position;
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'A hand walks around a small room. Use the buttons or the text box to direct it.');
  $('card').hidden = true;
  $('dock').inert = false;
  const open = (el) => { if (!el.matches(':popover-open')) el.showPopover(); };

  // ---- one door for text: the box, the cards, the palette and speech
  const pal = $('pal'), talkText = $('talkText');
  const ask = (text) => {
    if (isHelp(text)) return open(pal);
    brain.ask(text).then((r) => { if (r && r.lost) { offer(); open(pal); } })
      .catch((e) => { console.error('[ui] brain.ask threw: this is a bug in src/brain.js, not something the visitor did.', e); notice('I could not do that.'); });
  };
  pal.addEventListener('beforetoggle', () => { pal.style.bottom = `${innerHeight - $('dock').getBoundingClientRect().top + 8}px`; });
  for (const box of [$('keys'), pal]) box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-say]');
    if (!b) return;
    ask(b.dataset.say);
    if (e.detail) b.blur();                                  // a pointer press: Space is jump again. A key press keeps its place.
    if (box === pal) pal.hidePopover();
  });
  $('talk').addEventListener('submit', (e) => {
    e.preventDefault();
    if (talkText.value.trim()) ask(talkText.value.trim());
    talkText.value = '';
  });
  talkText.addEventListener('keydown', (e) => {
    e.stopPropagation();                                     // typing is not driving
    if (e.key === 'Escape') { talkText.value = ''; talkText.blur(); }
  });

  // ---- what it says: line 2, on its own clock, whatever the plan does meanwhile
  let said = '', sayT = 0;
  const notice = (text) => { said = text; sayT = Math.max(C.STATUS_HOLD, text.length / 14); };
  brain.st.onsay = (text, kind) => {
    if (kind === 'error') { console.warn(`[ui] the plan stopped: ${text}`); return notice('I could not do that.'); }
    notice(kind === 'say' ? `“${text}”` : text);
  };

  // ---- sound: locked until the first press (browsers refuse it before that)
  const muteBtn = $('muteBtn'), EARS = ['pointerup', 'keydown', 'click'];
  const hear = () => {
    const running = unlockAudio();
    $('soundTip').hidden = true; label();
    if (running) for (const t of EARS) removeEventListener(t, hear, true);
  };
  for (const t of EARS) addEventListener(t, hear, true);       // capture: typing in the box counts too
  const label = () => {
    muteBtn.classList.toggle('off', audio.muted);
    muteBtn.setAttribute('aria-pressed', String(!audio.muted));
    muteBtn.setAttribute('aria-label', audio.muted ? 'Sound off' : audio.on ? 'Sound on' : 'Sound: starts with your first press');
  };
  const setMute = (m) => { audio.muted = m; brain.mute(m); label(); };
  muteBtn.addEventListener('click', () => setMute(!audio.muted));
  // a sound that nobody can hear still shows: the button blinks
  const cue = () => {
    if (audio.on && !audio.muted) return;
    muteBtn.classList.remove('pulse'); void muteBtn.offsetWidth; muteBtn.classList.add('pulse');
  };

  // ---- speech: hold V or the microphone button. Not offered where it cannot work.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, micBtn = $('micBtn');
  let rec = null, listening = false, heard = '';
  const noVoice = () => { micBtn.hidden = true; $('talkHint').hidden = true; for (const e of document.querySelectorAll('.voice')) e.hidden = true; };
  const hush = () => { if (rec) { rec.stop(); rec = null; } micBtn.classList.remove('on'); };
  const listen = () => {
    if (rec || micBtn.hidden) return;
    const r = rec = new SR();
    heard = ''; listening = true; micBtn.classList.add('on');
    r.lang = 'en-US'; r.interimResults = true; r.continuous = true;
    r.onresult = (ev) => { heard = [...ev.results].map(x => x[0].transcript).join(' ').trim(); };
    r.onerror = (ev) => {
      console.warn(`[ui] speech recognition failed (${ev.error}): allow the microphone for this page, or type the command.`);
      if (ev.error !== 'not-allowed' && ev.error !== 'service-not-allowed' && ev.error !== 'audio-capture') return;
      noVoice(); notice('The microphone was refused. Type a command.');
    };
    r.onend = () => { listening = false; if (rec === r) rec = null; micBtn.classList.remove('on'); if (heard) ask(heard); };
    r.start();
  };
  if (!SR) noVoice();
  else {
    micBtn.hidden = false; $('talkHint').hidden = false;
    // a host can switch the microphone off for the whole page (a Permissions-Policy header)
    navigator.permissions?.query({ name: 'microphone' }).then((p) => { if (p.state === 'denied') noVoice(); })
      .catch(() => {});                                      // no such permission name here: voice stays on offer
    micBtn.addEventListener('pointerdown', listen);
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) micBtn.addEventListener(t, hush);
    addEventListener('keyup', (e) => { if (e.code === 'KeyV') hush(); });
    addEventListener('blur', hush);
  }

  // ---- the in-browser model: asked for by a button (it is the consent), shown as a bar
  const brainBtn = $('brainBtn'), offer = () => { $('brainRow').hidden = !brain.needsLocal; };
  brainBtn.addEventListener('click', () => brain.loadLocal());
  brain.st.onload = ({ state, pct }) => {
    brainBtn.hidden = state === 'loading'; $('brainLoad').hidden = state !== 'loading';
    if (state === 'loading') {
      $('brainPct').textContent = pct == null ? '…' : ` · ${pct}%`;
      if (pct == null) $('brainBar').removeAttribute('value'); else $('brainBar').value = pct;
    } else if (state === 'error') brainBtn.textContent = 'Download failed. Try again';
    else talkText.placeholder = 'ask it anything…';
  };

  // ---- keys that belong to the page (driving keys live in src/input.js)
  let knockIn = dev || navigator.webdriver ? 0 : KNOCK_AFTER;  // a real visitor who only watches gets a knock
  const touched = () => { knockIn = 0; $('title').classList.add('quiet'); };
  addEventListener('pointerdown', touched);
  addEventListener('keydown', (e) => {
    touched();
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'INPUT') return;
    if (e.key === '/') { e.preventDefault(); talkText.focus(); }
    else if (e.key === '?') $('help').togglePopover();
    else if (e.code === 'KeyM') setMute(!audio.muted);
    else if (e.code === 'KeyV' && !e.repeat) listen();
  });

  // ---- first-run hints: line 1 while nothing happens, each gone once it is done
  let hintI = dev ? HINTS.length : 0, hintT = 0, still = 0;
  const did = (what) => { if (hintI < HINTS.length && HINTS[hintI][0] === what) { hintI++; hintT = 0; } };

  // line 1: what the hand is doing, in a visitor's words
  function caption() {
    if (listening) return heard ? `heard “${heard}”` : 'listening…';
    const st = brain.st, now = st.i >= 0 ? st.plan[st.i] : null, next = st.plan[st.i + 1];
    const a = now && now.do === 'face' && !now.for && next && next.do === 'gesture' ? next : now;   // the turn to the viewer is part of the sign
    if (st.status === 'thinking') return 'thinking…';
    if (!a) return still > HINT_AFTER && hintI < HINTS.length && !said ? HINTS[hintI][1] : '';
    if (st.tag && st.tag !== 'reacting') return st.tag;
    const g = sim.s.gesture;
    if (g && g.def && g.def.hover && g.dur >= 4 && !(a.do === 'gesture' && a.started)) return 'getting up…';
    if (a.do === 'gesture') return GESTURE[a.name] ?? plain(a.name);
    if (a.do === 'morse') return `tapping out “${String(a.text ?? 'sos').toUpperCase()}”`;
    if (a.for) return ERRAND[a.for] ?? `off to the ${plain(a.for)}`;
    return /^walk/.test(a.do) && (a.speed ?? 0) >= C.SPEED.sprint ? 'running' : '';
  }

  const cap = $('caption'), capDo = $('capDo'), capSay = $('capSay'), at = new THREE.Vector3();
  const TIPS = Object.values(rig.digits).map(d => d.tip), knuckle = new THREE.Vector3();
  let capX = 0, capY = 0, capOn = false;
  let rect = cv.getBoundingClientRect();
  addEventListener('resize', () => { rect = cv.getBoundingClientRect(); });
  function update(dt) {
    if (knockIn > 0 && (knockIn -= dt) <= 0 && brain.idle)
      brain.command([{ do: 'routine', name: 'knock' }], { source: 'auto', tag: 'knocking on the glass' });
    still = brain.idle ? still + dt : 0;
    if (still > HINT_AFTER && hintI < HINTS.length && (hintT += dt) > HINT_FOR) { hintI++; hintT = 0; }
    if (sayT > 0 && (sayT -= dt) <= 0) said = '';
    offer();

    const line = caption();
    if (capDo.textContent !== line) capDo.textContent = line;   // only on change: the node is a live region
    if (capSay.textContent !== said) capSay.textContent = said;
    cap.hidden = !line && !said;
    if (cap.hidden) { capOn = false; return; }
    // above the top of the hand as drawn (a sign held up must stay in view), centred on
    // it, through the live camera. Eased, so a waving finger does not shake the words.
    let lo = Infinity, hi = -Infinity, top = Infinity;
    const see = () => {
      at.project(camera);
      const sx = rect.left + (at.x + 1) / 2 * rect.width, sy = rect.top + (1 - at.y) / 2 * rect.height;
      lo = Math.min(lo, sx); hi = Math.max(hi, sx); top = Math.min(top, sy);
    };
    // the outline, near enough: the cut end of the stump (out past the wrist, away from
    // the knuckles) and the five fingertips
    rig.digits.middle.mcp.getWorldPosition(knuckle); rig.wrist.getWorldPosition(at);
    at.addScaledVector(knuckle.sub(at).normalize(), -STUMP); see();
    for (const j of TIPS) { j.getWorldPosition(at); at.y += PAD; see(); }
    const k = capOn ? 1 - Math.exp(-dt / CAP_EASE) : 1;         // a caption that just appeared starts in place
    capX += ((lo + hi) / 2 - capX) * k; capY += (top - CAP_GAP - capY) * k; capOn = true;
    const w = cap.offsetWidth / 2, floor = $('dock').getBoundingClientRect().top - 8;
    const x = THREE.MathUtils.clamp(capX, 12 + w, innerWidth - 12 - w);
    const y = THREE.MathUtils.clamp(capY, 12 + cap.offsetHeight, floor);
    cap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  }
  return { update, cue, did, notice, caption };
}
