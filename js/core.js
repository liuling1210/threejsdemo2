import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Shared mutable state across modules.
export const state = {
  // Three.js core
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  hemiLight: null,
  dirLight: null,
  pointLight: null,
  spotLight: null,
  groundPlaneMesh: null,
  groundGridHelper: null,
  modelAxesHelper: null,
  skySphere: null,
  skySphereMaterial: null,

  // Environment mapping
  envMap: null,
  cubeCamera: null,
  useImageEnvMap: false,
  pmremGenerator: null,

  // Model / interactions
  modelRef: null,
  loadedModels: [],
  lastModelFileSize: null,
  highlightedMeshes: [],
  highlightedLines: [],
  flowEffects: [],
  panelCubes: [],
  selectedPanelCubeId: null,

  composer: null,
  outlinePass: null,
};

const CAMERA_NEAR = 0.1;
const CAMERA_BASE_FAR = 1000;
const CAMERA_FAR_PADDING = 200;
const CAMERA_FAR_MULTIPLIER = 6;
const CAMERA_MAX_FAR = 200000;

// Transparent material envMap intensity compensation:
// Three.js multiplies final reflected color by opacity, so reflections appear darker for transparent materials.
export function getEnvMapIntensityForMaterial(mat, baseIntensity) {
  const opacity = typeof mat.opacity === "number" ? mat.opacity : 1;
  const isTransparent = mat.transparent === true || opacity < 1;
  if (!isTransparent) return baseIntensity;
  return baseIntensity / Math.max(0.01, opacity);
}

export function initCore() {
  const canvas = document.querySelector("#viewport");
  state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  state.renderer.setPixelRatio(window.devicePixelRatio);
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.renderer.shadowMap.enabled = false;
  state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  state.renderer.localClippingEnabled = true;
  state.renderer.physicallyCorrectLights = true;
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1.0;

  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xcccccc);

  state.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_BASE_FAR);
  state.camera.position.set(153.2408832039139, 158.5726587585243, 217.34024277321305);
  window.camera = state.camera;

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.enableZoom = true;
  state.controls.target.set(0, 0, 0);
  state.controls.addEventListener("change", syncCameraClippingPlanes);

  // Lights
  state.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  state.hemiLight.position.set(0, 1, 0);
  state.scene.add(state.hemiLight);

  state.dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  state.dirLight.position.set(5, 10, 7.5);
  state.dirLight.castShadow = false;
  state.dirLight.shadow.mapSize.width = 2048;
  state.dirLight.shadow.mapSize.height = 2048;
  state.dirLight.shadow.camera.near = 0.5;
  state.dirLight.shadow.camera.far = 50;
  state.scene.add(state.dirLight);
  state.scene.add(state.dirLight.target);

  state.pointLight = new THREE.PointLight(0xffffff, 1.0, 100);
  state.pointLight.position.set(0, 5, 0);
  state.pointLight.visible = false;
  state.scene.add(state.pointLight);

  state.spotLight = new THREE.SpotLight(0xffffff, 1.0);
  state.spotLight.position.set(5, 10, 5);
  state.spotLight.angle = Math.PI / 6;
  state.spotLight.penumbra = 0.1;
  state.spotLight.decay = 2;
  state.spotLight.distance = 200;
  state.spotLight.target.position.set(0, 0, 0);
  state.spotLight.visible = false;
  state.scene.add(state.spotLight);
  state.scene.add(state.spotLight.target);

  const groundGeo = new THREE.PlaneGeometry(20, 20);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  state.groundPlaneMesh = new THREE.Mesh(groundGeo, groundMat);
  state.groundPlaneMesh.rotation.x = -Math.PI / 2;
  state.groundPlaneMesh.receiveShadow = true;
  state.groundPlaneMesh.castShadow = false;
  state.groundPlaneMesh.visible = false;
  state.scene.add(state.groundPlaneMesh);

  state.groundGridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x888888);
  state.groundGridHelper.visible = false;
  state.scene.add(state.groundGridHelper);

  state.modelAxesHelper = null;

  state.dirLight.shadow.bias = -0.00025;
  state.dirLight.shadow.normalBias = 0.035;
  state.dirLight.shadow.camera.left = -12;
  state.dirLight.shadow.camera.right = 12;
  state.dirLight.shadow.camera.top = 12;
  state.dirLight.shadow.camera.bottom = -12;
  state.dirLight.shadow.camera.near = 0.5;
  state.dirLight.shadow.camera.far = 50;

  // Sky sphere removed.
  state.skySphereMaterial = null;
  state.skySphere = null;

  // Env mapping variables.
  state.envMap = null;
  state.cubeCamera = null;
  state.useImageEnvMap = false;
  state.pmremGenerator = new THREE.PMREMGenerator(state.renderer);
  state.pmremGenerator.compileEquirectangularShader();

  // Handle resize.
  const resize = () => {
    state.camera.aspect = window.innerWidth / window.innerHeight;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", resize);
  syncCameraClippingPlanes();
}

const _unionBox = new THREE.Box3();
const _modelsBox = new THREE.Box3();
const _sunDirection = new THREE.Vector3(5, 10, 7.5);
const _sunOffsetDir = _sunDirection.clone().normalize();

function refreshSunDirectionFromInputs() {
  const x = parseFloat(document.getElementById("shadowDirX")?.value);
  const y = parseFloat(document.getElementById("shadowDirY")?.value);
  const z = parseFloat(document.getElementById("shadowDirZ")?.value);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  _sunDirection.set(x, y, z);
  if (_sunDirection.lengthSq() < 1e-6) return;
  _sunOffsetDir.copy(_sunDirection).normalize();
}

export function getLoadedModelsBoundingBox(targetBox = new THREE.Box3()) {
  targetBox.makeEmpty();
  for (let i = 0; i < state.loadedModels.length; i++) {
    _unionBox.setFromObject(state.loadedModels[i]);
    targetBox.union(_unionBox);
  }
  return targetBox;
}

export function syncCameraClippingPlanes() {
  if (!state.camera) return;

  let requiredDistance = 0;

  if (state.controls) {
    requiredDistance = Math.max(requiredDistance, state.camera.position.distanceTo(state.controls.target));
  }

  if (state.loadedModels.length) {
    getLoadedModelsBoundingBox(_modelsBox);
    if (!_modelsBox.isEmpty()) {
      const sphere = _modelsBox.getBoundingSphere(new THREE.Sphere());
      const modelDistance = state.camera.position.distanceTo(sphere.center) + sphere.radius;
      requiredDistance = Math.max(requiredDistance, modelDistance);
    }
  }

  const nextFar = THREE.MathUtils.clamp(
    Math.max(CAMERA_BASE_FAR, requiredDistance * CAMERA_FAR_MULTIPLIER + CAMERA_FAR_PADDING),
    CAMERA_BASE_FAR,
    CAMERA_MAX_FAR
  );

  if (Math.abs(state.camera.far - nextFar) > 1) {
    state.camera.near = CAMERA_NEAR;
    state.camera.far = nextFar;
    state.camera.updateProjectionMatrix();
  }
}

let activeCameraFlight = null;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Smooth orbit camera to frame `node` (same behavior as model node double-click). */
export function flyCameraToObject(node) {
  if (!node || !state.camera || !state.controls) return;

  const box = new THREE.Box3().setFromObject(node);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-3);
  const fov = (state.camera.fov * Math.PI) / 180;
  const fitDistance = (maxDim / (2 * Math.tan(fov / 2))) * 1.6;

  const viewDir = state.camera.position.clone().sub(state.controls.target);
  if (viewDir.lengthSq() < 1e-8) viewDir.set(1, 0.6, 1);
  viewDir.normalize();

  const toPos = center.clone().add(viewDir.multiplyScalar(fitDistance));

  activeCameraFlight = {
    startTime: performance.now(),
    duration: 650,
    fromPos: state.camera.position.clone(),
    toPos,
    fromTarget: state.controls.target.clone(),
    toTarget: center
  };
}

export function updateCameraFlight() {
  if (!activeCameraFlight) return;

  const now = performance.now();
  const t = Math.min(1, (now - activeCameraFlight.startTime) / activeCameraFlight.duration);
  const k = easeInOutCubic(t);

  state.camera.position.lerpVectors(activeCameraFlight.fromPos, activeCameraFlight.toPos, k);
  state.controls.target.lerpVectors(activeCameraFlight.fromTarget, activeCameraFlight.toTarget, k);
  state.controls.update();

  if (t >= 1) activeCameraFlight = null;
}

/**
 * Places the ground under loaded models, moves the directional light / target with the scene,
 * and fits the orthographic shadow frustum to the models (large scenes supported).
 */
export function syncShadowAndGroundFromModels() {
  const ground = state.groundPlaneMesh;
  const grid = state.groundGridHelper;
  const light = state.dirLight;
  if (!light || !ground || !grid) return;

  getLoadedModelsBoundingBox(_modelsBox);

  if (_modelsBox.isEmpty()) {
    ground.position.set(0, 0, 0);
    grid.position.set(0, 0.02, 0);
    light.target.position.set(0, 0, 0);
    light.position.copy(_sunOffsetDir.clone().multiplyScalar(50));
    light.shadow.camera.left = -50;
    light.shadow.camera.right = 50;
    light.shadow.camera.top = 50;
    light.shadow.camera.bottom = -50;
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 250;
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    light.shadow.camera.updateProjectionMatrix();
    light.target.updateMatrixWorld();
    return;
  }

  const center = _modelsBox.getCenter(new THREE.Vector3());
  const size = _modelsBox.getSize(new THREE.Vector3());
  const sp = _modelsBox.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sp.radius, 0.5);
  const margin = Math.max(radius * 0.15, 0.5);
  const halfFrustum = Math.max(radius + margin, Math.max(size.x, size.y, size.z) * 0.55 + margin);

  const lift = Math.max(0.02, Math.min(radius * 0.002, 5));
  ground.position.set(center.x, _modelsBox.min.y - lift, center.z);
  grid.position.set(center.x, ground.position.y + Math.max(0.03, lift * 0.5), center.z);

  const lightDist = Math.max(radius * 6, halfFrustum * 2.5, 50);
  light.target.position.copy(center);
  light.position.copy(center.clone().add(_sunOffsetDir.clone().multiplyScalar(lightDist)));

  light.shadow.camera.left = -halfFrustum;
  light.shadow.camera.right = halfFrustum;
  light.shadow.camera.top = halfFrustum;
  light.shadow.camera.bottom = -halfFrustum;

  const depthPad = margin + radius * 0.15;
  light.shadow.camera.near = Math.max(0.05, lightDist - radius - depthPad);
  light.shadow.camera.far = lightDist + radius + depthPad;

  const maxDim = Math.max(size.x, size.y, size.z);
  const mapSize = maxDim > 140 ? 4096 : maxDim > 70 ? 3072 : 2048;
  light.shadow.mapSize.width = mapSize;
  light.shadow.mapSize.height = mapSize;

  light.shadow.camera.updateProjectionMatrix();
  light.target.updateMatrixWorld();
}

// Scene/ground UI wiring (model pos, background, shadow, axes, ground placeholders).
export function initSceneControls() {
  const modelPosX = document.getElementById("modelPosX");
  const modelPosY = document.getElementById("modelPosY");
  const modelPosZ = document.getElementById("modelPosZ");
  const sceneBgColor = document.getElementById("sceneBgColor");
  const groundSizeW = document.getElementById("groundSizeW");
  const groundSizeD = document.getElementById("groundSizeD");
  const groundColor = document.getElementById("groundColor");
  const shadowEnabled = document.getElementById("shadowEnabled");
  const shadowRadius = document.getElementById("shadowRadius");
  const shadowRadiusValue = document.getElementById("shadowRadiusValue");
  const shadowStrength = document.getElementById("shadowStrength");
  const shadowStrengthValue = document.getElementById("shadowStrengthValue");
  const shadowDirX = document.getElementById("shadowDirX");
  const shadowDirY = document.getElementById("shadowDirY");
  const shadowDirZ = document.getElementById("shadowDirZ");
  const groundGridEnabled = document.getElementById("groundGridEnabled");
  const modelAxesEnabled = document.getElementById("modelAxesEnabled");
  const addCubeButton = document.getElementById("addPanelCubeBtn");
  const cubeSizeW = document.getElementById("panelCubeSizeW");
  const cubeSizeH = document.getElementById("panelCubeSizeH");
  const cubeSizeD = document.getElementById("panelCubeSizeD");
  const cubePosX = document.getElementById("panelCubePosX");
  const cubePosY = document.getElementById("panelCubePosY");
  const cubePosZ = document.getElementById("panelCubePosZ");
  const cubeSelect = document.getElementById("panelCubeSelect");
  const removeCubeButton = document.getElementById("removePanelCubeBtn");
  const cubeQuickCreateInput = document.getElementById("panelCubeQuickCreateInput");

  function applyModelPosition() {
    if (!state.modelRef) return;
    const x = parseFloat(modelPosX.value) || 0;
    const y = parseFloat(modelPosY.value) || 0;
    const z = parseFloat(modelPosZ.value) || 0;
    state.modelRef.position.set(x, y, z);
    syncShadowAndGroundFromModels();
  }

  if (modelPosX && modelPosY && modelPosZ) {
    [modelPosX, modelPosY, modelPosZ].forEach((el) => el.addEventListener("input", applyModelPosition));
  }

  if (sceneBgColor) {
    sceneBgColor.addEventListener("input", (e) => {
      state.scene.background.setStyle(e.target.value);
    });
  }

  function applyGroundSize() {
    if (!state.groundPlaneMesh || !groundSizeW || !groundSizeD) return;
    const w = Math.max(1, parseFloat(groundSizeW.value) || 20);
    const d = Math.max(1, parseFloat(groundSizeD.value) || 20);
    const sx = w / 20;
    const sz = d / 20;
    state.groundPlaneMesh.scale.set(sx, 1, sz);
    state.groundGridHelper.scale.set(sx, 1, sz);
    syncShadowAndGroundFromModels();
  }

  if (groundSizeW && groundSizeD) {
    groundSizeW.addEventListener("input", applyGroundSize);
    groundSizeD.addEventListener("input", applyGroundSize);
  }

  if (groundColor) {
    groundColor.addEventListener("input", (e) => {
      state.groundPlaneMesh.material.color.setStyle(e.target.value);
    });
  }

  if (shadowEnabled) {
    shadowEnabled.addEventListener("change", (e) => {
      const on = e.target.checked;
      state.renderer.shadowMap.enabled = on;
      state.dirLight.castShadow = on;
      if (on) syncShadowAndGroundFromModels();
    });
  }

  if (shadowRadius) {
    shadowRadius.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value) || 0;
      state.dirLight.shadow.radius = v;
      if (shadowRadiusValue) shadowRadiusValue.value = v.toFixed(1);
    });
  }

  if (shadowRadiusValue) {
    shadowRadiusValue.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value) || 0;
      state.dirLight.shadow.radius = v;
      if (shadowRadius) shadowRadius.value = v;
    });
  }

  function applyShadowStrength(v) {
    const factor = Math.max(0, Number(v) || 0);
    const baseDir = parseFloat(document.getElementById("leftDirIntensityValue")?.value) || 1.5;
    state.dirLight.intensity = baseDir * factor;
  }
  if (shadowStrength) {
    shadowStrength.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value) || 0;
      if (shadowStrengthValue) shadowStrengthValue.value = v.toFixed(2);
      applyShadowStrength(v);
    });
  }
  if (shadowStrengthValue) {
    shadowStrengthValue.addEventListener("input", (e) => {
      const v = parseFloat(e.target.value) || 0;
      if (shadowStrength) shadowStrength.value = String(v);
      applyShadowStrength(v);
    });
  }

  const applyShadowDirection = () => {
    refreshSunDirectionFromInputs();
    syncShadowAndGroundFromModels();
  };
  [shadowDirX, shadowDirY, shadowDirZ].forEach((input) => {
    input?.addEventListener("input", applyShadowDirection);
  });

  if (groundGridEnabled) {
    groundGridEnabled.addEventListener("change", (e) => {
      const useGrid = e.target.checked;
      state.groundGridHelper.visible = useGrid;
    });
  }

  function getSelectedPanelCube() {
    return state.panelCubes.find((item) => item.id === state.selectedPanelCubeId) || null;
  }

  function refreshPanelCubeOptions() {
    if (!cubeSelect) return;
    cubeSelect.innerHTML = "";
    state.panelCubes.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      cubeSelect.appendChild(option);
    });
    cubeSelect.disabled = state.panelCubes.length === 0;
    if (state.selectedPanelCubeId && state.panelCubes.some((item) => item.id === state.selectedPanelCubeId)) {
      cubeSelect.value = state.selectedPanelCubeId;
    }
    if (removeCubeButton) removeCubeButton.disabled = state.panelCubes.length === 0;
  }

  function fillInputsFromSelectedCube() {
    const selected = getSelectedPanelCube();
    if (!selected) return;
    if (cubeSizeW) cubeSizeW.value = selected.mesh.scale.x.toFixed(2);
    if (cubeSizeH) cubeSizeH.value = selected.mesh.scale.y.toFixed(2);
    if (cubeSizeD) cubeSizeD.value = selected.mesh.scale.z.toFixed(2);
    if (cubePosX) cubePosX.value = selected.mesh.position.x.toFixed(2);
    if (cubePosY) cubePosY.value = selected.mesh.position.y.toFixed(2);
    if (cubePosZ) cubePosZ.value = selected.mesh.position.z.toFixed(2);
  }

  function applyPanelCubeTransform() {
    const selected = getSelectedPanelCube();
    if (!selected) return;
    const sx = Math.max(0.01, parseFloat(cubeSizeW?.value) || 20);
    const sy = Math.max(0.01, parseFloat(cubeSizeH?.value) || 20);
    const sz = Math.max(0.01, parseFloat(cubeSizeD?.value) || 20);
    const px = parseFloat(cubePosX?.value) || 10;
    const py = parseFloat(cubePosY?.value) || 10;
    const pz = parseFloat(cubePosZ?.value) || 10;
    selected.mesh.scale.set(sx, sy, sz);
    selected.mesh.position.set(px, py, pz);
  }

  function createPanelCubeByValues(
    {
      length = 20,
      width = 20,
      height = 20,
      x = 10,
      y = 10,
      z = 10,
    } = {},
    { flyTo = false } = {}
  ) {
    const index = state.panelCubes.length + 1;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xaedcff,
      transparent: true,
      opacity: 0.5,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(
      Math.max(0.01, Number(length) || 20),
      Math.max(0.01, Number(width) || 20),
      Math.max(0.01, Number(height) || 20)
    );
    mesh.position.set(Number(x) || 10, Number(y) || 10, Number(z) || 10);
    const id = `panelCube-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    mesh.name = id;
    const cubeItem = { id, label: `立方体 ${index}`, mesh };
    state.panelCubes.push(cubeItem);
    state.selectedPanelCubeId = id;
    state.scene.add(mesh);
    mesh.updateMatrixWorld(true);
    refreshPanelCubeOptions();
    fillInputsFromSelectedCube();
    if (flyTo) {
      flyCameraToObject(mesh);
      syncCameraClippingPlanes();
    }
  }

  function parseCubeQuickCreateText(text) {
    if (!text || typeof text !== "string") return null;
    const kv = {};
    const segments = text.split(",");
    for (let i = 0; i < segments.length; i++) {
      const [rawKey, rawVal] = segments[i].split(":");
      const key = (rawKey || "").trim().toUpperCase();
      const val = parseFloat((rawVal || "").trim());
      if (!key || !Number.isFinite(val)) return null;
      kv[key] = val;
    }
    const requiredKeys = ["L", "W", "H", "X", "Y", "Z"];
    const hasAll = requiredKeys.every((k) => Object.prototype.hasOwnProperty.call(kv, k));
    if (!hasAll) return null;
    return {
      length: kv.L,
      width: kv.W,
      height: kv.H,
      x: kv.X,
      y: kv.Y,
      z: kv.Z,
    };
  }

  if (addCubeButton) {
    addCubeButton.addEventListener("click", () => {
      createPanelCubeByValues();
    });
  }

  function tryQuickCreateFromInput() {
    const parsed = parseCubeQuickCreateText(cubeQuickCreateInput.value);
    if (!parsed) return;
    createPanelCubeByValues(parsed, { flyTo: true });
    cubeQuickCreateInput.value = "";
  }

  if (cubeQuickCreateInput) {
    cubeQuickCreateInput.addEventListener("change", tryQuickCreateFromInput);
    cubeQuickCreateInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        tryQuickCreateFromInput();
      }
    });
  }

  if (cubeSelect) {
    cubeSelect.addEventListener("change", () => {
      state.selectedPanelCubeId = cubeSelect.value || null;
      fillInputsFromSelectedCube();
    });
  }

  if (removeCubeButton) {
    removeCubeButton.addEventListener("click", () => {
      const selected = getSelectedPanelCube();
      if (!selected) return;
      state.scene.remove(selected.mesh);
      selected.mesh.geometry.dispose();
      selected.mesh.material.dispose();
      state.panelCubes = state.panelCubes.filter((item) => item.id !== selected.id);
      state.selectedPanelCubeId = state.panelCubes.length ? state.panelCubes[state.panelCubes.length - 1].id : null;
      refreshPanelCubeOptions();
      fillInputsFromSelectedCube();
    });
  }

  [cubeSizeW, cubeSizeH, cubeSizeD, cubePosX, cubePosY, cubePosZ].forEach((input) => {
    input?.addEventListener("input", applyPanelCubeTransform);
  });
  refreshPanelCubeOptions();

  applyGroundSize();
  applyShadowDirection();

  if (modelAxesEnabled) {
    modelAxesEnabled.addEventListener("change", (e) => {
      if (!state.modelRef) return;
      const on = e.target.checked;
      if (on) {
        if (state.modelAxesHelper) return;
        const box = new THREE.Box3().setFromObject(state.modelRef);
        const size = box.getSize(new THREE.Vector3());
        state.modelAxesHelper = new THREE.AxesHelper(Math.max(size.x, size.y, size.z) * 0.8);
        state.modelRef.add(state.modelAxesHelper);
      } else if (state.modelAxesHelper) {
        state.modelRef.remove(state.modelAxesHelper);
        state.modelAxesHelper.geometry.dispose();
        state.modelAxesHelper = null;
      }
    });
  }
}

