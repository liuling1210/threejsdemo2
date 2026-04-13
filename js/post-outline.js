import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { state } from "./core.js";

function onWindowResizeComposer() {
  if (!state.composer || !state.outlinePass || !state.renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  state.composer.setSize(w, h);
  state.composer.setPixelRatio(state.renderer.getPixelRatio());
  state.outlinePass.resolution.set(w, h);
}

/**
 * @param {THREE.Object3D[]} list
 */
export function setOutlineSelectedObjects(list) {
  if (!state.outlinePass) return;
  state.outlinePass.selectedObjects = Array.isArray(list) ? list : [];
}

export function initPostOutline() {
  const renderer = state.renderer;
  const scene = state.scene;
  const camera = state.camera;
  if (!renderer || !scene || !camera) return;

  const w = window.innerWidth;
  const h = window.innerHeight;

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const outlinePass = new OutlinePass(new THREE.Vector2(w, h), scene, camera);
  outlinePass.visibleEdgeColor.set("#44ddff");
  outlinePass.hiddenEdgeColor.set("#1a0a2e");
  outlinePass.edgeStrength = 4;
  outlinePass.edgeGlow = 0.85;
  outlinePass.edgeThickness = 1.8;
  outlinePass.pulsePeriod = 2.2;
  composer.addPass(outlinePass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  state.composer = composer;
  state.outlinePass = outlinePass;

  window.addEventListener("resize", onWindowResizeComposer);
}
