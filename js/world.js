/* ============================================================================
   OREGON TRAIL — LONE PASSAGE
   world.js — the 3D world. Everything here is generated in code: terrain
   geometry, sky, water, trees, rocks, the wagon, animals, weather. No textures
   are loaded from disk; every surface is either vertex-coloured or drawn to an
   offscreen canvas at runtime.
   ========================================================================== */

import * as THREE from './vendor/three.module.js';

/* ----------------------------------------------------------------------------
   Palette — the trail's colours, keyed by terrain band.
   -------------------------------------------------------------------------- */
const PALETTE = {
  prairie: { grass: [0x6f8f3f, 0x8fae52], dirt: 0x9c7b4a, rock: 0x8a7a63, haze: 0xbcd0d8, sun: 0xfff2d0 },
  plains:  { grass: [0x8a9c4c, 0xa8b263], dirt: 0xb08c55, rock: 0x9a8467, haze: 0xd6d2b8, sun: 0xffeec4 },
  rockies: { grass: [0x6b7c45, 0x8a9455], dirt: 0x9b7a4e, rock: 0x7d6f5c, haze: 0xc8cfd6, sun: 0xffe9c8 },
  divide:  { grass: [0x7c8459, 0x9aa06a], dirt: 0xa38a63, rock: 0x8f8578, haze: 0xd2d9e2, sun: 0xffe2b8 },
  basin:   { grass: [0x9c9a62, 0xbfae74], dirt: 0xc2a06a, rock: 0xa89272, haze: 0xe6d9be, sun: 0xffe3a8 },
  snake:   { grass: [0x8f9a52, 0xb0b268], dirt: 0xb08c55, rock: 0x8f8578, haze: 0xdcd6c0, sun: 0xffedc2 },
  blues:   { grass: [0x5c7240, 0x7b8c4c], dirt: 0x8f7048, rock: 0x6f6558, haze: 0xc3ccd0, sun: 0xffe0b0 },
  gorge:   { grass: [0x567040, 0x748a4a], dirt: 0x8a6b45, rock: 0x6a6055, haze: 0xc9d2d6, sun: 0xffddab },
};

const WEATHER_LOOK = {
  clear:    { sky: [0x4d9be6, 0xbfe2f5], fog: 0.0022, sun: 1.25, ambient: 0.55 },
  overcast: { sky: [0x8fa5b4, 0xc9d5dc], fog: 0.0042, sun: 0.45, ambient: 0.7 },
  rain:     { sky: [0x5b6d7a, 0x93a5ae], fog: 0.0068, sun: 0.25, ambient: 0.72 },
  storm:    { sky: [0x39434d, 0x66737d], fog: 0.0102, sun: 0.12, ambient: 0.66 },
  snow:     { sky: [0xa8bccb, 0xe6eef4], fog: 0.0072, sun: 0.5,  ambient: 0.9 },
  heat:     { sky: [0xd8a45a, 0xf6e2b8], fog: 0.0034, sun: 1.5,  ambient: 0.72 },
  fog:      { sky: [0xb9c4c8, 0xdfe6e8], fog: 0.0142, sun: 0.35, ambient: 0.82 },
};

/* ----------------------------------------------------------------------------
   Deterministic noise for terrain generation (mirrors the engine's approach).
   -------------------------------------------------------------------------- */
function makeNoise(seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Value noise with smooth interpolation over a 2D lattice.
  const size = 256;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
  const at = (x, y) => grid[((y & (size - 1)) * size + (x & (size - 1)))];
  const fade = (t) => t * t * (3 - 2 * t);
  const noise2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  const fbm = (x, y, octaves = 5) => {
    let sum = 0, amp = 0.5, freq = 1;
    for (let o = 0; o < octaves; o += 1) { sum += noise2(x * freq, y * freq) * amp; freq *= 2; amp *= 0.5; }
    return sum;
  };
  return { rand, noise2, fbm };
}

/* ----------------------------------------------------------------------------
   Sky: an inverted sphere with a hand-written gradient shader, plus a sun.
   -------------------------------------------------------------------------- */
function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x4d9be6) },
      bottom: { value: new THREE.Color(0xbfe2f5) },
      sunDir: { value: new THREE.Vector3(0.4, 0.5, -1).normalize() },
      sunColor: { value: new THREE.Color(0xfff2d0) },
      sunStrength: { value: 1.0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunStrength;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 base = mix(bottom, top, pow(h, 0.75));
        float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        // Broad atmospheric glow plus a tight disc.
        base += sunColor * pow(d, 6.0) * 0.35 * sunStrength;
        base += sunColor * pow(d, 320.0) * 1.6 * sunStrength;
        gl_FragColor = vec4(base, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

/* ----------------------------------------------------------------------------
   Terrain: a long ribbon that scrolls under the wagon. Height and colour come
   from fbm noise; the profile flattens into the trail ruts down the middle.
   -------------------------------------------------------------------------- */
class Terrain {
  constructor(seed) {
    this.noise = makeNoise(seed);
    // The ground only needs to be big enough to fill the view before fog and
    // the distant ranges take over. Keeping it modest roughly quintuples the
    // frame rate, because vertex work and fill rate both scale with it.
    this.length = 900;      // world units of trail visible
    this.width = 190;
    this.segZ = 72;
    this.segX = 44;
    this.mesh = null;
    this.baseZ = 0;
  }

  build(bandId) {
    const { segZ, segX, length, width } = this;
    const geo = new THREE.PlaneGeometry(width, length, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    // The ground is static in its own local space; normals are computed once
    // here and only refreshed on the rare resculpt. Marking it non-dynamic
    // lets the driver cache the buffer.
    geo.attributes.position.usage = THREE.DynamicDrawUsage;
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const p = PALETTE[bandId] || PALETTE.prairie;

    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const height = this.heightAt(x, z);
      pos.setY(i, height);

      const n = this.noise.fbm((x + 500) * 0.02, (z + 500) * 0.02, 4);
      const rut = Math.exp(-(x * x) / 180);
      let col;
      if (rut > 0.55) {
        // Worn trail ruts: bare dirt down the centre.
        col = new THREE.Color(p.dirt).lerp(new THREE.Color(0x6b5232), 0.35);
      } else {
        const g = new THREE.Color(p.grass[0]).lerp(new THREE.Color(p.grass[1]), n);
        col = g.lerp(new THREE.Color(p.rock), Math.max(0, n - 0.68) * 1.6);
      }
      const shade = 0.82 + 0.18 * (1 - Math.min(1, Math.abs(x) / 140));
      colors[i * 3] = col.r * shade;
      colors[i * 3 + 1] = col.g * shade;
      colors[i * 3 + 2] = col.b * shade;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.02, flatShading: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.z = -length / 2 + 40;
    return mesh;
  }

  /* Rolling ground, flattened along the trail corridor and in the ruts. */
  heightAt(x, z) {
    const corridor = Math.exp(-(x * x) / 9000);
    let h = (this.noise.fbm((x + 300) * 0.012, (z + 300) * 0.012, 5) - 0.5) * 46;
    h *= (1 - corridor * 0.86);
    h += (this.noise.fbm((x + 700) * 0.06, (z + 700) * 0.06, 3) - 0.5) * 3.2 * (1 - corridor);
    const rut = Math.exp(-(x * x) / 180) * -0.5;
    return h + rut;
  }
}

/* ----------------------------------------------------------------------------
   Vegetation and props, instanced for performance.
   -------------------------------------------------------------------------- */
/* Grass reads best as low, tapering tufts — flat billboards viewed edge-on
   look like floating slabs, which is exactly what a plane billboard does
   without an alpha texture. A narrow cone gives real volume for very few
   triangles and looks correct from every angle. */
function makeGrassTufts(noise, bandId, count = 1400) {
  const base = PALETTE[bandId] || PALETTE.prairie;
  const tuft = new THREE.ConeGeometry(0.20, 0.85, 4, 1, true);
  tuft.translate(0, 0.42, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(base.grass[0]).lerp(new THREE.Color(base.grass[1]), 0.5),
    roughness: 0.96,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  const inst = new THREE.InstancedMesh(tuft, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i += 1) {
    const x = (noise.rand() - 0.5) * 185;
    const z = (noise.rand() - 0.5) * 880;
    if (Math.abs(x) < 3.4) continue;                    // keep the ruts clear
    const sc = 0.6 + noise.rand() * 1.3;
    s.set(sc, sc * (0.6 + noise.rand() * 1.0), sc);
    q.setFromAxisAngle(up, noise.rand() * Math.PI * 2);
    t.set(x, -0.15, z);
    m.compose(t, q, s);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  return inst;
}

function makeTrees(noise, bandId, count, opts = {}) {
  const { minX = 26, maxX = 110, minZ = -580, maxZ = 580, scale = 1 } = opts;
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 5.5, 6);
  trunk.translate(0, 2.75, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4432, roughness: 0.95 });
  const cone = new THREE.ConeGeometry(3.1, 9.5, 7);
  cone.translate(0, 8.4, 0);
  const leafMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color((PALETTE[bandId] || PALETTE.prairie).grass[0]).multiplyScalar(0.62),
    roughness: 0.92, flatShading: true,
  });

  const trunks = new THREE.InstancedMesh(trunk, trunkMat, count);
  const leaves = new THREE.InstancedMesh(cone, leafMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const side = noise.rand() < 0.5 ? -1 : 1;
    const x = side * (minX + noise.rand() * (maxX - minX));
    const z = minZ + noise.rand() * (maxZ - minZ);
    const sc = (0.7 + noise.rand() * 0.9) * scale;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), noise.rand() * Math.PI * 2);
    s.set(sc, sc * (0.85 + noise.rand() * 0.5), sc);
    t.set(x, -0.4, z);
    m.compose(t, q, s);
    trunks.setMatrixAt(i, m);
    leaves.setMatrixAt(i, m);
  }
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  trunks.frustumCulled = false; leaves.frustumCulled = false;
  const g = new THREE.Group();
  g.add(trunks, leaves);
  return g;
}

function makeRocks(noise, bandId, count = 120) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color((PALETTE[bandId] || PALETTE.prairie).rock),
    roughness: 1.0, flatShading: true,
  });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const side = noise.rand() < 0.5 ? -1 : 1;
    const x = side * (14 + noise.rand() * 100);
    const z = (noise.rand() - 0.5) * 1150;
    const sc = 0.5 + noise.rand() * 3.4;
    q.setFromEuler(new THREE.Euler(noise.rand() * 3, noise.rand() * 3, noise.rand() * 3));
    s.set(sc, sc * (0.6 + noise.rand() * 0.6), sc);
    t.set(x, sc * 0.3 - 0.4, z);
    m.compose(t, q, s);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  return inst;
}

/* Distant mountain ranges: silhouette rings so the horizon has depth. */
function makeMountainRange(noise, bandId, colorMul, dist, height, count = 26) {
  const color = new THREE.Color((PALETTE[bandId] || PALETTE.prairie).rock).multiplyScalar(colorMul);
  const geo = new THREE.ConeGeometry(1, 1, 4);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, fog: true });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const ang = (i / count) * Math.PI * 1.5 - Math.PI * 0.75;
    const r = dist * (0.85 + noise.rand() * 0.4);
    const x = Math.sin(ang) * r;
    const z = -Math.cos(ang) * r - 260;
    const h = height * (0.6 + noise.rand() * 1.0);
    const w = h * (1.4 + noise.rand() * 1.3);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), noise.rand() * Math.PI);
    s.set(w, h, w);
    t.set(x, h / 2 - 12, z);
    m.compose(t, q, s);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  return inst;
}

/* ----------------------------------------------------------------------------
   The wagon: built from primitives, with an animated canvas cover.
   -------------------------------------------------------------------------- */
export class Wagon {
  constructor() {
    this.group = new THREE.Group();
    this.wheels = [];
    this.build();
  }

  build() {
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x5c3a22, roughness: 0.85 });
    const woodMid = new THREE.MeshStandardMaterial({ color: 0x7a4f2c, roughness: 0.82 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2e2e33, roughness: 0.55, metalness: 0.65 });
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.98, side: THREE.DoubleSide });

    // Bed
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.55, 4.4), woodMid);
    bed.position.y = 1.5;
    bed.castShadow = true; bed.receiveShadow = true;
    this.group.add(bed);

    // Side rails
    for (const sx of [-1.28, 1.28]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 4.4), woodDark);
      rail.position.set(sx, 1.95, 0);
      rail.castShadow = true;
      this.group.add(rail);
    }

    // Hoops + canvas cover (half-cylinder)
    const hoopGeo = new THREE.TorusGeometry(1.36, 0.045, 6, 20, Math.PI);
    for (let i = 0; i < 5; i += 1) {
      const hoop = new THREE.Mesh(hoopGeo, woodDark);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(0, 1.78, -1.7 + i * 0.85);
      this.group.add(hoop);
    }
    const cover = new THREE.Mesh(
      new THREE.CylinderGeometry(1.34, 1.34, 3.6, 20, 1, true, 0, Math.PI),
      canvasMat,
    );
    cover.rotation.z = Math.PI / 2;
    cover.rotation.y = Math.PI / 2;
    cover.position.y = 1.8;
    cover.castShadow = true;
    this.group.add(cover);
    this.cover = cover;

    // Wheels: 4 large, with spokes.
    const wheelPositions = [
      [-1.45, 0.95, 1.3], [1.45, 0.95, 1.3],
      [-1.45, 0.95, -1.3], [1.45, 0.95, -1.3],
    ];
    const front = [true, true, false, false];
    for (let i = 0; i < 4; i += 1) {
      const r = front[i] ? 0.78 : 1.02;
      const wheel = this.makeWheel(r, woodMid, iron);
      wheel.position.set(...wheelPositions[i]);
      this.group.add(wheel);
      this.wheels.push(wheel);
    }

    // Tongue reaching forward to the ox yoke
    const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 4.2), woodMid);
    tongue.position.set(0, 0.82, -3.7);
    this.group.add(tongue);
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.16), woodDark);
    yoke.position.set(0, 0.9, -5.4);
    this.group.add(yoke);

    // Lantern
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.34, 8),
      new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0xff9a33, emissiveIntensity: 1.6, roughness: 0.5 }));
    lamp.position.set(1.15, 2.5, 1.85);
    this.group.add(lamp);
    this.lamp = lamp;

    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  }

  makeWheel(radius, woodMat, ironMat) {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.075, 6, 18), ironMat);
    tire.rotation.y = Math.PI / 2;
    wheel.add(tire);
    const spokeCount = radius > 0.9 ? 12 : 10;
    for (let i = 0; i < spokeCount; i += 1) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, radius * 2 - 0.1, 5), woodMat);
      spoke.rotation.z = (i / spokeCount) * Math.PI;
      spoke.rotation.x = Math.PI / 2;
      spoke.rotation.z = (i / spokeCount) * Math.PI;
      wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 8), woodMat);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    // Wheel axis: spin about X (the axle), so orient the group appropriately.
    return wheel;
  }

  update(dt, speed) {
    // Wheels rotate about the axle (world X).
    for (const w of this.wheels) w.rotation.x -= speed * dt * 1.4;
    // Gentle sway and bounce.
    const t = performance.now() / 1000;
    this.group.rotation.z = Math.sin(t * 3.1) * 0.018 * Math.min(1, speed);
    this.group.position.y = Math.abs(Math.sin(t * 5.4)) * 0.05 * Math.min(1, speed);
    if (this.lamp) this.lamp.material.emissiveIntensity = 1.2 + Math.sin(t * 7) * 0.35;
  }
}

/* ----------------------------------------------------------------------------
   Oxen: a small herd of low-poly animals plodding ahead of the wagon.
   -------------------------------------------------------------------------- */
export class Oxen {
  constructor(count = 6) {
    this.group = new THREE.Group();
    this.animals = [];
    const hide = new THREE.MeshStandardMaterial({ color: 0xb08a63, roughness: 0.88 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x6b5138, roughness: 0.95 });
    const horn = new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.6 });
    // Oxen are built at a realistic scale relative to the wagon: a team of six
    // should read as a group of animals pulling the tongue, large enough to be
    // clearly seen from the chase camera.
    for (let i = 0; i < count; i += 1) {
      const ox = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.88, 1.85), hide);
      body.position.y = 1.30; body.castShadow = true;
      ox.add(body);
      const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.74, 0.7), hide);
      shoulders.position.set(0, 1.42, 0.72); shoulders.castShadow = true;
      ox.add(shoulders);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.72), hide);
      head.position.set(0, 1.42, 1.32); head.castShadow = true;
      ox.add(head);
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.3), dark);
      snout.position.set(0, 1.28, 1.78);
      ox.add(snout);
      for (const [hx, hz] of [[0.33, 0.62], [-0.33, 0.62], [0.33, -0.62], [-0.33, -0.62]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.88, 0.19), dark);
        leg.position.set(hx, 0.44, hz);
        ox.add(leg);
        leg.userData.phase = (i * 1.7 + hz * 3) % 6.28;
      }
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.38, 5), horn);
        h.position.set(s * 0.24, 1.76, 1.42);
        h.rotation.z = s * 1.0;
        ox.add(h);
      }
      // The wagon travels toward -Z, so the team stands beyond the tongue.
      // Three yoked pairs in a line, abreast, spaced far enough apart that no
      // two animals overlap: this is how a real team was hitched.
      const pair = Math.floor(i / 2);
      const side = (i % 2) * 2 - 1;
      ox.userData = { phase: i * 0.9, lane: side * 0.62 };
      ox.position.set(ox.userData.lane, 0, -5.4 - pair * 2.35);
      this.animals.push(ox);
      this.group.add(ox);
    }
  }

  update(dt, speed, moving) {
    const t = performance.now() / 1000;
    for (const ox of this.animals) {
      const ph = ox.userData.phase;
      ox.position.y = Math.abs(Math.sin(t * 4.2 + ph)) * 0.03 * (moving ? 1 : 0.2);
      ox.rotation.z = Math.sin(t * 3.0 + ph) * 0.02 * (moving ? 1 : 0.2);
      for (const leg of ox.children) {
        if (leg.geometry && leg.geometry.type === 'BoxGeometry' && leg.position.y < 0.7) {
          leg.rotation.x = Math.sin(t * 6 + (leg.userData.phase || 0)) * 0.45 * (moving ? 1 : 0.12);
        }
      }
    }
  }
}

/* ----------------------------------------------------------------------------
   Weather particles: rain and snow, swapped on the fly.
   -------------------------------------------------------------------------- */
class Precipitation {
  constructor(count = 2600) {
    this.count = count;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count);
    for (let i = 0; i < this.count; i += 1) {
      this.positions[i * 3] = (Math.random() - 0.5) * 120;
      this.positions[i * 3 + 1] = Math.random() * 60;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * 120;
      this.velocities[i] = 12 + Math.random() * 16;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaaccee, size: 0.09, transparent: true, opacity: 0.7,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.mode = 'none';
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'none') { this.points.visible = false; return; }
    this.points.visible = true;
    if (mode === 'rain' || mode === 'storm') {
      this.points.material.color.setHex(0x9fc4e0);
      this.points.material.size = mode === 'storm' ? 0.13 : 0.09;
      this.points.material.opacity = mode === 'storm' ? 0.85 : 0.6;
    } else if (mode === 'snow') {
      this.points.material.color.setHex(0xffffff);
      this.points.material.size = 0.22;
      this.points.material.opacity = 0.92;
    }
  }

  update(dt) {
    if (!this.points.visible) return;
    const p = this.positions;
    const drift = this.mode === 'snow' ? 0.4 : 0.1;
    const fall = this.mode === 'snow' ? 0.45 : 1.0;
    const t = performance.now() / 1000;
    for (let i = 0; i < this.count; i += 1) {
      p[i * 3 + 1] -= this.velocities[i] * dt * fall;
      p[i * 3] += Math.sin(t * 1.5 + i) * drift * dt * 6;
      if (p[i * 3 + 1] < -2) {
        p[i * 3 + 1] = 58;
        p[i * 3] = (Math.random() - 0.5) * 120;
        p[i * 3 + 2] = (Math.random() - 0.5) * 120;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/* ----------------------------------------------------------------------------
   Dust kicked up by the wheels.
   -------------------------------------------------------------------------- */
class Dust {
  constructor(count = 260) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.count = count;
    for (let i = 0; i < count; i += 1) this.life[i] = 0;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xc4a878, size: 0.55, transparent: true, opacity: 0.4, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.cursor = 0;
  }

  emit(x, y, z, strength) {
    for (let k = 0; k < 3; k += 1) {
      const i = this.cursor = (this.cursor + 1) % this.count;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 2.4;
      this.pos[i * 3 + 1] = y + Math.random() * 0.3;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 1.2;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.6;
      this.vel[i * 3 + 1] = 0.4 + Math.random() * 0.7;
      this.vel[i * 3 + 2] = -strength * (0.4 + Math.random() * 0.5);
      this.life[i] = 1.4 + Math.random();
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i += 1) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] *= 0.98;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -999;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/* ----------------------------------------------------------------------------
   Landmark set pieces that the trail scrolls past.
   -------------------------------------------------------------------------- */
export class LandmarkProp {
  constructor(kind, noise) {
    this.group = new THREE.Group();
    this.kind = kind;
    switch (kind) {
      case 'fort': this.buildFort(); break;
      case 'river': this.buildRiver(noise); break;
      case 'landmark': this.buildMonument(noise); break;
      case 'pass': this.buildPass(noise); break;
      case 'town': this.buildTown(noise); break;
      case 'spring': this.buildSpring(noise); break;
      case 'desert': this.buildDesert(noise); break;
      default: this.buildMonument(noise);
    }
  }

  add(mesh) { mesh.castShadow = true; this.group.add(mesh); return mesh; }

  buildFort() {
    const wall = new THREE.MeshStandardMaterial({ color: 0x8a7455, roughness: 0.95 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 });
    for (let i = 0; i < 4; i += 1) {
      const b = this.add(new THREE.Mesh(new THREE.BoxGeometry(5, 3.4, 5), wall));
      b.position.set(-16 + (i % 2) * 9, 1.7, -20 + Math.floor(i / 2) * 10);
      const r = this.add(new THREE.Mesh(new THREE.ConeGeometry(4, 2.4, 4), roof));
      r.position.copy(b.position).setY(4.4);
      r.rotation.y = Math.PI / 4;
    }
    // Palisade stockade
    const post = new THREE.MeshStandardMaterial({ color: 0x6b563f, roughness: 0.95 });
    for (let i = 0; i < 26; i += 1) {
      const p = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 4.2, 5), post));
      const ang = (i / 26) * Math.PI * 2;
      p.position.set(Math.cos(ang) * 22, 2.1, -22 + Math.sin(ang) * 14);
    }
    // Flag
    const pole = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 9, 5), post));
    pole.position.set(0, 4.5, -22);
    const flag = this.add(new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8),
      new THREE.MeshStandardMaterial({ color: 0xb03030, side: THREE.DoubleSide, roughness: 0.9 })));
    flag.position.set(1.6, 8.2, -22);
    flag.userData.wave = true;
    this.flag = flag;
  }

  buildRiver(noise) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 34, 40, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f6c92, roughness: 0.18, metalness: 0.35, transparent: true, opacity: 0.88 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.12, -26);
    this.group.add(water);
    this.water = water;
    // Banks
    const bank = new THREE.MeshStandardMaterial({ color: 0x7a6446, roughness: 1 });
    for (const s of [-1, 1]) {
      const b = this.add(new THREE.Mesh(new THREE.BoxGeometry(200, 1.4, 12), bank));
      b.position.set(0, 0.5, -26 + s * 23);
    }
  }

  buildMonument(noise) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 1, flatShading: true });
    const height = 22 + noise.rand() * 18;
    for (let i = 0; i < 7; i += 1) {
      const r = this.add(new THREE.Mesh(new THREE.CylinderGeometry(2 + noise.rand() * 2.5, 3.5 + noise.rand() * 3, height / 3, 6), rockMat));
      r.position.set((noise.rand() - 0.5) * 12, (i + 0.5) * (height / 3) * 0.8, -30 + (noise.rand() - 0.5) * 10);
      r.rotation.y = noise.rand() * Math.PI;
      r.scale.setScalar(1 - i * 0.09);
    }
  }

  buildPass(noise) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f7069, roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i += 1) {
      const side = i % 2 ? -1 : 1;
      const m = this.add(new THREE.Mesh(new THREE.ConeGeometry(9 + noise.rand() * 9, 26 + noise.rand() * 26, 5), rockMat));
      m.position.set(side * (30 + noise.rand() * 40), m.geometry.parameters.height / 2 - 6, -60 - noise.rand() * 60);
      m.rotation.y = noise.rand() * Math.PI;
    }
    // Snow caps
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf0f6fa, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 10; i += 1) {
      const side = i % 2 ? -1 : 1;
      const cap = this.add(new THREE.Mesh(new THREE.ConeGeometry(6 + noise.rand() * 5, 11, 5), snowMat));
      cap.position.set(side * (34 + noise.rand() * 36), 26 + noise.rand() * 16, -70 - noise.rand() * 50);
    }
  }

  buildTown(noise) {
    const wall = new THREE.MeshStandardMaterial({ color: 0x9a8468, roughness: 0.95 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x6a4a38, roughness: 0.9 });
    for (let i = 0; i < 7; i += 1) {
      const w = 4 + noise.rand() * 4;
      const b = this.add(new THREE.Mesh(new THREE.BoxGeometry(w, 3 + noise.rand() * 2, 4 + noise.rand() * 3), wall));
      b.position.set(-18 + i * 6, 1.8, -30 - noise.rand() * 14);
      const r = this.add(new THREE.Mesh(new THREE.ConeGeometry(w * 0.8, 2.2, 4), roof));
      r.position.copy(b.position).setY(b.position.y + 2.6);
      r.rotation.y = Math.PI / 4;
    }
    // Steeple
    const steeple = this.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 9, 2.4), wall));
    steeple.position.set(6, 5.5, -36);
    const spire = this.add(new THREE.Mesh(new THREE.ConeGeometry(1.8, 4, 4), roof));
    spire.position.set(6, 12, -36);
    spire.rotation.y = Math.PI / 4;
  }

  buildSpring(noise) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(6, 24),
      new THREE.MeshStandardMaterial({ color: 0x3f7f7a, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.85 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.14, -22);
    this.group.add(pool);
    this.water = pool;
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x6f9440, roughness: 0.95 });
    for (let i = 0; i < 22; i += 1) {
      const t = this.add(new THREE.Mesh(new THREE.ConeGeometry(1.6 + noise.rand(), 4 + noise.rand() * 5, 5), grassMat));
      const ang = (i / 22) * Math.PI * 2;
      t.position.set(Math.cos(ang) * (9 + noise.rand() * 4), 2.2, -22 + Math.sin(ang) * (9 + noise.rand() * 4));
    }
  }

  buildDesert(noise) {
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xc9a970, roughness: 1, flatShading: true });
    for (let i = 0; i < 16; i += 1) {
      const d = this.add(new THREE.Mesh(new THREE.SphereGeometry(6 + noise.rand() * 10, 8, 6), sandMat));
      d.position.set((noise.rand() - 0.5) * 120, -3 + noise.rand() * 2, -20 - noise.rand() * 90);
      d.scale.set(1.6, 0.34, 1.0);
    }
    const cactus = new THREE.MeshStandardMaterial({ color: 0x5c7f42, roughness: 0.95 });
    for (let i = 0; i < 6; i += 1) {
      const c = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 5 + noise.rand() * 3, 6), cactus));
      c.position.set((noise.rand() - 0.5) * 50, 2.5, -25 - noise.rand() * 30);
    }
  }

  update(dt, t) {
    if (this.water) {
      const g = this.water.geometry;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i), y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 0.3 + t * 2) * 0.14 + Math.cos(y * 0.4 + t * 1.6) * 0.1);
      }
      pos.needsUpdate = true;
    }
    if (this.flag && this.flag.userData.wave) {
      this.flag.rotation.y = Math.sin(t * 2.4) * 0.25;
    }
  }
}

/* ============================================================================
   WORLD — owns the renderer, scene, camera, and the scroll simulation.
   ========================================================================== */
export class World {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    // Quality knobs, tunable at boot and by the adaptive governor below.
    this.shadowsOn = options.shadows !== false;
    this.shadowSize = options.shadowSize || 1536;
    this.maxDpr = options.maxDpr || 1.5;
    this.grassCount = options.grassCount || 1400;
    this.precipCount = options.precipCount || 1800;
    this.seed = 20261;
    this.noise = makeNoise(this.seed);
    this.time = 0;
    this.scroll = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.bandId = 'prairie';
    this.weatherMode = 'clear';
    this.reduceMotion = false;
    this.props = [];
    this.propCooldown = 0;
    this.landmarkQueue = [];
    this.initRenderer();
    this.initScene();
    this.initLights();
    this.initGround();
    this.initActors();
    this.precip = new Precipitation(this.precipCount);
    this.scene.add(this.precip.points);
    this.dust = new Dust();
    this.scene.add(this.dust.points);
    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr || 1.5));
    this.renderer.shadowMap.enabled = this.shadowsOn !== false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbcd0d8, 120, 620);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2200);
    // Low three-quarter view from the right rear, tight on the rig. The wagon
    // and its ox team run diagonally across the lower frame, which leaves the
    // upper centre clear for the title and keeps the team visible.
    this.camera.position.set(8.6, 3.4, 7.6);
    this.camera.lookAt(-1.4, 1.5, -6.0);

    this.sky = makeSky();
    this.scene.add(this.sky);
  }

  initLights() {
    this.hemi = new THREE.HemisphereLight(0xbcd8e8, 0x6b5a3a, 0.55);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d0, 1.25);
    this.sun.position.set(48, 70, 42);
    this.sun.castShadow = this.shadowsOn !== false;
    this.sun.shadow.mapSize.set(this.shadowSize || 1536, this.shadowSize || 1536);
    const d = 34;
    this.sun.shadow.camera.left = -d; this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d; this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 260;
    this.sun.shadow.bias = -0.0009;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.rim = new THREE.DirectionalLight(0x9fc4ff, 0.25);
    this.rim.position.set(-40, 30, -50);
    this.scene.add(this.rim);
  }

  initGround() {
    this.terrain = new Terrain(this.seed);
    this.groundMesh = this.terrain.build(this.bandId);
    this.scene.add(this.groundMesh);

    this.grass = makeGrassTufts(this.noise, this.bandId, this.grassCount);
    this.scene.add(this.grass);

    this.rangeFar = makeMountainRange(this.noise, this.bandId, 0.55, 900, 150, 30);
    this.scene.add(this.rangeFar);
    this.rangeNear = makeMountainRange(this.noise, this.bandId, 0.8, 620, 95, 24);
    this.scene.add(this.rangeNear);

    this.trees = makeTrees(this.noise, this.bandId, 90, { minX: 30, maxX: 115, scale: 1 });
    this.scene.add(this.trees);
    this.rocks = makeRocks(this.noise, this.bandId);
    this.scene.add(this.rocks);
  }

  initActors() {
    this.wagon = new Wagon();
    this.wagon.group.position.set(0, 0, 0);
    this.scene.add(this.wagon.group);

    this.oxen = new Oxen(6);
    this.scene.add(this.oxen.group);
  }

  /* Rebuild the world's look when the terrain band changes. */
  setBand(bandId) {
    if (bandId === this.bandId) return;
    this.bandId = bandId;
    this.scene.remove(this.groundMesh, this.grass, this.rangeFar, this.rangeNear, this.trees, this.rocks);
    disposeDeep(this.groundMesh); disposeDeep(this.grass);
    disposeDeep(this.rangeFar); disposeDeep(this.rangeNear);
    disposeDeep(this.trees); disposeDeep(this.rocks);

    this.groundMesh = this.terrain.build(bandId);
    this.scene.add(this.groundMesh);
    this.grass = makeGrassTufts(this.noise, bandId, this.grassCount);
    this.scene.add(this.grass);
    this.rangeFar = makeMountainRange(this.noise, bandId, 0.55, 900, 150, 30);
    this.scene.add(this.rangeFar);
    this.rangeNear = makeMountainRange(this.noise, bandId, 0.8, 620, 95, 24);
    this.scene.add(this.rangeNear);
    const dense = ['blues', 'gorge', 'rockies', 'divide'].includes(bandId);
    this.trees = makeTrees(this.noise, bandId, dense ? 130 : bandId === 'basin' ? 8 : 40, { minX: dense ? 24 : 45, maxX: 115, scale: dense ? 1.1 : 0.9 });
    this.scene.add(this.trees);
    this.rocks = makeRocks(this.noise, bandId, bandId === 'basin' ? 180 : 90);
    this.scene.add(this.rocks);
  }

  setWeather(mode) {
    const look = WEATHER_LOOK[mode] || WEATHER_LOOK.clear;
    this.weatherMode = mode;
    const band = PALETTE[this.bandId] || PALETTE.prairie;
    this.sky.material.uniforms.top.value.setHex(look.sky[0]);
    this.sky.material.uniforms.bottom.value.setHex(look.sky[1]);
    this.sky.material.uniforms.sunStrength.value = look.sun;
    this.sky.material.uniforms.sunColor.value.setHex(band.sun);
    this.scene.fog.color.setHex(look.sky[1]);
    this.scene.fog.near = 90;
    this.scene.fog.far = mode === 'fog' ? 260 : mode === 'storm' ? 380 : 620;
    this.sun.intensity = look.sun * 1.1;
    this.hemi.intensity = look.ambient;
    this.hemi.color.setHex(look.sky[1]);
    const precipMode = mode === 'rain' ? 'rain' : mode === 'storm' ? 'storm' : mode === 'snow' ? 'snow' : 'none';
    this.precip.setMode(precipMode);
  }

  setPaceFraction(f) {
    // 0 (halted) .. 1 (flat out)
    this.targetSpeed = Math.max(0, Math.min(1.6, f));
  }

  /* Add a landmark set piece at a given lateral/forward position. */
  spawnLandmark(kind) {
    const prop = new LandmarkProp(kind, this.noise);
    const side = this.noise.rand() < 0.5 ? -1 : 1;
    prop.group.position.set(side * 8, 0, -this.terrain.length * 0.42);
    prop.group.rotation.y = side > 0 ? -0.5 : 0.5;
    this.scene.add(prop.group);
    this.props.push({ prop, z: prop.group.position.z, kind });
    return prop;
  }

  update(dt, opts = {}) {
    this.time += dt;
    const { moving = true, health = 1, weather = this.weatherMode, bandId = this.bandId } = opts;

    if (bandId !== this.bandId) this.setBand(bandId);
    if (weather !== this.weatherMode) this.setWeather(weather);

    // Ease the scroll speed.
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 2.2);
    const scrollSpeed = moving ? this.speed : 0;

    // Scroll the world toward the camera (camera looks down -Z).
    const dz = scrollSpeed * dt * 26;
    this.scroll += dz;

    // Move all scrollable geometry and wrap it.
    this.scrollGround(dz);
    this.scrollProps(dz);
    this.scrollActors(dz, dt, moving, scrollSpeed, health);

    this.precip.update(dt);
    this.dust.update(dt);

    // Camera drift: subtle bob and a slow orbit for depth.
    if (!this.reduceMotion) {
      const bob = Math.sin(this.time * (moving ? 3.4 : 1.1)) * (moving ? 0.075 : 0.025) * Math.min(1, scrollSpeed);
      const sway = Math.cos(this.time * 1.7) * (moving ? 0.09 : 0.03);
      this.camera.position.set(8.6 + sway, 3.4 + bob, 7.6);
      this.camera.lookAt(-1.4, 1.5 + bob * 0.5, -6.0);
    }

    this.sky.position.copy(this.camera.position);
    // Keep the shadow frustum centred on the wagon.
    this.sun.target.position.set(0, 0, -8);
    this.sun.position.set(48, 70, 42 - 8);

    this.governQuality(dt);

    this.renderer.render(this.scene, this.camera);
  }

  scrollGround(dz) {
    const L = this.terrain.length;
    const g = this.groundMesh.position;
    g.z += dz;
    if (g.z > L / 2 + 40) { g.z -= L; this.needsWrapSculpt = true; }

    // Re-sculpting is the most expensive thing in the frame: it rewrites the
    // whole vertex buffer and recomputes normals. Do it sparingly, by distance
    // travelled, rather than every frame.
    // The ribbon translates as a rigid body, so the ground under the wagon
    // stays believable without re-evaluating noise every frame. Sculpting is
    // done only on the rare wrap, which keeps the per-frame cost to a matrix
    // update instead of a full vertex rewrite.
    if (this.needsWrapSculpt) { this.needsWrapSculpt = false; this.resculpt(g.z); }

    for (const m of [this.grass, this.trees, this.rocks, this.rangeFar, this.rangeNear]) {
      m.position.z += dz;
      if (m.position.z > 700) m.position.z -= 1400;
    }
  }

  /* Displace the ribbon so the ground under the wagon keeps its height. Only
     the rows near the camera matter; the rest is distant scenery. */
  resculpt(baseZ) {
    const geo = this.groundMesh.geometry;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const z = pos.getZ(i);
      if (z > 300 || z < -300) continue;
      pos.setY(i, this.terrain.heightAt(pos.getX(i), z + baseZ));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  scrollProps(dz) {
    const cutoff = 34;
    for (let i = this.props.length - 1; i >= 0; i -= 1) {
      const p = this.props[i];
      p.prop.group.position.z += dz;
      p.prop.update(this.dtLast || 0.016, this.time);
      if (p.prop.group.position.z > cutoff) {
        this.scene.remove(p.prop.group);
        disposeDeep(p.prop.group);
        this.props.splice(i, 1);
      }
    }
  }

  scrollActors(dz, dt, moving, scrollSpeed, health) {
    this.dtLast = dt;
    this.wagon.update(dt, moving ? scrollSpeed : 0);
    this.oxen.update(dt, scrollSpeed, moving);

    // The wagon stays near the origin; the ground moves instead. Wheel dust.
    if (moving && scrollSpeed > 0.15) {
      this.dust.emit((Math.random() - 0.5) * 2, 0.4, -2.4, scrollSpeed * 2);
    }

    // Tired teams sag; sick parties slump.
    const sag = 1 - (1 - health) * 0.12;
    this.oxen.group.scale.setScalar(sag);
  }

  /* Adaptive quality. Levels shed the most expensive effects first:
       0 = everything on
       1 = no precipitation particles
       2 = no shadow map
       3 = reduced draw resolution
     It only ever reduces, never oscillates back, which avoids visible flicker
     between tiers while the wagon is moving. */
  governQuality(dt) {
    this.qSamples = (this.qSamples || 0) + 1;
    this.qTime = (this.qTime || 0) + dt;
    if (this.qSamples < 45) return;
    const avg = this.qTime / this.qSamples;
    this.qSamples = 0;
    this.qTime = 0;
    if (avg < 1 / 34 || this.qLevel >= 3) return;

    this.qLevel += 1;
    if (this.qLevel === 1) {
      this.precip.points.visible = false;
      this.precipSuppressed = true;
    } else if (this.qLevel === 2) {
      this.renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
    } else {
      this.renderer.setPixelRatio(1);
      this.onResize();
    }
  }

  onResize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}

function disposeDeep(obj) {
  obj.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose?.();
    }
  });
}
