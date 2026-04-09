import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { state, getEnvMapIntensityForMaterial } from "./core.js";
import { generateEnvironmentMapFromScene, syncPbrFromPanel } from "./pbr.js";

const DEFAULT_MODEL_URL = new URL("../models/test02/test_001.gltf", import.meta.url).href;
let activeCameraFlight = null;

function setQueueSummary(done, total) {
  const summaryEl = document.getElementById("modelLoadQueueSummary");
  if (summaryEl) summaryEl.textContent = `${done}/${total}`;
}

function clearQueueView() {
  const listEl = document.getElementById("modelLoadQueueList");
  if (listEl) listEl.innerHTML = "";
}

function createQueueItem(name) {
  const listEl = document.getElementById("modelLoadQueueList");
  if (!listEl) return null;

  const row = document.createElement("div");
  row.className = "queue-item";

  const nameEl = document.createElement("div");
  nameEl.className = "queue-item-name";
  nameEl.textContent = name;

  const statusEl = document.createElement("div");
  statusEl.className = "queue-item-status pending";
  statusEl.textContent = "等待";

  row.appendChild(nameEl);
  row.appendChild(statusEl);
  listEl.appendChild(row);
  return statusEl;
}

function setQueueItemStatus(statusEl, status, text) {
  if (!statusEl) return;
  statusEl.className = "queue-item-status " + status;
  statusEl.textContent = text;
}

function normalizePath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function getResourceResolver(allFiles, modelFile) {
  if (!allFiles || !allFiles.length) return null;

  const fileByRelativePath = new Map();
  const fileListByBaseName = new Map();

  allFiles.forEach((file) => {
    const rawRel = file.webkitRelativePath && file.webkitRelativePath.length ? file.webkitRelativePath : file.name;
    const rel = normalizePath(rawRel);
    fileByRelativePath.set(rel, file);

    const baseName = normalizePath(file.name);
    if (!fileListByBaseName.has(baseName)) fileListByBaseName.set(baseName, []);
    fileListByBaseName.get(baseName).push(file);
  });

  const modelRelRaw =
    modelFile.webkitRelativePath && modelFile.webkitRelativePath.length ? modelFile.webkitRelativePath : modelFile.name;
  const modelRel = normalizePath(modelRelRaw);
  const modelDir = modelRel.includes("/") ? modelRel.slice(0, modelRel.lastIndexOf("/")) : "";

  const tryFindFile = (relativeLikePath) => {
    const decoded = normalizePath(decodeURIComponent(relativeLikePath || ""));
    if (!decoded) return null;

    const direct = fileByRelativePath.get(decoded);
    if (direct) return direct;

    if (modelDir) {
      const nearPath = normalizePath(modelDir + "/" + decoded);
      const near = fileByRelativePath.get(nearPath);
      if (near) return near;
    }

    const baseName = decoded.includes("/") ? decoded.slice(decoded.lastIndexOf("/") + 1) : decoded;
    const byName = fileListByBaseName.get(baseName);
    if (byName && byName.length === 1) return byName[0];

    return null;
  };

  return (url) => {
    if (!url) return null;
    if (/^data:/i.test(url)) return url;

    // 1) Try original URL string as relative path.
    const matchedFromRaw = tryFindFile(url);
    if (matchedFromRaw) return URL.createObjectURL(matchedFromRaw);

    // 2) For absolute blob/http URLs, extract pathname for matching fallback.
    if (/^(blob:|https?:)/i.test(url)) {
      try {
        const parsed = new URL(url);
        const pathLike = normalizePath(parsed.pathname || "");
        const matchedFromPath = tryFindFile(pathLike);
        if (matchedFromPath) return URL.createObjectURL(matchedFromPath);

        const baseName = pathLike.includes("/") ? pathLike.slice(pathLike.lastIndexOf("/") + 1) : pathLike;
        const matchedFromName = tryFindFile(baseName);
        if (matchedFromName) return URL.createObjectURL(matchedFromName);
      } catch (error) {
        void error;
      }
    }

    // 3) No match: keep original URL so GLTFLoader can continue default flow.
    return null;
  };
}

function setQueueCollapsed(collapsed) {
  const panelEl = document.getElementById("modelLoadQueuePanel");
  const toggleEl = document.getElementById("modelLoadQueueToggle");
  if (!panelEl || !toggleEl) return;
  panelEl.classList.toggle("collapsed", collapsed);
  toggleEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

const nodeTreeCollapsedState = new Map();

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function findHighlightTarget(node) {
  if (!node) return null;
  if (node.isMesh || node.isLine || node.isLineSegments) return node;
  let target = null;
  node.traverse((child) => {
    if (!target && (child.isMesh || child.isLine || child.isLineSegments)) target = child;
  });
  return target;
}

function flyCameraToObject(node) {
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

function updateCameraFlight() {
  if (!activeCameraFlight) return;

  const now = performance.now();
  const t = Math.min(1, (now - activeCameraFlight.startTime) / activeCameraFlight.duration);
  const k = easeInOutCubic(t);

  state.camera.position.lerpVectors(activeCameraFlight.fromPos, activeCameraFlight.toPos, k);
  state.controls.target.lerpVectors(activeCameraFlight.fromTarget, activeCameraFlight.toTarget, k);
  state.controls.update();

  if (t >= 1) activeCameraFlight = null;
}

function renderModelNodesPanel(model) {
  const summaryEl = document.getElementById("modelNodesSummary");
  const listEl = document.getElementById("modelNodesList");
  if (!summaryEl || !listEl) return;

  if (!model) {
    summaryEl.textContent = "节点数: —";
    listEl.textContent = "请先加载模型";
    nodeTreeCollapsedState.clear();
    return;
  }

  let count = 0;
  const treeRoot = document.createElement("ul");
  treeRoot.className = "node-tree-root";

  const createNodeItem = (node, pathKey) => {
    count++;
    const li = document.createElement("li");
    li.className = "node-tree-item";

    const row = document.createElement("div");
    row.className = "node-tree-row";

    const children = node.children || [];
    const hasChildren = children.length > 0;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "node-tree-toggle";

    const label = document.createElement("span");
    label.className = "node-tree-label";
    const name = node.name && node.name.trim() ? node.name : "(未命名)";
    label.textContent = `[${node.type}] ${name}`;
    label.title = "双击：高亮并飞到该节点";

    const focusNode = () => {
      const targetObj = findHighlightTarget(node);
      if (targetObj) {
        restoreHighlightedMeshes();
        highlightMeshOrLine(targetObj);
      }
      flyCameraToObject(node);
    };
    row.addEventListener("dblclick", focusNode);
    label.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      focusNode();
    });

    let childList = null;
    if (hasChildren) {
      const collapsed = nodeTreeCollapsedState.get(pathKey) === true;
      toggle.textContent = collapsed ? "▶" : "▼";
      toggle.setAttribute("aria-label", collapsed ? "展开节点" : "折叠节点");

      childList = document.createElement("ul");
      childList.className = "node-tree-children";
      if (collapsed) childList.style.display = "none";

      toggle.addEventListener("click", () => {
        const nextCollapsed = childList.style.display !== "none";
        childList.style.display = nextCollapsed ? "none" : "";
        toggle.textContent = nextCollapsed ? "▶" : "▼";
        toggle.setAttribute("aria-label", nextCollapsed ? "展开节点" : "折叠节点");
        nodeTreeCollapsedState.set(pathKey, nextCollapsed);
      });
    } else {
      toggle.textContent = "•";
      toggle.disabled = true;
    }

    row.appendChild(toggle);
    row.appendChild(label);
    li.appendChild(row);

    if (hasChildren && childList) {
      for (let i = 0; i < children.length; i++) {
        const childKey = `${pathKey}/${i}`;
        childList.appendChild(createNodeItem(children[i], childKey));
      }
      li.appendChild(childList);
    }

    return li;
  };

  treeRoot.appendChild(createNodeItem(model, "root"));

  summaryEl.textContent = `节点数: ${count}`;
  listEl.innerHTML = "";
  listEl.appendChild(treeRoot);
}

function formatBytes(bytes) {
  if (bytes == null || bytes === 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getModelFaceCount() {
  if (!state.modelRef) return 0;
  let faces = 0;
  state.modelRef.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const g = child.geometry;
      if (g.index) faces += g.index.count / 3;
      else if (g.attributes && g.attributes.position) faces += g.attributes.position.count / 3;
    }
  });
  return Math.floor(faces);
}

function restoreHighlightedMeshes() {
  state.highlightedMeshes.forEach((item) => {
    if (item.mesh && item.originalMaterial) {
      item.mesh.material = item.originalMaterial;
      item.mesh.visible = item.originalVisible !== undefined ? item.originalVisible : true;
    }
  });
  state.highlightedMeshes = [];

  state.highlightedLines.forEach((line) => {
    if (line && line.parent) line.parent.remove(line);
  });
  state.highlightedLines = [];

  // Clear flow effects.
  state.flowEffects = [];
}

function extractPointsFromLine(lineObject) {
  if (!lineObject.geometry) return [];
  const geometry = lineObject.geometry;
  const positions = geometry.attributes.position;
  if (!positions || positions.count < 2) return [];

  const points = [];
  lineObject.updateMatrixWorld(true);

  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3();
    point.fromBufferAttribute(positions, i);
    point.applyMatrix4(lineObject.matrixWorld);
    points.push(point);
  }
  return points;
}

function createOrangeWhiteStripedTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");

  const stripeWidth = 64;
  for (let i = 0; i <= canvas.width; i += stripeWidth) {
    const cycleIndex = Math.floor(i / (stripeWidth * 2));
    const positionInCycle = (i % (stripeWidth * 2)) / stripeWidth;
    const isOrange = positionInCycle < 1;

    context.fillStyle = isOrange ? "#FF8C00" : "#ffffff";
    const actualWidth = Math.min(stripeWidth, canvas.width - i);
    context.fillRect(i, 0, actualWidth, canvas.height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createThickLine(points, baseRadius = 0.01) {
  if (points.length < 2) return null;
  const radius = baseRadius * 0.2;

  let curve;
  if (points.length === 2) {
    const midPoint = new THREE.Vector3().addVectors(points[0], points[1]).multiplyScalar(0.5);
    const curvePoints = [points[0], midPoint, points[1]];
    curve = new THREE.CatmullRomCurve3(curvePoints, false, "catmullrom", 0.5);
  } else {
    curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5);
  }

  const segments = Math.max(64, points.length * 12);
  const tubeGeometry = new THREE.TubeGeometry(curve, segments, radius, 16, false);

  const texture = createOrangeWhiteStripedTexture();
  texture.repeat.set(15, 1);

  const flowMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide
  });

  const tube = new THREE.Mesh(tubeGeometry, flowMaterial);
  state.flowEffects.push({
    texture,
    mesh: tube,
    speed: 1.0
  });

  return tube;
}

function extractPointsFromMesh(mesh) {
  if (!mesh || !mesh.geometry) return [];
  const geometry = mesh.geometry;
  if (!geometry.attributes || !geometry.attributes.position) return [];

  mesh.updateMatrixWorld(true);
  const points = [];
  const positions = geometry.attributes.position;

  if (geometry.index) {
    const index = geometry.index;
    const seen = new Set();
    for (let i = 0; i < index.count; i++) {
      const vertexIndex = index.getX(i);
      const point = new THREE.Vector3();
      point.fromBufferAttribute(positions, vertexIndex);
      point.applyMatrix4(mesh.matrixWorld);

      const key = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`;
      if (!seen.has(key)) {
        seen.add(key);
        points.push(point);
      }
    }
  } else {
    const seen = new Set();
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3();
      point.fromBufferAttribute(positions, i);
      point.applyMatrix4(mesh.matrixWorld);

      const key = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`;
      if (!seen.has(key)) {
        seen.add(key);
        points.push(point);
      }
    }
  }

  return points;
}

function highlightMeshOrLine(obj) {
  if (!obj) return;

  const box = new THREE.Box3().setFromObject(state.modelRef);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const lineRadius = maxDim * 0.003;

  let points = [];
  if (obj.isLine || obj.isLineSegments) {
    points = extractPointsFromLine(obj);
  } else if (obj.isMesh) {
    points = extractPointsFromMesh(obj);
  }

  if (points.length >= 2) {
    const thickLine = createThickLine(points, lineRadius);
    if (thickLine) {
      state.scene.add(thickLine);
      state.highlightedLines.push(thickLine);
    }
  } else if (obj.isMesh && points.length < 2) {
    highlightMesh(obj);
  }
}

function highlightMesh(mesh) {
  if (!mesh || !mesh.isMesh) return;

  if (!mesh.userData.originalMaterial) mesh.userData.originalMaterial = mesh.material;
  if (mesh.userData.originalVisible === undefined) mesh.userData.originalVisible = mesh.visible;

  const highlightMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    emissive: 0x00ff00,
    emissiveIntensity: 1.5,
    metalness: 0.0,
    roughness: 0.2,
    side: THREE.DoubleSide
  });

  if (mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.color) {
    highlightMaterial.vertexColors = true;
    highlightMaterial.emissiveIntensity = 2.0;
    highlightMaterial.emissive = new THREE.Color(0x00ff00);
  }

  mesh.material = highlightMaterial;
  mesh.visible = true;

  state.highlightedMeshes.push({
    mesh,
    originalMaterial: mesh.userData.originalMaterial,
    originalVisible: mesh.userData.originalVisible
  });
}

function removeOldModel() {
  if (!state.loadedModels.length) return;

  restoreHighlightedMeshes();

  state.loadedModels.forEach((model) => {
    if (state.modelAxesHelper && model === state.modelRef) {
      model.remove(state.modelAxesHelper);
      state.modelAxesHelper.geometry && state.modelAxesHelper.geometry.dispose();
      state.modelAxesHelper = null;
    }

    state.scene.remove(model);

    model.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  });

  state.loadedModels.length = 0;
  state.modelRef = null;
  state.modelAxesHelper = null;
  renderModelNodesPanel(null);

}

function loadModel(urlOrFile, options = {}) {
  return new Promise((resolve, reject) => {
    const { resolveResourceUrl } = options;
    const manager = new THREE.LoadingManager();
    if (typeof resolveResourceUrl === "function") {
      manager.setURLModifier((url) => resolveResourceUrl(url) || url);
    }
    const loader = new GLTFLoader(manager);

    const onLoad = (gltf) => {
      const model = gltf.scene;
      state.modelRef = model;
      state.loadedModels.push(model);

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          if (state.envMap && child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                  mat.envMap = state.envMap;
                  mat.envMapIntensity = getEnvMapIntensityForMaterial(mat, 1.0);
                  mat.needsUpdate = true;
                }
              });
            } else {
              if (child.material.isMeshStandardMaterial || child.material.isMeshPhysicalMaterial) {
                child.material.envMap = state.envMap;
                child.material.envMapIntensity = getEnvMapIntensityForMaterial(child.material, 1.0);
                child.material.needsUpdate = true;
              }
            }
          }
        }
      });

      // Transparency correction (only when enabled).
      const transparencyCheck = document.getElementById("pbrTransparencyEnabled");
      if (transparencyCheck && transparencyCheck.checked) {
        model.traverse((child) => {
          if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            let hasTransparent = false;
            mats.forEach((mat) => {
              const isTransparent = mat.transparent === true || (typeof mat.opacity === "number" && mat.opacity < 1);
              if (isTransparent) {
                hasTransparent = true;
                mat.transparent = true;
                mat.depthWrite = false;
                if (mat.side !== undefined) mat.side = THREE.DoubleSide;
                mat.needsUpdate = true;
              }
            });
            if (hasTransparent) child.renderOrder = 1;
          }
        });
      }

      state.scene.add(model);
      renderModelNodesPanel(model);

      const mpX = document.getElementById("modelPosX");
      const mpY = document.getElementById("modelPosY");
      const mpZ = document.getElementById("modelPosZ");
      if (mpX) mpX.value = model.position.x.toFixed(3);
      if (mpY) mpY.value = model.position.y.toFixed(3);
      if (mpZ) mpZ.value = model.position.z.toFixed(3);

      // Auto generate env map (only when not using image env map).
      setTimeout(() => {
        try {
          if (!state.useImageEnvMap) {
            generateEnvironmentMapFromScene();
            console.log("环境贴图已自动生成");
          }
          syncPbrFromPanel();
        } catch (error) {
          console.warn("自动生成环境贴图失败:", error);
        }
      }, 100);

      resolve(model);
    };

    const onProgress = (progress) => {
      void progress;
    };

    const onError = (error) => {
      console.error("加载模型失败:", error);
      reject(error);
    };

    if (urlOrFile instanceof File) {
      const objectURL = URL.createObjectURL(urlOrFile);
      loader.load(
        objectURL,
        (gltf) => {
          onLoad(gltf);
          URL.revokeObjectURL(objectURL);
        },
        onProgress,
        (error) => {
          onError(error);
          URL.revokeObjectURL(objectURL);
        }
      );
    } else {
      loader.load(urlOrFile, onLoad, onProgress, onError);
    }
  });
}

export function initModelLoader() {
  const uploadButton = document.getElementById("uploadButton");
  const uploadFolderButton = document.getElementById("uploadFolderButton");
  const clearModelsButton = document.getElementById("clearModelsButton");
  const fileInput = document.getElementById("fileInput");
  const folderInput = document.getElementById("folderInput");
  const queueToggleButton = document.getElementById("modelLoadQueueToggle");

  if (queueToggleButton) {
    queueToggleButton.addEventListener("click", () => {
      const panelEl = document.getElementById("modelLoadQueuePanel");
      const isCollapsed = panelEl ? panelEl.classList.contains("collapsed") : true;
      setQueueCollapsed(!isCollapsed);
    });
  }
  setQueueCollapsed(true);
  setQueueSummary(0, 0);

  const runBatchLoad = async (files, sourceLabel, resetInput) => {
    const allSelectedFiles = files.slice();
    const modelFiles = files.filter((file) => {
      const lower = file.name.toLowerCase();
      return lower.endsWith(".glb") || lower.endsWith(".gltf");
    });

    if (!modelFiles.length) {
      alert("未找到GLB或GLTF模型文件！");
      if (resetInput) resetInput.value = "";
      return;
    }

    clearQueueView();
    setQueueCollapsed(false);
    setQueueSummary(0, modelFiles.length);

    const queueItems = modelFiles.map((file) => ({
      file,
      statusEl: createQueueItem(file.webkitRelativePath || file.name)
    }));

    let successCount = 0;
    let failedCount = 0;
    for (let i = 0; i < queueItems.length; i++) {
      const item = queueItems[i];
      state.lastModelFileSize = item.file.size;
      setQueueItemStatus(item.statusEl, "loading", "加载中");
      try {
        const resolveResourceUrl = getResourceResolver(allSelectedFiles, item.file);
        await loadModel(item.file, { resolveResourceUrl });
        successCount++;
        setQueueItemStatus(item.statusEl, "success", "成功");
        setQueueSummary(successCount + failedCount, modelFiles.length);
      } catch (error) {
        failedCount++;
        console.error("加载模型失败:", item.file.name, error);
        setQueueItemStatus(item.statusEl, "failed", "失败");
        setQueueSummary(successCount + failedCount, modelFiles.length);
      }
    }
    if (resetInput) resetInput.value = "";
  };

  if (uploadButton && fileInput) {
    uploadButton.addEventListener("click", () => fileInput.click());
  }
  if (uploadFolderButton && folderInput) {
    uploadFolderButton.addEventListener("click", () => folderInput.click());
  }

  if (clearModelsButton) {
    clearModelsButton.addEventListener("click", () => removeOldModel());
  }

  if (fileInput) {
    fileInput.addEventListener("change", async (event) => {
      const files = Array.from(event.target.files || []);
      await runBatchLoad(files, "文件上传", fileInput);
    });
  }

  if (folderInput) {
    folderInput.addEventListener("change", async (event) => {
      const files = Array.from(event.target.files || []);
      await runBatchLoad(files, "文件夹上传", folderInput);
    });
  }

  // Initial load.
  state.lastModelFileSize = null;
  renderModelNodesPanel(null);
  loadModel(DEFAULT_MODEL_URL).catch((error) => {
    console.error("默认模型加载失败:", error);
  });
}

export function startMainLoop() {
  let lastFpsTime = performance.now();
  let fpsFrameCount = 0;
  let displayFps = 0;

  const modelInfoFileSizeEl = document.getElementById("modelInfoFileSize");
  const modelInfoFacesEl = document.getElementById("modelInfoFaces");
  const modelInfoFpsEl = document.getElementById("modelInfoFps");

  const updateModelInfoPanel = () => {
    if (modelInfoFileSizeEl) modelInfoFileSizeEl.textContent = "文件大小: " + formatBytes(state.lastModelFileSize);
    if (modelInfoFacesEl) {
      modelInfoFacesEl.textContent = "面数: " + (state.modelRef ? getModelFaceCount().toLocaleString() : "—");
    }
    if (modelInfoFpsEl) modelInfoFpsEl.textContent = "帧率: " + Math.round(displayFps) + " FPS";
  };

  const animate = () => {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = now - lastFpsTime;
    fpsFrameCount++;

    if (delta >= 500) {
      displayFps = (fpsFrameCount * 1000) / delta;
      fpsFrameCount = 0;
      lastFpsTime = now;
    }

    updateModelInfoPanel();
    state.controls.update();
    updateCameraFlight();

    state.flowEffects.forEach((effect) => {
      effect.texture.offset.x -= 0.01 * effect.speed;
    });

    state.renderer.render(state.scene, state.camera);
  };

  animate();
}

// Kept for potential future integration (not wired in current UI).
export const _debug = {
  highlightMeshOrLine,
  highlightMesh
};

