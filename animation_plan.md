# Capture & Analyze — 4-State Animation Plan

## Overview

Replace the flat screenshot-preview-overlay with a spatial, in-world animation sequence. When the user presses **P** (or taps the 3D capture widget), the system performs a 4-state loop that feels like the world itself is thinking — not just showing a UI panel.

The collision mesh gives us object zones we can highlight. The splat gives us the visual. The LLM gives us the insight. The animation ties them together.

---

## The 4 States

```
  P pressed
     │
     ▼
┌─────────┐   0.0s – 0.8s
│ NOTICE   │   Pulse/halo on the zone the user is looking at.
│          │   Camera raycast → nearest collider hit → highlight that area.
└────┬─────┘
     │
     ▼
┌─────────┐   0.8s – 2.5s
│ INSPECT  │   Scan line sweeps across the view. Splat shimmers locally.
│          │   Screenshot is captured silently mid-sweep.
│          │   LLM request fires in background.
└────┬─────┘
     │
     ▼
┌─────────┐   2.5s – when LLM responds
│ EXPLAIN  │   Anchored card blooms outward from the hit point.
│          │   Shows the LLM's analysis as spatial text.
│          │   Card fades in with scale animation.
└────┬─────┘
     │
     ▼
┌─────────┐   after ~5s or user dismissal
│ COMMIT   │   Card shrinks to a small pinned marker in world space.
│          │   Stays as a persistent note the user can revisit.
│          │   Marker stores the analysis text + screenshot.
└─────────┘
```

---

## State Details

### 1. NOTICE (0.0s – 0.8s)

**Purpose:** Signal that the system has started analyzing. Draw attention to what the user is looking at.

**Implementation:**
- Raycast from camera center forward → hit the collider mesh
- At the hit point, spawn a **ring pulse effect** — a torus that expands outward and fades
- Ring uses an emissive material with the companion cyan color (`0x4fc3f7`)
- 2-3 concentric rings, staggered by ~0.15s, each expanding from 0.1m to 0.5m radius over 0.5s
- Rings are parented to the scene at world position (not camera), so they stay anchored

**Three.js approach:**
- `TorusGeometry` (thin, flat) with `MeshBasicMaterial({ transparent, opacity animating 1→0 })`
- Scale up from 0.1 to 0.5 over the duration
- Orient ring to face the camera (billboard) or align with the hit surface normal

### 2. INSPECT (0.8s – 2.5s)

**Purpose:** Show active scanning. This is when the screenshot is captured and the LLM request fires.

**Implementation:**
- **Scan line**: A horizontal line (thin plane) that sweeps top-to-bottom across the screen
  - Rendered in screen space (or as a camera-child plane)
  - Cyan/white gradient, semi-transparent
  - Moves from Y=+1 to Y=-1 in normalized screen coords over ~1.5s
- **Local shimmer**: Subtle brightness pulse on the splat near the hit point
  - Since we can't easily modify splat rendering per-region, instead overlay a soft transparent sphere at the hit point that pulses opacity
  - Sphere radius ~0.5m, additive blending, very low opacity (0.05-0.1)
- **Screenshot capture** happens at the midpoint of the scan (~1.5s mark)
- **LLM request** fires immediately after capture — runs in background while animation continues

**Three.js approach:**
- Scan line: `PlaneGeometry` child of camera, animated position.y, `ShaderMaterial` with gradient + fade
- Shimmer sphere: `SphereGeometry` with `MeshBasicMaterial({ blending: AdditiveBlending, transparent, opacity pulsing })`

### 3. EXPLAIN (2.5s – LLM response + 5s)

**Purpose:** Present the LLM's analysis spatially, anchored to the point of interest.

**Implementation:**
- When the LLM response arrives, spawn a **floating card** at the hit point
- Card is a `PlaneGeometry` with a canvas texture (renders text dynamically)
- **Bloom animation**: card starts at scale 0 and grows to full size over 0.4s with elastic easing
- Card is positioned slightly above and in front of the hit point, facing the camera
- A thin **tether line** connects the card to the hit point on the surface
- Card background: dark semi-transparent (`rgba(0,0,0,0.8)`) with subtle border glow

**Card layout (canvas texture):**
```
┌──────────────────────────┐
│  [Cyan dot]  Analysis    │  ← header
│                          │
│  The scene shows a       │  ← LLM text, word-wrapped
│  modern living room...   │
│                          │
└──────────────────────────┘
```

**Three.js approach:**
- `CanvasTexture` for text rendering (create offscreen canvas, draw text with `ctx.fillText`)
- `PlaneGeometry` + `MeshBasicMaterial({ map: canvasTexture, transparent, depthTest: false })`
- `renderOrder: 900` (above splats, below UI panels)
- Tether: `Line` from card position to hit point

### 4. COMMIT (after ~5s or user dismissal)

**Purpose:** Persist the insight as a small marker in world space.

**Implementation:**
- Card shrinks from full size to a small **pin marker** (scale 1.0 → 0.15) over 0.5s
- Pin stays in world space at the hit point
- Pin is a small sphere + tiny text label (or just the sphere with a tooltip on hover)
- Multiple pins accumulate as the user captures more views
- Pins are `Interactable` — pointing at one with a controller shows the full card again

**Data stored per pin:**
```ts
interface CapturePin {
  position: Vector3;
  analysisText: string;
  screenshotDataUrl: string;
  timestamp: number;
}
```

---

## New Files

| File | Purpose |
|------|---------|
| `src/captureAnimation.ts` | State machine + all 4 animation states. Manages the lifecycle. |
| `src/spatialCard.ts` | Creates the floating text card (canvas texture + plane mesh). |

**Modified files:**
- `src/index.ts` — replace the flat overlay capture flow with the animation system
- `src/captureWidget.ts` — triggers the animation instead of `doCapture` directly

---

## Animation State Machine

```ts
type CaptureState = 'idle' | 'notice' | 'inspect' | 'explain' | 'commit';

class CaptureAnimator {
  private state: CaptureState = 'idle';
  private elapsed = 0;
  private hitPoint: Vector3 | null = null;
  private hitNormal: Vector3 | null = null;
  private analysisText: string | null = null;
  private pins: CapturePin[] = [];

  // Called when user triggers capture
  start(camera: PerspectiveCamera, colliderMeshes: Mesh[]) {
    // Raycast from camera center → collider
    // Store hitPoint, hitNormal
    // Transition to 'notice'
  }

  // Called every frame
  update(delta: number) {
    this.elapsed += delta;
    switch (this.state) {
      case 'notice':  this.updateNotice(delta); break;
      case 'inspect':  this.updateInspect(delta); break;
      case 'explain':  this.updateExplain(delta); break;
      case 'commit':   this.updateCommit(delta); break;
    }
  }
}
```

---

## Timing Summary

| State | Duration | Key Event |
|-------|----------|-----------|
| NOTICE | 0.8s | Ring pulse at hit point |
| INSPECT | 1.7s | Scan line + capture at midpoint + LLM request fires |
| EXPLAIN | Until LLM responds + 5s display | Card blooms with analysis text |
| COMMIT | 0.5s transition | Card shrinks to persistent pin |

Total from press to insight displayed: ~2.5s + LLM latency (~2-4s) = **~5-7s**

---

## Implementation Order

### Phase 1 — State machine + NOTICE
- [ ] Create `CaptureAnimator` class with state machine
- [ ] Raycast from camera to collider on trigger
- [ ] Ring pulse effect at hit point
- [ ] Wire into index.ts, replacing flat overlay for the animation path

### Phase 2 — INSPECT + capture
- [ ] Scan line effect (camera-space plane sweeping down)
- [ ] Shimmer sphere at hit point
- [ ] Screenshot capture at midpoint
- [ ] Fire LLM request in background

### Phase 3 — EXPLAIN
- [ ] `SpatialCard` class — canvas texture text rendering
- [ ] Card bloom animation (scale 0 → 1 with easing)
- [ ] Tether line from card to hit point
- [ ] Display LLM analysis text

### Phase 4 — COMMIT + pins
- [ ] Card shrink to pin marker
- [ ] Persistent pins in world space
- [ ] Pin interaction (hover to re-show card)
- [ ] Multiple capture sessions accumulate pins

---

## Notes

- All effects use `depthTest: false` and high `renderOrder` so they're visible through/above the splat
- Effects are parented to the scene (world-anchored), not the camera, so they feel spatial
- The scan line is the exception — it's camera-relative so it feels like an HUD scan
- The LLM request runs in parallel with the inspect animation, so if the LLM is fast the explain state can start early
- If the raycast misses the collider (user looking at empty space), fall back to placing the hit point at a fixed distance in front of the camera (3m)
- Keep the flat overlay (Capture View button + P key) as a fallback for non-XR desktop use, but the in-world animation is the primary experience
