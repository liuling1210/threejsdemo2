import { initCore, initSceneControls } from "./core.js";
import { initPbrControls } from "./pbr.js";
import { initLightingControls } from "./lighting.js";
import { initMaterialEditor } from "./material-editor.js";
import { initDraggablePanels } from "./panel-drag.js";
import { initPostOutline } from "./post-outline.js";
import { initViewportMeshPick } from "./viewport-pick.js";
import { initSettingsPersist } from "./settings-persist.js";
import { initModelLoader, startMainLoop } from "./model-loader.js";

initCore();
initPostOutline();
initPbrControls();
initMaterialEditor();
initSceneControls();
initDraggablePanels();
initModelLoader();
initViewportMeshPick();
initLightingControls();
initSettingsPersist();
startMainLoop();

