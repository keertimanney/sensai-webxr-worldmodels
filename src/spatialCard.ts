
import * as THREE from "three";

// ------------------------------------------------------------
// SpatialCard — floating text card rendered via canvas texture
// ------------------------------------------------------------

const CARD_WIDTH = 0.6;   // meters
const CARD_HEIGHT = 0.35;  // meters
const CANVAS_W = 512;
const CANVAS_H = 300;
const PADDING = 24;
const FONT_SIZE = 18;
const LINE_HEIGHT = 24;
const HEADER_COLOR = "#4fc3f7";
const TEXT_COLOR = "#ffffff";
const BG_COLOR = "rgba(10, 10, 15, 0.88)";
const BORDER_COLOR = "rgba(79, 195, 247, 0.4)";

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function createSpatialCard(text: string): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.beginPath();
  ctx.roundRect(0, 0, CANVAS_W, CANVAS_H, 12);
  ctx.fill();

  // Border
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(1, 1, CANVAS_W - 2, CANVAS_H - 2, 12);
  ctx.stroke();

  // Header dot + label
  ctx.fillStyle = HEADER_COLOR;
  ctx.beginPath();
  ctx.arc(PADDING + 6, PADDING + 8, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `bold ${FONT_SIZE}px system-ui, sans-serif`;
  ctx.fillStyle = HEADER_COLOR;
  ctx.fillText("Analysis", PADDING + 20, PADDING + 14);

  // Body text
  ctx.font = `${FONT_SIZE - 2}px system-ui, sans-serif`;
  ctx.fillStyle = TEXT_COLOR;
  const maxTextWidth = CANVAS_W - PADDING * 2;
  const lines = wrapText(ctx, text, maxTextWidth);
  const startY = PADDING + 38;

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * LINE_HEIGHT;
    if (y > CANVAS_H - PADDING) break;
    ctx.fillText(lines[i], PADDING, y);
  }

  // Create Three.js mesh
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 900;
  mesh.raycast = () => {};
  return mesh;
}

/** Small pin marker left behind after commit. */
export function createPinMarker(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.025, 12, 12);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x4fc3f7,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 850;
  mesh.raycast = () => {};
  return mesh;
}
