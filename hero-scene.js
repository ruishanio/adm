import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createStory, STORY_DURATION as DURATION, ease } from './hero-story.js';

const mix = THREE.MathUtils.lerp;

/**
 * 创建全屏品牌开场，stage 为画布容器，translate 返回当前语言的替代文本。
 * 模型故事由独立模块编排；本模块负责镜头构图、资源加载与播放生命周期。
 */
export async function createHeroScene(stage, translate) {
  const host = stage.querySelector('.scene-canvas');
  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reveal = () => {
    root.dataset.intro = 'complete';
  };
  const refreshLabels = () => host.setAttribute('aria-label', translate('sceneDescription'));
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    stage.dataset.sceneState = 'fallback';
    reveal();
    return { refreshLabels, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.45;
  environment.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#d7f4ff', '#14221c', 0.7));
  const key = new THREE.DirectionalLight('#ffffff', 1.7);
  key.position.set(4, 7, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#71e8ce', 0.85);
  rim.position.set(-4, 2, -4);
  scene.add(rim);

  let model;
  const loader = new GLTFLoader();
  // 慢网超时后先显示可用官网；晚到的模型直接展示终态，不让正文再次消失。
  try {
    model = await loader.loadAsync('./assets/adm-icon.glb');
  } catch {
    envTarget.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    stage.dataset.sceneState = 'fallback';
    reveal();
    return { refreshLabels, dispose() {} };
  }
  const story = createStory(model.scene);
  const rig = story.group;
  scene.add(rig);
  const right = new THREE.Vector3(),
    up = new THREE.Vector3();
  let time = reducedMotion.matches || root.dataset.intro !== 'loading' ? DURATION : 0;
  let visible = true,
    disposed = false,
    frameId = 0,
    previous = 0;
  let width = host.clientWidth,
    height = host.clientHeight;
  let contextLost = false;
  let lastPose = '';
  if (time < DURATION) root.dataset.intro = 'playing';

  function render() {
    if (contextLost || !width || !height) return;
    const mobile = width <= 760;
    const framing = ease(5.0, DURATION, time);
    const aspect = width / height;
    const finalSize = mobile
      ? Math.min(width * 0.78, height * 0.33)
      : Math.min(width * 0.4, height * 0.62, 760);
    const openingExtent = mobile ? Math.max(10, 6.3 / aspect) : 8.8 * Math.max(1, 1.2 / aspect);
    const extent = mix(openingExtent, (5.8 * height) / finalSize, framing);
    camera.left = (-extent * aspect) / 2;
    camera.right = -camera.left;
    camera.top = extent / 2;
    camera.bottom = -camera.top;
    // 前两幕保持镜头稳定，让连接与收纳动作可读；设备归位时才转向图标角度。
    const turn = ease(3.1, 4.9, time),
      azimuth = mix(0.28, 0.69, turn);
    camera.position.set(Math.sin(azimuth) * 18, 7, Math.cos(azimuth) * 18);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const targetX = mobile ? 0 : extent * aspect * 0.235;
    const targetY = mobile ? extent * 0.19 : extent * 0.015;
    rig.position
      .copy(right)
      .multiplyScalar(targetX * framing)
      .addScaledVector(up, targetY * framing);

    story.update(time, { camera, mobile });
    renderer.render(scene, camera);
    const pose =
      time < 1.35
        ? 'separate'
        : time < 3.1
          ? 'connecting'
          : time < 5
            ? 'together'
            : time < DURATION
              ? 'settling'
              : 'complete';
    if (pose !== lastPose) {
      stage.dataset.pose = pose;
      lastPose = pose;
    }
    if (time >= DURATION) reveal();
  }
  // 以真实经过时间推进，不再限制每帧步长导致低帧率设备整段动画拖慢。
  function tick(now) {
    frameId = 0;
    time = Math.min(DURATION, time + (previous ? (now - previous) / 1000 : 0));
    previous = now;
    render();
    schedule();
  }
  function schedule() {
    if (!frameId && !disposed && !contextLost && visible && !document.hidden && time < DURATION)
      frameId = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    previous = 0;
  }
  function finish() {
    if (time >= DURATION) return;
    stop();
    time = DURATION;
    render();
  }
  const resize = new ResizeObserver(() => {
    width = host.clientWidth;
    height = host.clientHeight;
    renderer.setSize(width, height, false);
    render();
  });
  resize.observe(host);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) schedule();
    else if (time < DURATION) finish();
  });
  intersection.observe(stage);
  const onVisibility = () => {
    if (document.hidden) stop();
    else schedule();
  };
  const onMotion = () => {
    if (reducedMotion.matches) finish();
  };
  // 不锁滚动、不强迫观看；Esc、跳到正文或直接滚过首屏即可结束开场。
  const onKey = (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') finish();
  };
  const onHash = () => {
    if (location.hash) finish();
  };
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onHash);
  reducedMotion.addEventListener('change', onMotion);
  const onContextLost = (event) => {
    event.preventDefault();
    contextLost = true;
    time = DURATION;
    stop();
    stage.dataset.sceneState = 'fallback';
    reveal();
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    resize.disconnect();
    intersection.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('pagehide', onHide);
    reducedMotion.removeEventListener('change', onMotion);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    const geometries = new Set(),
      materials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material)
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) =>
          materials.add(material),
        );
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    envTarget.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  function onHide(event) {
    if (!event.persisted) dispose();
  }
  window.addEventListener('pagehide', onHide);
  stage.dataset.sceneState = 'ready';
  renderer.setSize(width, height, false);
  refreshLabels();
  render();
  schedule();
  return { refreshLabels, dispose };
}
