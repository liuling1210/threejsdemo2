import * as THREE from "three";
import { state } from "./core.js";
import { setOutlineSelectedObjects } from "./post-outline.js";
import {
  restoreHighlightedMeshes,
  focusModelNodesPanelOnObject,
  clearModelNodesPanelPickedRow
} from "./model-loader.js";

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

let downX = 0;
let downY = 0;
let downTime = 0;

function meshAncestorsVisible(mesh) {
  let o = mesh;
  while (o) {
    if (o.visible === false) return false;
    o = o.parent;
  }
  return true;
}

function pickFromPointerEvent(event) {
  const canvas = state.renderer && state.renderer.domElement;
  if (!canvas || !state.camera || !state.outlinePass) return;

  const rect = canvas.getBoundingClientRect();
  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(ndc, state.camera);
  const roots = state.loadedModels.filter(Boolean);
  if (!roots.length) {
    restoreHighlightedMeshes();
    setOutlineSelectedObjects([]);
    return;
  }

  const hits = raycaster.intersectObjects(roots, true);
  const first = hits.find((h) => h.object && h.object.isMesh && meshAncestorsVisible(h.object));

  restoreHighlightedMeshes();
  if (first) {
    setOutlineSelectedObjects([first.object]);
    focusModelNodesPanelOnObject(first.object);
  } else {
    setOutlineSelectedObjects([]);
    clearModelNodesPanelPickedRow();
  }
}

export function initViewportMeshPick() {
  const canvas = state.renderer && state.renderer.domElement;
  if (!canvas) return;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    downTime = performance.now();
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (dx * dx + dy * dy > 49) return;
    if (performance.now() - downTime > 900) return;
    pickFromPointerEvent(e);
  });
}
