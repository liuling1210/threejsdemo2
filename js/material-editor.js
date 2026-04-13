import * as THREE from "three";
import { state, getEnvMapIntensityForMaterial } from "./core.js";

let listEl;
let summaryEl;
let editSection;
let hintEl;
let colorInput;
let metalnessR;
let metalnessN;
let roughnessR;
let roughnessN;
let opacityR;
let opacityN;
let alphaTestR;
let alphaTestN;
let transparentCb;
let depthWriteCb;
let sideSelect;

/** @type {{ key: string, mesh: import("three").Mesh, index: number }[]} */
let slots = [];
let selectedKey = null;
let suppressUiSync = false;

function traverseMeshes(fn) {
  const roots = state.loadedModels || [];
  for (let r = 0; r < roots.length; r++) {
    roots[r].traverse((child) => {
      if (child.isMesh && child.material) fn(child);
    });
  }
}

function countRefsToMaterial(mat) {
  let n = 0;
  traverseMeshes((mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < mats.length; i++) {
      if (mats[i] === mat) n++;
    }
  });
  return n;
}

function ensureUniqueMaterial(mesh, index) {
  const isArr = Array.isArray(mesh.material);
  const mats = isArr ? mesh.material : [mesh.material];
  const mat = mats[index];
  if (!mat) return null;
  if (countRefsToMaterial(mat) <= 1) return mat;

  const cloned = mat.clone();
  cloned.needsUpdate = true;
  if (state.envMap && (cloned.isMeshStandardMaterial || cloned.isMeshPhysicalMaterial)) {
    cloned.envMap = state.envMap;
    const el = document.getElementById("pbrEnvMapIntensityValue");
    const base = el ? parseFloat(el.value) || 1 : 1;
    cloned.envMapIntensity = getEnvMapIntensityForMaterial(cloned, base);
  }
  if (isArr) {
    const next = mesh.material.slice();
    next[index] = cloned;
    mesh.material = next;
  } else {
    mesh.material = cloned;
  }
  return cloned;
}

function materialLabel(mat) {
  if (!mat) return "(空)";
  return mat.name || mat.type || "Material";
}

function buildSlots() {
  const out = [];
  traverseMeshes((mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let index = 0; index < mats.length; index++) {
      const mat = mats[index];
      if (!mat) continue;
      out.push({ key: `${mesh.uuid}:${index}`, mesh, index });
    }
  });
  return out;
}

function isPbr(mat) {
  return mat && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial);
}

function hasColor(mat) {
  return mat && mat.color && mat.color.isColor;
}

function syncUiFromMaterial(mat) {
  suppressUiSync = true;
  try {
    if (hasColor(mat) && colorInput) colorInput.value = "#" + mat.color.getHexString();
    else if (colorInput) colorInput.value = "#ffffff";

    if (isPbr(mat)) {
      if (metalnessR) metalnessR.value = String(mat.metalness);
      if (metalnessN) metalnessN.value = Number(mat.metalness.toFixed(2));
      if (roughnessR) roughnessR.value = String(mat.roughness);
      if (roughnessN) roughnessN.value = Number(mat.roughness.toFixed(2));
    }

    const op = typeof mat.opacity === "number" ? mat.opacity : 1;
    if (opacityR) opacityR.value = String(op);
    if (opacityN) opacityN.value = op.toFixed(2);
    const at = typeof mat.alphaTest === "number" ? mat.alphaTest : 0;
    if (alphaTestR) alphaTestR.value = String(at);
    if (alphaTestN) alphaTestN.value = at.toFixed(2);
    if (transparentCb) transparentCb.checked = !!mat.transparent;
    if (depthWriteCb) depthWriteCb.checked = mat.depthWrite !== false;

    if (sideSelect) {
      if (mat.side === THREE.DoubleSide) sideSelect.value = "2";
      else if (mat.side === THREE.BackSide) sideSelect.value = "1";
      else sideSelect.value = "0";
    }

    document.querySelectorAll(".material-pbr-only").forEach((el) => {
      el.style.display = isPbr(mat) ? "" : "none";
    });
  } finally {
    suppressUiSync = false;
  }
}

function getSelectedSlot() {
  return slots.find((s) => s.key === selectedKey) || null;
}

function getMatAtSlot(slot) {
  const mats = Array.isArray(slot.mesh.material) ? slot.mesh.material : [slot.mesh.material];
  return mats[slot.index] || null;
}

function applyMatUpdate(mutator) {
  if (suppressUiSync) return;
  const slot = getSelectedSlot();
  if (!slot) return;
  const mat = ensureUniqueMaterial(slot.mesh, slot.index);
  if (!mat) return;
  mutator(mat);
  mat.needsUpdate = true;
  refreshMaterialList();
}

function wireRangePair(range, num, onVal) {
  if (!range && !num) return;
  const apply = (raw) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    onVal(v);
  };
  if (range) {
    range.addEventListener("input", () => {
      if (num) num.value = parseFloat(range.value).toFixed(2);
      apply(range.value);
    });
  }
  if (num) {
    num.addEventListener("input", () => {
      if (range) range.value = String(parseFloat(num.value) || 0);
      apply(num.value);
    });
  }
}

export function refreshMaterialList() {
  const prevKey = selectedKey;
  slots = buildSlots();

  if (!listEl || !summaryEl) return;

  if (!slots.length) {
    summaryEl.textContent = "槽位: 0";
    listEl.innerHTML = "";
    selectedKey = null;
    if (editSection) editSection.style.display = "none";
    return;
  }

  summaryEl.textContent = `槽位: ${slots.length}`;
  listEl.innerHTML = "";

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const mat = getMatAtSlot(s);
    const shared = mat && countRefsToMaterial(mat) > 1;
    const meshName = s.mesh.name || "Mesh";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "material-list-item" + (s.key === prevKey ? " active" : "");
    btn.textContent = `${meshName} [${s.index}] · ${materialLabel(mat)}${shared ? " (共享)" : ""}`;
    btn.addEventListener("click", () => {
      selectedKey = s.key;
      refreshMaterialList();
    });
    listEl.appendChild(btn);
  }

  selectedKey = prevKey;
  if (!slots.some((x) => x.key === selectedKey)) selectedKey = null;

  if (selectedKey && editSection) {
    const slot = getSelectedSlot();
    const mat = slot ? getMatAtSlot(slot) : null;
    editSection.style.display = "";
    if (hintEl) {
      if (mat && countRefsToMaterial(mat) > 1) {
        hintEl.textContent =
          "该槽位与其他网格共享同一材质对象；修改任意属性时会自动克隆，仅影响当前槽位。";
      } else {
        hintEl.textContent = "";
      }
    }
    if (mat) syncUiFromMaterial(mat);
  } else if (editSection) {
    editSection.style.display = "none";
  }
}

export function initMaterialEditor() {
  listEl = document.getElementById("materialList");
  summaryEl = document.getElementById("materialListSummary");
  editSection = document.getElementById("materialEditSection");
  hintEl = document.getElementById("materialEditHint");
  colorInput = document.getElementById("matEditColor");
  metalnessR = document.getElementById("matMetalness");
  metalnessN = document.getElementById("matMetalnessValue");
  roughnessR = document.getElementById("matRoughness");
  roughnessN = document.getElementById("matRoughnessValue");
  opacityR = document.getElementById("matOpacity");
  opacityN = document.getElementById("matOpacityValue");
  alphaTestR = document.getElementById("matAlphaTest");
  alphaTestN = document.getElementById("matAlphaTestValue");
  transparentCb = document.getElementById("matTransparent");
  depthWriteCb = document.getElementById("matDepthWrite");
  sideSelect = document.getElementById("matSide");

  if (!listEl) return;

  colorInput?.addEventListener("input", () => {
    applyMatUpdate((mat) => {
      if (hasColor(mat)) mat.color.setStyle(colorInput.value);
    });
  });

  wireRangePair(metalnessR, metalnessN, (v) => {
    applyMatUpdate((mat) => {
      if (isPbr(mat)) {
        mat.metalness = v;
        mat.userData.skipGlobalPbr = true;
      }
    });
  });

  wireRangePair(roughnessR, roughnessN, (v) => {
    applyMatUpdate((mat) => {
      if (isPbr(mat)) {
        mat.roughness = v;
        mat.userData.skipGlobalPbr = true;
      }
    });
  });

  wireRangePair(opacityR, opacityN, (v) => {
    applyMatUpdate((mat) => {
      mat.opacity = v;
      if (state.envMap && isPbr(mat)) {
        const el = document.getElementById("pbrEnvMapIntensityValue");
        const base = el ? parseFloat(el.value) || 1 : 1;
        mat.envMapIntensity = getEnvMapIntensityForMaterial(mat, base);
      }
    });
  });

  wireRangePair(alphaTestR, alphaTestN, (v) => {
    applyMatUpdate((mat) => {
      mat.alphaTest = v;
    });
  });

  transparentCb?.addEventListener("change", () => {
    applyMatUpdate((mat) => {
      mat.transparent = transparentCb.checked;
      if (state.envMap && isPbr(mat)) {
        const el = document.getElementById("pbrEnvMapIntensityValue");
        const base = el ? parseFloat(el.value) || 1 : 1;
        mat.envMapIntensity = getEnvMapIntensityForMaterial(mat, base);
      }
    });
  });

  depthWriteCb?.addEventListener("change", () => {
    applyMatUpdate((mat) => {
      mat.depthWrite = depthWriteCb.checked;
    });
  });

  sideSelect?.addEventListener("change", () => {
    const v = sideSelect.value;
    const map = { "0": THREE.FrontSide, "1": THREE.BackSide, "2": THREE.DoubleSide };
    applyMatUpdate((mat) => {
      mat.side = map[v] ?? THREE.FrontSide;
    });
  });

  refreshMaterialList();
}
