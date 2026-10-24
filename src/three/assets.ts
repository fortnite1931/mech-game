import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { getSharedMaterials } from './materials.ts';
import { articulateLeg } from './mechGait.ts';

// ---------- small helpers ----------
function M(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  return M(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
}
function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 18) {
  return M(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
}
function sph(r: number, mat: THREE.Material, x = 0, y = 0, z = 0, w = 16, h = 12) {
  return M(new THREE.SphereGeometry(r, w, h), mat, x, y, z);
}
function tor(r: number, t: number, mat: THREE.Material, x = 0, y = 0, z = 0, arc = Math.PI * 2) {
  return M(new THREE.TorusGeometry(r, t, 10, 24, arc), mat, x, y, z);
}
function rot(o: THREE.Object3D, x = 0, y = 0, z = 0) { o.rotation.set(x, y, z); return o; }
function mulberry(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function displace(geo: THREE.BufferGeometry, amt: number, seed: number) {
  const rnd = mulberry(seed);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) + (rnd() - 0.5) * amt,
      pos.getY(i) + (rnd() - 0.5) * amt,
      pos.getZ(i) + (rnd() - 0.5) * amt);
  }
  geo.computeVertexNormals();
  return geo;
}
function glowSprite(color: string, size: number, opacity = 0.55) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

// =====================================================================
// MECHS
// =====================================================================
function buildMechScout(): THREE.Group {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  g.name = 'mech_scout';

  // pelvis
  g.add(box(1.5, 0.6, 1.0, mt.mechDark, 0, 2.55, 0));
  g.add(box(1.7, 0.25, 1.1, mt.hazard, 0, 2.32, 0));
  // torso main
  const torso = new THREE.Group(); torso.name = 'torso'; torso.position.y = 3.35; g.add(torso);
  torso.add(box(2.0, 1.3, 1.5, mt.mechArmor, 0, 0, 0));
  torso.add(rot(box(2.1, 0.7, 1.2, mt.mechArmor, 0, 0.55, -0.15), -0.18, 0, 0));
  torso.add(box(1.2, 0.5, 0.25, mt.mechDark, 0, 0.15, 0.82)); // chest plate
  // cockpit glass
  const glass = box(0.9, 0.42, 0.12, mt.glassCockpit, 0, 0.32, 0.78);
  torso.add(glass);
  // head sensor block
  torso.add(box(0.6, 0.35, 0.6, mt.mechDark, 0.55, 0.85, 0.35));
  const eye = box(0.18, 0.12, 0.06, mt.lightRed, 0.55, 0.85, 0.67);
  torso.add(eye);
  const eyeGlow = glowSprite('rgba(255,70,50,0.9)', 0.7, 0.5); eyeGlow.position.set(0.55, 0.85, 0.75); torso.add(eyeGlow);
  // side pods + vents
  [-1.15, 1.15].forEach((x) => {
    torso.add(box(0.45, 0.9, 1.1, mt.mechDark, x, -0.05, -0.1));
    for (let i = 0; i < 3; i++) torso.add(box(0.47, 0.08, 0.8, mt.steelDark, x, -0.25 + i * 0.22, -0.1));
  });
  // backpack exhausts
  [-0.5, 0.5].forEach((x) => {
    const ex = cyl(0.16, 0.2, 0.9, mt.steelDark, x, 0.2, -0.95); ex.rotation.x = Math.PI / 2 - 0.25; torso.add(ex);
    const tip = cyl(0.17, 0.17, 0.08, mt.rustHeavy, x, 0.31, -1.36); tip.rotation.x = Math.PI / 2 - 0.25; torso.add(tip);
  });
  // antenna
  const ant = cyl(0.02, 0.03, 1.6, mt.steelDark, -0.85, 1.3, -0.4); torso.add(ant);
  const antTip = sph(0.05, mt.lightRed, -0.85, 2.1, -0.4); torso.add(antTip);

  // shoulders + arms
  [-1.45, 1.45].forEach((sx, side) => {
    const sh = new THREE.Group(); sh.name = side === 0 ? 'arm_L' : 'arm_R'; sh.position.set(sx, 0.4, 0); torso.add(sh);
    const mzp = new THREE.Object3D(); mzp.name = 'muzzle'; mzp.position.set(0, -2.1, 1.85); sh.add(mzp);
    sh.add(box(0.85, 0.85, 1.0, mt.mechArmor, 0, 0, 0));
    sh.add(box(0.9, 0.3, 0.7, mt.hazard, 0, -0.5, 0));
    const upper = box(0.55, 1.0, 0.6, mt.mechDark, 0, -0.9, 0); sh.add(upper);
    const elbow = cyl(0.28, 0.28, 0.7, mt.steelDark, 0, -1.45, 0); elbow.rotation.z = Math.PI / 2; sh.add(elbow);
    const fore = box(0.6, 0.9, 0.65, mt.mechArmor, 0, -2.0, 0.05); sh.add(fore);
    // gun
    const barrel = cyl(0.09, 0.11, 1.5, mt.steelDark, 0, -2.1, 0.9); barrel.rotation.x = Math.PI / 2; sh.add(barrel);
    const muzzle = cyl(0.13, 0.13, 0.25, mt.rustHeavy, 0, -2.1, 1.65); muzzle.rotation.x = Math.PI / 2; sh.add(muzzle);
    const ammo = box(0.4, 0.5, 0.7, mt.rustDark, 0, -1.85, -0.5); sh.add(ammo);
    // piston
    const pist = cyl(0.05, 0.05, 0.8, mt.steelLight, 0.32, -1.2, 0.25); sh.add(pist);
    if (side === 0) sh.rotation.z = 0.06; else sh.rotation.z = -0.06;
  });

  // legs
  [-0.75, 0.75].forEach((lx) => {
    const leg = new THREE.Group(); leg.name = lx < 0 ? 'leg_L' : 'leg_R'; leg.position.set(lx, 2.3, 0); g.add(leg);
    leg.add(box(0.7, 0.7, 0.8, mt.mechArmor, 0, -0.2, 0)); // hip
    const thigh = box(0.62, 1.1, 0.7, mt.mechDark, 0, -0.9, 0); leg.add(thigh);
    leg.add(box(0.66, 0.28, 0.5, mt.hazard, 0, -0.65, 0.12));
    const knee = cyl(0.3, 0.3, 0.75, mt.steelDark, 0, -1.5, 0.1); knee.rotation.z = Math.PI / 2; leg.add(knee);
    const shin = box(0.55, 1.0, 0.6, mt.mechArmor, 0, -2.1, 0.02); leg.add(shin);
    // rear piston
    const pist = cyl(0.07, 0.07, 1.2, mt.steelLight, 0, -1.7, -0.42); leg.add(pist);
    const pist2 = cyl(0.11, 0.11, 0.5, mt.copperPipe, 0, -1.25, -0.42); leg.add(pist2);
    // foot
    leg.add(box(0.85, 0.3, 1.25, mt.mechDark, 0, -2.75, 0.15));
    leg.add(box(0.9, 0.14, 0.5, mt.hazard, 0, -2.62, 0.55));
    articulateLeg(leg, -1.5, -2.75);
  });
  // ground shadow blob handled by real shadows
  return g;
}

function buildMechJuggernaut(): THREE.Group {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  // pelvis + torso (wider, heavier)
  g.add(box(2.2, 0.7, 1.4, mt.mechDark, 0, 2.6, 0));
  const torso = new THREE.Group(); torso.name = 'torso'; torso.position.y = 3.7; g.add(torso);
  torso.add(box(2.9, 1.6, 1.9, mt.mechArmor, 0, 0, 0));
  torso.add(rot(box(3.0, 0.8, 1.6, mt.mechDark, 0, 0.7, -0.2), -0.2, 0, 0));
  torso.add(box(1.6, 0.6, 0.2, mt.steelDark, 0, 0.1, 1.0));
  torso.add(box(1.1, 0.45, 0.12, mt.glassCockpit, -0.5, 0.25, 1.05));
  torso.add(box(0.5, 0.5, 0.15, mt.lightCyan, 0.75, 0.2, 1.02));
  // missile pods on shoulders
  [-1.9, 1.9].forEach((x) => {
    const pod = new THREE.Group(); pod.name = 'missile_pod'; pod.position.set(x, 0.75, -0.2); torso.add(pod);
    const mm = new THREE.Object3D(); mm.name = 'muzzle_missile'; mm.position.set(0, 0, 1.2); pod.add(mm);
    pod.add(box(1.0, 0.8, 1.6, mt.mechDark, 0, 0, 0));
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const tube = cyl(0.13, 0.13, 0.3, mt.steelDark, -0.28 + c * 0.28, -0.15 + r * 0.32, 0.88);
      tube.rotation.x = Math.PI / 2; pod.add(tube);
      const hole = cyl(0.09, 0.09, 0.05, mt.rubber, -0.28 + c * 0.28, -0.15 + r * 0.32, 1.03);
      hole.rotation.x = Math.PI / 2; pod.add(hole);
    }
  });
  // exhausts x3
  [-0.7, 0, 0.7].forEach((x) => {
    const ex = cyl(0.2, 0.24, 1.0, mt.steelDark, x, 0.3, -1.2); ex.rotation.x = Math.PI / 2 - 0.2; torso.add(ex);
  });
  // hazard skirt
  torso.add(box(3.0, 0.3, 2.0, mt.hazard, 0, -0.9, 0));
  // arms — heavy cannons
  [-2.05, 2.05].forEach((sx) => {
    const sh = new THREE.Group(); sh.name = sx < 0 ? 'arm_L' : 'arm_R'; sh.position.set(sx, 0.2, 0); torso.add(sh);
    const mzp = new THREE.Object3D(); mzp.name = 'muzzle'; mzp.position.set(0, -1.2, 2.6); sh.add(mzp);
    sh.add(box(1.0, 1.0, 1.2, mt.mechArmor, 0, 0, 0));
    sh.add(box(0.7, 1.1, 0.75, mt.mechDark, 0, -1.0, 0));
    // twin barrels
    [-0.18, 0.18].forEach((ox) => {
      const b = cyl(0.12, 0.14, 2.1, mt.steelDark, ox, -1.2, 1.2); b.rotation.x = Math.PI / 2; sh.add(b);
      const mz = cyl(0.17, 0.17, 0.35, mt.rustHeavy, ox, -1.2, 2.3); mz.rotation.x = Math.PI / 2; sh.add(mz);
    });
    sh.add(box(0.9, 0.7, 1.0, mt.rustDark, 0, -1.0, -0.6)); // ammo drum
    const drum = cyl(0.35, 0.35, 0.5, mt.rustHeavy, 0.55, -0.9, -0.6); drum.rotation.z = Math.PI / 2; sh.add(drum);
  });
  // legs — massive
  [-1.05, 1.05].forEach((lx) => {
    const leg = new THREE.Group(); leg.name = lx < 0 ? 'leg_L' : 'leg_R'; leg.position.set(lx, 2.25, 0); g.add(leg);
    leg.add(box(1.0, 0.8, 1.0, mt.mechArmor, 0, -0.2, 0));
    leg.add(box(0.85, 1.2, 0.9, mt.mechDark, 0, -1.0, 0));
    const knee = cyl(0.4, 0.4, 1.0, mt.steelDark, 0, -1.65, 0.12); knee.rotation.z = Math.PI / 2; leg.add(knee);
    leg.add(box(0.8, 1.1, 0.85, mt.mechArmor, 0, -2.3, 0));
    // side pistons
    [-0.5, 0.5].forEach((ox) => {
      leg.add(cyl(0.08, 0.08, 1.3, mt.steelLight, ox, -1.7, -0.5));
    });
    leg.add(box(1.25, 0.35, 1.7, mt.mechDark, 0, -3.0, 0.2));
    leg.add(box(1.3, 0.16, 0.6, mt.hazard, 0, -2.85, 0.75));
    articulateLeg(leg, -1.65, -3.0);
  });
  // antenna + lights
  const ant = cyl(0.025, 0.04, 2.0, mt.steelDark, -1.2, 5.2, -0.6); g.add(ant);
  g.add(sph(0.06, mt.lightRed, -1.2, 6.2, -0.6));
  const beacon = glowSprite('rgba(255,60,40,0.9)', 0.9, 0.5); beacon.position.set(-1.2, 6.2, -0.6); g.add(beacon);
  [-1.3, 1.3].forEach((x) => {
    const l = box(0.22, 0.14, 0.06, mt.lightWarm, x, 3.15, 0.99); g.add(l);
  });
  // shift up so feet touch ground: feet at y ≈ 2.25-3.0-0.17 ≈ -0.9 → lift
  g.position.y = 0.95;
  const wrap = new THREE.Group(); wrap.add(g); g.position.y = 0.95;
  return wrap;
}

function buildMechMolot(): THREE.Group {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  g.add(box(1.8, 0.6, 1.15, mt.mechDark, 0, 2.5, 0));
  const torso = new THREE.Group(); torso.name = 'torso'; torso.position.y = 3.35; g.add(torso);
  const cannonMz = new THREE.Object3D(); cannonMz.name = 'muzzle'; cannonMz.position.set(1.55, -0.1, 3.9); torso.add(cannonMz);
  torso.add(box(2.3, 1.4, 1.6, mt.mechArmor, 0, 0, 0));
  torso.add(rot(box(1.8, 0.6, 1.3, mt.mechDark, 0.2, 0.75, 0.1), 0, 0.15, 0));
  torso.add(box(1.0, 0.4, 0.12, mt.glassCockpit, -0.35, 0.2, 0.85));
  // shield plate left
  const shield = box(0.18, 1.6, 1.4, mt.mechArmor, -1.7, -0.6, 0.4);
  torso.add(shield);
  torso.add(box(0.2, 0.35, 1.0, mt.hazard, -1.7, -1.15, 0.4));
  // cannon right — huge
  const cannon = new THREE.Group(); cannon.name = 'cannon'; cannon.position.set(1.55, -0.2, 0.3); torso.add(cannon);
  cannon.add(box(0.9, 0.9, 1.6, mt.mechDark, 0, 0, 0));
  const bar = cyl(0.2, 0.24, 2.6, mt.steelDark, 0, 0.1, 1.9); bar.rotation.x = Math.PI / 2; cannon.add(bar);
  const mz = cyl(0.3, 0.3, 0.5, mt.rustHeavy, 0, 0.1, 3.2); mz.rotation.x = Math.PI / 2; cannon.add(mz);
  // rings on barrel
  [1.2, 1.8, 2.4].forEach((z) => {
    const ring = tor(0.24, 0.045, mt.copperPipe, 0, 0.1, z); cannon.add(ring);
  });
  // arms
  [-1.5, 1.5].forEach((sx, i) => {
    const sh = new THREE.Group(); sh.name = i === 0 ? 'arm_L' : 'arm_R'; sh.position.set(sx, 0.35, 0); torso.add(sh);
    if (i === 0) { const mzp = new THREE.Object3D(); mzp.name = 'muzzle'; mzp.position.set(0, -1.9, 0.9); sh.add(mzp); }
    sh.add(box(0.8, 0.8, 0.95, mt.mechArmor, 0, 0, 0));
    sh.add(box(0.55, 1.6, 0.6, mt.mechDark, 0, -1.1, i === 0 ? 0.35 : 0));
  });
  // legs
  [-0.85, 0.85].forEach((lx) => {
    const leg = new THREE.Group(); leg.name = lx < 0 ? 'leg_L' : 'leg_R'; leg.position.set(lx, 2.2, 0); g.add(leg);
    leg.add(box(0.75, 1.3, 0.8, mt.mechDark, 0, -0.7, 0));
    const knee = cyl(0.32, 0.32, 0.85, mt.steelDark, 0, -1.4, 0.1); knee.rotation.z = Math.PI / 2; leg.add(knee);
    leg.add(box(0.62, 1.1, 0.68, mt.mechArmor, 0, -2.05, 0));
    leg.add(cyl(0.07, 0.07, 1.2, mt.steelLight, 0.35, -1.6, -0.4));
    leg.add(box(0.95, 0.32, 1.35, mt.mechDark, 0, -2.7, 0.15));
    articulateLeg(leg, -1.4, -2.7);
  });
  // searchlight
  const sl = cyl(0.16, 0.2, 0.35, mt.steelDark, 0.6, 4.15, 0.75); sl.rotation.x = Math.PI / 2; g.add(sl);
  const lens = cyl(0.14, 0.14, 0.05, mt.lightWarm, 0.6, 4.15, 0.95); lens.rotation.x = Math.PI / 2; g.add(lens);
  const beam = glowSprite('rgba(255,200,130,0.85)', 1.2, 0.45); beam.position.set(0.6, 4.15, 1.05); g.add(beam);
  return g;
}

// =====================================================================
// BARRELS & CARGO
// =====================================================================
function buildBarrel(mt: ReturnType<typeof getSharedMaterials>, mat: THREE.Material, h = 1.15): THREE.Group {
  const g = new THREE.Group();
  const body = cyl(0.32, 0.32, h, mat, 0, h / 2, 0, 22);
  g.add(body);
  [0.25, 0.75].forEach((t) => {
    const rib = tor(0.325, 0.028, mat, 0, h * t, 0); rib.rotation.x = Math.PI / 2; g.add(rib);
  });
  g.add(cyl(0.3, 0.3, 0.04, mt.steelDark, 0, h + 0.01, 0, 22));
  g.add(cyl(0.05, 0.05, 0.06, mt.rustHeavy, 0.15, h + 0.04, 0.08, 10)); // cap
  // hazard band
  const band = cyl(0.328, 0.328, 0.18, mt.hazard, 0, h * 0.5, 0, 22);
  g.add(band);
  return g;
}
function buildBarrelRusty() { const mt = getSharedMaterials(); return buildBarrel(mt, mt.rustOrange); }
function buildBarrelGroup() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const b1 = buildBarrel(mt, mt.rustOrange); g.add(b1);
  const b2 = buildBarrel(mt, mt.rustHeavy); b2.position.set(0.72, 0, 0.25); g.add(b2);
  const b3 = buildBarrel(mt, mt.rustDark); b3.position.set(0.35, 0.32, -0.55); b3.rotation.set(Math.PI / 2 - 0.08, 0, 0.5); g.add(b3);
  // puddle stain
  const stain = M(new THREE.CircleGeometry(1.1, 24), new THREE.MeshStandardMaterial({ color: 0x191410, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.7 }), 0.3, 0.02, 0);
  stain.rotation.x = -Math.PI / 2; g.add(stain);
  return g;
}
function buildBarrelToxic() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const body = cyl(0.34, 0.34, 1.2, mt.rustDark, 0, 0.6, 0, 22); g.add(body);
  const glowBand = cyl(0.35, 0.35, 0.28, mt.toxicGlow, 0, 0.75, 0, 22); g.add(glowBand);
  g.add(cyl(0.32, 0.32, 0.05, mt.toxicGlow, 0, 1.22, 0, 22));
  const s = glowSprite('rgba(120,255,80,0.8)', 1.6, 0.4); s.position.y = 1.35; g.add(s);
  // warning sign
  g.add(box(0.3, 0.3, 0.02, mt.hazard, 0, 0.35, 0.34));
  return g;
}
function buildContainer() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const W = 6, H = 2.6, D = 2.5;
  g.add(box(W, H, D, mt.metalPanels, 0, H / 2 + 0.15, 0));
  // corner posts
  [[-W/2, -D/2], [W/2, -D/2], [-W/2, D/2], [W/2, D/2]].forEach(([x, z]) => {
    g.add(box(0.22, H + 0.1, 0.22, mt.rustDark, x, H / 2 + 0.15, z));
  });
  // top rail + bottom rail
  g.add(box(W + 0.1, 0.15, D + 0.1, mt.rustHeavy, 0, H + 0.2, 0));
  g.add(box(W + 0.1, 0.18, D + 0.1, mt.steelDark, 0, 0.2, 0));
  // doors at +X
  g.add(box(0.08, H - 0.4, 0.06, mt.steelDark, W / 2 + 0.02, H / 2 + 0.15, -0.5));
  g.add(box(0.08, H - 0.4, 0.06, mt.steelDark, W / 2 + 0.02, H / 2 + 0.15, 0.5));
  for (let i = 0; i < 4; i++) {
    g.add(box(0.1, 0.12, 1.9, mt.rustDark, W / 2 + 0.02, 0.7 + i * 0.55, 0));
  }
  // side number plate + hazard
  g.add(box(1.4, 0.5, 0.05, mt.hazard, -1.2, 1.9, D / 2 + 0.02));
  g.add(box(0.9, 0.35, 0.05, mt.concrete, 1.0, 1.0, D / 2 + 0.02));
  // dents on roof: small dark boxes
  const rnd = mulberry(7);
  for (let i = 0; i < 5; i++) {
    g.add(box(0.5 + rnd() * 0.6, 0.06, 0.5, mt.rustHeavy, (rnd() - 0.5) * (W - 1), H + 0.28, (rnd() - 0.5) * (D - 0.6)));
  }
  return g;
}
function buildCone() {
  const g = new THREE.Group();
  const faded = new THREE.MeshStandardMaterial({ color: 0xb05a28, roughness: 0.88, metalness: 0.02 });
  const band = new THREE.MeshStandardMaterial({ color: 0xcfc8bd, roughness: 0.85, metalness: 0.02 });
  g.add(M(new THREE.ConeGeometry(0.28, 0.7, 14, 1, true), faded, 0, 0.35, 0));
  g.add(cyl(0.11, 0.16, 0.12, band, 0, 0.38, 0, 14));
  g.add(box(0.56, 0.05, 0.56, faded, 0, 0.03, 0));
  const c2 = M(new THREE.ConeGeometry(0.28, 0.7, 14, 1, true), faded, 0.95, 0.3, 0.45);
  c2.rotation.set(Math.PI / 2 - 0.12, 0.5, 0.25);
  g.add(c2);
  g.add(box(0.56, 0.05, 0.56, faded, 0.95, 0.06, 0.45));
  return g;
}
function buildCrate() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const S = 1.2;
  g.add(box(S, S, S, mt.wood, 0, S / 2, 0));
  // frame edges
  const e = 0.12;
  [[-S/2, -S/2], [S/2, -S/2], [-S/2, S/2], [S/2, S/2]].forEach(([x, z]) => g.add(box(e, S + 0.04, e, mt.rustDark, x, S / 2, z)));
  g.add(box(S + 0.06, e, e, mt.rustDark, 0, S - e / 2, S / 2));
  g.add(box(S + 0.06, e, e, mt.rustDark, 0, S - e / 2, -S / 2));
  g.add(box(S + 0.06, e, e, mt.rustDark, 0, e / 2, S / 2));
  // broken plank leaning
  const plank = box(1.1, 0.18, 0.05, mt.wood, 0.9, 0.35, 0.5); plank.rotation.set(0.2, 0.5, 1.1); g.add(plank);
  const plank2 = box(0.9, 0.18, 0.05, mt.wood, -0.8, 0.15, 0.7); plank2.rotation.set(-0.1, -0.4, 0.15); g.add(plank2);
  return g;
}

// =====================================================================
// CONCRETE
// =====================================================================
function buildBarrier() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  // jersey profile approximated with 3 stacked boxes
  g.add(box(3.0, 0.55, 0.75, mt.concrete, 0, 0.28, 0));
  g.add(rot(box(3.0, 0.6, 0.55, mt.concrete, 0, 0.8, 0), 0, 0, 0));
  g.add(box(3.0, 0.35, 0.32, mt.concrete, 0, 1.25, 0));
  // feet
  [-1.2, 1.2].forEach((x) => g.add(box(0.3, 0.12, 1.0, mt.concreteBroken, x, 0.06, 0)));
  // rebar holes top
  [-1.0, 0, 1.0].forEach((x) => g.add(cyl(0.03, 0.03, 0.18, mt.rustHeavy, x, 1.5, 0, 8)));
  // grime bottom
  g.add(box(3.02, 0.25, 0.77, mt.rustDark, 0, 0.16, 0));
  return g;
}
function buildBarrierBroken() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const main = box(1.7, 0.9, 0.6, mt.concreteBroken, -0.4, 0.45, 0); main.rotation.z = 0.06; g.add(main);
  const top = box(1.2, 0.4, 0.35, mt.concreteBroken, -0.5, 1.05, 0); top.rotation.z = -0.12; g.add(top);
  // exposed rebar
  const rnd = mulberry(21);
  for (let i = 0; i < 6; i++) {
    const r = cyl(0.02, 0.02, 0.6 + rnd() * 0.5, mt.rustHeavy, 0.45 + rnd() * 0.2, 0.4 + rnd() * 0.5, (rnd() - 0.5) * 0.5, 8);
    r.rotation.z = Math.PI / 2 + (rnd() - 0.5) * 0.8; r.rotation.y = (rnd() - 0.5) * 0.6; g.add(r);
  }
  // chunks
  for (let i = 0; i < 5; i++) {
    const c = M(displace(new THREE.BoxGeometry(0.2 + rnd() * 0.3, 0.15 + rnd() * 0.2, 0.2 + rnd() * 0.3), 0.06, 30 + i), mt.concreteBroken, 0.7 + rnd() * 1.2, 0.1, (rnd() - 0.5) * 1.6);
    c.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); g.add(c);
  }
  return g;
}
function buildSlab() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  g.add(box(4.2, 0.3, 3.2, mt.concreteBroken, 0, 0.15, 0));
  // broken corner piece tilted
  const corner = box(1.4, 0.28, 1.1, mt.concrete, 2.3, 0.3, 1.6); corner.rotation.set(0.25, 0.4, 0.12); g.add(corner);
  // rebar grid exposed in middle hole
  for (let i = 0; i < 4; i++) {
    const r1 = cyl(0.022, 0.022, 1.6, mt.rustHeavy, -0.6 + i * 0.35, 0.28, 0.3, 8); r1.rotation.z = Math.PI / 2; g.add(r1);
    const r2 = cyl(0.022, 0.022, 1.4, mt.rustHeavy, -0.1, 0.3, -0.3 + i * 0.3, 8); r2.rotation.x = Math.PI / 2; g.add(r2);
  }
  // dark hole under
  const hole = box(1.5, 0.1, 1.2, mt.rubber, -0.1, 0.2, 0.15); g.add(hole);
  return g;
}
function buildBunkerWall() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const W = 5, H = 2.8;
  g.add(box(W, H, 0.5, mt.concrete, 0, H / 2, 0));
  // pilasters
  [-W/2 + 0.3, 0, W/2 - 0.3].forEach((x) => g.add(box(0.6, H + 0.15, 0.7, mt.concreteBroken, x, H / 2, 0)));
  // metal strip top
  g.add(box(W + 0.1, 0.18, 0.6, mt.rustDark, 0, H + 0.05, 0));
  // bullet holes
  const rnd = mulberry(55);
  for (let i = 0; i < 9; i++) {
    const h = cyl(0.035, 0.035, 0.06, mt.rubber, (rnd() - 0.5) * (W - 1), 0.8 + rnd() * 1.4, 0.26, 8);
    h.rotation.x = Math.PI / 2; g.add(h);
  }
  // hazard chevrons center
  g.add(box(0.9, 0.6, 0.04, mt.hazard, 0, 1.5, 0.27));
  // sandbags at base
  for (let i = 0; i < 7; i++) {
    const sb = M(new THREE.CapsuleGeometry(0.22, 0.4, 4, 8), mt.sandbag, -2.1 + i * 0.7, 0.2, 0.55);
    sb.rotation.z = Math.PI / 2; sb.rotation.y = (rnd() - 0.5) * 0.3; g.add(sb);
  }
  return g;
}

function buildHusk() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const H = 6, T = 0.4, L = 6;
  g.add(box(L + 0.3, 0.25, L + 0.3, mt.concrete, 0, 0.12, 0));
  g.add(box(L, H, T, mt.concreteBroken, 0, H / 2, 0));
  g.add(box(T, H, L, mt.concreteBroken, -L / 2, H / 2, 0));
  for (let i = 0; i < 7; i++) {
    g.add(cyl(0.025, 0.025, 0.9 + (i % 3) * 0.4, mt.rustHeavy, -L / 2 + 0.4 + i * 0.85, H + 0.35, 0, 6));
    g.add(cyl(0.025, 0.025, 0.9 + ((i + 1) % 3) * 0.4, mt.rustHeavy, -L / 2, H + 0.3, -L / 2 + 0.4 + i * 0.85, 6));
  }
  [-2.0, -0.6, 1.2, 2.4].forEach((x) => {
    g.add(box(1.0, 1.4, 0.06, mt.rubber, x, 2.6, T / 2 + 0.01));
    g.add(box(1.1, 0.12, 0.08, mt.concrete, x, 3.4, T / 2 + 0.02));
    g.add(box(1.1, 0.12, 0.08, mt.concrete, x, 1.8, T / 2 + 0.02));
  });
  [-2.2, 0.4, 2.0].forEach((z) => {
    g.add(box(0.06, 1.4, 1.0, mt.rubber, -L / 2 - 0.01, 2.6, z));
    g.add(box(0.08, 0.12, 1.1, mt.concrete, -L / 2, 3.4, z));
    g.add(box(0.08, 0.12, 1.1, mt.concrete, -L / 2, 1.8, z));
  });
  const rnd = mulberry(88);
  for (let i = 0; i < 6; i++) {
    const c = M(displace(new THREE.BoxGeometry(0.5 + rnd() * 0.5, 0.3 + rnd() * 0.4, 0.45), 0.08, 90 + i), mt.concreteBroken, -L / 2 + rnd() * L, H + 0.1, (rnd() - 0.5) * 0.3);
    c.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.4);
    g.add(c);
  }
  g.add(box(L + 0.02, 0.5, T + 0.04, mt.rustDark, 0, 0.3, 0));
  g.add(box(T + 0.04, 0.5, L + 0.02, mt.rustDark, -L / 2, 0.3, 0));
  return g;
}

// =====================================================================
// RAILS & SCRAP
// =====================================================================
function buildRails() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const LEN = 8;
  // gravel bed
  g.add(box(3.0, 0.25, LEN, mt.rock, 0, 0.12, 0));
  // sleepers
  for (let i = 0; i < 7; i++) {
    const s = box(2.3, 0.14, 0.5, mt.wood, 0, 0.3, -LEN/2 + 0.6 + i * (LEN - 1.2) / 6);
    s.rotation.y = (mulberry(i * 3 + 1)() - 0.5) * 0.06; g.add(s);
  }
  // rails: head + web + base
  [-0.75, 0.75].forEach((x) => {
    g.add(box(0.09, 0.08, LEN, mt.steelDark, x, 0.52, 0));
    g.add(box(0.05, 0.1, LEN, mt.rustDark, x, 0.43, 0));
    g.add(box(0.16, 0.05, LEN, mt.rustHeavy, x, 0.37, 0));
  });
  // bent end: last meter lifted
  const bent = box(0.09, 0.08, 1.4, mt.rustHeavy, 0.75, 0.75, LEN/2 + 0.5); bent.rotation.x = -0.35; g.add(bent);
  return g;
}
function buildGirder() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  // twisted I-beam from segments
  const rnd = mulberry(99);
  let x = -2.5, y = 0.35, ang = 0;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.add(box(1.1, 0.3, 0.12, mt.rustHeavy, 0, 0.15, 0));
    seg.add(box(1.1, 0.3, 0.12, mt.rustHeavy, 0, -0.15, 0));
    seg.add(box(1.1, 0.42, 0.06, mt.rustDark, 0, 0, 0));
    ang += (rnd() - 0.3) * 0.5;
    seg.position.set(x, y + Math.sin(i * 1.1) * 0.3, (rnd() - 0.5) * 0.4);
    seg.rotation.set((rnd() - 0.5) * 0.6, ang * 0.4, (rnd() - 0.5) * 0.9);
    g.add(seg);
    x += 1.0; y += 0.12;
  }
  // bolts plate
  g.add(box(0.5, 0.5, 0.08, mt.steelDark, -2.4, 0.5, 0.1));
  return g;
}
function buildScrapPile() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const rnd = mulberry(1234);
  const mats = [mt.rustHeavy, mt.rustDark, mt.rustOrange, mt.steelDark, mt.mechDark];
  for (let i = 0; i < 26; i++) {
    const kind = rnd();
    const mat = mats[Math.floor(rnd() * mats.length)];
    let mesh: THREE.Mesh;
    if (kind < 0.35) mesh = M(displace(new THREE.BoxGeometry(0.3 + rnd() * 1.2, 0.06 + rnd() * 0.15, 0.3 + rnd() * 0.8), 0.08, i), mat, 0, 0, 0);
    else if (kind < 0.6) mesh = M(new THREE.CylinderGeometry(0.05 + rnd() * 0.12, 0.05 + rnd() * 0.12, 0.6 + rnd() * 1.6, 8), mat, 0, 0, 0);
    else if (kind < 0.8) mesh = M(displace(new THREE.BoxGeometry(0.4 + rnd() * 0.6, 0.3 + rnd() * 0.5, 0.4 + rnd() * 0.6), 0.12, i + 50), mat, 0, 0, 0);
    else mesh = M(new THREE.TorusGeometry(0.25 + rnd() * 0.2, 0.05, 8, 14, Math.PI * (0.6 + rnd())), mat, 0, 0, 0);
    const a = rnd() * Math.PI * 2, r = rnd() * 1.6;
    mesh.position.set(Math.cos(a) * r, 0.15 + rnd() * (1.1 - r * 0.4), Math.sin(a) * r);
    mesh.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(mesh);
  }
  // tire in pile
  const tire = tor(0.35, 0.14, mt.rubber, 0.8, 0.5, 0.6); tire.rotation.set(1.2, 0.4, 0.5); g.add(tire);
  return g;
}
function buildCarWreck() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  // chassis
  g.add(box(1.9, 0.35, 4.4, mt.rustDark, 0, 0.55, 0));
  // burnt body shell
  const bodyMat = mt.mechDark;
  const hood = box(1.8, 0.5, 1.4, bodyMat, 0, 0.95, 1.4); hood.rotation.x = -0.15; g.add(hood);
  g.add(box(1.85, 0.55, 1.8, bodyMat, 0, 1.0, -0.3));
  // cabin frame (no roof — burnt)
  [[-0.8, 0.4], [0.8, 0.4], [-0.8, -1.1], [0.8, -1.1]].forEach(([x, z]) => {
    const p = box(0.1, 0.7, 0.1, mt.rustHeavy, x, 1.55, z); p.rotation.z = (x > 0 ? -1 : 1) * 0.12; g.add(p);
  });
  g.add(box(1.8, 0.45, 1.0, bodyMat, 0, 0.95, -1.75));
  // wheels: 2 left, 1 right, 1 missing (on hub)
  const wheel = (x: number, z: number, missing = false) => {
    if (missing) { g.add(cyl(0.12, 0.12, 0.2, mt.rustHeavy, x, 0.4, z, 10).rotateZ(Math.PI / 2)); return; }
    const t = cyl(0.38, 0.38, 0.28, mt.rubber, x, 0.38, z, 18); t.rotation.z = Math.PI / 2; g.add(t);
    const hub = cyl(0.16, 0.16, 0.3, mt.rustHeavy, x, 0.38, z, 10); hub.rotation.z = Math.PI / 2; g.add(hub);
  };
  wheel(-1.0, 1.4); wheel(1.0, 1.4); wheel(-1.0, -1.4); wheel(1.0, -1.4, true);
  // tilt whole wreck
  g.rotation.z = 0.04;
  // rust patches
  g.add(box(1.0, 0.1, 0.8, mt.rustOrange, 0.2, 1.22, 1.35));
  // headlight broken
  g.add(box(0.3, 0.18, 0.06, mt.lightWarm, -0.6, 0.85, 2.12));
  return g;
}

function buildBricks() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0x9a5a42, roughness: 0.92, metalness: 0.02 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.94, metalness: 0.02 });
  const rnd = mulberry(41);
  for (let row = 0; row < 3; row++) {
    const n = 5 - row;
    for (let i = 0; i < n; i++) {
      const mat = rnd() < 0.7 ? red : grey;
      const b = box(0.5, 0.16, 0.24, mat, -1.1 + i * 0.52 + (row % 2) * 0.26, 0.09 + row * 0.17, (rnd() - 0.5) * 0.06);
      b.rotation.y = (rnd() - 0.5) * 0.08;
      g.add(b);
    }
  }
  for (let i = 0; i < 6; i++) {
    const mat = rnd() < 0.6 ? red : grey;
    const b = M(displace(new THREE.BoxGeometry(0.48, 0.15, 0.23), 0.04, 60 + i), mat, 1.2 + rnd() * 1.4, 0.08, (rnd() - 0.5) * 1.8);
    b.rotation.set(rnd() * 0.4, rnd() * Math.PI * 2, rnd() * 0.3);
    g.add(b);
  }
  return g;
}

// =====================================================================
// BASE / TECH
// =====================================================================
function buildWatchtower() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const H = 4.2;
  // legs angled
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const leg = cyl(0.09, 0.12, H + 0.6, mt.wood, sx * 0.9, H / 2, sz * 0.9, 10);
    leg.rotation.z = -sx * 0.09; leg.rotation.x = sz * 0.09; g.add(leg);
    g.add(box(0.4, 0.3, 0.4, mt.concrete, sx * 1.05, 0.15, sz * 1.05));
  });
  // cross braces
  for (let i = 0; i < 3; i++) {
    const y = 1.0 + i * 1.0;
    const b1 = box(1.9, 0.09, 0.09, mt.wood, 0, y, 0.95); b1.rotation.z = 0.5; g.add(b1);
    const b2 = box(1.9, 0.09, 0.09, mt.wood, 0, y, -0.95); b2.rotation.z = -0.5; g.add(b2);
  }
  // platform
  g.add(box(2.4, 0.14, 2.4, mt.wood, 0, H, 0));
  // railing
  [[0, 1.15, 2.4, 0.08], [0, -1.15, 2.4, 0.08]].forEach(([x, z, w]) => {
    g.add(box(w as number, 0.08, 0.08, mt.wood, x as number, H + 0.95, z as number));
    g.add(box(w as number, 0.08, 0.08, mt.wood, x as number, H + 0.55, z as number));
  });
  [[1.15, 0], [-1.15, 0]].forEach(([x, z]) => {
    g.add(box(0.08, 0.08, 2.4, mt.wood, x, H + 0.95, z));
    g.add(box(0.08, 0.08, 2.4, mt.wood, x, H + 0.55, z));
  });
  [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]].forEach(([x, z]) => g.add(box(0.09, 1.0, 0.09, mt.wood, x, H + 0.5, z)));
  // roof
  const roof = box(2.8, 0.1, 2.8, mt.rustHeavy, 0, H + 2.0, 0); roof.rotation.z = 0.06; g.add(roof);
  [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].forEach(([x, z]) => g.add(box(0.09, 1.1, 0.09, mt.wood, x, H + 1.5, z)));
  // spotlight + sandbags on platform
  g.add(box(0.4, 0.3, 0.4, mt.steelDark, 0.7, H + 0.3, 0.7));
  const lamp = cyl(0.12, 0.16, 0.25, mt.steelDark, 0.7, 0.55 + H, 0.7, 12); g.add(lamp);
  g.add(cyl(0.1, 0.1, 0.04, mt.lightWarm, 0.7, 0.55 + H, 0.85, 12).rotateX(Math.PI / 2));
  const s = glowSprite('rgba(255,200,120,0.9)', 1.4, 0.5); s.position.set(0.7, H + 0.55, 0.95); g.add(s);
  g.add(box(1.0, 0.5, 0.35, mt.sandbag, -0.6, H + 0.4, -0.9));
  // ladder
  for (let i = 0; i < 8; i++) g.add(box(0.5, 0.05, 0.05, mt.rustDark, 0, 0.5 + i * 0.5, 1.28));
  g.add(box(0.05, 4.0, 0.05, mt.rustDark, -0.25, 2.2, 1.28));
  g.add(box(0.05, 4.0, 0.05, mt.rustDark, 0.25, 2.2, 1.28));
  return g;
}
function buildTurret() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  g.add(cyl(0.9, 1.1, 0.5, mt.concrete, 0, 0.25, 0, 20));
  g.add(cyl(0.55, 0.7, 0.8, mt.mechDark, 0, 0.85, 0, 16));
  const head = new THREE.Group(); head.position.y = 1.5; g.add(head);
  head.add(box(1.1, 0.55, 1.2, mt.mechArmor, 0, 0, 0));
  head.add(box(0.7, 0.3, 0.5, mt.steelDark, 0, 0.4, -0.2));
  // twin barrels
  [-0.18, 0.18].forEach((x) => {
    const b = cyl(0.06, 0.07, 1.6, mt.steelDark, x, 0.05, 1.2); b.rotation.x = Math.PI / 2; head.add(b);
  });
  // sensor
  head.add(box(0.25, 0.15, 0.08, mt.lightRed, 0.3, 0.1, 0.62));
  head.add(box(0.25, 0.15, 0.08, mt.lightCyan, -0.3, 0.1, 0.62));
  head.add(box(0.5, 0.4, 0.3, mt.rustDark, -0.7, -0.05, -0.3)); // ammo
  head.rotation.y = 0.5;
  return g;
}
function buildGenerator() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  g.add(box(1.8, 1.1, 1.0, mt.mechArmor, 0, 0.65, 0));
  g.add(box(1.85, 0.15, 1.05, mt.rustDark, 0, 1.25, 0));
  // vents
  for (let i = 0; i < 5; i++) g.add(box(0.08, 0.7, 0.9, mt.rubber, -0.6 + i * 0.3, 0.62, 0.51));
  // exhaust pipe
  const ex = cyl(0.09, 0.09, 1.0, mt.rustHeavy, 0.6, 1.6, -0.25, 12); g.add(ex);
  const cap = cyl(0.12, 0.12, 0.08, mt.steelDark, 0.6, 2.12, -0.25, 12); g.add(cap);
  // control panel + light
  g.add(box(0.5, 0.6, 0.08, mt.steelDark, -0.5, 0.75, 0.52));
  g.add(box(0.12, 0.12, 0.04, mt.toxicGlow, -0.6, 0.9, 0.57));
  g.add(box(0.12, 0.12, 0.04, mt.lightWarm, -0.4, 0.9, 0.57));
  // cables
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.7, 0.4, 0.5), new THREE.Vector3(1.4, 0.15, 0.9), new THREE.Vector3(2.2, 0.08, 0.6)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.05, 8), mt.rubber));
  // feet
  [[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]].forEach(([x, z]) => g.add(box(0.2, 0.2, 0.2, mt.concreteBroken, x, 0.1, z)));
  return g;
}

// ----------------------- здания (стройка базы) -----------------------
/** Бетонная площадка — фундамент для зданий. */
function buildFoundation() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  g.add(box(6.0, 0.3, 6.0, mt.concrete, 0, 0.15, 0));
  g.add(box(6.1, 0.08, 6.1, mt.rustDark, 0, 0.04, 0));
  [-2.6, 2.6].forEach((x) => [-2.6, 2.6].forEach((z) => {
    g.add(box(0.25, 0.16, 0.25, mt.concreteBroken, x, 0.08, z));
    g.add(cyl(0.03, 0.03, 0.25, mt.rustHeavy, x, 0.4, z, 8));
  }));
  return g;
}

/** Завод — открывает крафт мехов. */
function buildFactory() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const W = 7, D = 5, H = 4;
  g.add(box(W, H, D, mt.mechArmor, 0, H / 2, 0));
  // крыша с «зубцами»
  g.add(box(W + 0.4, 0.3, D + 0.4, mt.mechDark, 0, H + 0.15, 0));
  for (let x = -3; x <= 3; x += 1.5) g.add(box(0.7, 1.2, 0.7, mt.mechDark, x, H + 1.0, 0));
  // труба
  g.add(cyl(0.35, 0.5, 3.2, mt.rustDark, 2.2, H + 2.0, 1.2, 14));
  g.add(cyl(0.4, 0.4, 0.15, mt.rustHeavy, 2.2, H + 3.7, 1.2, 14));
  // ворота
  g.add(box(2.0, 2.2, 0.12, mt.steelDark, 0, 1.1, D / 2 + 0.06));
  g.add(box(1.6, 1.8, 0.06, mt.rustDark, 0, 1.1, D / 2 + 0.12));
  // окна
  [-2, 2].forEach((x) => {
    g.add(box(1.2, 0.8, 0.1, mt.steelDark, x, 2.4, D / 2 + 0.06));
    g.add(box(1.0, 0.6, 0.05, mt.lightWarm, x, 2.4, D / 2 + 0.1));
  });
  // бетонная подложка
  g.add(box(W + 0.6, 0.25, D + 0.6, mt.concrete, 0, 0.12, 0));
  return g;
}

/** Электростанция. */
function buildPowerPlant() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const W = 5.5, D = 4, H = 3;
  g.add(box(W, H, D, mt.mechArmor, 0, H / 2, 0));
  g.add(box(W + 0.3, 0.25, D + 0.3, mt.mechDark, 0, H + 0.12, 0));
  // две трубы-градирни
  g.add(cyl(0.5, 0.7, 2.8, mt.concrete, -1.6, H + 1.8, 1.2, 14));
  g.add(cyl(0.4, 0.6, 2.4, mt.concrete, 1.6, H + 1.6, 1.2, 14));
  // бак
  g.add(cyl(0.9, 0.9, 1.4, mt.rustDark, -1.8, 0.7, -1.2, 16));
  g.add(cyl(0.95, 0.95, 0.1, mt.rustHeavy, -1.8, 1.45, -1.2, 16));
  // индикатор
  g.add(box(0.15, 0.15, 0.05, mt.lightWarm, 0, 2.2, D / 2 + 0.1));
  g.add(box(W + 0.5, 0.2, D + 0.5, mt.concrete, 0, 0.1, 0));
  return g;
}

/** Нефтебашня (добыча). */
function buildOilTower() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  // вышка
  g.add(box(1.6, 8.5, 1.6, mt.rustDark, 0, 4.3, 0));
  for (let y = 1; y < 8; y += 1.6) {
    g.add(box(1.8, 0.08, 1.8, mt.steelDark, 0, y, 0));
  }
  // резервуар
  g.add(cyl(1.4, 1.4, 2.0, mt.rustHeavy, -2.4, 1.0, 0, 18));
  g.add(cyl(1.45, 1.45, 0.12, mt.steelDark, -2.4, 2.05, 0, 18));
  // буровая мачта
  g.add(cyl(0.12, 0.12, 4.0, mt.steelLight, 0.3, 6.6, 0.3, 8).rotateZ(0.25));
  g.add(sph(0.2, mt.rustHeavy, 0.5, 8.8, 0.5));
  // фундамент
  g.add(box(5.2, 0.25, 4.2, mt.concrete, -0.4, 0.12, 0));
  return g;
}

/** Добытчик ресурсов (экстрактор). */
function buildExtractor() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const W = 4.5, D = 3.5, H = 2.4;
  g.add(box(W, H, D, mt.mechArmor, 0, H / 2, 0));
  g.add(box(W + 0.3, 0.2, D + 0.3, mt.mechDark, 0, H + 0.1, 0));
  // труба-конвейер
  const conv = box(3.4, 0.5, 0.5, mt.rustDark, 1.8, H + 0.5, 0.6);
  conv.rotation.z = -0.12; g.add(conv);
  for (let x = 0.6; x < 3.2; x += 0.5) g.add(cyl(0.08, 0.08, 0.6, mt.steelLight, x, H + 0.5, 0.6, 10));
  // бункер
  g.add(cyl(0.7, 1.0, 1.0, mt.rustHeavy, -1.6, H + 0.7, -0.8, 14));
  // огни
  g.add(box(0.12, 0.12, 0.05, mt.lightWarm, 0.5, 1.6, D / 2 + 0.1));
  g.add(box(W + 0.4, 0.2, D + 0.4, mt.concrete, 0, 0.1, 0));
  return g;
}
function buildAntenna() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  g.add(box(1.2, 0.4, 1.2, mt.concrete, 0, 0.2, 0));
  g.add(box(0.8, 0.6, 0.6, mt.mechDark, 0, 0.7, 0));
  // mast
  g.add(cyl(0.07, 0.12, 6.5, mt.rustDark, 0, 3.8, 0, 10));
  for (let i = 0; i < 4; i++) {
    const y = 2.2 + i * 1.2;
    g.add(box(1.4 - i * 0.2, 0.06, 0.06, mt.steelDark, 0, y, 0));
    g.add(box(0.06, 0.06, 1.4 - i * 0.2, mt.steelDark, 0, y + 0.3, 0));
  }
  // dish
  const dish = M(new THREE.SphereGeometry(0.7, 20, 12, 0, Math.PI * 2, 0, 0.7), mt.steelLight, 0.5, 4.4, 0.3);
  dish.rotation.set(0.6, 0.4, 0); g.add(dish);
  g.add(cyl(0.03, 0.03, 0.7, mt.steelDark, 0.35, 4.3, 0.15, 8).rotateZ(1.1));
  // top beacon
  g.add(sph(0.09, mt.lightRed, 0, 7.15, 0));
  const s = glowSprite('rgba(255,60,50,0.95)', 1.6, 0.6); s.position.set(0, 7.15, 0); g.add(s);
  // guy wires
  [[2.2, 0], [-2.2, 0], [0, 2.2]].forEach(([x, z]) => {
    const from = new THREE.Vector3(0, 5.8, 0), to = new THREE.Vector3(x, 0.1, z);
    const len = from.distanceTo(to);
    const wire = cyl(0.012, 0.012, len, mt.steelDark, 0, 0, 0, 6);
    wire.position.copy(from).lerp(to, 0.5);
    wire.lookAt(to); wire.rotateX(Math.PI / 2);
    g.add(wire);
    g.add(box(0.25, 0.25, 0.25, mt.concreteBroken, x, 0.12, z));
  });
  return g;
}
function buildLamp() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  g.add(cyl(0.3, 0.4, 0.4, mt.concreteBroken, 0, 0.2, 0, 12));
  const pole = cyl(0.07, 0.1, 5.2, mt.rustDark, 0, 2.8, 0, 10); pole.rotation.z = 0.05; g.add(pole);
  const arm = cyl(0.05, 0.05, 1.4, mt.rustDark, 0.6, 5.3, 0, 8); arm.rotation.z = Math.PI / 2 - 0.15; g.add(arm);
  g.add(box(0.5, 0.18, 0.3, mt.steelDark, 1.2, 5.35, 0));
  g.add(box(0.4, 0.06, 0.22, mt.lightWarm, 1.2, 5.25, 0));
  const s = glowSprite('rgba(255,190,110,0.9)', 2.6, 0.5); s.position.set(1.2, 5.1, 0); g.add(s);
  // cone of light (fake volumetric)
  const cone = M(new THREE.ConeGeometry(1.8, 4.8, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffbe78, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }), 1.2, 2.8, 0);
  g.add(cone);
  return g;
}
function buildSandbags() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const rnd = mulberry(77);
  for (let row = 0; row < 3; row++) {
    const n = 6 - (row === 2 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const sb = M(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), mt.sandbag, -1.9 + i * 0.68 + (row % 2) * 0.34, 0.22 + row * 0.36, (rnd() - 0.5) * 0.15);
      sb.rotation.z = Math.PI / 2; sb.rotation.y = (rnd() - 0.5) * 0.25; g.add(sb);
    }
  }
  return g;
}
function buildDome() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const R = 2.2;
  g.add(cyl(R + 0.4, R + 0.55, 0.4, mt.concrete, 0, 0.2, 0, 24));
  // glass
  const glass = M(new THREE.SphereGeometry(R, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), mt.glassGreen, 0, 0.4, 0);
  glass.castShadow = false; g.add(glass);
  // ribs
  for (let i = 0; i < 6; i++) {
    const rib = tor(R + 0.02, 0.045, mt.steelDark, 0, 0.4, 0, Math.PI);
    rib.rotation.y = (i / 6) * Math.PI; g.add(rib);
  }
  [0.7, 1.35].forEach((y) => {
    const ringR = Math.sqrt(R * R - y * y);
    const ring = tor(ringR, 0.04, mt.steelDark, 0, 0.4 + y, 0); ring.rotation.x = Math.PI / 2; g.add(ring);
  });
  // entrance
  g.add(box(1.1, 1.3, 0.9, mt.mechDark, 0, 0.85, R - 0.2));
  g.add(box(0.8, 1.0, 0.1, mt.toxicGlow, 0, 0.75, R + 0.26));
  const s = glowSprite('rgba(80,255,140,0.8)', 3.0, 0.35); s.position.set(0, 1.2, R + 0.4); g.add(s);
  return g;
}
function buildOutpost() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const W = 4.2, D = 3.2, H = 2.2;
  g.add(box(W, H, D, mt.mechArmor, 0, H / 2 + 0.1, 0));
  // rounded Quonset roof: full cylinder lying along X, flattened vertically
  const roofGeo = new THREE.CylinderGeometry(D / 2, D / 2, W, 20);
  const roof = M(roofGeo, mt.mechDark, 0, H + 0.1, 0);
  roof.rotation.z = Math.PI / 2;
  roof.scale.x = 0.32; // local X → world Y after rotation → flatten
  g.add(roof);
  // roof end caps trim
  [-W / 2, W / 2].forEach((x) => g.add(box(0.1, 0.5, D * 0.9, mt.rustDark, x, H + 0.15, 0)));
  // door + windows
  g.add(box(1.0, 1.6, 0.1, mt.steelDark, -1.0, 0.95, D / 2 + 0.02));
  g.add(box(0.7, 1.3, 0.06, mt.rustDark, -1.0, 0.85, D / 2 + 0.06));
  [0.2, 1.2].forEach((x) => {
    g.add(box(0.8, 0.6, 0.08, mt.steelDark, x, 1.5, D / 2 + 0.02));
    g.add(box(0.65, 0.45, 0.05, mt.lightWarm, x, 1.5, D / 2 + 0.05));
  });
  // side vents + AC
  g.add(box(0.3, 0.8, 1.2, mt.steelDark, W / 2 + 0.12, 1.2, 0));
  g.add(box(0.5, 0.4, 0.6, mt.rustDark, W / 2 + 0.25, 0.5, 0.8));
  // pipes on roof
  g.add(cyl(0.08, 0.08, 2.5, mt.copperPipe, 0.5, H + 0.7, -0.5, 10).rotateZ(Math.PI / 2));
  g.add(cyl(0.06, 0.06, 1.0, mt.rustHeavy, -1.4, H + 0.6, -0.6, 8));
  // antenna small + beacon
  g.add(cyl(0.02, 0.03, 1.4, mt.steelDark, 1.6, H + 1.1, -0.8, 6));
  g.add(sph(0.05, mt.lightRed, 1.6, H + 1.85, -0.8));
  // hazard skirt
  g.add(box(W + 0.06, 0.25, D + 0.06, mt.hazard, 0, 0.32, 0));
  // sandbags front
  for (let i = 0; i < 4; i++) {
    const sb = M(new THREE.CapsuleGeometry(0.18, 0.4, 4, 8), mt.sandbag, 0.4 + i * 0.6, 0.2, D / 2 + 0.7);
    sb.rotation.z = Math.PI / 2; g.add(sb);
  }
  return g;
}
function buildCheckpoint() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  // pillars
  [-2.5, 2.5].forEach((x) => {
    g.add(box(0.7, 2.6, 0.7, mt.concrete, x, 1.3, 0));
    g.add(box(0.8, 0.25, 0.8, mt.hazard, x, 2.65, 0));
    g.add(box(0.2, 0.2, 0.1, mt.lightRed, x, 2.2, 0.36));
  });
  // boom
  const boom = new THREE.Group(); boom.position.set(-2.15, 2.1, 0); g.add(boom);
  boom.add(box(4.4, 0.16, 0.16, mt.hazard, 2.2, 0, 0));
  boom.add(box(0.4, 0.5, 0.3, mt.steelDark, 0, -0.1, 0));
  boom.rotation.z = 0.28;
  // booth
  g.add(box(1.4, 2.2, 1.4, mt.metalPanels, 3.6, 1.1, 1.2));
  g.add(box(1.5, 0.15, 1.5, mt.rustDark, 3.6, 2.28, 1.2));
  g.add(box(1.0, 0.7, 0.06, mt.glassCockpit, 3.6, 1.5, 0.48));
  return g;
}
function buildTires() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const t = tor(0.42, 0.18, mt.rubber, 0, 0.2 + i * 0.34, 0); t.rotation.x = Math.PI / 2; g.add(t);
  }
  const lean = tor(0.42, 0.18, mt.rubber, 0.85, 0.42, 0.3); lean.rotation.set(0.2, 0.3, 1.35); g.add(lean);
  // dust on top
  g.add(cyl(0.3, 0.3, 0.05, mt.sandbag, 0, 1.06, 0, 14));
  return g;
}
function buildRock() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const r1 = M(displace(new THREE.IcosahedronGeometry(1.4, 2), 0.7, 5), mt.rock, 0, 0.8, 0); g.add(r1);
  const r2 = M(displace(new THREE.IcosahedronGeometry(0.8, 1), 0.4, 9), mt.rock, 1.5, 0.4, 0.6); g.add(r2);
  const r3 = M(displace(new THREE.IcosahedronGeometry(0.5, 1), 0.25, 13), mt.rock, -1.2, 0.25, 0.8); g.add(r3);
  // rust debris stuck
  g.add(rot(box(1.1, 0.08, 0.3, mt.rustHeavy, 0.4, 1.5, 0.3), 0.4, 0.5, 0.2));
  return g;
}
function buildDeadTree() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const trunk = cyl(0.09, 0.22, 2.6, mt.wood, 0, 1.3, 0, 9); trunk.rotation.z = 0.12; g.add(trunk);
  const rnd = mulberry(300);
  for (let i = 0; i < 7; i++) {
    const len = 0.8 + rnd() * 1.2;
    const br = cyl(0.02, 0.06, len, mt.wood, 0, 0, 0, 7);
    const y = 1.4 + rnd() * 1.4;
    br.position.set((rnd() - 0.5) * 0.5, y, (rnd() - 0.5) * 0.5);
    br.rotation.set((rnd() - 0.5) * 1.4, rnd() * 3, 0.5 + rnd() * 0.8);
    g.add(br);
  }
  // roots + stones
  g.add(cyl(0.5, 0.7, 0.3, mt.rock, 0, 0.1, 0, 9));
  return g;
}

function buildGrass() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  const blade = new THREE.MeshStandardMaterial({ color: 0x7d8a3c, roughness: 0.95, metalness: 0 });
  const dry = new THREE.MeshStandardMaterial({ color: 0xa89a4e, roughness: 0.95, metalness: 0 });
  const rnd = mulberry(150);
  const tufts = 5 + Math.floor(rnd() * 3);
  for (let t = 0; t < tufts; t++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.9;
    const tx = Math.cos(a) * r, tz = Math.sin(a) * r;
    g.add(cyl(0.12 + rnd() * 0.08, 0.16 + rnd() * 0.08, 0.06, mt.rock, tx, 0.03, tz, 8));
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const h = 0.35 + rnd() * 0.45;
      const ba = rnd() * Math.PI * 2;
      const lean = 0.3 + rnd() * 0.7;
      const b = cyl(0.008, 0.02, h, rnd() < 0.6 ? blade : dry, 0, 0, 0, 5);
      b.rotation.set(0, -ba, lean);
      b.position.set(
        tx + Math.cos(ba) * Math.sin(lean) * h / 2,
        (h / 2) * Math.cos(lean),
        tz + Math.sin(ba) * Math.sin(lean) * h / 2);
      g.add(b);
    }
  }
  return g;
}

function buildSpawnFlag() {
  const mt = getSharedMaterials();
  const g = new THREE.Group();
  g.name = 'sp_flag';
  g.add(cyl(0.32, 0.42, 0.22, mt.concrete, 0, 0.11, 0, 12));
  g.add(cyl(0.05, 0.08, 3, mt.steelDark, 0, 1.5, 0, 10));
  const cap = sph(0.07, mt.rustHeavy, 0, 3.02, 0, 10, 8); g.add(cap);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xff7a1e, roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide });
  const flag = M(new THREE.PlaneGeometry(1.1, 0.65), flagMat, 0.58, 2.62, 0);
  flag.rotation.y = -0.08;
  g.add(flag);
  const stripe = M(new THREE.PlaneGeometry(1.1, 0.16), mt.hazard, 0.58, 2.62, 0.005);
  stripe.rotation.y = -0.08;
  g.add(stripe);
  return g;
}

// ---------------- Персонажи ----------------
/** Пилот-пехотинец в защитном костюме с визором и ранцем. Рост 1.8 м. */
function buildPilotHuman() {
  const g = new THREE.Group();
  g.name = 'pilot_human';
  const suit = new THREE.MeshStandardMaterial({ color: 0x37424a, roughness: 0.78, metalness: 0.2 });
  const suitDark = new THREE.MeshStandardMaterial({ color: 0x232b31, roughness: 0.85, metalness: 0.15 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x7a6136, roughness: 0.5, metalness: 0.5 });
  const visor = new THREE.MeshStandardMaterial({
    color: 0xffb040, emissive: 0xff7a12, emissiveIntensity: 2.2, roughness: 0.25, metalness: 0.1,
  });
  const cap = (r: number, len: number, mat: THREE.Material) => M(new THREE.CapsuleGeometry(r, len, 4, 10), mat);

  const hips = cap(0.2, 0.14, suitDark); hips.position.y = 0.92; g.add(hips);
  const torso = cap(0.23, 0.34, suit);
  torso.position.y = 1.26; torso.scale.z = 0.82; torso.castShadow = true; g.add(torso);

  g.add(M(new THREE.BoxGeometry(0.46, 0.34, 0.16), plate, 0, 1.31, 0.16));
  g.add(M(new THREE.BoxGeometry(0.44, 0.08, 0.28), plate, 0, 1.02, 0));
  const pack = M(new THREE.BoxGeometry(0.36, 0.42, 0.22), suitDark, 0, 1.3, -0.24); g.add(pack);
  g.add(M(new THREE.CapsuleGeometry(0.07, 0.3, 3, 8), plate, -0.11, 1.34, -0.36));
  g.add(M(new THREE.CapsuleGeometry(0.07, 0.3, 3, 8), plate, 0.11, 1.34, -0.36));

  const neck = cap(0.07, 0.05, suitDark); neck.position.y = 1.56; g.add(neck);
  const helm = M(new THREE.SphereGeometry(0.16, 14, 12), suit, 0, 1.7, 0);
  helm.scale.set(1, 1.08, 1.06); helm.castShadow = true; g.add(helm);
  g.add(M(new THREE.SphereGeometry(0.135, 14, 10, -0.9, 1.8, 0.75, 0.9), visor, 0, 1.7, 0.05));
  g.add(M(new THREE.BoxGeometry(0.03, 0.09, 0.12), plate, 0, 1.82, -0.06));

  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(0.12 * side, 0.88, 0);
    leg.name = side < 0 ? 'leg_L' : 'leg_R';
    const thigh = cap(0.095, 0.3, suit); thigh.position.y = -0.26; thigh.castShadow = true; leg.add(thigh);
    leg.add(M(new THREE.BoxGeometry(0.16, 0.1, 0.28), suitDark, 0, -0.46, 0.04));
    g.add(leg);

    const arm = new THREE.Group();
    arm.position.set(0.27 * side, 1.47, 0);
    arm.name = side < 0 ? 'arm_L' : 'arm_R';
    const shoulder = M(new THREE.SphereGeometry(0.115, 10, 8), plate); shoulder.castShadow = true; arm.add(shoulder);
    const upper = cap(0.07, 0.26, suit); upper.position.y = -0.24; upper.castShadow = true; arm.add(upper);
    arm.add(M(new THREE.BoxGeometry(0.11, 0.12, 0.13), suitDark, 0, -0.44, 0));
    g.add(arm);
  }
  return g;
}

/** Гражданский выживший: капюшон и плащ вместо шлема — NPC для сцены. */
function buildSurvivor() {
  const g = buildPilotHuman();
  g.name = 'survivor';
  const cloth = new THREE.MeshStandardMaterial({ color: 0x5a5240, roughness: 0.95, metalness: 0.02, side: THREE.DoubleSide });
  // прячем шлем с визором, ставим капюшон
  for (const child of [...g.children]) {
    const m = child as THREE.Mesh;
    if (m.geometry instanceof THREE.SphereGeometry) m.visible = false;
  }
  g.add(M(new THREE.SphereGeometry(0.18, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), cloth, 0, 1.68, -0.01));
  g.add(M(new THREE.ConeGeometry(0.4, 0.95, 12, 1, true), cloth, 0, 1.18, -0.04));
  return g;
}

// --- GLB: анимированные мехи со скелетом и клипами ---
// mech_robot.zip.glb — статичный меш без скина, анимировать его нечем.
// exported-model.glb — тот же меш со скелетом (67 костей) и 5 клипами.
// anim_industrial.glb — другой мех (29 костей) и 7 клипов.

/** Состояние анимации меха — состояние переводится в конкретный клип ассета. */
export type MechAnimState = 'idle' | 'walk' | 'run' | 'jump' | 'damaged' | 'critical';

/** Какому клипу ассета соответствует состояние. */
const STATE_CLIPS: Record<MechAnimState, string[]> = {
  idle: ['Idle_A', 'Idle', 'idle'],
  walk: ['Walk'],
  run: ['Run_Anime', 'Run'],
  jump: ['Jump_2_RM', 'Jump_air', 'Jump', 'Climb_Wall'],
  damaged: ['Zombie_Walk'],
  critical: ['Zombie_Walk_2'],
};

interface GlbMech {
  id: string;
  url: string;
  scene: THREE.Group | null;
  clips: THREE.AnimationClip[];
}

const glbMechs: Record<string, GlbMech> = {
  mech_robot: { id: 'mech_robot', url: `${ASSET_BASE}library/exported-model.glb`, scene: null, clips: [] },
  mech_industrial: { id: 'mech_industrial', url: `${ASSET_BASE}library/anim_industrial.glb`, scene: null, clips: [] },
};

/** Масштаб и посадка на землю: рост 7 м (как у процедурных мехов), ноги на y=0.
 *  Масштаб применяем к ВНУТРЕННЕЙ группе: корень объекта трогает движок (масштаб в состоянии). */
function prepareMech(scene: THREE.Group, targetHeight: number, name: string): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  root.add(scene);
  const box = new THREE.Box3().setFromObject(scene);
  const h = box.max.y - box.min.y;
  const s = h > 0.0001 ? targetHeight / h : 1;
  scene.scale.setScalar(s);
  scene.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(scene);
  scene.position.y -= box2.min.y;
  return root;
}

function loadGlbMech(id: string) {
  const def = glbMechs[id];
  if (!def) return;
  const loader = new GLTFLoader();
  loader.load(def.url, (glb) => {
    if (glb.animations) def.clips = glb.animations.slice();
    if (glb.scene) {
      def.scene = prepareMech(glb.scene, 7, id);
      def.scene.name = id;
    }
  }, undefined, (err) => console.error(`GLB load error (${id})`, err));
}
Object.keys(glbMechs).forEach(loadGlbMech);

/** Разрез по поясу: верх тела (кабина, руки, голова) крутится отдельно от ног.
 *  В скелете: pelvis -> spine_01 -> spine_02 -> spine_03 -> (руки, голова),
 *  а ноги thigh_l/thigh_r висят от root. Ставим пивот 'torso' между pelvis и spine_01 —
 *  игровой движок ищет узел с именем 'torso' и крутит его по цели. */
function prepareTorsoPivot(root: THREE.Group) {
  const spine = root.getObjectByName('spine_01');
  const pelvis = root.getObjectByName('pelvis');
  if (!spine || !pelvis) return;
  const pivot = new THREE.Object3D();
  pivot.name = 'torso';
  pivot.position.copy(spine.position);
  pelvis.add(pivot);
  pivot.updateMatrixWorld(true);
  pivot.attach(spine); // мировая трансформация кости сохраняется

  // дуло у правой руки — оттуда летят снаряды
  const hand = root.getObjectByName('hand_r');
  if (hand) {
    const mz = new THREE.Object3D();
    mz.name = 'muzzle';
    mz.position.set(0, 0.14, 0.04);
    hand.add(mz);
  }
}

/** Клон анимированного меха со скелетом (SkeletonUtils сохраняет привязку к костям). */
function buildGlbMech(id: string): THREE.Group {
  const def = glbMechs[id];
  if (!def || !def.scene) return new THREE.Group();
  const c = skeletonClone(def.scene) as THREE.Group;
  c.name = id;
  prepareTorsoPivot(c);
  return c;
}

export function buildMechRobot(): THREE.Group { return buildGlbMech('mech_robot'); }
export function buildMechIndustrial(): THREE.Group { return buildGlbMech('mech_industrial'); }

import { clonePilot, getPilotAnimationClips } from './pilotModel.ts';
import { ASSET_BASE } from '../utils/baseUrl.ts';
import { base64ToBytes } from '../utils/dynamicAssetsStore.ts';

/** Пока GLB не догрузился — пустая группа (иначе редактор рисует сломанного пилота). */
export function buildPilotGlb(): THREE.Group {
  return clonePilot() ?? new THREE.Group();
}

/** Клипы конкретного меха. Для пилота — его собственные клипы (общая пайплайн-система). */
export function getMechClips(assetId: string): THREE.AnimationClip[] {
  if (assetId === 'pilot') return getPilotAnimationClips();
  return glbMechs[assetId]?.clips ?? [];
}

/** Все клипы всех GLB-мехов — для панели анимаций. */
export function getAllMechClips(): { assetId: string; clip: THREE.AnimationClip }[] {
  const out: { assetId: string; clip: THREE.AnimationClip }[] = [];
  Object.values(glbMechs).forEach((m) => m.clips.forEach((c) => out.push({ assetId: m.id, clip: c })));
  return out;
}

/** Клип для состояния анимации у конкретного меха (по приоритету имён). */
export function clipForState(assetId: string, state: MechAnimState): THREE.AnimationClip | null {
  const clips = getMechClips(assetId);
  for (const name of STATE_CLIPS[state]) {
    const found = clips.find((c) => c.name === name);
    if (found) return found;
  }
  return null;
}

/** Список клипов для панели анимаций (устаревшее — все подряд). */
export function getMechAnimationClips(): THREE.AnimationClip[] {
  return getAllMechClips().map((x) => x.clip);
}

// =====================================================================
// REGISTRY
// =====================================================================
export interface AssetDef {
  id: string;
  name: string;
  category: string;
  desc: string;
  build: () => THREE.Group;
  yOffset?: number;
  scale?: number;
  /** Модель приходит из GLB — пересобирать её процедурным конструктором нельзя. */
  gltf?: boolean;
}

export const ASSET_CATEGORIES = ['Мехи', 'Персонажи', 'Укрытия', 'Бочки и грузы', 'Металлолом', 'База и техника', 'Ландшафт'];

export const ASSETS: AssetDef[] = [
  { id: 'mech_scout', name: '«Ястреб» — разведчик', category: 'Мехи', desc: 'Лёгкий мех, 9м. Спаренные автопушки, сенсорная мачта.', build: buildMechScout },
  { id: 'mech_juggernaut', name: '«Титан» — джаггернаут', category: 'Мехи', desc: 'Тяжёлый штурмовой мех. Ракетные блоки, сдвоенные орудия.', build: buildMechJuggernaut },
  { id: 'mech_molot', name: '«Молот» — штурмовик', category: 'Мехи', desc: 'Средний мех с крупнокалиберной пушкой и щитом.', build: buildMechMolot },
  { id: 'mech_robot', name: 'Мех «Робот» (GLB + анимации)', category: 'Мехи', desc: 'Твой мех со скелетом: Zombie_Walk, Zombie_Walk_2, Run_Anime, Walk, Jump_2_RM.', build: buildMechRobot, gltf: true },
  { id: 'mech_industrial', name: 'Мех «Индустриальный» (GLB)', category: 'Мехи', desc: 'Второй твой мех: Walk_Large, Sword_Attack, Jump_air и другие клипы.', build: buildMechIndustrial, gltf: true },

  { id: 'pilot_human', name: 'Пилот — пехотинец', category: 'Персонажи', desc: 'Человек в защитном костюме, шлем с визором, ранец. 1.8 м.', build: buildPilotHuman },
  { id: 'pilot', name: 'Пилот (GLB + анимации)', category: 'Персонажи', desc: 'Текстурированный пилот из Blender со скелетом: Walk, Run_Anime, Climb_Wall, Fixing_Kneeling. 1.8 м.', build: buildPilotGlb, gltf: true },
  { id: 'survivor', name: 'Выживший — капюшон', category: 'Персонажи', desc: 'Гражданский в плаще с капюшоном. NPC для сцены.', build: buildSurvivor },

  { id: 'barrier', name: 'Бетонный блок', category: 'Укрытия', desc: 'Дорожный барьер типа «джерси», потёртый.', build: buildBarrier },
  { id: 'barrier_broken', name: 'Блок разрушенный', category: 'Укрытия', desc: 'Обломок барьера с торчащей арматурой.', build: buildBarrierBroken },
  { id: 'slab', name: 'Плита полуразрушенная', category: 'Укрытия', desc: 'Бетонная плита с проломом и арматурной сеткой.', build: buildSlab },
  { id: 'bunker_wall', name: 'Стена бункера', category: 'Укрытия', desc: 'Укреплённая стена 5м со следами обстрела.', build: buildBunkerWall },
  { id: 'sandbags', name: 'Мешки с песком', category: 'Укрытия', desc: 'Укрытие из мешков, 3 ряда.', build: buildSandbags },
  { id: 'husk', name: 'Остов здания', category: 'Укрытия', desc: 'Угол двух бетонных стен 6м, выбитые окна.', build: buildHusk },

  { id: 'barrel', name: 'Бочка ржавая', category: 'Бочки и грузы', desc: 'Стальная бочка 200л, сильная коррозия.', build: buildBarrelRusty },
  { id: 'barrel_group', name: 'Группа бочек', category: 'Бочки и грузы', desc: 'Три бочки, одна опрокинута, пятно мазута.', build: buildBarrelGroup },
  { id: 'barrel_toxic', name: 'Бочка токсичная', category: 'Бочки и грузы', desc: 'Контейнер с химикатами, светится.', build: buildBarrelToxic },
  { id: 'container', name: 'Контейнер ржавый', category: 'Бочки и грузы', desc: 'Грузовой контейнер 20ft, вмятины.', build: buildContainer },
  { id: 'crate', name: 'Ящик разбитый', category: 'Бочки и грузы', desc: 'Деревянный ящик, доски разбросаны.', build: buildCrate },
  { id: 'tires', name: 'Покрышки', category: 'Бочки и грузы', desc: 'Стопка старых покрышек.', build: buildTires },
  { id: 'cone', name: 'Дорожный конус', category: 'Бочки и грузы', desc: 'Выцветший сигнальный конус, пара лежит.', build: buildCone },

  { id: 'rails', name: 'Рельсы — сегмент', category: 'Металлолом', desc: 'Ж/д путь 8м, шпалы, погнутый конец.', build: buildRails },
  { id: 'girder', name: 'Балка гнутая', category: 'Металлолом', desc: 'Двутавр, скрученный взрывом.', build: buildGirder },
  { id: 'scrap', name: 'Куча металлолома', category: 'Металлолом', desc: 'Груда ржавого железа и труб.', build: buildScrapPile },
  { id: 'car_wreck', name: 'Остов машины', category: 'Металлолом', desc: 'Сгоревший автомобиль, без крыши.', build: buildCarWreck },
  { id: 'bricks', name: 'Штабель кирпичей', category: 'Металлолом', desc: 'Красно-серые кирпичи, половина раскатана.', build: buildBricks },

  { id: 'watchtower', name: 'Сторожевая вышка', category: 'База и техника', desc: 'Деревянная вышка 5м с прожектором.', build: buildWatchtower },
  { id: 'turret', name: 'Турель «Шершень»', category: 'База и техника', desc: 'Автономная спаренная турель.', build: buildTurret },
  { id: 'generator', name: 'Генератор', category: 'База и техника', desc: 'Дизель-генератор с кабелями.', build: buildGenerator },
  { id: 'antenna', name: 'Антенна-мачта', category: 'База и техника', desc: 'Мачта связи 7м, тарелка, маяк.', build: buildAntenna },
  { id: 'lamp', name: 'Фонарь ржавый', category: 'База и техника', desc: 'Столб освещения с объёмным светом.', build: buildLamp },
  { id: 'outpost', name: 'Модуль аванпоста', category: 'База и техника', desc: 'Жилой модуль базы с трубами.', build: buildOutpost },
  { id: 'dome', name: 'Купол теплицы', category: 'База и техника', desc: 'Стеклянный купол с зелёной подсветкой.', build: buildDome },
  { id: 'checkpoint', name: 'КПП со шлагбаумом', category: 'База и техника', desc: 'Контрольно-пропускной пункт.', build: buildCheckpoint },
  { id: 'sp_flag', name: 'Флаг спавна', category: 'База и техника', desc: 'Столб с флагом — точка старта меха вручную.', build: buildSpawnFlag },

  { id: 'rock', name: 'Скалы', category: 'Ландшафт', desc: 'Группа камней пустоши.', build: buildRock },
  { id: 'dead_tree', name: 'Сухое дерево', category: 'Ландшафт', desc: 'Мёртвое дерево с корнями.', build: buildDeadTree },
  { id: 'grass', name: 'Пучок травы', category: 'Ландшафт', desc: 'Кривые пучки зелёно-сухой травы.', build: buildGrass },
  { id: 'foundation', name: 'Бетонная площадка', category: 'Инфраструктура', desc: 'Фундамент под здания. Сначала зачисти территорию, потом залей бетон.', build: buildFoundation },
  { id: 'factory', name: 'Завод', category: 'Инфраструктура', desc: 'Позволяет крафтить мехов. Требует бетонную площадку.', build: buildFactory },
  { id: 'power_plant', name: 'Электростанция', category: 'Инфраструктура', desc: 'Обеспечивает энергией базу. Требует бетонную площадку.', build: buildPowerPlant },
  { id: 'oil_tower', name: 'Нефтебашня', category: 'Инфраструктура', desc: 'Добыча топлива. Требует бетонную площадку.', build: buildOilTower },
  { id: 'extractor', name: 'Добытчик ресурсов', category: 'Инфраструктура', desc: 'Добывает ресурсы из недр. Требует бетонную площадку.', build: buildExtractor },
];

/** Динамические ассеты (например, импортированные из GLB во время сессии). */
const dynamicAssets = new Map<string, AssetDef>();
export function registerDynamicAsset(def: AssetDef): void {
  dynamicAssets.set(def.id, def);
}
export function unregisterDynamicAsset(id: string): void {
  dynamicAssets.delete(id);
}

/**
 * Восстановить импортированный GLB-ассет из base64 (для новых вкладок/перезагрузок).
 * Регистрируем синхронно (build возвращает группу), геометрия грузится асинхронно.
 */
export function restoreDynamicAsset(id: string, name: string, base64: string): void {
  const group = new THREE.Group();
  registerDynamicAsset({
    id,
    name: name || "Мех (импорт)",
    category: "Мехи",
    desc: "Восстановлено из сохранённого GLB (base64).",
    build: () => group,
    gltf: true,
  });
  const bytes = base64ToBytes(base64);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "model/gltf-binary" });
  const url = URL.createObjectURL(blob);
  const loader = new GLTFLoader();
  loader.load(url, (glb) => {
    if (glb.scene) {
      const scene = glb.scene.clone(true);
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const s = Math.max(0.001, 4.8 / Math.max(0.001, size.y));
      scene.scale.setScalar(s);
      scene.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(scene);
      scene.position.y -= box2.min.y;
      group.add(scene);
    }
  }, undefined, (err) => console.warn("Restore GLB error", err));
}

export function getAsset(id: string): AssetDef | undefined {
  return dynamicAssets.get(id) ?? ASSETS.find((a) => a.id === id);
}
