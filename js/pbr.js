import * as THREE from "three";
import { state, getEnvMapIntensityForMaterial } from "./core.js";
import {
  applyFoliageBillboardToAllLoadedModels,
  DEFAULT_FOLIAGE_ALPHA_TEST
} from "./foliage-billboard.js";

let pbrMetalnessValue;
let pbrRoughnessValue;
let pbrEnvMapIntensityValue;
let pbrOpacityValue;
let pbrAlphaTestValue;

const DEFAULT_ENV_MAP_URL = new URL("../assets/huanjingtietu.png", import.meta.url).href;

export function syncPbrFromPanel() {
  const m = parseFloat(pbrMetalnessValue?.value) || 0;
  const r = parseFloat(pbrRoughnessValue?.value) ?? 0.5;
  const e = parseFloat(pbrEnvMapIntensityValue?.value) ?? 1;
  applyPbrToModel(m, r, e);
}

export function generateEnvironmentMapFromScene() {
  // Clear old env map.
  if (state.envMap) {
    state.envMap.dispose();
    state.envMap = null;
  }
  if (state.cubeCamera) {
    state.cubeCamera.renderTarget.dispose();
    state.scene.remove(state.cubeCamera);
    state.cubeCamera = null;
  }

  const size = 512;
  const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(size);
  cubeRenderTarget.texture.type = THREE.HalfFloatType;
  cubeRenderTarget.texture.colorSpace = THREE.SRGBColorSpace;

  state.cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);

  // Temporarily hide model, render only lighting + background.
  const originalVisible = {};
  if (state.modelRef) {
    state.modelRef.traverse((child) => {
      if (child.isMesh) {
        originalVisible[child.uuid] = child.visible;
        child.visible = false;
      }
    });
  }

  state.cubeCamera.position.set(0, 0, 0);
  state.cubeCamera.update(state.renderer, state.scene);

  // Restore visibility.
  if (state.modelRef) {
    state.modelRef.traverse((child) => {
      if (child.isMesh && Object.prototype.hasOwnProperty.call(originalVisible, child.uuid)) {
        child.visible = originalVisible[child.uuid];
      }
    });
  }

  state.envMap = cubeRenderTarget.texture;
  state.scene.environment = state.envMap;

  // Apply env map to model materials.
  if (state.modelRef) {
    state.modelRef.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => {
            if (mat.userData.foliageBillboardBasic) return;
            if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
              mat.envMap = state.envMap;
              mat.envMapIntensity = getEnvMapIntensityForMaterial(mat, 1.0);
              mat.needsUpdate = true;
            }
          });
        } else {
          if (
            !child.material.userData.foliageBillboardBasic &&
            (child.material.isMeshStandardMaterial || child.material.isMeshPhysicalMaterial)
          ) {
            child.material.envMap = state.envMap;
            child.material.envMapIntensity = getEnvMapIntensityForMaterial(child.material, 1.0);
            child.material.needsUpdate = true;
          }
        }
      }
    });
  }

  return state.envMap;
}

function applyPbrToModel(metalness, roughness, envMapIntensity) {
  if (!state.modelRef) return;

  const envEnabledEl = document.getElementById("pbrEnvEnabled");
  const envEnabled = envEnabledEl ? envEnabledEl.checked : true;

  if (!envEnabled) {
    state.scene.environment = null;
    state.modelRef.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          if (mat.userData.foliageBillboardBasic) return;
          if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
            mat.envMap = null;
            mat.envMapIntensity = 0;
            mat.needsUpdate = true;
          }
        });
      }
    });
    return;
  }

  state.scene.environment = state.envMap;
  state.modelRef.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (mat.userData.foliageBillboardBasic) return;
        if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
          const isTransparent = mat.transparent === true || (typeof mat.opacity === "number" && mat.opacity < 1);
          if (!isTransparent && !mat.userData.skipGlobalPbr) {
            mat.metalness = metalness;
            mat.roughness = roughness;
          }
          mat.envMapIntensity = getEnvMapIntensityForMaterial(mat, envMapIntensity);
          if (state.envMap) mat.envMap = state.envMap;
          mat.needsUpdate = true;
        }
      });
    }
  });
}

function applyTransparencyFix(enable) {
  if (!state.modelRef) return;

  state.modelRef.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      let hasTransparent = false;
      mats.forEach((mat) => {
        const isTransparent = mat.transparent === true || (typeof mat.opacity === "number" && mat.opacity < 1);
        if (isTransparent) {
          hasTransparent = true;
          mat.transparent = enable;
          // 面片树等：配合 alphaTest 裁切时保持深度写入，避免十字面片互相穿透、排序错误。
          mat.depthWrite = true;
          if (mat.side !== undefined) mat.side = enable ? THREE.DoubleSide : THREE.FrontSide;
          mat.needsUpdate = true;
        }
      });
      child.renderOrder = hasTransparent && enable ? 1 : 0;
    }
  });
}

function applyTransparencyParams(opacity, alphaTest) {
  if (!state.modelRef) return;

  const baseIntensityEl = document.getElementById("pbrEnvMapIntensityValue");
  const baseIntensity = baseIntensityEl ? parseFloat(baseIntensityEl.value) ?? 1 : 1;

  state.modelRef.traverse((child) => {
    if (child.isMesh && child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        const isTransparent = mat.transparent === true || (typeof mat.opacity === "number" && mat.opacity < 1);
        if (isTransparent && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) {
          mat.opacity = opacity;
          mat.alphaTest = alphaTest;
          mat.envMapIntensity = getEnvMapIntensityForMaterial(mat, baseIntensity);
          if (state.envMap) mat.envMap = state.envMap;
          mat.needsUpdate = true;
        }
      });
    }
  });
}

function clearImageEnvironmentMap() {
  state.useImageEnvMap = false;

  if (state.envMap) {
    state.envMap.dispose();
    state.envMap = null;
  }
  state.scene.environment = null;

  if (state.modelRef) {
    state.modelRef.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          if (mat.userData.foliageBillboardBasic) return;
          if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
            mat.envMap = null;
            mat.envMapIntensity = 0;
            mat.needsUpdate = true;
          }
        });
      }
    });
  }

  const paramsEl = document.getElementById("imageEnvMapParams");
  if (paramsEl) paramsEl.style.display = "none";
}

function loadImageEnvironmentMap() {
  const loader = new THREE.TextureLoader();
  loader.load(
    DEFAULT_ENV_MAP_URL,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      const cubeEnvMap = state.pmremGenerator.fromEquirectangular(texture).texture;

      if (state.envMap) {
        state.envMap.dispose();
        state.envMap = null;
      }
      if (state.cubeCamera) {
        state.cubeCamera.renderTarget.dispose();
        state.scene.remove(state.cubeCamera);
        state.cubeCamera = null;
      }

      state.envMap = cubeEnvMap;
      state.scene.environment = state.envMap;
      state.useImageEnvMap = true;

      const envIntensityEl = document.getElementById("pbrEnvMapIntensityValue");
      const envIntensity = envIntensityEl ? parseFloat(envIntensityEl.value) || 1 : 1;

      if (state.modelRef) {
        state.modelRef.traverse((child) => {
          if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => {
                if (mat.userData.foliageBillboardBasic) return;
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                  mat.envMap = state.envMap;
                  mat.envMapIntensity = getEnvMapIntensityForMaterial(mat, envIntensity);
                  mat.needsUpdate = true;
                }
              });
            } else {
              if (
                !child.material.userData.foliageBillboardBasic &&
                (child.material.isMeshStandardMaterial || child.material.isMeshPhysicalMaterial)
              ) {
                child.material.envMap = state.envMap;
                child.material.envMapIntensity = getEnvMapIntensityForMaterial(child.material, envIntensity);
                child.material.needsUpdate = true;
              }
            }
          }
        });
      }

      syncPbrFromPanel();
      console.log("环境贴图 huanjingtietu.png 已加载并应用");
    },
    undefined,
    (err) => console.warn("加载环境贴图 huanjingtietu.png 失败:", err)
  );
}

function loadEnvironmentMapFromFile(file) {
  if (!file || !file.type.startsWith("image/")) return;

  const url = URL.createObjectURL(file);
  const loader = new THREE.TextureLoader();
  loader.load(
    url,
    (texture) => {
      URL.revokeObjectURL(url);

      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      const cubeEnvMap = state.pmremGenerator.fromEquirectangular(texture).texture;

      if (state.envMap) {
        state.envMap.dispose();
        state.envMap = null;
      }
      if (state.cubeCamera) {
        state.cubeCamera.renderTarget.dispose();
        state.scene.remove(state.cubeCamera);
        state.cubeCamera = null;
      }

      state.envMap = cubeEnvMap;
      state.scene.environment = state.envMap;
      state.useImageEnvMap = true;

      const envIntensityEl = document.getElementById("pbrEnvMapIntensityValue");
      const envIntensity = envIntensityEl ? parseFloat(envIntensityEl.value) || 1 : 1;

      if (state.modelRef) {
        state.modelRef.traverse((child) => {
          if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => {
                if (mat.userData.foliageBillboardBasic) return;
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                  mat.envMap = state.envMap;
                  mat.envMapIntensity = getEnvMapIntensityForMaterial(mat, envIntensity);
                  mat.needsUpdate = true;
                }
              });
            } else {
              if (
                !child.material.userData.foliageBillboardBasic &&
                (child.material.isMeshStandardMaterial || child.material.isMeshPhysicalMaterial)
              ) {
                child.material.envMap = state.envMap;
                child.material.envMapIntensity = getEnvMapIntensityForMaterial(child.material, envIntensity);
                child.material.needsUpdate = true;
              }
            }
          }
        });
      }

      syncPbrFromPanel();
      console.log("本地环境贴图已加载并应用:", file.name);
    },
    undefined,
    (err) => {
      URL.revokeObjectURL(url);
      console.warn("加载本地环境贴图失败:", err);
    }
  );
}

export function initPbrControls() {
  // ---- PBR panel ----
  const pbrMetalness = document.getElementById("pbrMetalness");
  const pbrRoughness = document.getElementById("pbrRoughness");
  const pbrEnvMapIntensity = document.getElementById("pbrEnvMapIntensity");

  pbrMetalnessValue = document.getElementById("pbrMetalnessValue");
  pbrRoughnessValue = document.getElementById("pbrRoughnessValue");
  pbrEnvMapIntensityValue = document.getElementById("pbrEnvMapIntensityValue");

  pbrOpacityValue = document.getElementById("pbrOpacityValue");
  pbrAlphaTestValue = document.getElementById("pbrAlphaTestValue");

  if (pbrMetalness && pbrMetalnessValue) {
    pbrMetalness.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value) || 0;
      pbrMetalnessValue.value = v.toFixed(2);
      syncPbrFromPanel();
    });
    pbrMetalnessValue.addEventListener("input", () => syncPbrFromPanel());
  }

  if (pbrRoughness && pbrRoughnessValue) {
    pbrRoughness.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value) ?? 0.5;
      pbrRoughnessValue.value = v.toFixed(2);
      syncPbrFromPanel();
    });
    pbrRoughnessValue.addEventListener("input", () => syncPbrFromPanel());
  }

  if (pbrEnvMapIntensity && pbrEnvMapIntensityValue) {
    pbrEnvMapIntensity.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value) ?? 1;
      pbrEnvMapIntensityValue.value = v.toFixed(2);
      syncPbrFromPanel();
    });
    pbrEnvMapIntensityValue.addEventListener("input", () => syncPbrFromPanel());
  }

  const pbrEnvEnabled = document.getElementById("pbrEnvEnabled");
  const pbrTransparencyEnabled = document.getElementById("pbrTransparencyEnabled");
  const pbrTransparencyControls = document.getElementById("pbrTransparencyControls");
  const pbrOpacity = document.getElementById("pbrOpacity");
  const pbrAlphaTest = document.getElementById("pbrAlphaTest");

  if (pbrEnvEnabled) pbrEnvEnabled.addEventListener("change", () => syncPbrFromPanel());

  function syncTransparencyFromPanel() {
    const op = parseFloat(pbrOpacityValue?.value) ?? 0.8;
    const at = parseFloat(pbrAlphaTestValue?.value) ?? 0;
    applyTransparencyParams(op, at);
  }

  if (pbrTransparencyEnabled) {
    pbrTransparencyEnabled.addEventListener("change", (e) => {
      const on = e.target.checked;
      if (pbrTransparencyControls) pbrTransparencyControls.style.display = on ? "block" : "none";
      applyTransparencyFix(on);
      if (on) {
        const op = parseFloat(pbrOpacityValue?.value || "0.8") || 0.8;
        const at = parseFloat(pbrAlphaTestValue?.value || "0") || 0;
        applyTransparencyParams(op, at);
      }
    });
  }

  if (pbrOpacity) {
    pbrOpacity.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value) ?? 0.8;
      if (pbrOpacityValue) pbrOpacityValue.value = v.toFixed(2);
      syncTransparencyFromPanel();
    });
  }
  if (pbrOpacityValue) pbrOpacityValue.addEventListener("input", () => syncTransparencyFromPanel());

  if (pbrAlphaTest) {
    pbrAlphaTest.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value) || 0;
      if (pbrAlphaTestValue) pbrAlphaTestValue.value = v.toFixed(2);
      syncTransparencyFromPanel();
    });
  }
  if (pbrAlphaTestValue) pbrAlphaTestValue.addEventListener("input", () => syncTransparencyFromPanel());

  const pbrFoliageBillboardEnabled = document.getElementById("pbrFoliageBillboardEnabled");
  const pbrFoliageAlphaTest = document.getElementById("pbrFoliageAlphaTest");
  const pbrFoliageAlphaTestValue = document.getElementById("pbrFoliageAlphaTestValue");

  function readFoliageAlphaTest() {
    const v = parseFloat(pbrFoliageAlphaTestValue?.value);
    return Number.isFinite(v) ? v : DEFAULT_FOLIAGE_ALPHA_TEST;
  }

  function syncFoliageBillboardFromPanel() {
    if (!pbrFoliageBillboardEnabled) return;
    const on = pbrFoliageBillboardEnabled.checked;
    if (on) applyFoliageBillboardToAllLoadedModels(true, readFoliageAlphaTest());
    else applyFoliageBillboardToAllLoadedModels(false);
  }

  if (pbrFoliageBillboardEnabled) {
    pbrFoliageBillboardEnabled.addEventListener("change", () => syncFoliageBillboardFromPanel());
  }
  if (pbrFoliageAlphaTest && pbrFoliageAlphaTestValue) {
    pbrFoliageAlphaTest.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) pbrFoliageAlphaTestValue.value = v.toFixed(2);
      if (pbrFoliageBillboardEnabled?.checked) applyFoliageBillboardToAllLoadedModels(true, readFoliageAlphaTest());
    });
    pbrFoliageAlphaTestValue.addEventListener("input", () => {
      const v = parseFloat(pbrFoliageAlphaTestValue.value);
      if (pbrFoliageAlphaTest && Number.isFinite(v)) pbrFoliageAlphaTest.value = String(v);
      if (pbrFoliageBillboardEnabled?.checked) applyFoliageBillboardToAllLoadedModels(true, readFoliageAlphaTest());
    });
  }

  // ---- Environment map: image & file upload ----
  const imageEnvMapCheckbox = document.getElementById("imageEnvMapEnabled");
  const imageEnvMapParamsEl = document.getElementById("imageEnvMapParams");

  const applyEnvMapToggle = () => {
    if (imageEnvMapCheckbox?.checked) {
      loadImageEnvironmentMap();
      if (imageEnvMapParamsEl) imageEnvMapParamsEl.style.display = "";
    } else {
      clearImageEnvironmentMap();
    }
  };

  if (imageEnvMapCheckbox && imageEnvMapParamsEl) {
    applyEnvMapToggle();
    imageEnvMapCheckbox.addEventListener("change", () => applyEnvMapToggle());

    const uploadEnvMapBtn = document.getElementById("uploadEnvMapButton");
    const envMapFileInput = document.getElementById("envMapFileInput");
    if (uploadEnvMapBtn && envMapFileInput) {
      uploadEnvMapBtn.addEventListener("click", () => envMapFileInput.click());
      envMapFileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) loadEnvironmentMapFromFile(file);
        e.target.value = "";
      });
    }
  } else {
    loadImageEnvironmentMap();
  }
}

