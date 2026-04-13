/**
 * Drag panels by handle (title bar / grip). Converts fixed right/bottom to left/top on first drag.
 */
let dragZ = 220;

function anchorToLeftTop(el) {
  if (el.dataset.dragAnchored === "1") return;
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.round(r.left)}px`;
  el.style.top = `${Math.round(r.top)}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.dataset.dragAnchored = "1";
}

function clampPanelPosition(panel) {
  const pad = 6;
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  let l = parseFloat(panel.style.left) || 0;
  let t = parseFloat(panel.style.top) || 0;
  const maxL = Math.max(pad, window.innerWidth - w - pad);
  const maxT = Math.max(pad, window.innerHeight - h - pad);
  l = Math.min(Math.max(l, pad), maxL);
  t = Math.min(Math.max(t, pad), maxT);
  panel.style.left = `${l}px`;
  panel.style.top = `${t}px`;
}

function bindPanelDrag(panel, handle) {
  if (!panel || !handle) return;

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button, input, select, textarea, a, label")) return;

    e.preventDefault();
    anchorToLeftTop(panel);
    panel.style.zIndex = String(++dragZ);
    handle.setPointerCapture(e.pointerId);
    handle.style.cursor = "grabbing";

    const startX = e.clientX;
    const startY = e.clientY;
    const baseL = parseFloat(panel.style.left) || 0;
    const baseT = parseFloat(panel.style.top) || 0;

    function onMove(ev) {
      let nl = baseL + (ev.clientX - startX);
      let nt = baseT + (ev.clientY - startY);
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const pad = 6;
      nl = Math.min(Math.max(nl, pad), Math.max(pad, window.innerWidth - w - pad));
      nt = Math.min(Math.max(nt, pad), Math.max(pad, window.innerHeight - h - pad));
      panel.style.left = `${nl}px`;
      panel.style.top = `${nt}px`;
    }

    function onUp(ev) {
      handle.releasePointerCapture(ev.pointerId);
      handle.style.cursor = "grab";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  });
}

const PANEL_DRAG_CONFIG = [
  { root: "#modelInfoDock", handle: ".info-title.panel-drag-handle" },
  { root: "#modelNodesPanel", handle: ".info-title.panel-drag-handle" },
  { root: "#leftPanelsWrap", handle: ".panel-drag-handle--bar" },
  { root: "#rightPanelsContainer", handle: ".panel-drag-handle--bar" },
  { root: "#modelLoadQueuePanel", handle: ".queue-drag-grip" },
  { root: "#floatingToolbar", handle: ".panel-drag-handle--bar" }
];

export function initDraggablePanels() {
  for (let i = 0; i < PANEL_DRAG_CONFIG.length; i++) {
    const { root, handle } = PANEL_DRAG_CONFIG[i];
    const panel = document.querySelector(root);
    if (!panel) continue;
    const h = panel.querySelector(handle);
    if (!h) continue;
    bindPanelDrag(panel, h);
  }

  window.addEventListener("resize", () => {
    for (let i = 0; i < PANEL_DRAG_CONFIG.length; i++) {
      const panel = document.querySelector(PANEL_DRAG_CONFIG[i].root);
      if (panel && panel.dataset.dragAnchored === "1") clampPanelPosition(panel);
    }
  });
}
