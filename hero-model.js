import * as THREE from 'three';

export const DEVICE_LIFT = 1.08;
export const SWAY_CENTER = 0.69;
export const SWAY_ANGLE = 0.85;
const WIGGLE_DURATION = 1.2;
// 回插后的三次柔和明暗过渡，末段保持常亮；仅在真正落座后启动。
const SCREEN_STARTUP = [[0, 0], [0.16, 1], [0.34, 0.25], [0.52, 1], [0.70, 0.35], [0.88, 1], [1.06, 0.5], [1.24, 1]];
const STARTUP_DURATION = SCREEN_STARTUP.at(-1)[0];
const OFF_COLOR = new THREE.Color('#111820');

/**
 * 把原始 GLB 分成底座和三台完整设备，保持机身、屏幕的比例与插槽坐标。
 * 返回模型、选取方法和状态更新器；setActive 指定拔起的设备，null 表示全部插回。
 */
export function createDeviceModel(model) {
  const group = new THREE.Group();
  group.name = 'adm-model';
  const assembly = new THREE.Group();
  group.add(assembly);
  const parts = [...model.children];
  model.updateMatrixWorld(true);
  const liveMeshes = [], homeMeshes = [];
  const proxyMaterial = new THREE.MeshBasicMaterial();
  const homeGeometry = new THREE.BoxGeometry(2.26, 2.9, 0.37);
  const corridorGeometry = new THREE.BoxGeometry(2.5, 3.1 + DEVICE_LIFT, 0.64);
  const phones = ['Rear', 'Middle', 'Front'].map((name, index) => {
    const phone = new THREE.Group();
    phone.name = `device-${name.toLowerCase()}`;
    const home = new THREE.Vector3(0, 1.7, (index - 1) * 1.7);
    phone.position.copy(home);
    assembly.add(phone);
    group.updateMatrixWorld(true);
    let screen;
    for (const part of parts.filter(part => part.name.startsWith(name))) {
      phone.attach(part);
      part.traverse(object => {
        if (!object.isMesh) return;
        object.userData.deviceIndex = index;
        liveMeshes.push(object);
        if (object.name.includes('屏幕')) {
          // 原文件共用屏幕材质；每台单独复制，息屏不能影响另外两台。
          object.material = object.material.clone();
          screen = { material: object.material, color: object.material.color.clone(),
            emission: object.material.emissiveIntensity };
        }
      });
    }
    const homeProxy = new THREE.Mesh(homeGeometry, proxyMaterial);
    homeProxy.name = `device-home-${index}`;
    homeProxy.position.copy(home);
    homeProxy.userData.deviceIndex = index;
    homeProxy.visible = false;
    const corridor = new THREE.Mesh(corridorGeometry, proxyMaterial);
    corridor.position.copy(home);
    corridor.position.y += DEVICE_LIFT / 2;
    corridor.visible = false;
    assembly.add(homeProxy, corridor);
    homeMeshes.push(homeProxy);
    return { group: phone, home, screen, corridor, lift: 0, power: 1, disconnected: false,
      wiggleTime: WIGGLE_DURATION, startupTime: STARTUP_DURATION };
  });
  const dock = new THREE.Group();
  dock.name = 'device-dock';
  assembly.add(dock);
  for (const part of parts.filter(part => part.name.startsWith('Dock') || part.name.startsWith('Android'))) {
    dock.attach(part);
    part.traverse(object => {
      if (object.isMesh) { liveMeshes.push(object); homeMeshes.push(object); }
    });
  }
  assembly.position.y = -1.45;

  // 中性背景上只留一层柔和的接地阴影，不生成绿色底板。
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot((x + 0.5 - size / 2) / (size / 2), (y + 0.5 - size / 2) / (size / 2));
    pixels[(y * size + x) * 4 + 3] = Math.round(255 * Math.pow(Math.max(0, 1 - distance), 2));
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.needsUpdate = true;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5, 7.6),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.32, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.44;
  group.add(shadow);
  let activeIndex = null, moving = false, swayPhase = Math.asin(-SWAY_CENTER / SWAY_ANGLE);

  function setActive(index) {
    const next = Number.isInteger(index) && index >= 0 && index < phones.length ? index : null;
    if (next === activeIndex) return;
    activeIndex = next;
    if (next !== null) {
      phones[next].wiggleTime = 0;
      if (phones[next].disconnected) phones[next].startupTime = 0;
    }
  }
  /** 固定原插槽的命中区，并保留拔起路径，避免设备上移后悬停反复丢失、抖动。 */
  function pick(raycaster) {
    group.updateMatrixWorld(true);
    const live = raycaster.intersectObjects(liveMeshes, false)[0]?.object.userData.deviceIndex;
    if (live === activeIndex && activeIndex !== null) return activeIndex;
    const home = raycaster.intersectObjects(homeMeshes, false)[0]?.object.userData.deviceIndex;
    if (Number.isInteger(home)) return home;
    if (Number.isInteger(live)) return live;
    if (activeIndex !== null && raycaster.intersectObject(phones[activeIndex].corridor, false).length)
      return activeIndex;
    return null;
  }
  /** 按时间插值屏幕亮度，使用平滑曲线让闪亮有渐变，而不是突然开关。 */
  function startupPower(time) {
    for (let i = 1; i < SCREEN_STARTUP.length; i++) {
      const [end, to] = SCREEN_STARTUP[i];
      if (time <= end) {
        const [start, from] = SCREEN_STARTUP[i - 1];
        return THREE.MathUtils.lerp(from, to, THREE.MathUtils.smoothstep(time, start, end));
      }
    }
    return 1;
  }
  /**
   * dt 为秒数；rotate 控制空闲时的正面摆动，instant 跳过轻摇与亮屏闪烁。
   * 设备依次经历上提、轻摇、回插、亮屏；更新 moving 供页面按需申请下一帧。
   */
  function update(dt, { rotate = true, instant = false } = {}) {
    const step = Math.min(Math.max(dt, 0), 0.1);
    moving = false;
    for (const [index, phone] of phones.entries()) {
      const selected = index === activeIndex, target = selected ? 1 : 0;
      phone.lift = instant ? target : THREE.MathUtils.damp(phone.lift, target, 13, step);
      if (Math.abs(phone.lift - target) < 0.0005) phone.lift = target;
      phone.group.position.y = phone.home.y + DEVICE_LIFT * phone.lift;
      if (instant) {
        phone.wiggleTime = WIGGLE_DURATION;
        phone.startupTime = STARTUP_DURATION;
        phone.group.rotation.set(0, 0, 0);
        phone.power = selected ? 0 : 1;
        phone.disconnected = selected;
      } else {
        // 升起到位后轻摇三下，振幅自然收拢；持续悬停不会重复播放。
        if (selected && phone.lift > 0.96 && phone.wiggleTime < WIGGLE_DURATION) {
          phone.wiggleTime = Math.min(WIGGLE_DURATION, phone.wiggleTime + step);
          const progress = phone.wiggleTime / WIGGLE_DURATION;
          const envelope = Math.sin(Math.PI * progress) ** 2;
          const shake = Math.sin(progress * Math.PI * 6) * envelope;
          phone.group.rotation.z = shake * 0.085;
          phone.group.rotation.y = shake * 0.05;
        } else {
          // 中途移开时先收正姿态，下降到插槽附近已完全对齐。
          phone.group.rotation.z = THREE.MathUtils.damp(phone.group.rotation.z, 0, 24, step);
          phone.group.rotation.y = THREE.MathUtils.damp(phone.group.rotation.y, 0, 24, step);
        }
        if (Math.abs(phone.group.rotation.z) < 0.00005) phone.group.rotation.z = 0;
        if (Math.abs(phone.group.rotation.y) < 0.00005) phone.group.rotation.y = 0;
        // 只有真正离开插槽才断电；轻微上提后马上取消，不息屏也不播放回插闪亮。
        if (!phone.disconnected && phone.lift >= 0.35) {
          phone.disconnected = true;
          phone.startupTime = 0;
        }
        if (!phone.disconnected) {
          phone.power = 1;
        } else if (selected || phone.lift > 0) {
          phone.power = THREE.MathUtils.damp(phone.power, 0, 18, step);
          if (phone.power < 0.0005) phone.power = 0;
        } else {
          phone.startupTime = Math.min(STARTUP_DURATION, phone.startupTime + step);
          phone.power = startupPower(phone.startupTime);
          if (phone.startupTime === STARTUP_DURATION) phone.disconnected = false;
        }
      }
      phone.screen.material.color.lerpColors(OFF_COLOR, phone.screen.color, phone.power);
      phone.screen.material.emissiveIntensity = phone.screen.emission * phone.power;
      moving ||= phone.lift !== target || (selected && (phone.power !== 0 || phone.wiggleTime < WIGGLE_DURATION))
        || (!selected && phone.startupTime < STARTUP_DURATION)
        || phone.group.rotation.z !== 0 || phone.group.rotation.y !== 0;
    }
    // 相位只在空闲时推进，悬停与回插后接着原来的方向摆动，始终展示正面。
    if (rotate && !instant && activeIndex === null && !moving) {
      swayPhase = (swayPhase + step * Math.PI * 2 / 15) % (Math.PI * 2);
      group.rotation.y = SWAY_CENTER + Math.sin(swayPhase) * SWAY_ANGLE;
    }
    group.updateMatrixWorld(true);
  }
  update(0);
  return { group, phones, pick, setActive, update,
    get activeIndex() { return activeIndex; }, get moving() { return moving; } };
}
