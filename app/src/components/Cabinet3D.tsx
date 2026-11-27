"use client";
// Real-time 3D cabinet (three.js). World mapping is 1:1 with on-chain grid units:
// world x = (x - 500) / 100, world z = (500 - z) / 100, capsule radius = radius / 100.
// FRONT camera looks along -z (left/right = x); SIDE camera looks along -x (left/right = z).
// Two fixed aiming cameras: players switch views to judge depth, as on-chain aim needs.
// ORBIT is a third, spectator-only camera that circles the cabinet while someone else plays.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Cabinet } from "@/lib/chain";
import { MINT_KEYS, MINT_DECIMALS } from "@/lib/chain";
import { CHUTE_X, CHUTE_Z, CHUTE_KEEP_OUT, GRID } from "@/lib/math";
import CabinetCanvas, { type Anim, type View } from "./CabinetCanvas";

const U = 100;
const wx = (x: number) => (x - GRID / 2) / U;
const wz = (z: number) => (GRID / 2 - z) / U;
const CAMS: Record<Exclude<View, "orbit">, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
  front: { pos: new THREE.Vector3(0, 10.4, 9.9), look: new THREE.Vector3(0, 0.5, -0.5) },
  side: { pos: new THREE.Vector3(9.9, 10.4, 0), look: new THREE.Vector3(-0.5, 0.5, 0) },
};
const REST_Y = 3.9, DROP_Y = 1.45, CEIL = 8.5;

type Entry = { g: THREE.Group; target: THREE.Vector3; key: string; dying?: number; born: number };

function makeMats() {
  const phys = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
  return {
    chrome: phys({ color: "#eef2ff", metalness: 1, roughness: 0.12, clearcoat: 1, envMapIntensity: 1.6 }),
    // Plush prize (AI-generated art, one per prize mint) standing on the floor as a camera-facing sprite.
    plush: ["p_coin", "p_gem", "p_koi", "p_robo", "p_mystery"].map((n) => {
      const t = new THREE.TextureLoader().load(`/art/${n}.webp`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return new THREE.SpriteMaterial({ map: t, alphaTest: 0.35 });
    }),
    shadow: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    goldBand: phys({ color: "#ffd84a", metalness: 1, roughness: 0.18, emissive: "#ff9d00", emissiveIntensity: 0.25 }),
    gold: phys({ color: "#ffcf3a", metalness: 1, roughness: 0.16, clearcoat: 0.6 }),
    slime: phys({ color: "#a6ff2e", emissive: "#7dff10", emissiveIntensity: 1.2, roughness: 0.2 }),
  };
}
type Mats = ReturnType<typeof makeMats>;

const GEO = {
  band: new THREE.TorusGeometry(1, 0.06, 10, 48),
};

export const PLUSH_H = 3.6; // plush height in capsule radii (labels and the held prize use it)
export const MYSTERY_H = 2.6; // sealed mystery capsule art height in radii

// Soft round contact shadow under each plush.
function blobTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, "rgba(0,0,0,0.6)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// A plush prize stands directly on the floor (no shell); rare prizes get a gold ring.
function buildPlush(kind: number, mintIdx: number, r: number, M: Mats) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const inner = new THREE.Group();
  const mystery = kind === 2;
  const sp = new THREE.Sprite(M.plush[mystery ? 4 : mintIdx]);
  sp.center.set(0.5, 0);
  sp.scale.setScalar(mystery ? MYSTERY_H : PLUSH_H);
  inner.add(sp);
  const sh = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), M.shadow);
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.01;
  body.add(sh, inner);
  if (kind !== 0) { const ring = new THREE.Mesh(GEO.band, mystery ? M.slime : M.goldBand); ring.rotation.x = Math.PI / 2; ring.scale.setScalar(1.1); ring.position.y = 0.05; body.add(ring); }
  body.scale.setScalar(r);
  g.add(body);
  g.userData = { body, inner, mystery };
  return g;
}

// Every prize is a sprite on the floor; a mystery prize shows only its sealed capsule art.
const buildCapsule = buildPlush;

function buildClaw(M: Mats) {
  const claw = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.42, 24), M.gold);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 12), M.gold);
  cap.position.y = 0.24;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 10, 32), M.goldBand);
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.2;
  hub.castShadow = true;
  claw.add(hub, cap, ring);
  const prongs: THREE.Group[] = [];
  const arm = new THREE.BoxGeometry(0.1, 0.78, 0.1), tip = new THREE.BoxGeometry(0.09, 0.5, 0.09);
  for (let i = 0; i < 3; i++) {
    const yaw = new THREE.Group(); yaw.rotation.y = (i * Math.PI * 2) / 3;
    const hinge = new THREE.Group(); hinge.position.set(0, -0.2, 0.3);
    const a = new THREE.Mesh(arm, M.chrome); a.position.y = -0.39; a.castShadow = true;
    const knuckle = new THREE.Group(); knuckle.position.y = -0.78; knuckle.rotation.x = 0.95;
    const t = new THREE.Mesh(tip, M.chrome); t.position.y = -0.25; t.castShadow = true;
    knuckle.add(t); hinge.add(a, knuckle); yaw.add(hinge); claw.add(yaw);
    prongs.push(hinge);
  }
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 8), new THREE.MeshStandardMaterial({ color: "#e8e2ff", metalness: 0.8, roughness: 0.3 }));
  return { claw, prongs, cable };
}

// Arcade cabinet interior: glossy dark-plum panels, gold pinstripes, a marquee bulb row and a soft sheen.
function panelTexture() {
  const W = 1024, H = 1024;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#160530"); bg.addColorStop(0.55, "#2a0b52"); bg.addColorStop(1, "#3b1170");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const n = 5, pw = W / n;
  for (let i = 0; i < n; i++) {
    const x = i * pw;
    const p = g.createLinearGradient(x, 0, x + pw, 0); // each panel: lit left edge, dark right edge
    p.addColorStop(0, "rgba(255,255,255,0.10)"); p.addColorStop(0.15, "rgba(255,255,255,0.02)"); p.addColorStop(0.85, "rgba(0,0,0,0.10)"); p.addColorStop(1, "rgba(0,0,0,0.28)");
    g.fillStyle = p; g.fillRect(x + 6, 90, pw - 12, H - 130);
    g.fillStyle = "#e9b93a"; g.fillRect(x - 2, 70, 4, H - 70); // gold pinstripe
  }
  g.fillStyle = "#e9b93a"; g.fillRect(0, 66, W, 6); g.fillRect(0, H - 30, W, 6);
  for (let i = 0; i < 24; i++) { // marquee bulbs along the top
    const x = (i + 0.5) * (W / 24);
    const b = g.createRadialGradient(x, 34, 1, x, 34, 18);
    b.addColorStop(0, "#fffbe6"); b.addColorStop(0.35, i % 2 ? "#ff5fc8" : "#ffd84a"); b.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = b; g.beginPath(); g.arc(x, 34, 18, 0, Math.PI * 2); g.fill();
  }
  const sh = g.createLinearGradient(0, 0, W, H); // diagonal glass sheen
  sh.addColorStop(0.25, "rgba(255,255,255,0)"); sh.addColorStop(0.35, "rgba(255,255,255,0.07)"); sh.addColorStop(0.45, "rgba(255,255,255,0)");
  g.fillStyle = sh; g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export default function Cabinet3D(props: { cabinet: Cabinet | null; claw: { x: number; z: number }; view: View; anim: Anim; reduced: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const st = useRef(props);
  st.current = props;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current!, ov = overlay.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = "block h-full w-full";
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#14041f");
    scene.fog = new THREE.Fog("#14041f", 18, 30);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    const cam = new THREE.PerspectiveCamera(52, 1, 0.1, 60);
    const v0 = CAMS[st.current.view === "orbit" ? "front" : st.current.view];
    cam.position.copy(v0.pos);
    const look = v0.look.clone();
    cam.lookAt(look);

    // Lights: soft fill, a hard top spot for shadows, magenta + cyan rim, lime glow over the chute
    scene.add(new THREE.HemisphereLight("#c9b2ff", "#1a0630", 1.1));
    const spot = new THREE.SpotLight("#fff4dc", 85, 30, 0.8, 0.7, 1.6);
    spot.position.set(0, 11, 2.5); spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004;
    scene.add(spot, spot.target);
    const pink = new THREE.PointLight("#ff2fb2", 22, 14, 1.8); pink.position.set(-4.5, 4.5, -4.5); scene.add(pink);
    const cyan = new THREE.PointLight("#3df5ff", 16, 14, 1.8); cyan.position.set(4.5, 4.5, 4.5); scene.add(cyan);

    const M = makeMats();
    // Floor: glossy plum with the 10x10 aim grid (one cell = 100 grid units)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 10.6), new THREE.MeshPhysicalMaterial({ color: "#2a0c4a", roughness: 0.5, metalness: 0.1, clearcoat: 0.15, clearcoatRoughness: 0.4 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(10, 10, "#a6ff2e", "#a6ff2e");
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.16;
    grid.position.y = 0.006; scene.add(grid);
    // Glossy arcade panels on both far walls (seen from front and from side), gold trim
    const wallMat = new THREE.MeshPhysicalMaterial({ map: panelTexture(), roughness: 0.35, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.15 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 9), wallMat); back.position.set(0, 4.5, -5.3); scene.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 9), wallMat); left.rotation.y = Math.PI / 2; left.position.set(-5.3, 4.5, 0); scene.add(left);
    const trim = new THREE.BoxGeometry(10.8, 0.16, 0.16);
    for (const [x, z, ry] of [[0, -5.3, 0], [-5.3, 0, Math.PI / 2], [0, 5.3, 0], [5.3, 0, Math.PI / 2]] as const) {
      const t = new THREE.Mesh(trim, M.gold); t.position.set(x, 0.08, z); t.rotation.y = ry; scene.add(t);
    }
    // Neon strips along the top of the far walls
    const neonMat = new THREE.MeshStandardMaterial({ color: "#ff2fb2", emissive: "#ff2fb2", emissiveIntensity: 2.2 });
    const n1 = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.08, 0.08), neonMat); n1.position.set(0, 0.35, -5.25); scene.add(n1);
    const n2 = n1.clone(); n2.rotation.y = Math.PI / 2; n2.position.set(-5.25, 0.35, 0); scene.add(n2);

    // Prize chute: a dark pit with a pulsing slime ring, sized by CHUTE_KEEP_OUT
    const cr = CHUTE_KEEP_OUT / U;
    const chute = new THREE.Group(); chute.position.set(wx(CHUTE_X), 0, wz(CHUTE_Z));
    const pit = new THREE.Mesh(new THREE.CircleGeometry(cr * 0.92, 40), new THREE.MeshBasicMaterial({ color: "#05010a" }));
    pit.rotation.x = -Math.PI / 2; pit.position.y = 0.012;
    const ringMat = new THREE.MeshStandardMaterial({ color: "#a6ff2e", emissive: "#7dff10", emissiveIntensity: 1.6 });
    const cring = new THREE.Mesh(new THREE.TorusGeometry(cr, 0.09, 12, 48), ringMat); cring.rotation.x = Math.PI / 2; cring.position.y = 0.06;
    const glow = new THREE.PointLight("#a6ff2e", 8, 4, 2); glow.position.y = 0.8;
    chute.add(pit, cring, glow); scene.add(chute);

    // Claw, cable, aim ring + guide beam
    const { claw, prongs, cable } = buildClaw(M);
    scene.add(claw, cable);
    const aim = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 40), new THREE.MeshBasicMaterial({ color: "#3df5ff", transparent: true, opacity: 0.9, depthWrite: false }));
    aim.rotation.x = -Math.PI / 2; aim.position.y = 0.02; scene.add(aim);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), new THREE.MeshBasicMaterial({ color: "#3df5ff", transparent: true, opacity: 0.35, depthWrite: false }));
    scene.add(beam);

    const entries = new Map<number, Entry>();
    const labels = new Map<number, HTMLDivElement>();
    let held: { key: string; g: THREE.Group } | null = null;
    const chuteLabel = document.createElement("div");
    chuteLabel.className = "cab3d-chute";
    chuteLabel.textContent = "PRIZE";
    ov.appendChild(chuteLabel);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    const v = new THREE.Vector3();
    const orbitPos = new THREE.Vector3(), orbitLook = new THREE.Vector3(0, 0.6, 0);
    const toScreen = (p: THREE.Vector3) => { v.copy(p).project(cam); return { x: (v.x + 1) / 2 * el.clientWidth, y: (1 - v.y) / 2 * el.clientHeight }; };

    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const { cabinet, claw: cp, view, anim, reduced } = st.current;
      const ease = reduced ? 1 : 1 - Math.exp(-dt * 7);

      // Camera glides between the fixed views; orbit circles slowly (a fixed 3/4 angle under reduced motion)
      const orbitA = reduced ? Math.PI / 4 : now / 9000;
      const c = view === "orbit"
        ? { pos: orbitPos.set(Math.sin(orbitA) * 11.5, 9.2, Math.cos(orbitA) * 11.5), look: orbitLook }
        : CAMS[view];
      cam.position.lerp(c.pos, reduced ? 1 : 1 - Math.exp(-dt * 5));
      look.lerp(c.look, reduced ? 1 : 1 - Math.exp(-dt * 5));
      cam.lookAt(look);

      // Sync capsules with on-chain state; positions tween so slips visibly slide toward the chute
      const live = new Set<number>();
      cabinet?.capsules.forEach((cap, i) => {
        if (!cap.active) return;
        live.add(i);
        const key = `${cap.id}:${cap.kind}:${cap.mintIdx}:${cap.radius}`;
        let e = entries.get(i);
        if (e && e.key !== key) { scene.remove(e.g); entries.delete(i); e = undefined; }
        if (!e) {
          const g = buildCapsule(cap.kind, cap.mintIdx, cap.radius / U, M);
          g.position.set(wx(cap.x), 0, wz(cap.z));
          g.scale.setScalar(reduced ? 1 : 0.01);
          scene.add(g);
          e = { g, target: new THREE.Vector3(), key, born: now };
          entries.set(i, e);
        }
        e.dying = undefined;
        e.target.set(wx(cap.x), 0, wz(cap.z));
      });
      for (const [i, e] of entries) {
        if (!live.has(i) && e.dying === undefined) e.dying = now;
        if (e.dying !== undefined) {
          const k = Math.max(0, 1 - (now - e.dying) / 350);
          e.g.scale.setScalar(k);
          if (k === 0) { scene.remove(e.g); entries.delete(i); labels.get(i)?.remove(); labels.delete(i); }
          continue;
        }
        e.g.position.lerp(e.target, ease);
        e.g.scale.setScalar(Math.min(1, e.g.scale.x + (reduced ? 1 : dt * 3)));
        const { inner, mystery } = e.g.userData as { inner: THREE.Group; mystery: boolean };
        if (!reduced) {
          // Plush sprites wobble like a toy settling; 3D contents (mystery orb) spin.
          if (inner.children[0] instanceof THREE.Sprite) { (inner.children[0].material as THREE.SpriteMaterial).rotation = Math.sin(now / 900 + i) * 0.08; inner.scale.y = 1 + Math.sin(now / 700 + i * 1.7) * 0.025; }
          else inner.rotation.y += dt * 0.9;
          if (mystery) inner.position.y = Math.abs(Math.sin(now / 380 + i)) * 0.08;
        }
      }
      ringMat.emissiveIntensity = reduced ? 1.6 : 1.4 + 0.6 * Math.sin(now / 350);

      // Claw: same timing as the 2D renderer (drop 0.9 s, hold, lift 0.9 s)
      const t = (now - anim.t0) / 1000;
      let drop = 0;
      if (anim.phase === "drop") drop = Math.min(1, t / 0.9);
      if (anim.phase === "hold") drop = 1;
      if (anim.phase === "lift") drop = Math.max(0, 1 - t / 0.9);
      const dropE = drop * drop * (3 - 2 * drop);
      const cx = wx(cp.x), cz = wz(cp.z);
      claw.position.lerp(new THREE.Vector3(cx, REST_Y + (DROP_Y - REST_Y) * dropE, cz), anim.phase === "idle" ? ease : 1);
      claw.position.y = REST_Y + (DROP_Y - REST_Y) * dropE;
      const sway = reduced || anim.phase !== "idle" ? 0 : Math.sin(now / 520) * 0.05;
      claw.rotation.z = sway; claw.rotation.x = sway * 0.6;
      const closed = anim.phase === "hold" || anim.phase === "lift" ? 1 : anim.phase === "drop" ? Math.max(0, (t - 0.75) / 0.15) : 0;
      const open = -0.62 + 0.62 * Math.min(1, closed) + (anim.phase === "lift" && anim.outcome === 1 ? -0.12 : 0);
      for (const p of prongs) p.rotation.x = open;
      const len = CEIL - claw.position.y - 0.3;
      cable.scale.y = len; cable.position.set(claw.position.x, claw.position.y + 0.3 + len / 2, claw.position.z);
      aim.position.x = claw.position.x; aim.position.z = claw.position.z;
      (aim.material as THREE.MeshBasicMaterial).opacity = reduced ? 0.9 : 0.65 + 0.3 * Math.sin(now / 200);
      beam.scale.y = Math.max(0.01, claw.position.y - 1.0);
      beam.position.set(claw.position.x, beam.scale.y / 2, claw.position.z);
      beam.visible = anim.phase === "idle";

      // A HELD capsule rides up in the claw (built from the same on-chain capsule record)
      const hi = anim.phase === "lift" && anim.outcome === 1 ? anim.capsuleIdx : undefined;
      const hc = hi !== undefined ? cabinet?.capsules[hi] : undefined;
      if (hc) {
        const key = `${anim.t0}:${hi}`;
        if (!held || held.key !== key) {
          if (held) scene.remove(held.g);
          held = { key, g: buildCapsule(hc.kind, hc.mintIdx, hc.radius / U, M) };
          scene.add(held.g);
        }
        const r = hc.radius / U;
        held.g.position.set(claw.position.x, claw.position.y - (0.7 + (hc.kind === 2 ? MYSTERY_H : PLUSH_H) * r * 0.8), claw.position.z);
      } else if (held) { scene.remove(held.g); held = null; }

      renderer.render(scene, cam);

      // DOM labels: amount + token (mystery shows only "?"), nudged so they never overlap
      const W = el.clientWidth;
      const items: { i: number; x: number; y: number; d: number }[] = [];
      for (const [i, e] of entries) {
        if (e.dying !== undefined || !cabinet) continue;
        const r = cabinet.capsules[i].radius / U;
        const s = toScreen(new THREE.Vector3(e.g.position.x, (cabinet.capsules[i].kind === 2 ? MYSTERY_H : PLUSH_H) * r + 0.08, e.g.position.z));
        items.push({ i, x: s.x, y: s.y, d: cam.position.distanceTo(e.g.position) });
      }
      items.sort((a, b) => b.y - a.y);
      const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
      for (const it of items) {
        const cap = cabinet!.capsules[it.i];
        let lab = labels.get(it.i);
        const text = cap.kind === 2 ? "?" : `${cap.kind === 1 ? "★ " : ""}${Number(cap.amount) / 10 ** MINT_DECIMALS[cap.mintIdx]} ${MINT_KEYS[cap.mintIdx]}`;
        if (!lab) { lab = document.createElement("div"); ov.appendChild(lab); labels.set(it.i, lab); }
        const cls = `cab3d-label${cap.kind === 2 ? " mystery" : ""}`;
        const html = `${text}${cap.slipCount > 0 ? `<b>${cap.slipCount}</b>` : ""}`;
        if (lab.className !== cls) lab.className = cls;
        if (lab.innerHTML !== html) lab.innerHTML = html;
        const w = lab.offsetWidth, h = lab.offsetHeight;
        let y = it.y - h;
        for (let k = 0; k < 5; k++) {
          const hit = placed.some((q) => it.x - w / 2 < q.x1 && it.x + w / 2 > q.x0 && y < q.y1 && y + h > q.y0);
          if (!hit) break; y -= h * 0.9;
        }
        const x = Math.max(2, Math.min(W - w - 2, it.x - w / 2));
        placed.push({ x0: x, x1: x + w, y0: y, y1: y + h });
        lab.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        lab.style.zIndex = String(1000 - Math.round(it.d * 10));
      }
      const cs = toScreen(new THREE.Vector3(chute.position.x, 0, chute.position.z + cr + 0.2));
      chuteLabel.style.transform = `translate(${(cs.x - chuteLabel.offsetWidth / 2).toFixed(1)}px, ${cs.y.toFixed(1)}px)`;
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      ov.replaceChildren();
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      pmrem.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  if (failed) return <CabinetCanvas {...props} view={props.view === "orbit" ? "front" : props.view} />;
  const { cabinet, view } = props;
  return (
    <div ref={host} className="relative h-full w-full" role="img" aria-label={`Claw cabinet, ${view} view, ${cabinet?.capsules.filter((c) => c.active).length ?? 0} capsules`}>
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
      <div className="pointer-events-none absolute inset-x-2 bottom-1.5 flex items-center justify-between font-display text-[11px] text-white/80 text-outline" aria-hidden>
        <span>{view === "front" ? "FRONT VIEW · LEFT ↔ RIGHT" : view === "side" ? "SIDE VIEW · NEAR ↔ FAR" : "ORBIT VIEW · SPECTATING"}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--magenta)]" /> = SLIPS</span>
      </div>
    </div>
  );
}
