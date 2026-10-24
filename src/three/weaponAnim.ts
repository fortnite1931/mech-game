// Pure weapon recoil animation state. Attach to real shots via kick(), drive
// with update(dt); offsets always decay back to zero — no drift accumulation.

export interface RecoilPose { amp: number; pitch: number; back: number; jitter: number }

const IDLE_EPS = 0.005;

export class WeaponRecoil {
  private amp = 0;
  private t = 99;
  private decay: number;
  private max: number;

  constructor(decay = 8, max = 1.4) {
    this.decay = decay;
    this.max = max;
  }

  /**
   * Register a live shot. Contributions decay, so a machine-gun stream
   * saturates near `max` instead of growing unbounded.
   */
  kick(strength: number): void {
    const s = Math.max(0, strength);
    this.amp = Math.min(this.max, this.amp * 0.25 + s);
    this.t = 0;
  }

  update(dt: number): RecoilPose {
    this.t += Math.max(0, dt);
    const env = Math.exp(-this.decay * this.t);
    const a = this.amp * env;
    return {
      amp: a,
      pitch: a * 0.45,                                   // стволы задираются вверх
      back: a * 0.22,                                    // откат назад по локальной Z
      jitter: a * 0.06 * Math.sin(this.t * 90),          // мелкая тряска автоматики
    };
  }

  /** True when the weapon has fully returned to rest. */
  get idle(): boolean {
    return this.amp * Math.exp(-this.decay * this.t) < IDLE_EPS;
  }

  /** Snap to rest (weapon switch, stop). */
  reset(): void {
    this.amp = 0;
    this.t = 99;
  }
}
