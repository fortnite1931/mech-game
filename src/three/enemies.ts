import * as THREE from 'three';
import { Effects } from './effects.ts';
import { sfx } from './sfx.ts';
import { animateLeg } from './mechGait.ts';
import { WeaponRecoil } from './weaponAnim.ts';
import type { EnemyKindId } from './playTypes.ts';

export interface EnemyStats { hp: number; dmg: number; rof: number; range: number; speed: number; attackRange: number }

/** Настройки ИИ из поведения типа объекта — перекрывают таблицу по умолчанию. */
export interface EnemyAiSettings {
  aggroRadius?: number;
  attackRange?: number;
  speed?: number;
  patrolSpeed?: number;
  patrolRadius?: number;
  turnSpeed?: number;
  strafeAmount?: number;
  aimError?: number;
  burstDelay?: number;
  hp?: number;
  damage?: number;
}

export const ENEMY_STATS: Record<EnemyKindId, EnemyStats> = {
  turret: { hp: 120, dmg: 8, rof: 1.2, range: 90, speed: 0, attackRange: 90 },
  mech_scout: { hp: 160, dmg: 6, rof: 2, range: 70, speed: 7, attackRange: 45 },
  mech_molot: { hp: 260, dmg: 10, rof: 1.4, range: 80, speed: 5, attackRange: 55 },
  mech_juggernaut: { hp: 500, dmg: 16, rof: 1, range: 90, speed: 3.5, attackRange: 60 },
  infantry: { hp: 90, dmg: 5, rof: 3, range: 26, speed: 4.6, attackRange: 14 },
};

// A shot the enemy wants to fire — the visible projectile is spawned by PlayController.
export interface EnemyFire { from: THREE.Vector3; dir: THREE.Vector3; speed: number; dmg: number }

export interface EnemyOpts {
  hpMul: number; dmgMul: number;
  groundHeight: (x: number, z: number) => number;
  blocked: (x: number, z: number, r: number) => boolean;
  fx: Effects;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const stepYaw = (cur: number, target: number, maxStep: number) => cur + THREE.MathUtils.clamp(wrapAngle(target - cur), -maxStep, maxStep);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

type MechState = 'patrol' | 'wait' | 'alert' | 'chase' | 'attack' | 'return';

/** Глобальные настройки патруля — приходят из сценария. */
export interface PatrolCfg {
  enabled: boolean;
  radius: number;
  speedMul: number;
  waypoints: number;
  pauseSec: number;
  aggro: number;
  alertSec: number;
  leash: number;
  returnHome: boolean;
}

export class Enemy {
  readonly id: string;
  readonly kind: EnemyKindId;
  group: THREE.Group;
  hp: number;
  maxHp: number;
  alive = true;

  private dmg: number;
  private range: number;
  private speed: number;
  private attackRange: number;
  private patrolSpeed = 0.35;
  private turnRate = 3;
  private strafeAmount = 0.5;
  private aimError = 0.035;
  private burstDelay = 1.4;
  private opts: EnemyOpts;
  private home: THREE.Vector3;
  /** Маршрут: точки вокруг дома, по ним NPC ходит по кругу. */
  private route: THREE.Vector3[] = [];
  private routeIdx = 0;
  private waitT = 0;
  private alertT = 0;
  private patrol: PatrolCfg | null = null;
  private cd = 0;
  private state: MechState = 'patrol';
  private legPhase = 0;
  private strafeT = 0;
  private strafeDir = 0;
  private recoil = new WeaponRecoil(9, 0.8);
  private weaponParts: { part: THREE.Object3D; x: number; z: number }[] = [];
  private torso: THREE.Object3D | null = null;
  private legL: THREE.Object3D | null = null;
  private legR: THREE.Object3D | null = null;
  private muzzle: THREE.Object3D | null = null;

  constructor(group: THREE.Group, kind: EnemyKindId, id: string, opts: EnemyOpts, ai: EnemyAiSettings = {}) {
    const st = ENEMY_STATS[kind];
    this.group = group;
    this.kind = kind;
    this.id = id;
    this.opts = opts;
    const baseHp = ai.hp ?? st.hp;
    this.maxHp = Math.round(baseHp * opts.hpMul);
    this.hp = this.maxHp;
    this.dmg = (ai.damage ?? st.dmg) * opts.dmgMul;
    this.range = kind === 'turret' ? (ai.aggroRadius ?? st.range) : (ai.aggroRadius ?? st.range);
    this.speed = ai.speed ?? st.speed;
    this.attackRange = ai.attackRange ?? st.attackRange;
    this.patrolSpeed = ai.patrolSpeed ?? 0.35;
    this.turnRate = ai.turnSpeed ?? 3;
    this.strafeAmount = ai.strafeAmount ?? 0.5;
    this.aimError = ai.aimError ?? 0.035;
    this.burstDelay = ai.burstDelay ?? (1 / st.rof);
    this.home = group.position.clone();
    this.cd = rand(0, 0.5);
    this.legPhase = rand(0, Math.PI * 2);
    group.traverse((o) => {
      if (o.name === 'torso') this.torso = o;
      else if (o.name === 'leg_L') this.legL = o;
      else if (o.name === 'leg_R') this.legR = o;
      else if (o.name === 'muzzle') this.muzzle = o;
    });
    group.traverse((o) => {
      if (o.name === 'arm_L' || o.name === 'arm_R' || o.name === 'cannon') this.weaponParts.push({ part: o, x: o.rotation.x, z: o.position.z });
    });
  }

  /** Включить патруль: строим маршрут вокруг дома и подставляем настройки сценария. */
  setPatrol(cfg: PatrolCfg): void {
    this.patrol = cfg;
    this.buildRoute();
    if (cfg.aggro) this.range = cfg.aggro;
    if (cfg.speedMul) this.patrolSpeed = cfg.speedMul;
  }

  private buildRoute(): void {
    const cfg = this.patrol;
    this.route = [];
    if (!cfg?.enabled) return;
    const n = Math.max(1, Math.min(12, Math.round(cfg.waypoints)));
    // равномерный круг со случайным разбросом — маршрут не выглядит «по линейке»
    const phase = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
      const r = cfg.radius * rand(0.55, 1);
      this.route.push(new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r));
    }
    this.routeIdx = 0;
  }

  /** Per-frame weapon animation: barrel kick-back decays to rest between shots. */
  updateWeaponAnim(dt: number): void {
    const pose = this.recoil.update(dt);
    for (const { part, x, z } of this.weaponParts) {
      part.rotation.x = x - pose.pitch * 0.5;
      part.position.z = z - pose.back;
    }
  }

  update(dt: number, playerPos: THREE.Vector3, emitFire: (f: EnemyFire) => void): void {
    if (!this.alive) return;
    this.cd -= dt;
    if (this.kind === 'turret') this.updateTurret(dt, playerPos, emitFire);
    else this.updateMech(dt, playerPos, emitFire);
  }

  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    sfx.hit(this.group.position);
    if (this.hp <= 0) { this.alive = false; return true; }
    return false;
  }

  // ---------------- turret ----------------
  private muzzleWorld(localY: number, localZ: number): THREE.Vector3 {
    const v = new THREE.Vector3(0, localY, localZ);
    return this.group.localToWorld(v);
  }

  private tryFire(from: THREE.Vector3, target: THREE.Vector3, spread: number, speed: number, emitFire: (f: EnemyFire) => void): void {
    const dir = new THREE.Vector3().subVectors(target, from).normalize();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    emitFire({ from: from.clone(), dir, speed, dmg: this.dmg });
    this.recoil.kick(this.kind === 'turret' ? 0.5 : 0.8);
    this.opts.fx.muzzleFlash(from, 0xff8040, 1.2);
    sfx.enemyShoot(from);
    this.cd = this.burstDelay;
  }

  private updateTurret(dt: number, playerPos: THREE.Vector3, emitFire: (f: EnemyFire) => void): void {
    const p = this.group.position;
    const dx = playerPos.x - p.x, dz = playerPos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= this.range) {
      const want = Math.atan2(dx, dz);
      const before = this.group.rotation.y;
      this.group.rotation.y = stepYaw(before, want, this.turnRate * dt);
      const err = Math.abs(wrapAngle(want - this.group.rotation.y));
      if (this.cd <= 0 && err < 0.12) {
        const from = this.muzzleWorld(1.55, 2.0);
        this.tryFire(from, new THREE.Vector3(playerPos.x, playerPos.y + 2.2, playerPos.z), this.aimError * 0.6, 60, emitFire);
      }
    } else {
      this.group.rotation.y += 0.3 * dt; // idle scan
    }
  }

  // ---------------- mech ----------------
  private updateMech(dt: number, playerPos: THREE.Vector3, emitFire: (f: EnemyFire) => void): void {
    const p = this.group.position;
    const cfg = this.patrol;
    const dx = playerPos.x - p.x, dz = playerPos.z - p.z;
    const d = Math.hypot(dx, dz);
    const distHome = Math.hypot(p.x - this.home.x, p.z - this.home.z);

    // --- выбор состояния ---
    if (this.state !== 'chase' && this.state !== 'attack') {
      if (d <= this.range) {
        if (this.state !== 'alert') { this.state = 'alert'; this.alertT = cfg?.alertSec ?? 0.6; }
      } else if (this.state === 'alert') {
        this.state = this.route.length ? 'patrol' : 'wait';
      }
    }
    // ушёл слишком далеко от базы — отпускаем игрока и возвращаемся
    if ((this.state === 'chase' || this.state === 'attack') && cfg?.returnHome && distHome > cfg.leash) {
      this.state = 'return';
    }

    let moving = 0;
    switch (this.state) {
      case 'alert': {
        // заметили игрока: доводим корпус и целимся, потом атакуем
        this.alertT -= dt;
        const want = Math.atan2(dx, dz);
        this.group.rotation.y = stepYaw(this.group.rotation.y, want, this.turnRate * 1.5 * dt);
        if (this.torso) this.torso.rotation.y = THREE.MathUtils.clamp(wrapAngle(want - this.group.rotation.y), -1.2, 1.2);
        moving = 0;
        if (this.alertT <= 0) this.state = d > this.attackRange ? 'chase' : 'attack';
        break;
      }
      case 'chase': {
        moving = this.walkToward(playerPos.x, playerPos.z, this.speed, dt);
        if (d <= this.attackRange) this.state = 'attack';
        break;
      }
      case 'return': {
        moving = this.walkToward(this.home.x, this.home.z, this.speed * 0.7, dt);
        if (distHome < 2.5) { this.state = 'patrol'; this.routeIdx = 0; }
        break;
      }
      case 'wait': {
        this.waitT -= dt;
        if (this.waitT <= 0) {
          if (this.route.length) { this.state = 'patrol'; this.routeIdx = 0; }
          else this.waitT = 1;
        }
        moving = 0;
        break;
      }
      case 'patrol':
      default: {
        if (!cfg?.enabled || !this.route.length) {
          // без маршрута — медленное покачивание на месте (старая заглушка)
          this.group.rotation.y += dt * 0.25;
          moving = 0;
          break;
        }
        const wp = this.route[this.routeIdx];
        if (!wp) { this.routeIdx = 0; break; }
        const reached = Math.hypot(p.x - wp.x, p.z - wp.z) < 1.6;
        if (reached) {
          moving = 0;
          if (this.waitT <= 0) this.waitT = Math.max(0, cfg.pauseSec) * rand(0.6, 1.4);
          this.waitT -= dt;
          if (this.waitT <= 0) this.routeIdx = (this.routeIdx + 1) % this.route.length;
        } else {
          moving = this.walkToward(wp.x, wp.z, this.speed * this.patrolSpeed, dt);
          this.waitT = 0;
        }
        break;
      }
    }

    // огонь в бою
    if (this.state === 'attack' && this.cd <= 0) {
      const want = Math.atan2(dx, dz);
      this.group.rotation.y = stepYaw(this.group.rotation.y, want, this.turnRate * dt);
      if (this.torso) this.torso.rotation.y = THREE.MathUtils.clamp(wrapAngle(want - this.group.rotation.y), -1.2, 1.2);
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeT = rand(2, 4);
      }
      const side = this.group.rotation.y + Math.PI / 2;
      const sx = p.x + Math.sin(side) * this.strafeDir * this.speed * 0.4 * dt;
      const sz = p.z + Math.cos(side) * this.strafeDir * this.speed * 0.4 * dt;
      if (!this.opts.blocked(sx, sz, 1.2)) { p.x = sx; p.z = sz; moving = this.speed * this.strafeAmount; }
      const err = Math.abs(wrapAngle(want - this.group.rotation.y));
      if (err < 0.15) {
        const from = this.muzzle ? this.muzzle.getWorldPosition(new THREE.Vector3()) : this.muzzleWorld(this.kind === 'infantry' ? 1.5 : 3.2, this.kind === 'infantry' ? 0.5 : 1.5);
        this.tryFire(from, new THREE.Vector3(playerPos.x, playerPos.y + 1.4, playerPos.z), this.aimError, 55, emitFire);
      }
    }

    p.y = this.opts.groundHeight(p.x, p.z);
    // walk animation
    if (moving > 0.1) {
      this.legPhase += dt * (2 + moving * 0.9);
      animateLeg(this.legL, this.legPhase, Math.min(1, moving / 4), dt);
      animateLeg(this.legR, this.legPhase + Math.PI, Math.min(1, moving / 4), dt);
      this.group.rotation.z = Math.sin(this.legPhase) * 0.02;
    } else {
      animateLeg(this.legL, 0, 0, dt);
      animateLeg(this.legR, 0, 0, dt);
      this.group.rotation.z *= 0.9;
    }
  }

  private walkToward(tx: number, tz: number, speed: number, dt: number): number {
    const p = this.group.position;
    const want = Math.atan2(tx - p.x, tz - p.z);
    this.group.rotation.y = stepYaw(this.group.rotation.y, want, this.turnRate * dt);
    const nx = p.x + Math.sin(this.group.rotation.y) * speed * dt;
    const nz = p.z + Math.cos(this.group.rotation.y) * speed * dt;
    if (!this.opts.blocked(nx, nz, 1.6)) { p.x = nx; p.z = nz; return speed; }
    // sidestep attempt
    for (const a of [0.7, -0.7]) {
      const yaw = this.group.rotation.y + a;
      const ax = p.x + Math.sin(yaw) * speed * dt, az = p.z + Math.cos(yaw) * speed * dt;
      if (!this.opts.blocked(ax, az, 1.6)) { p.x = ax; p.z = az; return speed; }
    }
    return 0;
  }
}
