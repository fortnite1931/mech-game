export type BarrelContents = 'empty' | 'fuel' | 'toxic';
export function interactionKind(asset: string, contents?: BarrelContents) {
  if (asset === 'girder') return 'crush';
  if (asset.startsWith('barrel')) return (contents ?? (asset === 'barrel_toxic' ? 'toxic' : 'empty')) === 'empty' ? 'crush' : 'explode';
  if (asset === 'dead_tree') return 'tree';
  if (['crate', 'tires', 'scrap', 'cone', 'grass', 'bush', 'car_wreck', 'lamp', 'antenna', 'sandbags'].includes(asset)) return 'crush';
  return 'solid';
}

// Angles in radians. Positive knee rotation folds the shin backwards.
export function gaitPose(phase: number, amount: number, direction = 1, airborne = false) {
  const lift = Math.max(0, Math.sin(phase));
  const hip = airborne ? -0.3 : -Math.cos(phase) * 0.4 * amount * direction - lift * 0.26 * amount;
  const knee = airborne ? 0.8 : (0.08 + lift * 0.95) * amount;
  return { hip, knee, ankle: -hip - knee };
}
