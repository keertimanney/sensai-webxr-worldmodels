
import * as THREE from "three";
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
      .registerSystem(CompanionSystem);


    // ------------------------------------------------------------
    // Gaussian Splat
    // ------------------------------------------------------------
    const defaultSplat = "./splats/worldlabs-100k.spz";

    const splatEntity = world.createTransformEntity();
    // World Labs exports use inverted Y — flip without affecting Z
    splatEntity.object3D!.scale.y = -1;
    splatEntity.object3D!.position.y = 1.5;
    splatEntity.addComponent(GaussianSplatLoader, { splatUrl: defaultSplat, autoLoad: true });

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
    // Floating Companion (glowing sphere, follows camera)
    // ------------------------------------------------------------
    const companionMesh = createCompanionMesh();
    companionMesh.position.set(0.4, 1.2, -1.2);
    const companionEntity = world.createTransformEntity(companionMesh as any);
    companionEntity.addComponent(Companion);
    companionEntity.addComponent(Interactable);
    companionEntity.addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveAtSource,
      translate: true,
      rotate: false,
      scale: false,
    });


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

  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
    const container = document.getElementById("scene-container");
  });

  
