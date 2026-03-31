import { state } from "./core.js";
import { generateEnvironmentMapFromScene } from "./pbr.js";

export function initLightingControls() {
  const leftHemiIntensity = document.getElementById("leftHemiIntensity");
  const leftHemiIntensityValue = document.getElementById("leftHemiIntensityValue");
  const leftDirIntensity = document.getElementById("leftDirIntensity");
  const leftDirIntensityValue = document.getElementById("leftDirIntensityValue");
  const leftDirX = document.getElementById("leftDirX");
  const leftDirY = document.getElementById("leftDirY");
  const leftDirZ = document.getElementById("leftDirZ");

  if (
    !leftHemiIntensity ||
    !leftHemiIntensityValue ||
    !leftDirIntensity ||
    !leftDirIntensityValue ||
    !leftDirX ||
    !leftDirY ||
    !leftDirZ
  ) {
    return;
  }

  leftHemiIntensity.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    state.hemiLight.intensity = value;
    leftHemiIntensityValue.value = value.toFixed(1);
  });
  leftHemiIntensityValue.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    state.hemiLight.intensity = value;
    leftHemiIntensity.value = value;
  });

  leftDirIntensity.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    state.dirLight.intensity = value;
    leftDirIntensityValue.value = value.toFixed(1);
  });
  leftDirIntensityValue.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    state.dirLight.intensity = value;
    leftDirIntensity.value = value;
  });

  [leftDirX, leftDirY, leftDirZ].forEach((input, index) => {
    input.addEventListener("input", (e) => {
      const value = parseFloat(e.target.value);
      if (index === 0) state.dirLight.position.x = value;
      else if (index === 1) state.dirLight.position.y = value;
      else if (index === 2) state.dirLight.position.z = value;
    });
  });

  const lightingInputs = [
    leftHemiIntensity,
    leftHemiIntensityValue,
    leftDirIntensity,
    leftDirIntensityValue,
    leftDirX,
    leftDirY,
    leftDirZ
  ];

  let envMapRegenerateTimer = null;
  function regenerateEnvMapDebounced() {
    if (envMapRegenerateTimer) clearTimeout(envMapRegenerateTimer);
    envMapRegenerateTimer = setTimeout(() => {
      if (state.modelRef && state.envMap && !state.useImageEnvMap) {
        try {
          generateEnvironmentMapFromScene();
          console.log("环境贴图已根据新的光照参数重新生成");
        } catch (error) {
          console.warn("重新生成环境贴图失败:", error);
        }
      }
    }, 500);
  }

  lightingInputs.forEach((input) => {
    input?.addEventListener("input", () => regenerateEnvMapDebounced());
  });
}

