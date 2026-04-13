/**
 * 交叉面片 + 带透明通道的贴图时，平行光阴影默认按矩形几何投射。
 * 引擎在 alphaTest>0 且存在 map/alphaMap 时会对阴影 depth pass 做 alpha 裁切（见 WebGLShadowMap.getDepthMaterial）。
 */
function isShadowCutoutCandidate(mat) {
  if (!mat) return false;
  return (
    mat.isMeshStandardMaterial === true ||
    mat.isMeshPhysicalMaterial === true ||
    mat.isMeshBasicMaterial === true ||
    mat.isMeshLambertMaterial === true ||
    mat.isMeshPhongMaterial === true
  );
}

/**
 * @param {THREE.Object3D} root
 * @param {{ threshold?: number }} [opts]
 */
export function applyTexturedAlphaShadowFix(root, opts = {}) {
  const threshold = typeof opts.threshold === "number" ? opts.threshold : 0.5;
  if (!root) return;

  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      if (!isShadowCutoutCandidate(mat)) continue;
      if (mat.isMeshPhysicalMaterial && mat.transmission > 0) continue;
      if (!mat.map && !mat.alphaMap) continue;
      if (mat.alphaTest > 0) continue;

      const useCutout = mat.alphaMap != null || (mat.map != null && mat.transparent === true);

      if (!useCutout) continue;

      mat.alphaTest = threshold;
      mat.needsUpdate = true;
    }
  });
}
