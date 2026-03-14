# Floating Robot Companion — UX & Implementation Plan

## Overview

Add a floating robot companion that accompanies the user as they explore the Gaussian splat world. The companion should feel alive, helpful, and non-intrusive — like a small drone assistant hovering nearby.

---

## UX Design

### Behavior Modes

#### 1. Idle / Ambient
- Floats near the user at a comfortable distance (~1.5m away, slightly below eye level)
- Gentle bob/hover animation (sine wave on Y axis + subtle rotation)
- **Lazy follow**: eases toward the user's position with a delay, so it feels organic rather than rigidly attached
- Slight random drift so it never feels perfectly still

#### 2. Attention / Engaged
- When the user gazes at the companion (or points a controller at it), it "perks up"
- Turns to face the user smoothly
- Subtle scale pulse or glow to acknowledge attention
- This is the trigger point for interaction (speech, menu, info overlay)

#### 3. Navigation / Guide (future)
- Companion flies ahead to a point of interest as a wayfinder
- Leaves a subtle trail or particle breadcrumb for the user to follow
- Returns to idle mode once the user reaches the destination

---

## Key Design Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| **Positioning** | World-anchored with lazy follow (spring/lerp toward offset from user's head) | Feels alive and physical. Head-locked feels like HUD, not a character. |
| **Offset** | Slightly right and below eye level (~0.4m right, -0.3m down, 1.2m forward) | Peripheral vision — visible but not blocking the splat world |
| **Size** | ~25–30cm | Small enough to not occlude the environment, big enough to notice and feel like a presence |
| **Render order** | `renderOrder: 500` (between splats at -10 and UI at 10000) | Always visible above the splat world, but UI panels draw on top |
| **Interaction model** | Gaze detection (V1), grabbable (V2) | Gaze is the simplest cross-platform input (works in VR, AR, and flat screen) |
| **Visual style** | Simple geometric mesh to start (sphere body + floating ring + "eye" dot) | Fast to prototype, swap for a GLTF model later |
| **Animation** | `sin(time)` bob on Y, slow Y-axis rotation, lerp-based follow | Cheap GPU-friendly, looks good |
| **Personality cues** | "Eye" that tracks the user, subtle color shifts on state change | Minimal but effective — gives it life without complex animation |

---

## Visual Design (V1 — Geometric Placeholder)

```
       ___
      /   \      ← Sphere body (~20cm), emissive material
      \___/        with slight metallic sheen
    ——|   |——    ← Floating ring (torus), orbits slowly
        •        ← Small "eye" sphere, always faces user
```

- **Body**: `SphereGeometry` with `MeshStandardMaterial` (metallic: 0.6, roughness: 0.3, emissive color)
- **Ring**: `TorusGeometry` orbiting the body, slight tilt, slow rotation
- **Eye**: Small sphere on the front face, uses `lookAt(camera)` each frame
- **Glow**: Optional — `PointLight` with low intensity parented to the companion for subtle ambient glow

---

## Technical Architecture

### Fits into existing ECS pattern

The codebase uses IWSDK's Entity-Component-System architecture. The companion follows the same pattern as the existing hologram sphere (`interactableExample.ts`).

### New Files

| File | Purpose |
|------|---------|
| `src/companion.ts` | `CompanionComponent` + `CompanionSystem` — all companion logic |
| `src/companionMesh.ts` | Builds the Three.js mesh group (body, ring, eye) — separated so it's easy to swap for a GLTF model later |

### CompanionComponent

```ts
{
  followSpeed: 2.0,        // lerp speed toward target position
  hoverHeight: 1.2,        // Y offset from ground (meters)
  hoverAmplitude: 0.05,    // bob amplitude (meters)
  hoverFrequency: 1.5,     // bob speed (Hz)
  offsetRight: 0.4,        // offset right of camera forward (meters)
  offsetForward: 1.2,      // offset in front of camera (meters)
  gazeThreshold: 1.0,      // seconds of gaze to trigger "engaged" mode
  state: 'idle'            // 'idle' | 'engaged' | 'navigating'
}
```

### CompanionSystem (per-frame update loop)

1. **Get camera position & forward direction** from IWSDK world
2. **Compute target position**: camera position + forward offset + right offset + hover height
3. **Lerp companion toward target** using `followSpeed * deltaTime`
4. **Apply hover bob**: `position.y += sin(time * hoverFrequency) * hoverAmplitude`
5. **Rotate ring** slowly around Y axis
6. **Point eye** at camera using `lookAt()`
7. **Gaze detection**: raycast from camera center, check intersection with companion mesh
   - If intersecting, accumulate gaze timer
   - If timer exceeds `gazeThreshold`, transition to "engaged" state
   - If not intersecting, decay timer and return to "idle"
8. **State transitions**: apply visual feedback (scale pulse, color shift, eye glow)

### Entity Setup (in index.ts)

```ts
// Create companion entity
const companion = world.create()
companion.add(Transform, { position: new Vector3(0.4, 1.2, -1.2) })
companion.add(CompanionComponent, { /* defaults */ })

// Attach mesh to entity's transform
const companionMesh = createCompanionMesh()
companion.get(Transform).object3D.add(companionMesh)
```

### Render Configuration

- Set `renderOrder: 500` on all companion mesh children
- Set `material.depthTest = false` so it renders above splats (same approach as hologram sphere in `interactableExample.ts`)
- Optional: `material.depthWrite = false` to prevent z-fighting with UI

---

## Implementation Phases

### Phase 1 — Static Companion (get something on screen)
- [ ] Create `companionMesh.ts` — build the geometric mesh group
- [ ] Create `CompanionComponent` with config defaults
- [ ] Create `CompanionSystem` with basic hover animation (bob + rotate)
- [ ] Register system and spawn entity in `index.ts`
- [ ] Verify it renders above the splat world

### Phase 2 — Follow Behavior
- [ ] Read camera position each frame
- [ ] Compute world-space target offset from camera
- [ ] Lerp companion position toward target
- [ ] Tune follow speed, offset, and damping until it feels natural
- [ ] Handle edge cases: teleportation (snap to new position instead of lerping across the map)

### Phase 3 — Gaze Interaction
- [ ] Add raycasting from camera center
- [ ] Detect gaze on companion mesh
- [ ] Implement gaze timer with threshold
- [ ] Visual feedback on state change (scale pulse, emissive color shift, eye glow)
- [ ] Add `Interactable` component for controller pointer support

### Phase 4 — Polish & Personality
- [ ] Add slight random drift to idle position (Perlin noise or similar)
- [ ] Smooth out rotation so companion banks/tilts when moving
- [ ] Add particle trail or subtle effects
- [ ] Sound cues (hover hum, attention chime)
- [ ] Consider `DistanceGrabbable` so user can reposition the companion

### Phase 5 — Real Model & Navigation (future)
- [ ] Replace geometric mesh with a proper GLTF robot model
- [ ] Add skeletal animation support (idle, alert, moving)
- [ ] Implement navigation/guide mode with pathfinding
- [ ] Add speech or text bubble for companion communication

---

## Open Questions

1. **Should the companion persist position across XR session enter/exit?** The splat world replays its fly-in animation on XR enter — should the companion do similar?
2. **Multi-user?** If this becomes multiplayer, does each user see their own companion or is it shared?
3. **AI integration?** Is the companion meant to be a front-end for an LLM/voice agent, or purely a UX element for now?
4. **Accessibility**: Should there be an option to disable/hide the companion for users who find it distracting?

---

## References

- Existing interactive object pattern: `src/interactableExample.ts` (hologram sphere)
- Render ordering approach: splats at -10, UI at 10000, companion at 500
- ECS system pattern: `src/gaussianSplatLoader.ts` (component + system in one file)
- Animation reference: `src/gaussianSplatAnimator.ts` (GPU-driven animation with time uniforms)
