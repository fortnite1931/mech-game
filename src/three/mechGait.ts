import * as THREE from 'three';
import { gaitPose } from './interaction.ts';

export function articulateLeg(leg: THREE.Group, kneeY: number, footY: number) {
  const knee = new THREE.Group(); knee.name = 'knee'; knee.position.set(0, kneeY, 0.1);
  const ankle = new THREE.Group(); ankle.name = 'ankle'; ankle.position.set(0, footY - kneeY, 0);
  for (const part of [...leg.children]) {
    if (part.position.y > kneeY + 0.15) continue;
    leg.remove(part);
    if (part.position.y <= footY + 0.25) {
      part.position.sub(new THREE.Vector3(0, footY, 0.1)); ankle.add(part);
    } else { part.position.sub(knee.position); knee.add(part); }
  }
  knee.add(ankle); leg.add(knee);
}

export function animateLeg(leg: THREE.Object3D | null | undefined, phase: number, amount: number, dt: number, direction = 1, airborne = false) {
  if (!leg) return;
  const pose = gaitPose(phase, amount, direction, airborne);
  const a = 1 - Math.exp(-18 * dt);
  leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, pose.hip, a);
  const knee = leg.getObjectByName('knee'), ankle = leg.getObjectByName('ankle');
  if (knee) knee.rotation.x = THREE.MathUtils.lerp(knee.rotation.x, pose.knee, a);
  if (ankle) ankle.rotation.x = THREE.MathUtils.lerp(ankle.rotation.x, pose.ankle, a);
}
