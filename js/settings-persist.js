import { state, syncShadowAndGroundFromModels } from "./core.js";
import { syncPbrFromPanel } from "./pbr.js";
import { getOutlineSettings, applyOutlineSettings } from "./post-outline.js";
import { collectMaterialsSnapshot, applyMaterialsSnapshot } from "./material-editor.js";
import {
  applyFoliageBillboardToAllLoadedModels,
  DEFAULT_FOLIAGE_ALPHA_TEST
} from "./foliage-billboard.js";

const SETTINGS_MAGIC = "dev_threejsdemo2-settings";
/** 当前导出版本；v2 起含 materialSlots（逐材质槽位参数） */
export const SETTINGS_FORMAT_VERSION = 2;

function el(id) {
  return document.getElementById(id);
}

function setRangeNumberPair(rangeId, numberId, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  const rangeEl = el(rangeId);
  const numEl = el(numberId);
  if (numEl) numEl.value = String(v);
  if (rangeEl) {
    rangeEl.value = String(v);
    rangeEl.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (numEl) {
    numEl.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function setNumberInput(id, value) {
  const n = el(id);
  if (!n) return;
  n.value = String(value);
  n.dispatchEvent(new Event("input", { bubbles: true }));
}

function setCheckbox(id, checked) {
  const c = el(id);
  if (!c || c.type !== "checkbox") return;
  c.checked = !!checked;
  c.dispatchEvent(new Event("change", { bubbles: true }));
}

function setColorInput(id, hex) {
  const c = el(id);
  if (!c || c.type !== "color") return;
  let h = String(hex || "").trim();
  if (!h.startsWith("#")) h = "#" + h;
  if (h.length === 4) {
    h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  c.value = h;
  c.dispatchEvent(new Event("input", { bubbles: true }));
}

export function collectSettingsSnapshot() {
  const materialSlots = collectMaterialsSnapshot();
  const snap = {
    magic: SETTINGS_MAGIC,
    version: SETTINGS_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    camera: {
      position: state.camera ? state.camera.position.toArray() : [0, 0, 0],
      target: state.controls ? state.controls.target.toArray() : [0, 0, 0],
      fov: state.camera ? state.camera.fov : 45
    },
    renderer: {
      toneMappingExposure: state.renderer ? state.renderer.toneMappingExposure : 1
    },
    lighting: {
      hemiIntensity: parseFloat(el("leftHemiIntensityValue")?.value) || 0,
      dirIntensity: parseFloat(el("leftDirIntensityValue")?.value) || 0,
      dirPosition: [
        parseFloat(el("leftDirX")?.value) || 0,
        parseFloat(el("leftDirY")?.value) || 0,
        parseFloat(el("leftDirZ")?.value) || 0
      ]
    },
    scene: {
      modelPosition: [
        parseFloat(el("modelPosX")?.value) || 0,
        parseFloat(el("modelPosY")?.value) || 0,
        parseFloat(el("modelPosZ")?.value) || 0
      ],
      backgroundColor: el("sceneBgColor")?.value || "#cccccc",
      ground: {
        width: parseFloat(el("groundSizeW")?.value) || 20,
        depth: parseFloat(el("groundSizeD")?.value) || 20,
        color: el("groundColor")?.value || "#888888"
      },
      shadowEnabled: !!el("shadowEnabled")?.checked,
      shadowRadius: parseFloat(el("shadowRadiusValue")?.value) || 0,
      groundGridEnabled: !!el("groundGridEnabled")?.checked,
      modelAxesEnabled: !!el("modelAxesEnabled")?.checked
    },
    pbr: {
      metalness: parseFloat(el("pbrMetalnessValue")?.value) || 0,
      roughness: parseFloat(el("pbrRoughnessValue")?.value) || 0.5,
      envMapIntensity: parseFloat(el("pbrEnvMapIntensityValue")?.value) || 1,
      imageEnvMapEnabled: !!el("imageEnvMapEnabled")?.checked,
      pbrEnvEnabled: el("pbrEnvEnabled") ? !!el("pbrEnvEnabled").checked : true,
      transparencyEnabled: !!el("pbrTransparencyEnabled")?.checked,
      opacity: parseFloat(el("pbrOpacityValue")?.value) || 0.8,
      alphaTest: parseFloat(el("pbrAlphaTestValue")?.value) || 0,
      foliageBillboardEnabled: !!el("pbrFoliageBillboardEnabled")?.checked,
      foliageAlphaTest: parseFloat(el("pbrFoliageAlphaTestValue")?.value) || DEFAULT_FOLIAGE_ALPHA_TEST
    },
    outline: getOutlineSettings(),
    materialSlots
  };
  return snap;
}

export function serializeSettingsToTxt(data) {
  const header =
    "# dev_threejsdemo2 场景参数快照（UTF-8）\n" +
    "# v2：JSON 内 materialSlots 为逐网格材质槽参数（modelIndex + path + slot + props）。\n" +
    "# 解析规则：忽略以 # 开头的注释行；找到以 dev_threejsdemo2-settings 开头的标识行；\n" +
    "# 其下一行起直至文件结束为 JSON。也可用整文件纯 JSON（须含 magic 字段）。\n";
  const line1 = `${SETTINGS_MAGIC} v${data.version || SETTINGS_FORMAT_VERSION}`;
  return `${header}${line1}\n${JSON.stringify(data, null, 2)}\n`;
}

export function parseSettingsText(raw) {
  const text = String(raw).replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("空文件");

  const stripped = text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .trim();

  if (stripped.startsWith("{")) {
    const j = JSON.parse(stripped);
    if (j.magic !== SETTINGS_MAGIC) throw new Error("缺少 magic 字段或格式不对");
    return j;
  }

  const nl = stripped.indexOf("\n");
  if (nl === -1) throw new Error("无效格式：需要首行标识 + JSON");
  const first = stripped.slice(0, nl).trim();
  const low = first.toLowerCase();
  const head = SETTINGS_MAGIC.toLowerCase();
  if (!low.startsWith(head))
    throw new Error(`首行须以 "${SETTINGS_MAGIC}" 开头（可带版本号，如 v1、v2）`);
  const parts = first.split(/\s+/);
  const verTok = parts.find((p) => /^v?\d+$/i.test(p));
  const fileVer = verTok ? parseInt(String(verTok).replace(/^v/i, ""), 10) : 1;
  const jsonStr = stripped.slice(nl + 1).trim();
  const data = JSON.parse(jsonStr);
  if (data.magic && data.magic !== SETTINGS_MAGIC) throw new Error("JSON 内 magic 不匹配");
  data.version = data.version ?? fileVer;
  return data;
}

/**
 * 将快照应用到当前页面与 Three 状态（依赖各面板已绑定的 input/change 监听）。
 */
export function applySettingsSnapshot(data) {
  if (!data || data.magic !== SETTINGS_MAGIC) throw new Error("不是本项目的设置文件");

  if (data.camera && state.camera && state.controls) {
    const p = data.camera.position;
    const t = data.camera.target;
    if (Array.isArray(p) && p.length >= 3) state.camera.position.set(p[0], p[1], p[2]);
    if (Array.isArray(t) && t.length >= 3) state.controls.target.set(t[0], t[1], t[2]);
    if (typeof data.camera.fov === "number") {
      state.camera.fov = data.camera.fov;
      state.camera.updateProjectionMatrix();
    }
    state.controls.update();
  }

  if (data.renderer && state.renderer && typeof data.renderer.toneMappingExposure === "number") {
    state.renderer.toneMappingExposure = data.renderer.toneMappingExposure;
  }

  const L = data.lighting || {};
  if (L.hemiIntensity != null) setRangeNumberPair("leftHemiIntensity", "leftHemiIntensityValue", L.hemiIntensity);
  if (L.dirIntensity != null) setRangeNumberPair("leftDirIntensity", "leftDirIntensityValue", L.dirIntensity);
  if (Array.isArray(L.dirPosition) && L.dirPosition.length >= 3) {
    setNumberInput("leftDirX", L.dirPosition[0]);
    setNumberInput("leftDirY", L.dirPosition[1]);
    setNumberInput("leftDirZ", L.dirPosition[2]);
  }

  const S = data.scene || {};
  if (Array.isArray(S.modelPosition) && S.modelPosition.length >= 3) {
    setNumberInput("modelPosX", S.modelPosition[0]);
    setNumberInput("modelPosY", S.modelPosition[1]);
    setNumberInput("modelPosZ", S.modelPosition[2]);
  }
  if (S.backgroundColor) setColorInput("sceneBgColor", S.backgroundColor);
  if (S.ground) {
    if (S.ground.width != null) setNumberInput("groundSizeW", S.ground.width);
    if (S.ground.depth != null) setNumberInput("groundSizeD", S.ground.depth);
    if (S.ground.color) setColorInput("groundColor", S.ground.color);
  }
  if (S.shadowEnabled != null) setCheckbox("shadowEnabled", S.shadowEnabled);
  if (S.shadowRadius != null) setRangeNumberPair("shadowRadius", "shadowRadiusValue", S.shadowRadius);
  if (S.groundGridEnabled != null) setCheckbox("groundGridEnabled", S.groundGridEnabled);
  if (S.modelAxesEnabled != null) setCheckbox("modelAxesEnabled", S.modelAxesEnabled);

  const P = data.pbr || {};
  if (P.metalness != null) setRangeNumberPair("pbrMetalness", "pbrMetalnessValue", P.metalness);
  if (P.roughness != null) setRangeNumberPair("pbrRoughness", "pbrRoughnessValue", P.roughness);
  if (P.envMapIntensity != null) setRangeNumberPair("pbrEnvMapIntensity", "pbrEnvMapIntensityValue", P.envMapIntensity);
  if (P.imageEnvMapEnabled != null) setCheckbox("imageEnvMapEnabled", P.imageEnvMapEnabled);
  if (P.pbrEnvEnabled != null) setCheckbox("pbrEnvEnabled", P.pbrEnvEnabled);
  if (P.transparencyEnabled != null) setCheckbox("pbrTransparencyEnabled", P.transparencyEnabled);
  if (P.opacity != null) setRangeNumberPair("pbrOpacity", "pbrOpacityValue", P.opacity);
  if (P.alphaTest != null) setRangeNumberPair("pbrAlphaTest", "pbrAlphaTestValue", P.alphaTest);
  if (P.foliageAlphaTest != null) {
    setRangeNumberPair("pbrFoliageAlphaTest", "pbrFoliageAlphaTestValue", P.foliageAlphaTest);
  }
  if (P.foliageBillboardEnabled != null) setCheckbox("pbrFoliageBillboardEnabled", P.foliageBillboardEnabled);

  applyOutlineSettings(data.outline);

  syncShadowAndGroundFromModels();
  syncPbrFromPanel();

  const materialSlots =
    data.version >= 2 && Array.isArray(data.materialSlots) ? data.materialSlots : [];
  applyMaterialsSnapshot(materialSlots);

  if (P.foliageBillboardEnabled === true) {
    const at =
      parseFloat(el("pbrFoliageAlphaTestValue")?.value) || P.foliageAlphaTest || DEFAULT_FOLIAGE_ALPHA_TEST;
    applyFoliageBillboardToAllLoadedModels(true, at);
  } else if (P.foliageBillboardEnabled === false) {
    applyFoliageBillboardToAllLoadedModels(false);
  }
}

export function downloadSettingsTxt() {
  const data = collectSettingsSnapshot();
  const text = serializeSettingsToTxt(data);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `viewer-settings-${stamp}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function initSettingsPersist() {
  const saveBtn = el("saveSettingsDocBtn");
  const loadBtn = el("loadSettingsDocBtn");
  const fileInput = el("loadSettingsFileInput");

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      try {
        downloadSettingsTxt();
      } catch (err) {
        console.error(err);
        alert("导出失败: " + (err && err.message));
      }
    });
  }

  if (loadBtn && fileInput) {
    loadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = parseSettingsText(reader.result);
          applySettingsSnapshot(data);
        } catch (err) {
          console.error(err);
          alert("加载失败: " + (err && err.message));
        }
      };
      reader.readAsText(file, "UTF-8");
    });
  }
}
