
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildNavGraph } from "./navGraph.js";
import { createNavGraphOverlay } from "./navGraphDebug.js";
import {
  EnvironmentType,
  Interactable,
  LocomotionEnvironment,
  Mesh,
  MeshBasicMaterial,
  PanelUI,
  PlaneGeometry,
  ScreenSpace,
  SessionMode,
  VisibilityState,
  World,
} from "@iwsdk/core";
import { PanelSystem } from "./uiPanel.js";
import { GaussianSplatLoader, GaussianSplatLoaderSystem,} from "./gaussianSplatLoader.js";
import { spawnHologramSphere } from "./interactableExample.js";
import { Companion, CompanionSystem, createCompanionMesh, DistanceGrabbable, MovementMode } from "./companion.js";
import { CaptureWidget, CaptureWidgetSystem, createCaptureWidgetMesh } from "./captureWidget.js";
import { CaptureAnimator } from "./captureAnimation.js";


type BoundsLike = {
  center: THREE.Vector3;
  size: THREE.Vector3;
  min: THREE.Vector3;
  max: THREE.Vector3;
};

type SplatMeshLike = THREE.Object3D & {
  isInitialized?: boolean;
  initialized?: boolean;
  getBoundingBox?: (centersOnly?: boolean) => THREE.Box3;
};

function boxToBounds(box: THREE.Box3): BoundsLike | null {
  if (box.isEmpty()) return null;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  if (size.lengthSq() <= 1e-8) return null;
  return {
    center,
    size,
    min: box.min.clone(),
    max: box.max.clone(),
  };
}

function getWorldBounds(object: THREE.Object3D): BoundsLike | null {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  return boxToBounds(box);
}

function getSplatWorldBounds(host: THREE.Object3D): BoundsLike | null {
  let candidate: SplatMeshLike | null = null;
  host.traverse((child) => {
    const maybeSplat = child as SplatMeshLike;
    if (
      candidate === null &&
      typeof maybeSplat.getBoundingBox === "function" &&
      maybeSplat.isInitialized === true
    ) {
      candidate = maybeSplat;
    }
  });
  if (!candidate || !candidate.getBoundingBox) return null;
  candidate.updateMatrixWorld(true);
  let local: THREE.Box3;
  try {
    local = candidate.getBoundingBox(true);
  } catch {
    return null;
  }
  const world = local.clone().applyMatrix4(candidate.matrixWorld);
  return boxToBounds(world);
}

function computeUniformScaleFromBounds(
  fromSize: THREE.Vector3,
  toSize: THREE.Vector3,
): number {
  const sx = toSize.x / fromSize.x;
  const sz = toSize.z / fromSize.z;
  const sy = toSize.y / fromSize.y;

  // Prefer horizontal footprint (x/z) for room-scale alignment, with y as fallback.
  const candidates = [sx, sz, sy].filter((v) => Number.isFinite(v) && v > 0);
  if (candidates.length === 0) return 1.0;
  if (Number.isFinite(sx) && sx > 0 && Number.isFinite(sz) && sz > 0) {
    return (sx + sz) * 0.5;
  }
  return candidates.reduce((acc, v) => acc + v, 0) / candidates.length;
}

async function waitForRenderableBounds(
  object: THREE.Object3D,
  timeoutMs = 20_000,
): Promise<BoundsLike> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const bounds = getSplatWorldBounds(object);
    if (bounds) return bounds;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`[Align] Timed out after ${timeoutMs}ms waiting for bounds.`);
}

function autoAlignColliderToSplat(
  colliderRoot: THREE.Object3D,
  splatRoot: THREE.Object3D,
): void {
  const splatBounds = getSplatWorldBounds(splatRoot) ?? getWorldBounds(splatRoot);
  const colliderBoundsBefore = getWorldBounds(colliderRoot);
  if (!splatBounds || !colliderBoundsBefore) {
    console.warn("[Align] Missing bounds for auto-alignment.");
    return;
  }

  const targetAspect = splatBounds.size.x / Math.max(splatBounds.size.z, 1e-6);
  const yawCandidates = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
  const baseYaw = colliderRoot.rotation.y;
  let bestYaw = baseYaw;
  let bestAspectError = Infinity;

  for (const yawOffset of yawCandidates) {
    colliderRoot.rotation.y = baseYaw + yawOffset;
    colliderRoot.updateMatrixWorld(true);
    const bounds = getWorldBounds(colliderRoot);
    if (!bounds) continue;
    const aspect = bounds.size.x / Math.max(bounds.size.z, 1e-6);
    const error = Math.abs(Math.log(Math.max(aspect, 1e-6) / Math.max(targetAspect, 1e-6)));
    if (error < bestAspectError) {
      bestAspectError = error;
      bestYaw = colliderRoot.rotation.y;
    }
  }
  colliderRoot.rotation.y = bestYaw;
  colliderRoot.updateMatrixWorld(true);

  const scale = computeUniformScaleFromBounds(
    getWorldBounds(colliderRoot)?.size ?? colliderBoundsBefore.size,
    splatBounds.size,
  );
  const clampedScale = THREE.MathUtils.clamp(scale, 0.1, 10.0);
  colliderRoot.scale.setScalar(clampedScale);
  colliderRoot.updateMatrixWorld(true);

  const colliderBoundsAfterScale = getWorldBounds(colliderRoot);
  if (!colliderBoundsAfterScale) {
    console.warn("[Align] Collider bounds unavailable after scaling.");
    return;
  }

  // Align horizontal center and floor height.
  const dx = splatBounds.center.x - colliderBoundsAfterScale.center.x;
  const dz = splatBounds.center.z - colliderBoundsAfterScale.center.z;
  const dy = splatBounds.min.y - colliderBoundsAfterScale.min.y;
  colliderRoot.position.add(new THREE.Vector3(dx, dy, dz));
  colliderRoot.updateMatrixWorld(true);

  const colliderBoundsFinal = getWorldBounds(colliderRoot);
  if (colliderBoundsFinal) {
      console.log("[Align] Auto-aligned collider to splat", {
      appliedScale: clampedScale.toFixed(4),
      appliedYawDeg: THREE.MathUtils.radToDeg(bestYaw).toFixed(1),
      appliedTranslation: {
        x: dx.toFixed(3),
        y: dy.toFixed(3),
        z: dz.toFixed(3),
      },
      splatSize: {
        x: splatBounds.size.x.toFixed(3),
        y: splatBounds.size.y.toFixed(3),
        z: splatBounds.size.z.toFixed(3),
      },
      colliderSizeBefore: {
        x: colliderBoundsBefore.size.x.toFixed(3),
        y: colliderBoundsBefore.size.y.toFixed(3),
        z: colliderBoundsBefore.size.z.toFixed(3),
      },
      colliderSizeAfter: {
        x: colliderBoundsFinal.size.x.toFixed(3),
        y: colliderBoundsFinal.size.y.toFixed(3),
        z: colliderBoundsFinal.size.z.toFixed(3),
      },
    });
  }
}


// ------------------------------------------------------------
// World (IWSDK settings)
// ------------------------------------------------------------
World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets: {},
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: "always",
    features: { handTracking: true, layers: true },
  },
  render: {
    defaultLighting: false,
  },
  features: {
    locomotion: true,
    grabbing: true,
    physics: false,
    sceneUnderstanding: false,
  },
})
  .then((world) => {
    world.camera.position.set(0, 1.5, 0);
    world.scene.background = new THREE.Color(0x000000);
    world.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    world
      .registerSystem(PanelSystem)
      .registerSystem(GaussianSplatLoaderSystem)
      .registerSystem(CompanionSystem)
      .registerSystem(CaptureWidgetSystem);


    // ------------------------------------------------------------
    // Gaussian Splat
    // ------------------------------------------------------------
    const defaultSplat = "./splats/worldlabs-100k.spz";

    const splatEntity = world.createTransformEntity();
    // World Labs semantics_metadata from API response
    const GROUND_PLANE_OFFSET = 1.4800363;
    splatEntity.object3D!.scale.y = -1;
    splatEntity.object3D!.position.y = GROUND_PLANE_OFFSET;
    splatEntity.addComponent(GaussianSplatLoader, { splatUrl: defaultSplat, autoLoad: true });

    // Debug root for collider + nav graph. Kept in sync with splat transform
    // controls so overlays stay aligned with world content.
    const worldmodelDebugRoot = new THREE.Group();
    worldmodelDebugRoot.position.y = GROUND_PLANE_OFFSET;
    worldmodelDebugRoot.scale.copy(splatEntity.object3D!.scale);
    world.scene.add(worldmodelDebugRoot);

    const colliderContainer = new THREE.Group();
    colliderContainer.visible = false;
    worldmodelDebugRoot.add(colliderContainer);

    const navOverlayContainer = new THREE.Group();
    navOverlayContainer.visible = false;
    worldmodelDebugRoot.add(navOverlayContainer);

    const colliderFineTune = {
      scale: 1.0,
      yawDeg: 180.0,
      offsetX: 0.0,
      offsetY: 0.0,
      offsetZ: 0.0,
    };
    let colliderFineTuneRoot: THREE.Group | null = null;

    const applyColliderFineTune = () => {
      if (!colliderFineTuneRoot) return;
      colliderFineTuneRoot.scale.setScalar(colliderFineTune.scale);
      colliderFineTuneRoot.rotation.set(
        0,
        THREE.MathUtils.degToRad(colliderFineTune.yawDeg),
        0,
      );
      colliderFineTuneRoot.position.set(
        colliderFineTune.offsetX,
        colliderFineTune.offsetY,
        colliderFineTune.offsetZ,
      );
      colliderFineTuneRoot.updateMatrixWorld(true);
    };

    const bindColliderSlider = (
      sliderId: string,
      valueId: string,
      parse: (raw: string) => number,
      format: (value: number) => string,
      apply: (value: number) => void,
    ) => {
      const slider = document.getElementById(sliderId) as HTMLInputElement | null;
      const valueLabel = document.getElementById(valueId) as HTMLSpanElement | null;
      if (!slider || !valueLabel) return;

      const sync = () => {
        const value = parse(slider.value);
        apply(value);
        valueLabel.textContent = format(value);
        applyColliderFineTune();
      };

      sync();
      slider.addEventListener("input", sync);
    };

    bindColliderSlider(
      "collider-scale",
      "collider-scale-val",
      (raw) => Number(raw),
      (value) => value.toFixed(2),
      (value) => { colliderFineTune.scale = value; },
    );
    bindColliderSlider(
      "collider-yaw",
      "collider-yaw-val",
      (raw) => Number(raw),
      (value) => `${value.toFixed(0)}°`,
      (value) => { colliderFineTune.yawDeg = value; },
    );
    bindColliderSlider(
      "collider-off-x",
      "collider-off-x-val",
      (raw) => Number(raw),
      (value) => value.toFixed(2),
      (value) => { colliderFineTune.offsetX = value; },
    );
    bindColliderSlider(
      "collider-off-y",
      "collider-off-y-val",
      (raw) => Number(raw),
      (value) => value.toFixed(2),
      (value) => { colliderFineTune.offsetY = value; },
    );
    bindColliderSlider(
      "collider-off-z",
      "collider-off-z-val",
      (raw) => Number(raw),
      (value) => value.toFixed(2),
      (value) => { colliderFineTune.offsetZ = value; },
    );

    // Create capture animator early so collider callback can register meshes
    const captureAnimator = new CaptureAnimator(
      world.scene,
      world.camera as THREE.PerspectiveCamera,
      world.renderer as THREE.WebGLRenderer,
    );

    new GLTFLoader().load("./splats/worldlabs-collider.glb", async (gltf) => {
      colliderFineTuneRoot = new THREE.Group();
      colliderContainer.add(colliderFineTuneRoot);
      colliderFineTuneRoot.add(gltf.scene);
      applyColliderFineTune();
      colliderContainer.updateMatrixWorld(true);

      // Log collider bounding box
      const bbox = new THREE.Box3().setFromObject(gltf.scene);
      console.log("[Collider] Bounding box:", {
        min: { x: bbox.min.x.toFixed(2), y: bbox.min.y.toFixed(2), z: bbox.min.z.toFixed(2) },
        max: { x: bbox.max.x.toFixed(2), y: bbox.max.y.toFixed(2), z: bbox.max.z.toFixed(2) },
      });

      // Wait for splat bounds, then align collider to splat before nav graph generation.
      try {
        await waitForRenderableBounds(splatEntity.object3D!, 60_000);
        autoAlignColliderToSplat(colliderContainer, splatEntity.object3D!);
      } catch (error) {
        console.warn("[Align] Skipping collider auto-alignment:", error);
      }

      // Build nav graph BEFORE disabling raycast on meshes
      const navGraph = buildNavGraph(colliderContainer, {
        gridSpacing: 0.45,
        sampleHeight: 1.5,
        groundTolerance: 0.15,
        maxEdgeLength: 1.0,
        minNormalY: 0.8,
        edgeProbeHeight: 0.2,
      });

      // Collect collider meshes for capture animation raycasting
      // (must be done BEFORE raycast is disabled on them)
      const colliderMeshes: THREE.Mesh[] = [];
      gltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          colliderMeshes.push(child as THREE.Mesh);
        }
      });

      // Now set up wireframe overlay and disable raycasting for locomotion
      const wireframeMat = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
        depthTest: true,
      });

      gltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).material = wireframeMat;
          child.raycast = () => {};
        }
      });
      console.log("[Collider] Loaded wireframe collider mesh");

      // Give capture animator access to collider meshes for gaze raycasting
      captureAnimator.setColliderMeshes(colliderMeshes);

      // Debug visualization overlay in collider-local space so it stays anchored.
      navOverlayContainer.clear();
      const navOverlay = createNavGraphOverlay(navGraph, {
        depthTest: true,
      });
      navOverlayContainer.add(navOverlay);

      // Nav graph toggle
      const navToggle = document.getElementById("nav-toggle") as HTMLInputElement;
      if (navToggle) {
        navOverlayContainer.visible = navToggle.checked;
        navToggle.addEventListener("change", () => {
          navOverlayContainer.visible = navToggle.checked;
        });
      }
    });

    // Collider toggle
    const colliderToggle = document.getElementById("collider-toggle") as HTMLInputElement;
    if (colliderToggle) {
      colliderContainer.visible = colliderToggle.checked;
      colliderToggle.addEventListener("change", () => {
        colliderContainer.visible = colliderToggle.checked;
      });
    }

    const splatSystem = world.getSystem(GaussianSplatLoaderSystem)!;

    // Play splat animation when entering XR
    world.visibilityState.subscribe((state) => {
      if (state !== VisibilityState.NonImmersive) {
        splatSystem.replayAnimation(splatEntity).catch((err) => {
          console.error("[World] Failed to replay splat animation:", err);
        });
      }
    });

    // Debug sliders for splat transform
    const splatObj = splatEntity.object3D!;
    for (const axis of ["x", "y", "z"] as const) {
      const slider = document.getElementById(`rot-${axis}`) as HTMLInputElement;
      const label = document.getElementById(`rot-${axis}-val`) as HTMLSpanElement;
      if (slider && label) {
        slider.addEventListener("input", () => {
          const deg = Number(slider.value);
          label.textContent = `${deg}°`;
          splatObj.rotation[axis] = THREE.MathUtils.degToRad(deg);
          worldmodelDebugRoot.rotation[axis] = splatObj.rotation[axis];
        });
      }
    }

    // Y position slider
    {
      const slider = document.getElementById("pos-y") as HTMLInputElement;
      const label = document.getElementById("pos-y-val") as HTMLSpanElement;
      if (slider && label) {
        slider.addEventListener("input", () => {
          const val = Number(slider.value);
          label.textContent = val.toFixed(1);
          splatObj.position.y = val;
          worldmodelDebugRoot.position.y = val;
        });
      }
    }

    // Splat picker dropdown
    const picker = document.getElementById("splat-picker") as HTMLSelectElement;
    if (picker) {
      picker.value = defaultSplat;
      picker.addEventListener("change", () => {
        const url = picker.value;
        console.log(`[SplatPicker] Switching to: ${url}`);
        splatSystem.unload(splatEntity, { animate: false }).then(() => {
          splatEntity.setValue(GaussianSplatLoader, "splatUrl", url);
          splatSystem.load(splatEntity).catch((err) => {
            console.error("[SplatPicker] Failed to load splat:", err);
          });
        });
      });
    }

    
    // ------------------------------------------------------------
    // Invisible floor for locomotion (must be a Mesh for IWSDK raycasting)
    // Deferred by a frame so the locomotion engine is fully initialized.
    // ------------------------------------------------------------
    requestAnimationFrame(() => {
      const floorGeometry = new PlaneGeometry(100, 100);
      floorGeometry.rotateX(-Math.PI / 2);
      const floor = new Mesh(floorGeometry, new MeshBasicMaterial());
      floor.visible = false;
      world
        .createTransformEntity(floor)
        .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });
    });

    const grid = new THREE.GridHelper(100, 100, 0x444444, 0x222222);
    grid.material.transparent = true;
    grid.material.opacity = 0.4;
    grid.visible = false; // hidden by default, togglable via UI
    world.scene.add(grid);

    // Grid toggle
    const gridToggle = document.getElementById("grid-toggle") as HTMLInputElement;
    if (gridToggle) {
      gridToggle.addEventListener("change", () => {
        grid.visible = gridToggle.checked;
      });
    }


    // ------------------------------------------------------------
    // Hologram Sphere (distance-grabbable, translate in place)
    // ------------------------------------------------------------
    spawnHologramSphere(world);


    // ------------------------------------------------------------
    // Capture Widget (floating 3D button, left side of user)
    // ------------------------------------------------------------
    const captureWidgetMesh = createCaptureWidgetMesh();
    captureWidgetMesh.position.set(-0.5, 1.2, -0.4);
    const captureWidgetEntity = world.createTransformEntity(captureWidgetMesh as any);
    captureWidgetEntity.addComponent(CaptureWidget);
    captureWidgetEntity.addComponent(Interactable);


    // ------------------------------------------------------------
    // Panel UI (centered on screen in desktop, positioned in 3D for XR)
    // ------------------------------------------------------------
    const panelEntity = world
      .createTransformEntity()
      .addComponent(PanelUI, {
        config: "./ui/sensai.json",
        maxHeight: 0.8,
        maxWidth: 1.6,
      })
      .addComponent(Interactable)
      .addComponent(ScreenSpace, {
        top: "30%",
        bottom: "30%",
        left: "30%",
        right: "30%",
        height: "40%",
        width: "40%",
      });
    panelEntity.object3D!.position.set(0, 1.29, -1.9);


    // ------------------------------------------------------------
    // Capture Animation — spatial 4-state analysis flow
    // ------------------------------------------------------------
    // (captureAnimator created earlier, before collider load)

    // Update animator every frame via a simple animation loop hook
    const animClock = new THREE.Clock();
    const animLoop = () => {
      const dt = animClock.getDelta();
      captureAnimator.update(dt);
      requestAnimationFrame(animLoop);
    };
    requestAnimationFrame(animLoop);

    const doCapture = () => {
      if (captureAnimator.isActive) return; // prevent overlapping captures
      captureAnimator.start();
    };

    // Desktop button
    const captureBtn = document.getElementById("capture-btn") as HTMLButtonElement;
    if (captureBtn) {
      captureBtn.addEventListener("click", doCapture);
    }

    // 3D widget
    const captureSystem = world.getSystem(CaptureWidgetSystem);
    if (captureSystem) {
      captureSystem.onCapture = doCapture;
    }

    // Keyboard shortcut: P
    window.addEventListener("keydown", (e) => {
      if (e.key === "p" || e.key === "P") {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        doCapture();
      }
    });

  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
    const container = document.getElementById("scene-container");
  });

  
