import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createDeviceModel } from './hero-model.js';

const HOVER_DELAY = 220;

/**
 * 创建居中的交互模型。stage 为容器，translate 提供当前语言文案。
 * 返回标签更新与销毁方法；模型加载不会延迟导航、正文和下载入口。
 */
export async function createHeroScene(stage, translate) {
  const host = stage.querySelector('.scene-canvas');
  const status = stage.querySelector('.scene-status');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const refreshLabels = () => host.setAttribute('aria-label', translate('sceneDescription'));
  const fallback = () => {
    stage.dataset.sceneState = 'fallback';
    host.tabIndex = -1;
  };
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    fallback();
    return { refreshLabels, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 3.5, -2.5, 0.1, 100);
  camera.position.set(Math.sin(0.69) * 18, 7, Math.cos(0.69) * 18);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.6;
  environment.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#ffffff', '#697586', 1));
  const key = new THREE.DirectionalLight('#ffffff', 1.7);
  key.position.set(4, 7, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#d9e4ff', 0.7);
  rim.position.set(-4, 3, -4);
  scene.add(rim);
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync('./assets/adm-icon.glb');
  } catch {
    envTarget.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    fallback();
    return { refreshLabels, dispose() {} };
  }
  const model = createDeviceModel(gltf.scene);
  scene.add(model.group);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const keyboardOrder = [2, 1, 0];
  let pointerInside = false, mode = null, paused = false;
  let visible = true, disposed = false, lost = false;
  let width = host.clientWidth, height = host.clientHeight;
  let frameId = 0, previous = 0, touchStart = null;
  let hoverTimer = 0, hoverCandidate = null;
  const events = new AbortController();
  const listen = (target, type, callback, options = {}) =>
    target.addEventListener(type, callback, { ...options, signal: events.signal });

  function draw() {
    if (!lost && width && height) renderer.render(scene, camera);
  }
  function needsFrame() {
    return model.moving || (!reducedMotion.matches && !paused && model.activeIndex === null);
  }
  function schedule() {
    if (!frameId && !disposed && !lost && visible && !document.hidden && needsFrame())
      frameId = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    previous = 0;
  }
  function cancelHover() {
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    hoverCandidate = null;
  }
  function select(index, inputMode) {
    if (inputMode !== 'pointer') cancelHover();
    if (index === model.activeIndex && mode === inputMode) return;
    mode = inputMode;
    model.setActive(index);
    // 先推进一小步以启动按需动画；减少动态效果时直接切换到选中姿态。
    model.update(1 / 60, { rotate: false, instant: reducedMotion.matches });
    stage.dataset.activeDevice = index === null ? '' : String(index);
    host.style.cursor = index === null ? '' : 'pointer';
    draw();
    schedule();
  }
  function hit() {
    raycaster.setFromCamera(pointer, camera);
    return model.pick(raycaster);
  }
  /** 连续停留在同一台设备上才触发；移开、改选或暂停页面时取消候选。 */
  function updateHover(index) {
    mode = 'pointer';
    if (index === null || index === model.activeIndex) {
      cancelHover();
      select(index, 'pointer');
      host.style.cursor = index === null ? '' : 'pointer';
      return;
    }
    if (model.activeIndex !== null) select(null, 'pointer');
    host.style.cursor = 'pointer';
    if (hoverCandidate === index) return;
    cancelHover();
    hoverCandidate = index;
    hoverTimer = setTimeout(() => {
      cancelHover();
      if (disposed || lost || !visible || document.hidden || !pointerInside || mode !== 'pointer') return;
      // 等待期间模型仍会摆动，提交前重新射线检查，不能选中已从鼠标下移走的设备。
      const current = hit();
      if (current === index) select(index, 'pointer');
      else updateHover(current);
    }, HOVER_DELAY);
  }
  function tick(now) {
    frameId = 0;
    const dt = previous ? (now - previous) / 1000 : 1 / 60;
    previous = now;
    model.update(dt, { rotate: !paused && !reducedMotion.matches, instant: reducedMotion.matches });
    if (pointerInside && mode === 'pointer') updateHover(hit());
    draw();
    if (needsFrame()) schedule();
    else previous = 0;
  }
  function updatePointer(event) {
    const rect = host.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  }
  listen(host, 'pointermove', event => {
    if (event.pointerType === 'touch') return;
    pointerInside = true;
    updatePointer(event);
    updateHover(hit());
  });
  listen(host, 'pointerleave', event => {
    if (event.pointerType === 'touch') return;
    pointerInside = false;
    cancelHover();
    if (mode === 'pointer') select(null, null);
  });
  // 触屏轻点切换，保留纵向滚动；滑动手势不能误触拔出设备。
  listen(host, 'pointerdown', event => {
    if (event.pointerType === 'touch') {
      cancelHover();
      pointerInside = false;
      touchStart = { x: event.clientX, y: event.clientY };
    }
  });
  listen(host, 'pointerup', event => {
    if (event.pointerType !== 'touch' || !touchStart) return;
    const distance = Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y);
    touchStart = null;
    if (distance > 10) return;
    updatePointer(event);
    const index = hit();
    select(index === model.activeIndex ? null : index, 'touch');
  });
  listen(host, 'pointercancel', () => {
    touchStart = null;
    pointerInside = false;
    cancelHover();
    if (mode === 'pointer') select(null, null);
  });
  listen(document, 'pointerdown', event => {
    if (!host.contains(event.target)) { pointerInside = false; select(null, null); }
  });
  listen(host, 'keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      pointerInside = false;
      const current = keyboardOrder.indexOf(model.activeIndex);
      const next = current < 0 ? 0 : (current + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      const index = keyboardOrder[next];
      select(index, 'keyboard');
      status.textContent = `${translate(`sceneDevices.${index}`)} · ${translate('sceneLifted')}`;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      pointerInside = false;
      paused = true;
      select(null, null);
      status.textContent = translate('sceneRestored');
    } else if (event.key === ' ') {
      event.preventDefault();
      paused = !paused;
      status.textContent = translate(paused || reducedMotion.matches ? 'scenePaused' : 'sceneRotating');
      schedule();
    }
  });
  listen(host, 'blur', () => {
    if (mode === 'keyboard') select(null, null);
  });
  listen(window, 'scroll', () => {
    pointerInside = false;
    touchStart = null;
    cancelHover();
    if (model.activeIndex !== null) select(null, null);
  }, { passive: true });
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { cancelHover(); stop(); }
    else schedule();
  });
  listen(reducedMotion, 'change', () => {
    stop();
    model.update(0, { rotate: false, instant: reducedMotion.matches });
    draw();
    schedule();
  });
  listen(renderer.domElement, 'webglcontextlost', event => {
    event.preventDefault();
    lost = true;
    cancelHover();
    stop();
    fallback();
  });
  const resize = new ResizeObserver(() => {
    width = host.clientWidth;
    height = host.clientHeight;
    if (!width || !height) return;
    const aspect = width / height, extent = Math.max(6, 7 / aspect);
    camera.left = -extent * aspect / 2;
    camera.right = -camera.left;
    camera.top = extent / 2 + 0.5;
    camera.bottom = -extent / 2 + 0.5;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    draw();
  });
  resize.observe(host);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) { draw(); schedule(); }
    else {
      cancelHover();
      stop();
      pointerInside = false;
      mode = null;
      model.setActive(null);
      model.update(0, { rotate: false, instant: true });
      stage.dataset.activeDevice = '';
    }
  });
  intersection.observe(stage);
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelHover();
    stop();
    events.abort();
    resize.disconnect();
    intersection.disconnect();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material])
        .forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => {
      if (material.map) textures.add(material.map);
      material.dispose();
    });
    textures.forEach(texture => texture.dispose());
    envTarget.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  listen(window, 'pagehide', event => { if (!event.persisted) dispose(); });
  stage.dataset.sceneState = 'ready';
  refreshLabels();
  schedule();
  return { refreshLabels, dispose };
}
