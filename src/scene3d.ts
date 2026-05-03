import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import type { VolumeBounds } from "./oracleWasm";
import type { WasmOracle } from "./oracleWasm";

export type Scene3DOptions = {
  container: HTMLElement;
  bounds: VolumeBounds;
  maxParticles: number;
  /** Speed scale for hue (same idea as main.ts `vMax`). */
  vMax: number;
  getOracle: () => WasmOracle | undefined;
  getDisplayTime: () => number;
};

/**
 * Three.js view for the 3D WASM box: PBR-ish room, translucent shell, grid floor,
 * instanced spheres, orbit camera. See `native/include/oracle/types.hpp` Particle layout
 * for WASM ↔ world-unit alignment (same numeric bounds as Canvas2D).
 */
export class Scene3D {
  private readonly container: HTMLElement;
  private readonly bounds: VolumeBounds;
  private readonly vMax: number;
  private readonly getOracle: () => WasmOracle | undefined;
  private readonly getDisplayTime: () => number;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private instanced: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private resizeObs?: ResizeObserver;

  private pmremTarget?: THREE.WebGLRenderTarget;
  private readonly edges: THREE.LineSegments;
  private readonly shell: THREE.Mesh;
  private readonly grid: THREE.GridHelper;
  private readonly boxGeo: THREE.BoxGeometry;

  constructor(opts: Scene3DOptions) {
    this.container = opts.container;
    this.bounds = opts.bounds;
    this.vMax = opts.vMax;
    this.getOracle = opts.getOracle;
    this.getDisplayTime = opts.getDisplayTime;

    const w = Math.max(1, opts.container.clientWidth);
    const h = Math.max(1, opts.container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    opts.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const bg = 0x030818;
    this.scene.background = new THREE.Color(bg);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 20000);
    const cx = 0.5 * (this.bounds.minX + this.bounds.maxX);
    const cy = 0.5 * (this.bounds.minY + this.bounds.maxY);
    const cz = 0.5 * (this.bounds.minZ + this.bounds.maxZ);
    const bw = this.bounds.maxX - this.bounds.minX;
    const bh = this.bounds.maxY - this.bounds.minY;
    const bz = this.bounds.maxZ - this.bounds.minZ;
    const span = Math.max(bw, bh, bz);
    this.camera.position.set(cx + span * 0.85, cy + span * 0.65, cz + span * 0.9);
    this.camera.lookAt(cx, cy, cz);

    this.scene.fog = new THREE.Fog(bg, span * 0.95, span * 4.2);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.035);
    this.scene.environment = envTarget.texture;
    this.pmremTarget = envTarget;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(cx, cy, cz);

    this.scene.add(new THREE.HemisphereLight(0x7a9fff, 0x080c18, 0.42));
    const dir = new THREE.DirectionalLight(0xfff4e8, 0.95);
    dir.position.set(cx + span * 1.1, cy + span * 1.35, cz + span * 0.85);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0x6ab0ff, 0.28);
    fill.position.set(cx - span, cy + span * 0.4, cz - span * 0.6);
    this.scene.add(fill);

    this.boxGeo = new THREE.BoxGeometry(bw, bh, bz);
    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.boxGeo),
      new THREE.LineBasicMaterial({
        color: 0x40e8ff,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.edges.position.set(cx, cy, cz);
    this.scene.add(this.edges);

    const shellMat = new THREE.MeshPhysicalMaterial({
      color: 0x3d6ea8,
      metalness: 0.06,
      roughness: 0.38,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.0,
    });
    this.shell = new THREE.Mesh(this.boxGeo, shellMat);
    this.shell.position.set(cx, cy, cz);
    this.scene.add(this.shell);

    const gridSize = Math.max(bw, bz) * 1.02;
    this.grid = new THREE.GridHelper(gridSize, 14, 0x2ae8ff, 0x0c1c38);
    this.grid.position.set(cx, this.bounds.minY + 0.04, cz);
    this.scene.add(this.grid);

    const sphereGeo = new THREE.SphereGeometry(1, 32, 24);
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 0.22,
      roughness: 0.26,
      clearcoat: 0.45,
      clearcoatRoughness: 0.35,
      envMapIntensity: 1.2,
      emissive: new THREE.Color(0x061828),
      emissiveIntensity: 0.4,
    });
    this.instanced = new THREE.InstancedMesh(sphereGeo, mat, opts.maxParticles);
    this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanced.count = 0;
    this.instanced.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(opts.maxParticles * 3),
      3,
    );
    this.instanced.frustumCulled = false;
    this.scene.add(this.instanced);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(opts.container);
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Call each animation frame while 3D mode is active. */
  frame(): void {
    const o = this.getOracle();
    const displayTime = this.getDisplayTime();
    if (!o) {
      return;
    }
    const n = o.particleCount;
    const vm = Math.max(1e-9, this.vMax);
    for (let i = 0; i < n; i++) {
      const p = o.posAt(i, displayTime);
      const r = o.radiusAt(i);
      const { vx, vy, vz } = o.velocityAt(i, displayTime);
      const speed = Math.hypot(vx, vy, vz);
      const t = Math.min(1, speed / vm);
      const hue = (240 - t * 240) / 360;
      this.color.setHSL(hue, 0.93, 0.5 + t * 0.06);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(r);
      this.dummy.updateMatrix();
      this.instanced.setMatrixAt(i, this.dummy.matrix);
      this.instanced.setColorAt(i, this.color);
    }
    this.instanced.count = n;
    this.instanced.instanceMatrix.needsUpdate = true;
    if (this.instanced.instanceColor) {
      this.instanced.instanceColor.needsUpdate = true;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObs?.disconnect();
    this.resizeObs = undefined;
    this.controls.dispose();

    this.scene.environment = null;
    this.pmremTarget?.dispose();
    this.pmremTarget = undefined;

    this.edges.geometry.dispose();
    (this.edges.material as THREE.Material).dispose();
    this.shell.geometry.dispose();
    (this.shell.material as THREE.Material).dispose();
    this.grid.geometry.dispose();
    const gm = this.grid.material;
    if (Array.isArray(gm)) {
      for (const m of gm) {
        m.dispose();
      }
    } else {
      gm.dispose();
    }

    this.instanced.geometry.dispose();
    (this.instanced.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
