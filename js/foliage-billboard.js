import * as THREE from "three";
import { state } from "./core.js";
import { refreshMaterialList } from "./material-editor.js";

const UD_BACKUP = "foliageBillboardBackups";
export const UD_FOLIAGE_BASIC = "foliageBillboardBasic";

export const DEFAULT_FOLIAGE_ALPHA_TEST = 0.4;

/**
 * 可转为面片树 Unlit + AlphaTest 的材质：带 map/alphaMap，且为半透明、已有裁切，或 userData.forceFoliageBillboard。
 */
export function isFoliageBillboardCandidate(mat) {
  if (!mat) return false;
  if (mat.userData[UD_FOLIAGE_BASIC]) return false;
  if (mat.userData.forceFoliageBillboard && (mat.map || mat.alphaMap)) return true;
  const okType =
    mat.isMeshStandardMaterial ||
    mat.isMeshPhysicalMaterial ||
    mat.isMeshLambertMaterial ||
    mat.isMeshPhongMaterial ||
    mat.isMeshBasicMaterial;
  if (!okType) return false;
  if (!mat.map && !mat.alphaMap) return false;
  return (
    mat.transparent === true ||
    (typeof mat.opacity === "number" && mat.opacity < 1) ||
    (typeof mat.alphaTest === "number" && mat.alphaTest > 0)
  );
}

function copyTextureParams(dst, src) {
  if (!dst || !src || dst === src) return;
  dst.offset.copy(src.offset);
  dst.repeat.copy(src.repeat);
  dst.center.copy(src.center);
  dst.rotation = src.rotation;
  dst.wrapS = src.wrapS;
  dst.wrapT = src.wrapT;
}

/**
 * @param {THREE.Material} sourceMat 备份克隆或原始材质（贴图引用与源一致）
 */
export function createFoliageBasicFromSource(sourceMat, alphaTest) {
  const m = new THREE.MeshBasicMaterial({
    map: sourceMat.map || null,
    alphaMap: sourceMat.alphaMap || null,
    color: sourceMat.color ? sourceMat.color.clone() : new THREE.Color(0xffffff),
    vertexColors: !!sourceMat.vertexColors,
    alphaTest,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide
  });
  m.name = sourceMat.name || "";
  m.userData = { ...sourceMat.userData, [UD_FOLIAGE_BASIC]: true };
  if (sourceMat.map) copyTextureParams(m.map, sourceMat.map);
  if (sourceMat.alphaMap && sourceMat.alphaMap !== sourceMat.map) {
    copyTextureParams(m.alphaMap, sourceMat.alphaMap);
  }
  return m;
}

function processMeshMaterials(mesh, enable, alphaTest) {
  const isArr = Array.isArray(mesh.material);
  const list = isArr ? mesh.material.slice() : [mesh.material];

  if (!enable) {
    const backups = mesh.userData[UD_BACKUP];
    if (!backups) return;
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      if (cur && cur.userData[UD_FOLIAGE_BASIC]) cur.dispose();
    }
    const restored = [];
    for (let i = 0; i < list.length; i++) {
      restored.push(backups[i] != null ? backups[i] : list[i]);
    }
    mesh.material = isArr ? restored : restored[0];
    delete mesh.userData[UD_BACKUP];
    mesh.renderOrder = 0;
    return;
  }

  let backups = mesh.userData[UD_BACKUP];
  if (!backups || backups.length !== list.length) {
    backups = new Array(list.length).fill(null);
    mesh.userData[UD_BACKUP] = backups;
  }

  const out = [];
  for (let i = 0; i < list.length; i++) {
    const mat = list[i];
    if (!mat) {
      out.push(null);
      continue;
    }
    if (mat.userData[UD_FOLIAGE_BASIC]) {
      mat.alphaTest = alphaTest;
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      mat.side = THREE.DoubleSide;
      mat.needsUpdate = true;
      out.push(mat);
      continue;
    }
    if (!isFoliageBillboardCandidate(mat)) {
      out.push(mat);
      continue;
    }
    if (backups[i] == null) backups[i] = mat.clone();
    out.push(createFoliageBasicFromSource(backups[i], alphaTest));
  }
  mesh.material = isArr ? out : out[0];
  mesh.renderOrder = 0;
}

/**
 * @param {THREE.Object3D} root
 * @param {boolean} enable
 * @param {number} [alphaTest]
 */
export function setFoliageBillboardOnObject3D(root, enable, alphaTest = DEFAULT_FOLIAGE_ALPHA_TEST) {
  if (!root) return;
  const at =
    typeof alphaTest === "number" && Number.isFinite(alphaTest) ? alphaTest : DEFAULT_FOLIAGE_ALPHA_TEST;
  root.traverse((o) => {
    if (o.isMesh && o.material) processMeshMaterials(o, enable, at);
  });
}

/**
 * @param {boolean} enable
 * @param {number} [alphaTest]
 */
export function applyFoliageBillboardToAllLoadedModels(enable, alphaTest) {
  const roots = state.loadedModels || [];
  for (let i = 0; i < roots.length; i++) {
    setFoliageBillboardOnObject3D(roots[i], enable, alphaTest);
  }
  refreshMaterialList();
}
