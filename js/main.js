import { initCore, initSceneControls } from "./core.js";
import { initPbrControls } from "./pbr.js";
import { initLightingControls } from "./lighting.js";
import { initMaterialEditor } from "./material-editor.js";
import { initDraggablePanels } from "./panel-drag.js";
import { initModelLoader, startMainLoop } from "./model-loader.js";

initCore();
initPbrControls();
initMaterialEditor();
initSceneControls();
initDraggablePanels();
initModelLoader();
initLightingControls();
startMainLoop();

