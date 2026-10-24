import * as THREE from 'three';
import { getTextures } from './textures.ts';

export interface MaterialOverride {
  tint?: string;
  rust?: number; // 0..1
  metalness?: number;
  roughness?: number;
  emissiveIntensity?: number;
}

let matCache: Record<string, THREE.MeshStandardMaterial> = {};

export function getSharedMaterials() {
  if (Object.keys(matCache).length) return matCache;
  const T = getTextures();

  const mk = (name: string, opts: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial(opts);
    matCache[name] = m;
    return m;
  };

  mk('ground', { map: T.ground, bumpMap: T.groundBump, bumpScale: 0.6, roughness: 0.96, metalness: 0.02, color: 0xbfae98 });
  mk('rustDark', { map: T.rustDark, roughness: 0.82, metalness: 0.55, color: 0xcfc4b8 });
  mk('rustOrange', { map: T.rustOrange, roughness: 0.78, metalness: 0.45, color: 0xd8c0a8 });
  mk('rustHeavy', { map: T.rustHeavy, roughness: 0.9, metalness: 0.35, color: 0xcbb59a });
  mk('concrete', { map: T.concrete, roughness: 0.92, metalness: 0.02, color: 0xcfc8bd });
  mk('concreteBroken', { map: T.concreteBroken, roughness: 0.95, metalness: 0.02, color: 0xbdb5a8 });
  mk('mechArmor', { map: T.mechArmor, roughness: 0.62, metalness: 0.55, color: 0xd6d2c2 });
  mk('mechDark', { map: T.mechDark, roughness: 0.55, metalness: 0.72, color: 0xd0ccc0 });
  mk('hazard', { map: T.hazard, roughness: 0.7, metalness: 0.3, color: 0xd8ccb0 });
  mk('wood', { map: T.wood, roughness: 0.9, metalness: 0.0, color: 0xbfae98 });
  mk('metalPanels', { map: T.metalPanels, roughness: 0.72, metalness: 0.5, color: 0xd0c0a8 });
  mk('rock', { map: T.rock, roughness: 0.95, metalness: 0.02, color: 0xbfb6aa });
  mk('sandbag', { map: T.sandbag, roughness: 0.95, metalness: 0.0, color: 0xcfc0a0 });
  mk('rubber', { color: 0x1e1e20, roughness: 0.92, metalness: 0.05 });
  mk('glassCockpit', { color: 0x86c5d8, roughness: 0.15, metalness: 0.9, emissive: 0x2a5a6a, emissiveIntensity: 0.5 });
  mk('glassGreen', { color: 0x7de8b0, roughness: 0.2, metalness: 0.1, emissive: 0x1fd67c, emissiveIntensity: 0.9, transparent: true, opacity: 0.75 });
  mk('lightWarm', { color: 0xffd9a0, emissive: 0xff9a3c, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0 });
  mk('lightRed', { color: 0xff6a5a, emissive: 0xff2a1a, emissiveIntensity: 2.0, roughness: 0.4, metalness: 0 });
  mk('lightCyan', { color: 0x9ae8ff, emissive: 0x2ac8ff, emissiveIntensity: 1.8, roughness: 0.4, metalness: 0 });
  mk('toxicGlow', { color: 0x9dff6a, emissive: 0x4dff22, emissiveIntensity: 1.6, roughness: 0.5, metalness: 0.1 });
  mk('steelDark', { color: 0x3a3d40, roughness: 0.45, metalness: 0.85 });
  mk('steelLight', { color: 0x8a8f94, roughness: 0.35, metalness: 0.9 });
  mk('copperPipe', { color: 0x8a5a30, roughness: 0.4, metalness: 0.85 });
  mk('canvas', { color: 0x5a5348, roughness: 0.95, metalness: 0 });

  return matCache;
}

// Apply per-object overrides. Always recomputed from captured originals → idempotent.
const RUST_COLOR = new THREE.Color(0x8a4a22);
const WHITE = new THREE.Color(0xffffff);

export function applyOverride(base: THREE.Material | THREE.Material[], override: MaterialOverride): void {
  const mats = Array.isArray(base) ? base : [base];
  mats.forEach((m) => {
    if (m instanceof THREE.MeshStandardMaterial) {
      // capture originals once (before any modification)
      if (!m.userData.origColor) {
        m.userData.origColor = m.color.clone();
        m.userData.origRough = m.roughness;
        m.userData.origMetal = m.metalness;
        m.userData.origEmissive = m.emissiveIntensity;
      }
      const oc = m.userData.origColor as THREE.Color;
      const orough = m.userData.origRough as number;
      const ometal = m.userData.origMetal as number;

      // 1) base color = original × tint
      m.color.copy(oc);
      if (override.tint && override.tint.toLowerCase() !== '#ffffff') {
        m.color.multiply(new THREE.Color(override.tint));
      }
      // 2) rust lerp toward corrosion color
      const r = override.rust ?? 0;
      if (r > 0) m.color.lerp(RUST_COLOR, r * 0.55);

      // 3) PBR params: user value (or original) adjusted by rust
      const targetRough = override.roughness ?? orough;
      const targetMetal = override.metalness ?? ometal;
      m.roughness = THREE.MathUtils.clamp(targetRough + r * 0.3, 0, 1);
      m.metalness = THREE.MathUtils.clamp(targetMetal - r * 0.28, 0, 1);

      if (override.emissiveIntensity !== undefined) {
        m.emissiveIntensity = override.emissiveIntensity;
      }
    }
  });
}

export { WHITE };

// Deep-clone materials of a group so per-object overrides don't leak
export function cloneMaterials(group: THREE.Object3D) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone());
      else mesh.material = (mesh.material as THREE.Material).clone();
      // клон — персональный материал объекта: его можно и нужно освобождать
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => { m.userData.shared = false; });
    }
  });
}
