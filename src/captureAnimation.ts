
import * as THREE from "three";
import { createSpatialCard, createPinMarker } from "./spatialCard.js";

// ------------------------------------------------------------
// 4-state capture animation: Notice → Inspect → Explain → Commit
// ------------------------------------------------------------

type CaptureState = "idle" | "notice" | "inspect" | "explain" | "commit";

const ACCENT = 0x4fc3f7;
const NOTICE_DURATION = 0.8;
const INSPECT_DURATION = 1.7;
const EXPLAIN_DISPLAY = 6.0; // seconds to show the card before committing
const COMMIT_DURATION = 0.5;

export interface CapturePin {
  position: THREE.Vector3;
  analysisText: string;
  timestamp: number;
  marker: THREE.Mesh;
}

export class CaptureAnimator {
  private state: CaptureState = "idle";
  private elapsed = 0;
  private hitPoint = new THREE.Vector3();
  private hitNormal = new THREE.Vector3(0, 1, 0);

  // Scene references
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  // Effect objects
  private rings: THREE.Mesh[] = [];
  private scanLine: THREE.Mesh | null = null;
  private shimmerSphere: THREE.Mesh | null = null;
  private card: THREE.Mesh | null = null;
  private tether: THREE.Line | null = null;

  // LLM result
  private analysisText: string | null = null;
  private analysisPromise: Promise<string> | null = null;

  // Persistent pins
  readonly pins: CapturePin[] = [];

  // Raycaster for finding what user is looking at
  private raycaster = new THREE.Raycaster();
  private screenCenter = new THREE.Vector2(0, 0);

  // Collider meshes (cloned geometry for raycasting — the originals have raycast disabled)
  private colliderProxies: THREE.Mesh[] = [];

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
  }

  /** Register collider meshes for gaze raycasting. Call after collider loads. */
  setColliderMeshes(meshes: THREE.Mesh[]) {
    // Create proxy meshes that share the same geometry + world transforms
    // but have raycast enabled (the originals are disabled for locomotion)
    this.colliderProxies = meshes.map((m) => {
      const proxy = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial());
      proxy.visible = false;
      proxy.matrixAutoUpdate = false;
      return proxy;
    });
    // Store references to the originals so we can sync world matrices
    (this as any)._colliderOriginals = meshes;
  }

  get isActive(): boolean {
    return this.state !== "idle";
  }

  /** Start the 4-state animation sequence. */
  start() {
    if (this.state !== "idle") return;

    // Sync proxy matrices from originals
    const originals = (this as any)._colliderOriginals as THREE.Mesh[] | undefined;
    if (originals) {
      for (let i = 0; i < originals.length; i++) {
        originals[i].updateMatrixWorld(true);
        this.colliderProxies[i].matrix.copy(originals[i].matrixWorld);
        this.colliderProxies[i].matrixWorld.copy(originals[i].matrixWorld);
        // Need to enable raycast on proxy
        this.colliderProxies[i].geometry.computeBoundingBox();
        this.colliderProxies[i].geometry.computeBoundingSphere();
      }
    }

    // Raycast from camera center to find what user is looking at
    this.raycaster.setFromCamera(this.screenCenter, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.colliderProxies.length > 0 ? this.colliderProxies : [],
      false,
    );

    if (hits.length > 0) {
      this.hitPoint.copy(hits[0].point);
      if (hits[0].face) {
        this.hitNormal.copy(hits[0].face.normal);
      }
    } else {
      // Fallback: 3m in front of camera
      const dir = new THREE.Vector3(0, 0, -3);
      dir.applyMatrix4(this.camera.matrixWorld);
      this.hitPoint.copy(dir);
      this.hitNormal.set(0, 1, 0);
    }

    this.state = "notice";
    this.elapsed = 0;
    this.analysisText = null;
    this.analysisPromise = null;
    this.spawnRings();

    console.log("[CaptureAnim] Started — hit at", this.hitPoint.toArray().map(v => v.toFixed(2)));
  }

  /** Call every frame. */
  update(delta: number) {
    if (this.state === "idle") return;
    this.elapsed += delta;

    switch (this.state) {
      case "notice":
        this.updateNotice(delta);
        break;
      case "inspect":
        this.updateInspect(delta);
        break;
      case "explain":
        this.updateExplain(delta);
        break;
      case "commit":
        this.updateCommit(delta);
        break;
    }
  }

  // ---- NOTICE ----

  private spawnRings() {
    const ringCount = 3;
    for (let i = 0; i < ringCount; i++) {
      const geo = new THREE.TorusGeometry(0.01, 0.005, 8, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 1.0,
        depthTest: false,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.position.copy(this.hitPoint);
      ring.lookAt(this.camera.position);
      ring.renderOrder = 950;
      ring.raycast = () => {};
      ring.userData.delay = i * 0.15;
      ring.userData.spawned = false;
      ring.scale.setScalar(0.01);
      this.scene.add(ring);
      this.rings.push(ring);
    }
  }

  private updateNotice(delta: number) {
    for (const ring of this.rings) {
      const t = this.elapsed - ring.userData.delay;
      if (t < 0) continue;
      ring.userData.spawned = true;

      const progress = Math.min(t / 0.6, 1.0);
      const scale = THREE.MathUtils.lerp(0.1, 0.5, progress);
      ring.scale.setScalar(scale);
      (ring.material as THREE.MeshBasicMaterial).opacity = 1.0 - progress;
    }

    if (this.elapsed >= NOTICE_DURATION) {
      this.cleanupRings();
      this.state = "inspect";
      this.elapsed = 0;
      this.spawnScanLine();
      this.spawnShimmer();
    }
  }

  private cleanupRings() {
    for (const ring of this.rings) {
      this.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.rings = [];
  }

  // ---- INSPECT ----

  private spawnScanLine() {
    const geo = new THREE.PlaneGeometry(2, 0.004);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(ACCENT) },
        uOpacity: { value: 0.7 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float alpha = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          gl_FragColor = vec4(uColor, alpha * uOpacity);
        }
      `,
    });

    this.scanLine = new THREE.Mesh(geo, mat);
    this.scanLine.renderOrder = 9999;
    this.scanLine.frustumCulled = false;
    this.scanLine.raycast = () => {};
    this.scene.add(this.scanLine);
  }

  private spawnShimmer() {
    const geo = new THREE.SphereGeometry(0.4, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.06,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.shimmerSphere = new THREE.Mesh(geo, mat);
    this.shimmerSphere.position.copy(this.hitPoint);
    this.shimmerSphere.renderOrder = 940;
    this.shimmerSphere.raycast = () => {};
    this.scene.add(this.shimmerSphere);
  }

  private capturedThisInspect = false;

  private updateInspect(delta: number) {
    const progress = this.elapsed / INSPECT_DURATION;

    // Scan line moves from top to bottom
    if (this.scanLine) {
      const y = THREE.MathUtils.lerp(0.95, -0.95, progress);
      this.scanLine.position.y = y;
      const mat = this.scanLine.material as THREE.ShaderMaterial;
      mat.uniforms.uOpacity.value = 0.7 * (1.0 - Math.pow(progress, 3));
    }

    // Shimmer pulses
    if (this.shimmerSphere) {
      const pulse = 0.06 + 0.04 * Math.sin(this.elapsed * 8);
      (this.shimmerSphere.material as THREE.MeshBasicMaterial).opacity = pulse;
    }

    // Capture screenshot at midpoint
    if (!this.capturedThisInspect && progress >= 0.5) {
      this.capturedThisInspect = true;
      this.doSilentCapture();
    }

    if (this.elapsed >= INSPECT_DURATION) {
      this.cleanupInspect();
      this.state = "explain";
      this.elapsed = 0;
    }
  }

  private doSilentCapture() {
    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.renderer.domElement.toDataURL("image/png");

    console.log("[CaptureAnim] Screenshot captured, sending to LLM...");

    this.analysisPromise = fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    })
      .then((r) => r.json())
      .then((data) => {
        const text = data.analysis ?? data.error ?? "No response";
        this.analysisText = text;
        console.log("[CaptureAnim] Analysis received:", text.slice(0, 80) + "...");
        return text;
      })
      .catch((err) => {
        const msg = `Analysis failed: ${err.message}`;
        this.analysisText = msg;
        return msg;
      });
  }

  private cleanupInspect() {
    if (this.scanLine) {
      this.scene.remove(this.scanLine);
      this.scanLine.geometry.dispose();
      (this.scanLine.material as THREE.Material).dispose();
      this.scanLine = null;
    }
    if (this.shimmerSphere) {
      this.scene.remove(this.shimmerSphere);
      this.shimmerSphere.geometry.dispose();
      (this.shimmerSphere.material as THREE.Material).dispose();
      this.shimmerSphere = null;
    }
    this.capturedThisInspect = false;
  }

  // ---- EXPLAIN ----

  private updateExplain(delta: number) {
    // Wait for LLM response before showing card
    if (!this.analysisText) return;

    // Spawn card on first frame after text arrives
    if (!this.card) {
      this.spawnCard(this.analysisText);
    }

    // Card bloom animation (first 0.4s)
    if (this.card) {
      const bloomT = Math.min(this.elapsed / 0.4, 1.0);
      // Elastic ease-out
      const ease = bloomT === 1 ? 1 : 1 - Math.pow(2, -10 * bloomT) * Math.cos((bloomT * 10 - 0.75) * (2 * Math.PI / 3));
      this.card.scale.setScalar(ease);

      // Card always faces camera
      this.card.lookAt(this.camera.position);

      // Tether
      if (this.tether) {
        const positions = this.tether.geometry.getAttribute("position") as THREE.BufferAttribute;
        positions.setXYZ(0, this.hitPoint.x, this.hitPoint.y, this.hitPoint.z);
        positions.setXYZ(1, this.card.position.x, this.card.position.y, this.card.position.z);
        positions.needsUpdate = true;
      }
    }

    // Transition to commit after display time
    if (this.elapsed >= EXPLAIN_DISPLAY && this.card) {
      this.state = "commit";
      this.elapsed = 0;
    }
  }

  private spawnCard(text: string) {
    this.card = createSpatialCard(text);

    // Position card above and slightly toward camera from hit point
    const toCamera = new THREE.Vector3().subVectors(this.camera.position, this.hitPoint).normalize();
    this.card.position.copy(this.hitPoint)
      .addScaledVector(toCamera, 0.4)
      .add(new THREE.Vector3(0, 0.3, 0));

    this.card.scale.setScalar(0.01); // starts tiny, blooms up
    this.scene.add(this.card);

    // Tether line
    const tetherGeo = new THREE.BufferGeometry();
    tetherGeo.setAttribute("position", new THREE.Float32BufferAttribute([
      this.hitPoint.x, this.hitPoint.y, this.hitPoint.z,
      this.card.position.x, this.card.position.y, this.card.position.z,
    ], 3));
    const tetherMat = new THREE.LineBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.4,
      depthTest: false,
    });
    this.tether = new THREE.Line(tetherGeo, tetherMat);
    this.tether.renderOrder = 899;
    this.tether.raycast = () => {};
    this.scene.add(this.tether);
  }

  // ---- COMMIT ----

  private updateCommit(delta: number) {
    const progress = Math.min(this.elapsed / COMMIT_DURATION, 1.0);

    // Shrink card to pin size
    if (this.card) {
      const scale = THREE.MathUtils.lerp(1.0, 0.0, progress);
      this.card.scale.setScalar(scale);
    }

    // Fade tether
    if (this.tether) {
      (this.tether.material as THREE.LineBasicMaterial).opacity = 0.4 * (1 - progress);
    }

    if (progress >= 1.0) {
      // Clean up card and tether
      if (this.card) {
        this.scene.remove(this.card);
        this.card.geometry.dispose();
        (this.card.material as THREE.Material).dispose();
        this.card = null;
      }
      if (this.tether) {
        this.scene.remove(this.tether);
        this.tether.geometry.dispose();
        (this.tether.material as THREE.Material).dispose();
        this.tether = null;
      }

      // Leave a persistent pin
      const marker = createPinMarker();
      marker.position.copy(this.hitPoint);
      this.scene.add(marker);

      this.pins.push({
        position: this.hitPoint.clone(),
        analysisText: this.analysisText ?? "",
        timestamp: Date.now(),
        marker,
      });

      console.log("[CaptureAnim] Committed pin #" + this.pins.length);

      this.state = "idle";
      this.elapsed = 0;
    }
  }

  /** Clean up everything if we need to abort. */
  dispose() {
    this.cleanupRings();
    this.cleanupInspect();
    if (this.card) {
      this.scene.remove(this.card);
      this.card = null;
    }
    if (this.tether) {
      this.scene.remove(this.tether);
      this.tether = null;
    }
    this.state = "idle";
  }
}
