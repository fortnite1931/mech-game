import * as THREE from 'three';

// ---------- helpers ----------
function makeCanvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { canvas: c, ctx: c.getContext('2d')! };
}

function rand(seedRef: { s: number }) {
  // mulberry32
  let t = (seedRef.s += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// value noise texture fill
function fillNoise(ctx: CanvasRenderingContext2D, size: number, base: string, spots: string[], count: number, minR: number, maxR: number, alphaMin: number, alphaMax: number, seed: number) {
  const s = { s: seed };
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const x = rand(s) * size;
    const y = rand(s) * size;
    const r = minR + rand(s) * (maxR - minR);
    const col = spots[Math.floor(rand(s) * spots.length)];
    const a = alphaMin + rand(s) * (alphaMax - alphaMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col + Math.round(a * 255).toString(16).padStart(2, '0'));
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function addSpeckle(ctx: CanvasRenderingContext2D, size: number, count: number, colors: string[], maxSize: number, seed: number) {
  const s = { s: seed };
  for (let i = 0; i < count; i++) {
    const x = rand(s) * size;
    const y = rand(s) * size;
    const w = 1 + rand(s) * maxSize;
    const h = 1 + rand(s) * maxSize;
    ctx.fillStyle = colors[Math.floor(rand(s) * colors.length)];
    ctx.globalAlpha = 0.25 + rand(s) * 0.6;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;
}

function addScratches(ctx: CanvasRenderingContext2D, size: number, count: number, seed: number, light = false) {
  const s = { s: seed };
  for (let i = 0; i < count; i++) {
    const x = rand(s) * size;
    const y = rand(s) * size;
    const len = 10 + rand(s) * 90;
    const ang = rand(s) * Math.PI * 2;
    ctx.strokeStyle = light ? 'rgba(200,180,150,0.25)' : 'rgba(20,12,8,0.35)';
    ctx.lineWidth = 0.5 + rand(s) * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
}

function addCracks(ctx: CanvasRenderingContext2D, size: number, count: number, seed: number) {
  const s = { s: seed };
  ctx.strokeStyle = 'rgba(15,10,8,0.55)';
  for (let i = 0; i < count; i++) {
    let x = rand(s) * size;
    let y = rand(s) * size;
    let ang = rand(s) * Math.PI * 2;
    ctx.lineWidth = 1 + rand(s) * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 4 + Math.floor(rand(s) * 6);
    for (let j = 0; j < segs; j++) {
      ang += (rand(s) - 0.5) * 1.2;
      const len = 15 + rand(s) * 50;
      x += Math.cos(ang) * len;
      y += Math.sin(ang) * len;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function toTexture(canvas: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- public texture builders ----------
export interface WastelandTextures {
  ground: THREE.CanvasTexture;
  groundBump: THREE.CanvasTexture;
  rustDark: THREE.CanvasTexture;
  rustOrange: THREE.CanvasTexture;
  rustHeavy: THREE.CanvasTexture;
  concrete: THREE.CanvasTexture;
  concreteBroken: THREE.CanvasTexture;
  mechArmor: THREE.CanvasTexture;
  mechDark: THREE.CanvasTexture;
  hazard: THREE.CanvasTexture;
  wood: THREE.CanvasTexture;
  metalPanels: THREE.CanvasTexture;
  rock: THREE.CanvasTexture;
  dustSprite: THREE.CanvasTexture;
  sandbag: THREE.CanvasTexture;
}

let cache: WastelandTextures | null = null;

export function getTextures(): WastelandTextures {
  if (cache) return cache;

  // --- GROUND: dark ash + orange dust ---
  const g = makeCanvas(1024);
  fillNoise(g.ctx, 1024, '#2e241b', ['#3a2d21', '#201913', '#55402c', '#6f5230', '#7d5a2e'], 1100, 6, 110, 0.2, 0.65, 21);
  addSpeckle(g.ctx, 1024, 9000, ['#0f0c09', '#58504a', '#7a6a55', '#8a6b3f', '#c9a06a'], 3, 31);
  addCracks(g.ctx, 1024, 26, 41);
  addScratches(g.ctx, 1024, 160, 51);
  // dusty drifts
  const gs = { s: 61 };
  for (let i = 0; i < 60; i++) {
    const x = rand(gs) * 1024, y = rand(gs) * 1024, r = 40 + rand(gs) * 130;
    const gr = g.ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(190,130,70,0.18)');
    gr.addColorStop(1, 'rgba(190,130,70,0)');
    g.ctx.fillStyle = gr;
    g.ctx.beginPath(); g.ctx.arc(x, y, r, 0, Math.PI * 2); g.ctx.fill();
  }
  const groundTex = toTexture(g.canvas, 8);

  const gb = makeCanvas(512);
  fillNoise(gb.ctx, 512, '#808080', ['#6a6a6a', '#999999', '#555555'], 600, 4, 40, 0.3, 0.7, 71);
  addSpeckle(gb.ctx, 512, 4000, ['#333333', '#bbbbbb'], 2, 72);
  const groundBump = toTexture(gb.canvas, 8, false);

  // --- RUST DARK ---
  const rd = makeCanvas(512);
  fillNoise(rd.ctx, 512, '#33302c', ['#4a3a28', '#6b4423', '#2a2118', '#7a4a22'], 700, 4, 60, 0.3, 0.8, 101);
  addSpeckle(rd.ctx, 512, 3500, ['#1a1512', '#8a5a2e', '#c07a35', '#4a2e18'], 3, 102);
  addScratches(rd.ctx, 512, 90, 103);
  // vertical rust streaks
  const rds = { s: 104 };
  for (let i = 0; i < 70; i++) {
    const x = rand(rds) * 512, y = rand(rds) * 512, len = 20 + rand(rds) * 120;
    const grd = rd.ctx.createLinearGradient(x, y, x, y + len);
    grd.addColorStop(0, 'rgba(140,70,25,0.5)');
    grd.addColorStop(1, 'rgba(140,70,25,0)');
    rd.ctx.fillStyle = grd;
    rd.ctx.fillRect(x, y, 2 + rand(rds) * 5, len);
  }
  const rustDark = toTexture(rd.canvas, 1);

  // --- RUST ORANGE (barrels) ---
  const ro = makeCanvas(512);
  fillNoise(ro.ctx, 512, '#6e3a1c', ['#8a4a22', '#a35a28', '#4a2410', '#c07a35', '#2e1a0e'], 800, 5, 70, 0.3, 0.75, 201);
  addSpeckle(ro.ctx, 512, 2800, ['#2a1508', '#d89a55', '#5a2e12'], 3, 202);
  addScratches(ro.ctx, 512, 70, 203, true);
  const rustOrange = toTexture(ro.canvas, 1);

  // --- RUST HEAVY ---
  const rh = makeCanvas(512);
  fillNoise(rh.ctx, 512, '#4a2a14', ['#6e3a1c', '#8a4a22', '#2a1a0e', '#a35a28', '#1d130c'], 900, 6, 80, 0.35, 0.85, 301);
  addSpeckle(rh.ctx, 512, 4200, ['#140d08', '#c07a35', '#7a4a22'], 4, 302);
  addCracks(rh.ctx, 512, 10, 303);
  const rustHeavy = toTexture(rh.canvas, 1);

  // --- CONCRETE ---
  const cc = makeCanvas(512);
  fillNoise(cc.ctx, 512, '#8a8580', ['#9a9590', '#787370', '#a8a39e', '#6a6560'], 700, 6, 60, 0.25, 0.6, 401);
  addSpeckle(cc.ctx, 512, 5000, ['#5a5550', '#b8b3ae', '#3a3633'], 2, 402);
  addCracks(cc.ctx, 512, 12, 403);
  // stains
  const ccs = { s: 404 };
  for (let i = 0; i < 25; i++) {
    const x = rand(ccs) * 512, y = rand(ccs) * 512, r = 20 + rand(ccs) * 70;
    const gr = cc.ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(60,45,30,0.25)');
    gr.addColorStop(1, 'rgba(60,45,30,0)');
    cc.ctx.fillStyle = gr;
    cc.ctx.beginPath(); cc.ctx.arc(x, y, r, 0, Math.PI * 2); cc.ctx.fill();
  }
  const concrete = toTexture(cc.canvas, 1);

  // --- CONCRETE BROKEN (darker, dirtier) ---
  const cb = makeCanvas(512);
  fillNoise(cb.ctx, 512, '#6f6a64', ['#5a5550', '#7d7873', '#4a453f', '#8a7a62'], 800, 6, 70, 0.3, 0.7, 501);
  addSpeckle(cb.ctx, 512, 6000, ['#2e2a26', '#9a9590', '#6b5a42'], 3, 502);
  addCracks(cb.ctx, 512, 30, 503);
  const concreteBroken = toTexture(cb.canvas, 1);

  // --- MECH ARMOR (olive drab, chipped) ---
  const ma = makeCanvas(512);
  fillNoise(ma.ctx, 512, '#4a4a3c', ['#555545', '#3d3d32', '#5f5a48', '#44483a'], 500, 8, 70, 0.25, 0.55, 601);
  // panel lines
  ma.ctx.strokeStyle = 'rgba(15,15,12,0.7)';
  ma.ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * 512;
    ma.ctx.beginPath(); ma.ctx.moveTo(0, p); ma.ctx.lineTo(512, p); ma.ctx.stroke();
    ma.ctx.beginPath(); ma.ctx.moveTo(p, 0); ma.ctx.lineTo(p, 512); ma.ctx.stroke();
  }
  // rivets
  const mas = { s: 602 };
  ma.ctx.fillStyle = 'rgba(20,20,16,0.8)';
  for (let i = 0; i < 64; i++) {
    const x = Math.floor(rand(mas) * 5) * (512 / 4) + (rand(mas) > 0.5 ? 8 : -8);
    const y = rand(mas) * 512;
    ma.ctx.beginPath(); ma.ctx.arc(x, y, 3, 0, Math.PI * 2); ma.ctx.fill();
  }
  // chipped paint -> rust spots
  for (let i = 0; i < 140; i++) {
    const x = rand(mas) * 512, y = rand(mas) * 512, r = 2 + rand(mas) * 9;
    ma.ctx.fillStyle = `rgba(${120 + rand(mas) * 60},${60 + rand(mas) * 20},${25},${0.5 + rand(mas) * 0.5})`;
    ma.ctx.beginPath(); ma.ctx.arc(x, y, r, 0, Math.PI * 2); ma.ctx.fill();
  }
  addScratches(ma.ctx, 512, 80, 603);
  const mechArmor = toTexture(ma.canvas, 1);

  // --- MECH DARK ---
  const md = makeCanvas(512);
  fillNoise(md.ctx, 512, '#2b2d2a', ['#34362f', '#22241f', '#3d3a2e'], 500, 6, 60, 0.3, 0.6, 701);
  addSpeckle(md.ctx, 512, 2000, ['#141512', '#5a4a30', '#8a6a3a'], 2, 702);
  addScratches(md.ctx, 512, 60, 703);
  const mechDark = toTexture(md.canvas, 1);

  // --- HAZARD ---
  const hz = makeCanvas(256);
  hz.ctx.fillStyle = '#c9a227';
  hz.ctx.fillRect(0, 0, 256, 256);
  hz.ctx.fillStyle = '#1d1a16';
  for (let i = -8; i < 16; i++) {
    hz.ctx.beginPath();
    hz.ctx.moveTo(i * 32, 0);
    hz.ctx.lineTo(i * 32 + 32, 0);
    hz.ctx.lineTo(i * 32 - 64 + 32, 256);
    hz.ctx.lineTo(i * 32 - 64, 256);
    hz.ctx.fill();
  }
  // wear
  fillNoise(hz.ctx, 256, 'rgba(0,0,0,0)', ['#6e3a1c', '#3a2a1a'], 0, 0, 0, 0, 0, 1);
  addSpeckle(hz.ctx, 256, 1200, ['#6e3a1c', '#2a2118', '#c9a227'], 3, 801);
  addScratches(hz.ctx, 256, 40, 802);
  const hazard = toTexture(hz.canvas, 1);

  // --- WOOD ---
  const wd = makeCanvas(512);
  wd.ctx.fillStyle = '#5a4028';
  wd.ctx.fillRect(0, 0, 512, 512);
  const wds = { s: 901 };
  for (let y = 0; y < 512; y += 4) {
    const shade = 60 + Math.sin(y * 0.05) * 12 + rand(wds) * 18;
    wd.ctx.fillStyle = `rgba(${shade + 30},${shade * 0.7},${shade * 0.4},0.6)`;
    wd.ctx.fillRect(0, y, 512, 3);
  }
  // planks
  wd.ctx.strokeStyle = 'rgba(20,12,6,0.8)';
  wd.ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    wd.ctx.beginPath(); wd.ctx.moveTo(0, (i / 4) * 512); wd.ctx.lineTo(512, (i / 4) * 512); wd.ctx.stroke();
  }
  addSpeckle(wd.ctx, 512, 1500, ['#2a1a0c', '#8a6a42'], 2, 902);
  const wood = toTexture(wd.canvas, 1);

  // --- METAL PANELS (containers) ---
  const mp = makeCanvas(512);
  fillNoise(mp.ctx, 512, '#5a4a38', ['#6b5a44', '#4a3d2e', '#7d6a52'], 400, 8, 60, 0.3, 0.6, 1001);
  // corrugation
  for (let x = 0; x < 512; x += 32) {
    const gr = mp.ctx.createLinearGradient(x, 0, x + 32, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.4)');
    gr.addColorStop(0.5, 'rgba(255,230,190,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0.4)');
    mp.ctx.fillStyle = gr;
    mp.ctx.fillRect(x, 0, 32, 512);
  }
  addSpeckle(mp.ctx, 512, 2500, ['#2a2018', '#8a5a2e', '#c07a35'], 3, 1002);
  // rust bottom
  const grdB = mp.ctx.createLinearGradient(0, 320, 0, 512);
  grdB.addColorStop(0, 'rgba(110,58,28,0)');
  grdB.addColorStop(1, 'rgba(110,58,28,0.75)');
  mp.ctx.fillStyle = grdB;
  mp.ctx.fillRect(0, 320, 512, 192);
  const metalPanels = toTexture(mp.canvas, 1);

  // --- ROCK ---
  const rk = makeCanvas(512);
  fillNoise(rk.ctx, 512, '#4a443e', ['#5a544c', '#3a3632', '#6a6258', '#2e2b27'], 800, 5, 70, 0.3, 0.7, 1101);
  addSpeckle(rk.ctx, 512, 4000, ['#1d1b19', '#8a8178', '#5a544c'], 3, 1102);
  addCracks(rk.ctx, 512, 18, 1103);
  const rock = toTexture(rk.canvas, 1);

  // --- DUST SPRITE ---
  const ds = makeCanvas(128);
  const dg = ds.ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  dg.addColorStop(0, 'rgba(255,220,170,0.85)');
  dg.addColorStop(0.4, 'rgba(230,180,120,0.35)');
  dg.addColorStop(1, 'rgba(220,160,100,0)');
  ds.ctx.fillStyle = dg;
  ds.ctx.fillRect(0, 0, 128, 128);
  const dustSprite = toTexture(ds.canvas, 1);
  dustSprite.wrapS = dustSprite.wrapT = THREE.ClampToEdgeWrapping;

  // --- SANDBAG ---
  const sb = makeCanvas(256);
  fillNoise(sb.ctx, 256, '#7a6a4e', ['#8a7a5c', '#6a5c42', '#94805e'], 300, 5, 30, 0.3, 0.6, 1201);
  addSpeckle(sb.ctx, 256, 1200, ['#4a4030', '#a89468'], 2, 1202);
  const sandbag = toTexture(sb.canvas, 1);

  cache = {
    ground: groundTex, groundBump, rustDark, rustOrange, rustHeavy,
    concrete, concreteBroken, mechArmor, mechDark, hazard, wood,
    metalPanels, rock, dustSprite, sandbag,
  };
  return cache;
}
