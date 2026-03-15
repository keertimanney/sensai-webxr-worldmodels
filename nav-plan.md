# Navigation Graph — Implementation Plan

## Goal

Build a walkable waypoint graph from the World Labs collider mesh (GLB) so the companion can autonomously navigate around the Gaussian splat world. The graph is computed **once at load time** and queried at runtime for pathfinding.

---

## Architecture

```
Collider GLB (loaded once)
    │
    ▼
┌──────────────────────────┐
│  1. Sample candidate     │   Raycast downward from a grid of points
│     floor points         │   above the room. Keep hits on upward-facing
│                          │   surfaces near ground_plane height.
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  2. Filter walkable      │   Discard points on tables, shelves, etc.
│     nodes                │   by checking Y height is within threshold
│                          │   of ground plane. Also discard points too
│                          │   close to walls (optional margin).
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  3. Build adjacency      │   For each node pair within max edge
│     (line-of-sight)      │   distance (~1.5m), raycast between them
│                          │   against the collider mesh. If clear,
│                          │   add a bidirectional edge.
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  4. NavGraph ready       │   Lightweight data structure:
│                          │   - nodes: Vector3[]
│                          │   - edges: Map<number, number[]>
│                          │   Stored in memory, no per-frame cost.
└──────────────────────────┘
```

---

## Data Structures

```ts
interface NavNode {
  index: number;
  position: Vector3;
}

interface NavGraph {
  nodes: NavNode[];
  edges: Map<number, number[]>;  // adjacency list

  // Query methods
  nearest(position: Vector3): NavNode;
  path(from: number, to: number): number[];  // A* → node indices
}
```

---

## Step-by-step Implementation

### Step 1 — NavGraph class (`src/navGraph.ts`)

Core graph data structure with:

- `nodes: Vector3[]` — walkable positions
- `edges: Map<number, number[]>` — bidirectional adjacency list
- `nearest(pos: Vector3): number` — find closest node to a world position
- `path(from: number, to: number): number[]` — A* shortest path returning ordered node indices
- `getPosition(index: number): Vector3` — get world position of a node

### Step 2 — Graph builder (`src/navGraphBuilder.ts`)

Takes the collider mesh and produces a NavGraph:

```ts
function buildNavGraph(colliderScene: THREE.Group, options?: {
  gridSpacing?: number;     // default 0.5m — distance between sample rays
  gridExtent?: number;      // default 10m — half-size of the sampling grid
  sampleHeight?: number;    // default 3.0m — height to cast rays from
  groundTolerance?: number; // default 0.3m — max deviation from ground plane
  maxEdgeLength?: number;   // default 1.5m — max distance for edges
  groundY?: number;         // default 0 — expected ground Y position
}): NavGraph
```

**Sampling phase:**
- Create a grid of points at `sampleHeight` above the floor
- For each grid point, cast a ray straight down (-Y)
- If the ray hits a collider face:
  - Check the face normal is roughly upward (normal.y > 0.7)
  - Check the hit Y is within `groundTolerance` of `groundY`
  - If both pass, add as a walkable node

**Edge-building phase:**
- For each pair of nodes within `maxEdgeLength`:
  - Raycast horizontally between them against the collider mesh
  - If no intersection, add a bidirectional edge
- This is O(n²) but with 30-100 nodes it's trivial (~0.01s)

### Step 3 — Debug visualization (`src/navGraphDebug.ts`)

Render the graph as a Three.js overlay for tuning:

- **Nodes**: Small green spheres at each walkable position
- **Edges**: Thin lines connecting adjacent nodes
- **Active path**: Highlighted in a different color when the companion is following a path
- Togglable via a "Show Nav Graph" checkbox in the UI

### Step 4 — Integrate with CompanionSystem (`src/companion.ts`)

Update the companion to use the nav graph:

- On init: pick a random node as starting position
- **Idle behavior**: periodically pick a random node within ~3-5m, pathfind to it, walk the path
- **Path following**: lerp between consecutive waypoints at a set speed
- **Arrival**: pause briefly at destination, then pick a new target
- Keep the existing hover bob and emissive breathing while walking

```
CompanionSystem update loop:
  if no active path:
    pick random target node
    compute A* path from nearest(currentPos) → target
  else:
    move toward next waypoint in path
    if reached waypoint:
      advance to next waypoint
      if path complete:
        wait a few seconds, then clear path (triggers new target)
```

### Step 5 — Wire up in index.ts

- After collider GLB loads, call `buildNavGraph(gltf.scene, { groundY: 0 })`
- Pass the resulting `NavGraph` to the `CompanionSystem`
- Add "Show Nav Graph" checkbox to the HTML controls
- Store nav graph on `world.globals` or pass directly to the system

---

## File Overview

| File | Purpose |
|------|---------|
| `src/navGraph.ts` | `NavGraph` class — nodes, edges, nearest-node lookup, A* pathfinding |
| `src/navGraphBuilder.ts` | `buildNavGraph()` — samples floor from collider, builds adjacency |
| `src/navGraphDebug.ts` | Debug visualization — spheres for nodes, lines for edges |
| `src/companion.ts` | Updated to follow nav graph paths instead of fixed camera offset |

---

## Implementation Order

### Phase A — Graph construction
- [ ] Create `NavGraph` class with nodes, edges, `nearest()`, and `path()` (A*)
- [ ] Create `buildNavGraph()` that raycasts against collider to sample floor nodes
- [ ] Build line-of-sight edges between nearby nodes
- [ ] Log node/edge count to console for validation

### Phase B — Debug visualization
- [ ] Render nodes as small spheres
- [ ] Render edges as lines
- [ ] Add "Show Nav Graph" toggle to UI
- [ ] Visually verify the graph covers the walkable floor

### Phase C — Companion pathfinding
- [ ] Companion picks random target nodes and pathfinds to them
- [ ] Smooth movement along waypoint paths (lerp between nodes)
- [ ] Pause at destinations before choosing new target
- [ ] Keep hover bob and breathing animation while moving

### Phase D — Tuning
- [ ] Adjust grid spacing, ground tolerance, and edge length for good coverage
- [ ] Make sure companion doesn't walk through walls or furniture
- [ ] Tune movement speed and pause duration for natural feel

---

## Key Parameters to Tune

| Parameter | Default | What it affects |
|-----------|---------|-----------------|
| `gridSpacing` | 0.5m | Density of sample points. Smaller = more nodes, better coverage |
| `groundTolerance` | 0.3m | How far from ground plane a hit can be and still count as "floor" |
| `maxEdgeLength` | 1.5m | Max distance between connected nodes. Smaller = more precise paths |
| `sampleHeight` | 3.0m | Height to cast rays from. Must be above all furniture |
| `walkSpeed` | 0.8 m/s | How fast the companion moves between waypoints |
| `pauseDuration` | 2-5s | Random pause at each destination before moving again |

---

## Notes

- The collider mesh coordinate system may differ from the splat. The builder needs to account for whatever transform makes the collider align with the splat (currently being debugged).
- With `ground_plane_offset = 1.48` from the World Labs API, the ground Y in the collider's local space should be derivable.
- The nav graph should be recomputed if the user switches to a different splat/collider via the dropdown.
- All computation happens once at load time. Runtime cost is only A* on a tiny graph (~microseconds).
