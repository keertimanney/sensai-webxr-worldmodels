import * as THREE from "three";
import { NavGraph } from "./navGraph.js";


// ------------------------------------------------------------
// Debug visualization for the NavGraph
// ------------------------------------------------------------

export interface NavGraphDebugOptions {
  nodeRadius?: number;
  nodeColor?: number;
  edgeColor?: number;
  nodeOpacity?: number;
  edgeOpacity?: number;
  yOffset?: number;
  depthTest?: boolean;
}

const DEBUG_DEFAULTS: Required<NavGraphDebugOptions> = {
  nodeRadius: 0.045,
  nodeColor: 0x00ff44,
  edgeColor: 0x44ff88,
  nodeOpacity: 0.8,
  edgeOpacity: 0.45,
  yOffset: 0.02,
  depthTest: true,
};

export function createNavGraphOverlay(
  graph: NavGraph,
  options?: NavGraphDebugOptions,
): THREE.Group {
  const opts = { ...DEBUG_DEFAULTS, ...options };
  const group = new THREE.Group();
  group.name = "navGraphDebug";

  if (graph.nodes.length === 0) {
    console.warn("[NavGraphDebug] No nodes to visualize");
    return group;
  }

  const nodeMat = new THREE.MeshBasicMaterial({
    color: opts.nodeColor,
    depthTest: opts.depthTest,
    depthWrite: false,
    transparent: true,
    opacity: opts.nodeOpacity,
  });
  const nodeGeo = new THREE.SphereGeometry(opts.nodeRadius, 8, 8);

  for (const pos of graph.nodes) {
    const sphere = new THREE.Mesh(nodeGeo, nodeMat);
    sphere.position.copy(pos);
    sphere.position.y += opts.yOffset;
    sphere.raycast = () => {};
    group.add(sphere);
  }

  const edgePositions: number[] = [];
  const visited = new Set<string>();

  for (const [i, neighbors] of graph.edges) {
    for (const j of neighbors) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const a = graph.nodes[i];
      const b = graph.nodes[j];
      edgePositions.push(a.x, a.y + opts.yOffset, a.z);
      edgePositions.push(b.x, b.y + opts.yOffset, b.z);
    }
  }

  if (edgePositions.length > 0) {
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePositions, 3),
    );

    const lineMat = new THREE.LineBasicMaterial({
      color: opts.edgeColor,
      transparent: true,
      opacity: opts.edgeOpacity,
      depthTest: opts.depthTest,
      depthWrite: false,
    });

    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.raycast = () => {};
    group.add(lines);
  }

  console.log(
    `[NavGraphDebug] Visualizing ${graph.nodes.length} nodes, ${visited.size} edges`,
  );

  return group;
}
