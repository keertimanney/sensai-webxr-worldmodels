
import {
  Types,
  createComponent,
  createSystem,
  Interactable,
  DistanceGrabbable,
  MovementMode,
} from "@iwsdk/core";
import * as THREE from "three";


// ------------------------------------------------------------
// Component – marks an entity as a floating companion
// ------------------------------------------------------------
export const Companion = createComponent("Companion", {
  followSpeed: { type: Types.Float32, default: 3.0 },
  hoverAmplitude: { type: Types.Float32, default: 0.03 },
  hoverFrequency: { type: Types.Float32, default: 1.0 },
  offsetRight: { type: Types.Float32, default: 0.6 },
  offsetUp: { type: Types.Float32, default: -0.2 },
});

// Re-export for index.ts convenience
export { DistanceGrabbable, MovementMode };


// ------------------------------------------------------------
// Mesh – glowing sphere
// ------------------------------------------------------------
const COMPANION_COLOR = 0x4fc3f7;

export function createCompanionMesh(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.1, 32, 32);
  const material = new THREE.MeshStandardMaterial({
    color: COMPANION_COLOR,
    emissive: COMPANION_COLOR,
    emissiveIntensity: 0.6,
    metalness: 0.3,
    roughness: 0.4,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 500;
  return mesh;
}


// ------------------------------------------------------------
// System – stays to the right of the user, follows position
// ------------------------------------------------------------

const TELEPORT_THRESHOLD = 2.0;

export class CompanionSystem extends createSystem({
  companions: { required: [Companion, Interactable] },
}) {
  private elapsed = 0;
  private targetPos = new THREE.Vector3();
  private localOffset = new THREE.Vector3();
  private prevCameraPos = new THREE.Vector3();
  private initialized = false;

  update(delta: number, _time: number) {
    this.elapsed += delta;

    // Detect teleportation
    const cameraMoved = this.prevCameraPos.distanceTo(this.camera.position);
    const didTeleport = this.initialized && cameraMoved > TELEPORT_THRESHOLD;
    this.prevCameraPos.copy(this.camera.position);

    for (const entity of this.queries.companions.entities) {
      const obj = entity.object3D;
      if (!obj) continue;

      const followSpeed = entity.getValue(Companion, "followSpeed") as number;
      const hoverAmp = entity.getValue(Companion, "hoverAmplitude") as number;
      const hoverFreq = entity.getValue(Companion, "hoverFrequency") as number;
      const offRight = entity.getValue(Companion, "offsetRight") as number;
      const offUp = entity.getValue(Companion, "offsetUp") as number;

      // Compute target in camera's local space, then convert to world.
      // This keeps the companion always to the right of the user's view.
      this.localOffset.set(offRight, offUp, -0.3);
      this.targetPos.copy(this.localOffset).applyMatrix4(this.camera.matrixWorld);

      if (!this.initialized || didTeleport) {
        obj.position.copy(this.targetPos);
        this.initialized = true;
      } else {
        // Fast lerp so it stays in view when turning
        const lerpFactor = 1 - Math.exp(-followSpeed * delta);
        obj.position.lerp(this.targetPos, lerpFactor);
      }

      // Gentle hover bob
      obj.position.y += Math.sin(this.elapsed * hoverFreq * Math.PI * 2) * hoverAmp;

      // Subtle emissive breathing
      const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (mat) {
        mat.emissiveIntensity = 0.5 + 0.15 * Math.sin(this.elapsed * 2.0);
      }
    }
  }
}
