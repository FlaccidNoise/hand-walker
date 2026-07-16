// src/tuning.js — EVERY constant. Single source of truth. (HANDOFF §3, §5)
// Anatomy-not-tuning constants (§5) are held EXACTLY; do not "fix" them.

// --- Time ---
export const TIME_SCALE = 0.75;        // slow the clock; hand-sized creature under real gravity moves violently fast
export const SWING_MIN = 0.11;        // s — the cadence law, startSwing and QA all share it (anatomy, §5)

// --- SI body / physics ---
export const MASS = 0.45;             // kg — a real severed adult hand (anatomy, §5)
export const MU = 1.1;                 // friction coef; locomotion is friction-limited (anatomy, §5)
export const F_DIGIT = 15;            // N sustained flexor strength per digit (anatomy, §5)
export const F_DIGIT_BURST = 8;       // N burst (landing impulse) per digit
export const F_DIGIT_LAT = 8;         // N lateral per digit (caps friction force, FhMax)
export const G_SI = 9.81;             // m/s^2 (real gravity). World G = G_SI / WORLD_M, derived in rig.
export const FLOOR_Y = 0;             // palm bottoms here and scrapes with sliding friction

// --- Spring (planted digit = stiff ~critically damped spring, force capped by F_DIGIT) ---
export const SPRING_K = 9000;         // N/m  (tuned stiff; overloads sag because force is capped)
export const SPRING_C = 2 * Math.sqrt(MASS * SPRING_K) * 0.9; // ~critical damping

// --- Joint limits (anatomy, §5): [MCP curl, PIP curl, DIP curl] rad ---
// PIP 1.75 rad = 100° (real ~100–110°). dMin is downstream of these.
export const LIMITS = [
  [-0.55, 1.6],   // MCP
  [0, 1.75],      // PIP
  [-0.35, 1.35],  // DIP
];

// --- Reach / step geometry ---
export const DIP_SLAVE = 0.62;        // DIP anatomically slaved to PIP (~0.62·) (§4.2)
export const THUMB_SLAVE = 0.5;       // thumb IP slaved to its MCP flexion (CMC-rooted chain)
export const THUMB_CMC_EXT = -0.9;    // CMC extension range (~50°) — LIMITS[0] is finger-MCP anatomy
// MCP ab/adduction yaw (§4.2): anatomical range (§7: fingers ±0.3, thumb ±0.65),
// faded out near the knuckle where the lever shrinks (|t|/reach between LO and HI).
export const YAW_MAX_FINGER = 0.3;
export const YAW_MAX_THUMB = 0.9;     // CMC palmar abduction (~50°) — the ±0.65 figure was
                                      // the original's proximal-rooted thumb, ours roots at the CMC
export const YAW_FADE_LO = 0.15;
export const YAW_FADE_HI = 0.40;
export const ARC_CLEAR = 0.05;         // load-bearing step-height margin, binds on ~80% of swing frames (anatomy, §5)

// --- Separation controller (§4.9) ---
export const SEP_ANG = 0.35;          // rad — angle-gated to genuine crossing threats only
export const SEP_SIGN = 1;            // +1 verified (anatomy, §5)
export const SEP_AUTH_PLANTED = 0.18;  // authority rad
export const SEP_AUTH_SWING = 0.30;

// --- Phase gait (§4.5) ---
export const PHASE_SEP = 0.25;         // min phase gap between spatially adjacent digits
export const BAND_UTIL = 0.8;          // cadence law targets this fraction of the pacer band —
                                       // 0.9/1.0 raise edge drift more than fewer steps save

// --- Steering ---
export const V_MAX = 2.6;             // u/s leash / gamepad top (walk→run)

// --- Speed crossover V_MOVE: aloft only active while speed > this ---
export const V_MOVE = 0.15;

// --- Gaits (§4.7): walk→trot→run selected by commanded speed, like a dog. fMax is the
// gait's cadence ceiling (Hz); its top SPEED derives from calibration (cadence law ×
// pacer band), clamped by vCap so all three gaits live inside 0..V_MAX. Thumb carried
// ALOFT in trot/run — its band can't service them. Phase offsets keep spatially
// adjacent digits ≥PHASE_SEP apart (walk ripple: every neighbour pair 0.4 apart). ---
export const GAITS = {
  // thumb aloft in ALL moving gaits: with palm-down flexion its forward band at walk
  // height is a sliver (~0.05) — the spec's own rule ("its band can't service trot")
  // applies to our walk too. It plants at rest below V_MOVE (the standing Thing look).
  walk: { duty: 0.78, fMax: 3.0, arcH: 0.18, vCap: 1.3, aloft: ['thumb'],
          offsets: { index: 0.0, ring: 0.25, middle: 0.5, pinky: 0.75, thumb: 0.4 } },
  trot: { duty: 0.62, fMax: 5.5, arcH: 0.22, vCap: 2.1, aloft: ['thumb'],
          offsets: { index: 0.0, ring: 0.0, middle: 0.5, pinky: 0.5, thumb: 0.25 } },
  run:  { duty: 0.50, fMax: 7.0, arcH: 0.24, vCap: Infinity, aloft: ['thumb'],
          offsets: { index: 0.0, ring: 0.0, middle: 0.5, pinky: 0.5, thumb: 0.25 } },
};
export const GAIT_ORDER = ['walk', 'trot', 'run'];
export const GAIT_HYST = 0.15;        // upshift at vTop+0.15, downshift at lower gait's vTop exactly (§4.7)

// --- Steering / cadence ---
export const STEER_GAIN = 6;          // yaw-rate gain toward the commanded heading (1/s)
export const YAW_RATE_MAX = 0.35;     // rad/s — feet sweep yawRate·radius·stanceTime of arc
                                      // per stance; beyond ~0.1 rad/stance no band absorbs it
                                      // (a hand pivots deliberately, in small re-steps)
export const CAD_YAW_GAIN = 1.5;      // cadence rise per |yaw rate| — turning buys re-steps (§4.5)
export const ACCEL_TAU = 0.12;        // s — velocity-command response time (friction-limited)

// --- Swing shaping (§4.6) ---
export const LANE_CLAMP = 0.09;       // lane half-width, ·reach
export const BAND_MARGIN = 0.03;      // keep landings this far inside the band edges
export const FOLD_K = 0.6;            // rad of extra PIP curl at peak stepping fold
export const RESCUE_DUR = 0.16;       // s — rescue swings take at least this
export const RESCUE_HOLD = 0.55;      // rescue holds the fold until t=0.55

// --- Jump (§4.8, energy-based) ---
export const JUMP_STROKE = 0.12;      // world units of push-off stroke

// --- Joint rate limits (rad/s): cap the solve, NEVER the constraint (§4.3) ---
export const RATE_PLANTED = 16;
export const RATE_SWING = 18;
export const TUCK_MIN = 1.15;          // airborne legs never tuck below 1.15·standH

// §5 stance rule: feet plant forward of the knuckles as descending diagonals — each
// rest sits on the ground at REST_EXT of the digit's reach along its lane, at least
// REST_MIN_FWD·reach forward of the MCP. standH = HIGHEST wrist height where every
// digit (incl. thumb) plants through the real solver; the pinky pins it.
export const REST_EXT = 0.92;
export const REST_MIN_FWD = 0.25;
export const BELLY_CLEAR = 0.06;      // palm/stump underside stays at least this far off the floor

// --- Calibration (§4.4) ---
export const CALIB_DT = 0.05;         // fixed dt, no wall clock → bit-exact
export const BAND_TIP_ERR = 0.025;    // contiguous window kept where tip err < this
export const BAND_HEIGHT_SAMPLES = 25; // per-height band table over ±0.15 of standH
export const BAND_HEIGHT_RANGE = 0.15;
export const BAND_S_MIN = -0.3;       // lane scan: foot offset forward of the live MCP
export const BAND_S_MAX = 1.2;
export const BAND_S_STEP = 0.01;
export const POSE_CROUCH = 0.95;      // crouch −5%
export const POSE_SAG = -0.035;       // sag

// --- TUNE flags (the only thing you should touch when tuning) ---
export const TUNE = {
  liveBands: 1,      // 1 = per-height band table (default), 0 = A/B control
  dMinK: 1.1,        // fold annulus multiplier (anatomy, §5)
  arcClear: ARC_CLEAR,
  // walk-pitch / stance posture baked into the calib scan pose:
  walkPitch: 0.0,    // set at rig time from bind geometry
  walkRoll: 0.0,     // constant ROLL during scan (§4.4)
  flat: true,        // FLAT ground during scan
};

// --- Neighbours (for phase separation + separation controller) ---
export const NEIGHBORS = {
  thumb:  ['index'],
  index:  ['middle', 'thumb'],
  middle: ['index', 'ring'],
  ring:   ['middle', 'pinky'],
  pinky:  ['ring'],
};

// --- Handedness: this GLB is a LEFT hand (the severed "Thing"). rig.js derives
//     axis/signs from the bind pose; HANDEDNESS multiplies lateral quantities so
//     a right hand is a sign flip away. -1 = left (default).
export const HANDEDNESS = -1;
