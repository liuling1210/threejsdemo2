import { initCore, initSceneControls } from "./core.js";
import { initPbrControls } from "./pbr.js";
import { initLightingControls } from "./lighting.js";
import { initModelLoader, startMainLoop } from "./model-loader.js";

initCore();
initPbrControls();
initSceneControls();
initModelLoader();
initLightingControls();
startMainLoop();

