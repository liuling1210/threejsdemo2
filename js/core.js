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
};

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
  state.renderer.localClippingEnabled = true;
  state.renderer.physicallyCorrectLights = true;
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1.0;

  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xcccccc);

  state.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  state.camera.position.set(153.2408832039139, 158.5726587585243, 217.34024277321305);
  window.camera = state.camera;

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.enableZoom = true;
  state.controls.target.set(0, 0, 0);

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

  // Ground placeholders (kept to avoid errors in event handlers).
  state.groundPlaneMesh = {
    visible: false,
    material: { color: { setStyle() {} } },
    scale: { set() {} }
  };
  state.groundGridHelper = {
    visible: false,
    scale: { set() {} },
    position: { copy() {} }
  };

  state.modelAxesHelper = null;

  // Expand dir light shadow camera.
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
  const groundGridEnabled = document.getElementById("groundGridEnabled");
  const modelAxesEnabled = document.getElementById("modelAxesEnabled");

  function applyModelPosition() {
    if (!state.modelRef) return;
    const x = parseFloat(modelPosX.value) || 0;
    const y = parseFloat(modelPosY.value) || 0;
    const z = parseFloat(modelPosZ.value) || 0;
    state.modelRef.position.set(x, y, z);
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
    const w = Math.max(1, parseFloat(groundSizeW.value) || 20);
    const d = Math.max(1, parseFloat(groundSizeD.value) || 20);
    state.groundPlaneMesh.scale.set(w / 20, d / 20, 1);
    state.groundGridHelper.scale.set(w / 20, 1, d / 20);
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

  if (groundGridEnabled) {
    groundGridEnabled.addEventListener("change", (e) => {
      const useGrid = e.target.checked;
      state.groundGridHelper.visible = useGrid;
      state.groundPlaneMesh.visible = !useGrid;
    });
  }

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

