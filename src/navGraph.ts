import * as THREE from "three";


// ------------------------------------------------------------
// NavGraph — walkable waypoint graph with A* pathfinding
// ------------------------------------------------------------

export interface NavGraphOptions {
  gridSpacing?: number;      // distance between sample rays
  sampleHeight?: number;     // how far above collider bounds to cast from
  groundTolerance?: number;  // max Y deviation from groundY
  maxEdgeLength?: number;    // max distance for edges
  groundY?: number;          // expected floor Y in collider-local space (optional)
  minNormalY?: number;       // minimum upward normal to count as floor
  edgeProbeHeight?: number;  // height above floor used for edge obstruction checks
  edgeClearance?: number;    // trim at segment end to avoid endpoint self-hit
}

const DEFAULTS: Required<NavGraphOptions> = {
  gridSpacing: 0.5,
  sampleHeight: 1.5,
  groundTolerance: 0.2,
  maxEdgeLength: 1.0,
  groundY: Number.NaN,
  minNormalY: 0.7,
  edgeProbeHeight: 0.2,
  edgeClearance: 0.05,
};

export class NavGraph {
  readonly nodes: THREE.Vector3[] = [];
  readonly edges: Map<number, number[]> = new Map();

  /** Find the index of the nearest node to a position in graph-local space. */
  nearest(pos: THREE.Vector3): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = pos.distanceToSquared(this.nodes[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** A* shortest path. Returns array of node indices (including from and to). */
  path(from: number, to: number): number[] {
    if (from === to) return [from];
    if (from < 0 || to < 0) return [];

    const nodes = this.nodes;
    const edges = this.edges;

    const gScore = new Float64Array(nodes.length).fill(Infinity);
    const fScore = new Float64Array(nodes.length).fill(Infinity);
    const cameFrom = new Int32Array(nodes.length).fill(-1);
    const closed = new Uint8Array(nodes.length);

    gScore[from] = 0;
    fScore[from] = nodes[from].distanceTo(nodes[to]);

    const open: number[] = [from];

    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i;
      }
      const current = open[bestIdx];
      open.splice(bestIdx, 1);

      if (current === to) {
        const result: number[] = [];
        let c = to;
        while (c !== -1) {
          result.push(c);
          c = cameFrom[c];
        }
        return result.reverse();
      }

      closed[current] = 1;

      const neighbors = edges.get(current) ?? [];
      for (const neighbor of neighbors) {
        if (closed[neighbor]) continue;

        const tentativeG = gScore[current] + nodes[current].distanceTo(nodes[neighbor]);
        if (tentativeG < gScore[neighbor]) {
          cameFrom[neighbor] = current;
          gScore[neighbor] = tentativeG;
          fScore[neighbor] = tentativeG + nodes[neighbor].distanceTo(nodes[to]);
          if (!open.includes(neighbor)) {
            open.push(neighbor);
          }
        }
      }
    }

    return [];
  }
}


// ------------------------------------------------------------
// Builder — construct NavGraph from a collider mesh
// ------------------------------------------------------------

export function buildNavGraph(
  colliderScene: THREE.Object3D,
  options?: NavGraphOptions,
): NavGraph {
  const opts = { ...DEFAULTS, ...options };
  const graph = new NavGraph();

  const meshes: THREE.Mesh[] = [];
  colliderScene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshes.push(child as THREE.Mesh);
    }
  });

  if (meshes.length === 0) {
    console.warn("[NavGraph] No meshes found in collider scene");
    return graph;
  }

  colliderScene.updateMatrixWorld(true);
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }

  const worldBounds = new THREE.Box3().setFromObject(colliderScene);
  const targetGroundY = Number.isFinite(opts.groundY)
    ? colliderScene.localToWorld(new THREE.Vector3(0, opts.groundY, 0)).y
    : worldBounds.min.y;

  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const downDir = new THREE.Vector3(0, -1, 0);
  const normalMatrix = new THREE.Matrix3();

  const step = opts.gridSpacing;
  const minX = worldBounds.min.x;
  const maxX = worldBounds.max.x;
  const minZ = worldBounds.min.z;
  const maxZ = worldBounds.max.z;
  const castY = worldBounds.max.y + opts.sampleHeight;

  for (let x = minX; x <= maxX + 1e-4; x += step) {
    for (let z = minZ; z <= maxZ + 1e-4; z += step) {
      rayOrigin.set(x, castY, z);
      raycaster.set(rayOrigin, downDir);

      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length === 0) continue;

      let bestHit: THREE.Intersection | null = null;
      let bestDist = Infinity;

      for (const hit of hits) {
        if (!hit.face) continue;

        normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
        if (worldNormal.y < opts.minNormalY) continue;

        const yDist = Math.abs(hit.point.y - targetGroundY);
        if (yDist < bestDist) {
          bestDist = yDist;
          bestHit = hit;
        }
      }

      if (!bestHit || bestDist > opts.groundTolerance) continue;

      // Store nodes in collider-local space so they stay aligned with collider transforms.
      const localPoint = colliderScene.worldToLocal(bestHit.point.clone());
      graph.nodes.push(localPoint);
    }
  }

  console.log(
    `[NavGraph] Sampled ${graph.nodes.length} walkable nodes from ${meshes.length} meshes ` +
      `(bounds x:[${minX.toFixed(2)},${maxX.toFixed(2)}] z:[${minZ.toFixed(2)},${maxZ.toFixed(2)}], groundY=${targetGroundY.toFixed(2)})`,
  );

  const maxEdgeSq = opts.maxEdgeLength * opts.maxEdgeLength;
  const aWorld = new THREE.Vector3();
  const bWorld = new THREE.Vector3();
  const rayDir = new THREE.Vector3();

  for (let i = 0; i < graph.nodes.length; i++) {
    graph.edges.set(i, []);
  }

  for (let i = 0; i < graph.nodes.length; i++) {
    for (let j = i + 1; j < graph.nodes.length; j++) {
      const a = graph.nodes[i];
      const b = graph.nodes[j];
      const distSq = a.distanceToSquared(b);
      if (distSq > maxEdgeSq) continue;

      aWorld.copy(a);
      bWorld.copy(b);
      colliderScene.localToWorld(aWorld);
      colliderScene.localToWorld(bWorld);

      aWorld.y += opts.edgeProbeHeight;
      bWorld.y += opts.edgeProbeHeight;

      rayDir.subVectors(bWorld, aWorld);
      const dist = rayDir.length();
      if (dist <= opts.edgeClearance) continue;
      rayDir.divideScalar(dist);

      raycaster.set(aWorld, rayDir);
      raycaster.near = 0.001;
      raycaster.far = dist - opts.edgeClearance;
      const blockers = raycaster.intersectObjects(meshes, false);

      if (blockers.length > 0) continue;

      graph.edges.get(i)!.push(j);
      graph.edges.get(j)!.push(i);
    }
  }

  let edgeCount = 0;
  for (const neighbors of graph.edges.values()) edgeCount += neighbors.length;
  console.log(`[NavGraph] Built ${edgeCount / 2} edges`);

  return graph;
}
