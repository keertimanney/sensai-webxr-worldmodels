
import {
  Types,
  createComponent,
  createSystem,
  Interactable,
  Hovered,
  Pressed,
} from "@iwsdk/core";
import * as THREE from "three";


// ------------------------------------------------------------
// Component — marks an entity as the capture widget
// ------------------------------------------------------------
export const CaptureWidget = createComponent("CaptureWidget", {
  offsetLeft: { type: Types.Float32, default: -0.5 },
  offsetUp: { type: Types.Float32, default: -0.1 },
  offsetForward: { type: Types.Float32, default: -0.4 },
  followSpeed: { type: Types.Float32, default: 5.0 },
});


// ------------------------------------------------------------
// Mesh — small floating panel with a camera icon
// ------------------------------------------------------------
const WIDGET_COLOR = 0x222222;
const ICON_COLOR = 0x4fc3f7;

export function createCaptureWidgetMesh(): THREE.Group {
  const group = new THREE.Group();

  // Background panel (rounded look via circle geometry)
  const panelGeo = new THREE.CircleGeometry(0.06, 32);
  const panelMat = new THREE.MeshBasicMaterial({
    color: WIDGET_COLOR,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const panel = new THREE.Mesh(panelGeo, panelMat);
  panel.renderOrder = 800;
  panel.name = "capturePanel";
  group.add(panel);

  // Camera icon — simple lens circle + body rectangle
  // Outer ring (lens)
  const ringGeo = new THREE.RingGeometry(0.02, 0.028, 24);
  const iconMat = new THREE.MeshBasicMaterial({
    color: ICON_COLOR,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, iconMat);
  ring.position.z = 0.001;
  ring.renderOrder = 801;
  group.add(ring);

  // Small dot in center (lens center)
  const dotGeo = new THREE.CircleGeometry(0.008, 16);
  const dot = new THREE.Mesh(dotGeo, iconMat);
  dot.position.z = 0.001;
  dot.renderOrder = 801;
  group.add(dot);

  group.renderOrder = 800;
  return group;
}


// ------------------------------------------------------------
// System — follows user, detects press, triggers capture
// ------------------------------------------------------------

export type CaptureCallback = () => void;

export class CaptureWidgetSystem extends createSystem({
  widgets: { required: [CaptureWidget, Interactable] },
}) {
  private targetPos = new THREE.Vector3();
  private localOffset = new THREE.Vector3();
  private prevCameraPos = new THREE.Vector3();
  private initialized = false;

  // Set externally to wire up the actual capture logic
  onCapture: CaptureCallback | null = null;

  // Track press state to fire once per click
  private wasPressed = new Map<number, boolean>();

  update(delta: number, _time: number) {
    for (const entity of this.queries.widgets.entities) {
      const obj = entity.object3D;
      if (!obj) continue;

      const idx = entity.index;
      const followSpeed = entity.getValue(CaptureWidget, "followSpeed") as number;
      const offLeft = entity.getValue(CaptureWidget, "offsetLeft") as number;
      const offUp = entity.getValue(CaptureWidget, "offsetUp") as number;
      const offFwd = entity.getValue(CaptureWidget, "offsetForward") as number;

      // Position in camera local space (left side of view)
      this.localOffset.set(offLeft, offUp, offFwd);
      this.targetPos.copy(this.localOffset).applyMatrix4(this.camera.matrixWorld);

      const cameraMoved = this.prevCameraPos.distanceTo(this.camera.position);
      if (!this.initialized || cameraMoved > 2.0) {
        obj.position.copy(this.targetPos);
        this.initialized = true;
      } else {
        const lerpFactor = 1 - Math.exp(-followSpeed * delta);
        obj.position.lerp(this.targetPos, lerpFactor);
      }
      this.prevCameraPos.copy(this.camera.position);

      // Always face the camera
      obj.lookAt(this.camera.position);

      // Visual feedback on hover
      const panel = obj.getObjectByName("capturePanel") as THREE.Mesh | undefined;
      if (panel) {
        const mat = panel.material as THREE.MeshBasicMaterial;
        const isHovered = entity.hasComponent(Hovered);
        mat.opacity = isHovered ? 0.95 : 0.85;
        const targetScale = isHovered ? 1.15 : 1.0;
        const s = THREE.MathUtils.lerp(obj.scale.x, targetScale, 1 - Math.exp(-10 * delta));
        obj.scale.setScalar(s);
      }

      // Detect press (fire once on press-down)
      const isPressed = entity.hasComponent(Pressed);
      const wasPrev = this.wasPressed.get(idx) ?? false;

      if (isPressed && !wasPrev) {
        console.log("[CaptureWidget] Pressed — triggering capture");
        this.onCapture?.();
      }

      this.wasPressed.set(idx, isPressed);
    }
  }
}
