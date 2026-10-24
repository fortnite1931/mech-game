import type { PropValues } from '../../game/props.ts';

export interface MovementSettings {
  maxSpeed: number;
  accel: number;
  turnSpeed: number;
  brakeFactor: number;
  boostFactor: number;
  jumpJets: boolean;
  jetThrust: number;
  gravity: number;
  jetRefill: number;
  maxY: number;
  heatPerJet: number;
}

export interface MoveInput {
  forward: number;
  turn: number;
  boost: boolean;
  jet: boolean;
}

export interface MoveEnv {
  groundY: number;
  speedMul: number;
  turnMul: number;
  overheated: boolean;
  locked: boolean;
}

export interface MovementState {
  speed: number;
  vy: number;
  y: number;
  yaw: number;
  airborne: boolean;
  jetFuel: number;
  heat: number;
  /** Сила удара при приземлении, 0..1 (для пыли, звука и сминания). */
  landing: number;
  jumping: boolean;
}

export function movementDefaults(): MovementSettings {
  return {
    maxSpeed: 34,
    accel: 0.6,
    turnSpeed: 70,
    brakeFactor: 0.6,
    boostFactor: 1.45,
    jumpJets: true,
    // джетпак: тяга 14 м/с², потолок скорости 6.5 м/с, падение с гравитацией 17.
    // Тяга держит мех в воздухе, пока зажат Space — прыжок получается тяжёлым,
    // а не «молнией». maxY — это потолок СКОРОСТИ подъёма, не высота.
    jetThrust: 14,
    gravity: 17,
    jetRefill: 15,
    maxY: 6.5,
    heatPerJet: 1.5,
  };
}

export function readMovement(settings: PropValues | undefined): MovementSettings {
  const d = movementDefaults();
  if (!settings) return d;
  const n = (k: keyof MovementSettings, f: number) => {
    const v = Number(settings[k as string]);
    return Number.isFinite(v) ? v : f;
  };
  return {
    maxSpeed: n('maxSpeed', d.maxSpeed),
    accel: n('accel', d.accel),
    turnSpeed: n('turnSpeed', d.turnSpeed),
    brakeFactor: n('brakeFactor', d.brakeFactor),
    boostFactor: n('boostFactor', d.boostFactor),
    jumpJets: settings.jumpJets === true || settings.jumpJets === 'true',
    jetThrust: n('jetThrust', d.jetThrust),
    gravity: n('gravity', d.gravity),
    jetRefill: n('jetRefill', d.jetRefill),
    maxY: n('maxY', d.maxY),
    heatPerJet: n('heatPerJet', d.heatPerJet),
  };
}

/** Один шаг движения. Чистая функция: не трогает three.js, только состояние. */
export function stepMovement(prev: MovementState, dt: number, input: MoveInput, env: MoveEnv, cfg: MovementSettings): MovementState {
  const state: MovementState = { ...prev, landing: 0 };
  const boost = input.boost ? cfg.boostFactor : 1;
  const reverse = input.forward < 0 ? cfg.brakeFactor : 1;
  const maxSpeed = (cfg.maxSpeed / 3.6) * env.speedMul * (env.overheated ? 0.45 : 1) * boost;

  if (!env.locked) {
    const target = input.forward * maxSpeed * reverse;
    const accel = Math.max(0.01, maxSpeed * (0.6 + cfg.accel * 2.4));
    const diff = target - state.speed;
    state.speed += Math.sign(diff) * Math.min(Math.abs(diff), accel * dt);
  } else {
    state.speed = 0;
  }
  state.speed = Math.max(-maxSpeed, Math.min(maxSpeed, state.speed));

  if (!env.locked && input.turn !== 0) {
    const yawRate = (cfg.turnSpeed * Math.PI) / 180 * env.turnMul * (state.airborne ? 0.6 : 1);
    state.yaw += input.turn * yawRate * dt;
  }

  const wantJet = !env.locked && cfg.jumpJets && input.jet && state.jetFuel > 0 && !env.overheated;
  state.jumping = wantJet;
  if (wantJet) {
    // тяга держит мех в воздухе: разгон вверх до потолка скорости
    state.vy = Math.min(cfg.maxY, state.vy + cfg.jetThrust * dt);
    state.jetFuel = Math.max(0, state.jetFuel - cfg.jetThrust * dt);
    state.airborne = true;
    state.heat += cfg.heatPerJet * dt;
  }

  if (state.airborne) {
    // гравитация работает только когда джет выключен — иначе прыжок «молния»
    if (!wantJet) state.vy -= cfg.gravity * dt;
    state.y += state.vy * dt;
    if (state.y <= env.groundY) {
      state.y = env.groundY;
      state.airborne = false;
      state.landing = Math.min(1, Math.abs(state.vy) / 12);
      state.vy = 0;
    }
  } else {
    state.y = env.groundY;
    state.vy = 0;
    state.jetFuel = Math.min(100, state.jetFuel + cfg.jetRefill * dt);
  }
  return state;
}

export function moveDistance(speed: number, yaw: number, dt: number): { dx: number; dz: number } {
  return { dx: Math.sin(yaw) * speed * dt, dz: Math.cos(yaw) * speed * dt };
}