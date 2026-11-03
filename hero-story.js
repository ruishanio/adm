import * as THREE from 'three';

export const STORY_DURATION = 6.2;
export function ease(start, end, time) {
  const t = THREE.MathUtils.clamp((time - start) / (end - start), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 生成圆角实体，宽、高、圆角和厚度均采用模型坐标单位。 */
function roundedGeometry(width, height, radius, depth = 0.06) {
  const x = -width / 2,
    y = -height / 2,
    shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    curveSegments: 10,
  });
}

/** 保留原始手机和底座几何；故事中的设备完整出现，不再拆散屏幕与机身。 */
function groupDevices(model) {
  const assembly = new THREE.Group();
  const parts = [...model.children];
  model.updateMatrixWorld(true);
  const phones = ['Rear', 'Middle', 'Front'].map((name, index) => {
    const group = new THREE.Group(),
      home = new THREE.Vector3(0, 1.7, (index - 1) * 1.7);
    group.position.copy(home);
    assembly.add(group);
    group.updateMatrixWorld(true);
    let screen;
    for (const part of parts.filter((part) => part.name.startsWith(name))) {
      group.attach(part);
      if (part.name.includes('屏幕')) {
        part.material = part.material.clone();
        screen = {
          material: part.material,
          color: part.material.color.clone(),
          emission: part.material.emissiveIntensity,
        };
      }
    }
    return { group, home, screen };
  });
  const dock = new THREE.Group();
  assembly.add(dock);
  for (const part of parts.filter((part) => part.name.startsWith('Dock') || part.name.startsWith('Android')))
    dock.attach(part);
  assembly.position.y = -1.45;
  return { assembly, phones, dock };
}

/** 简洁的任务便签分别表示日志、文件、应用；连接后收进各自设备屏幕。 */
function createTask(index) {
  const group = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color: '#e1efe9', roughness: 0.8 });
  const ink = new THREE.MeshBasicMaterial({
    color: index === 1 ? '#bd813e' : index === 2 ? '#4b61b2' : '#397a6b',
  });
  const muted = new THREE.MeshBasicMaterial({ color: '#9bafa7' });
  group.add(new THREE.Mesh(roundedGeometry(1.12, 0.83, 0.09), paper));
  if (index === 2) {
    const tile = roundedGeometry(0.18, 0.18, 0.035, 0.018);
    for (let i = 0; i < 4; i++) {
      const square = new THREE.Mesh(tile, ink);
      square.position.set(-0.25 + (i % 2) * 0.24, 0.14 - Math.floor(i / 2) * 0.24, 0.09);
      group.add(square);
    }
  } else if (index === 1) {
    const folder = new THREE.Mesh(roundedGeometry(0.53, 0.34, 0.04, 0.02), ink);
    const tab = new THREE.Mesh(roundedGeometry(0.23, 0.09, 0.025, 0.018), ink);
    folder.position.set(-0.08, 0.015, 0.09);
    tab.position.set(-0.22, 0.21, 0.09);
    group.add(folder, tab);
  } else {
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(i === 2 ? 0.32 : 0.56, 0.045, 0.015),
        i === 0 ? ink : muted,
      );
      line.position.set(i === 2 ? -0.12 : 0, 0.18 - i * 0.16, 0.09);
      group.add(line);
    }
  }
  const materials = new Set();
  group.traverse((object) => {
    if (object.material) {
      object.material.transparent = true;
      object.material.depthWrite = false;
      materials.add(object.material);
    }
  });
  return { group, materials: [...materials] };
}

/**
 * 创建「分散的设备 → 连接起来 → 一个工作台」的品牌故事。
 * update 接收秒数、当前镜头和窄屏标记；只更新模型，不操作页面或播放计时。
 */
export function createStory(model) {
  const group = new THREE.Group();
  const { assembly, phones, dock } = groupDevices(model);
  group.add(assembly);
  const dockMaterials = new Set();
  dock.traverse((object) => {
    if (object.material) {
      object.material = object.material.clone();
      object.material.transparent = true;
      dockMaterials.add(object.material);
    }
  });
  const tasks = phones.map((_, index) => createTask(index));
  tasks.forEach((task) => group.add(task.group));
  // 有厚度的细线充当连接线，避免高分屏上的单像素线几乎不可见。
  const cableGeometry = new THREE.CylinderGeometry(0.017, 0.017, 1, 6);
  const connections = phones.map(() => {
    const material = new THREE.MeshBasicMaterial({
      color: '#63d9ae',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const wire = new THREE.InstancedMesh(cableGeometry, material, 40);
    wire.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    wire.frustumCulled = false;
    const pulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#a7f5cd' }),
    );
    group.add(wire, pulse);
    return { wire, pulse, curve: new THREE.CubicBezierCurve3() };
  });
  const segmentStart = new THREE.Vector3(),
    segmentEnd = new THREE.Vector3(),
    segmentDelta = new THREE.Vector3(),
    segmentMid = new THREE.Vector3(),
    segmentScale = new THREE.Vector3(),
    axisY = new THREE.Vector3(0, 1, 0);
  const segmentRotation = new THREE.Quaternion(),
    segmentMatrix = new THREE.Matrix4();
  const plateMaterial = new THREE.MeshBasicMaterial({
    color: '#2bd9b4',
    toneMapped: false,
    transparent: true,
    opacity: 0,
  });
  const plate = new THREE.Mesh(roundedGeometry(5.8, 5.8, 1.28, 0.14), plateMaterial);
  group.add(plate);
  const initialRight = new THREE.Vector3(Math.cos(0.28), 0, -Math.sin(0.28));
  const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.28, 0));
  const identity = new THREE.Quaternion(),
    tilted = new THREE.Quaternion(),
    turn = new THREE.Quaternion();
  const start = new THREE.Vector3(),
    target = new THREE.Vector3();
  const offScreenColor = new THREE.Color('#365669');
  const mix = THREE.MathUtils.lerp;

  function update(time, { camera, mobile }) {
    // 第 1 幕：三台完整设备各自带着任务，没有粒子、轨道或无目的的旋转。
    const collect = ease(3.1, 4.65, time);
    const dockShow = ease(0.95, 1.65, time);
    dock.position.y = (mobile ? -1.8 : 0) - 0.85 * (1 - dockShow);
    dock.position.y *= 1 - collect;
    dock.visible = dockShow > 0;
    for (const material of dockMaterials) material.opacity = dockShow;
    phones.forEach(({ group: phone, home, screen }, index) => {
      const arrival = ease(3.1 + index * 0.12, 4.5 + index * 0.12, time);
      if (mobile) start.set(index === 1 ? -1.15 : 1.15, 3.55 - index * 1.8, 0);
      else
        start
          .copy(initialRight)
          .multiplyScalar((1 - index) * 3.25)
          .add(new THREE.Vector3(0, index === 1 ? 2.5 : 2.15, 0));
      phone.position.lerpVectors(start, home, arrival);
      // 只做一次很轻的抬升以避开插槽边缘，最终严格回到图标原始坐标。
      phone.position.y += Math.sin(arrival * Math.PI) * 0.35;
      turn.setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        [0.055, -0.045, -0.055][index] * (1 - ease(1.9, 3.1, time)),
      );
      tilted.copy(facing).multiply(turn);
      phone.quaternion.copy(tilted).slerp(identity, arrival);
      phone.scale.setScalar(mix(mobile ? 0.7 : 0.88, 1, arrival));
      // 第 2 幕：底座发出连接信号，抵达后屏幕才亮起，建立明确的因果关系。
      const connectionOrder = 2 - index;
      const connected = ease(2.05 + connectionOrder * 0.16, 2.4 + connectionOrder * 0.16, time);
      if (screen) {
        screen.material.color.lerpColors(offScreenColor, screen.color, connected);
        screen.material.emissiveIntensity = mix(0.015, screen.emission, connected);
      }
      const link = connections[index],
        draw = ease(1.35 + connectionOrder * 0.16, 2.1 + connectionOrder * 0.16, time);
      link.curve.v0.set(0, 0.68 + dock.position.y, (index - 1) * 1.7).add(assembly.position);
      target
        .set(0, -1.43, 0)
        .multiplyScalar(phone.scale.x)
        .applyQuaternion(phone.quaternion)
        .add(phone.position)
        .add(assembly.position);
      link.curve.v3.copy(target);
      link.curve.v1.copy(link.curve.v0).add(new THREE.Vector3((1 - index) * 0.45, 0.45, 0));
      link.curve.v2.copy(target).add(new THREE.Vector3(0, -0.65, 0));
      link.curve.getPoint(0, segmentStart);
      for (let n = 0; n < 40; n++) {
        link.curve.getPoint((n + 1) / 40, segmentEnd);
        segmentDelta.subVectors(segmentEnd, segmentStart);
        const length = segmentDelta.length();
        segmentRotation.setFromUnitVectors(axisY, segmentDelta.normalize());
        segmentMid.addVectors(segmentStart, segmentEnd).multiplyScalar(0.5);
        segmentScale.set(1, length, 1);
        segmentMatrix.compose(segmentMid, segmentRotation, segmentScale);
        link.wire.setMatrixAt(n, segmentMatrix);
        segmentStart.copy(segmentEnd);
      }
      link.wire.instanceMatrix.needsUpdate = true;
      link.wire.count = Math.round(draw * 40);
      link.wire.material.opacity = 0.72 * (1 - ease(3.15, 3.9, time));
      link.wire.visible = draw > 0 && time < 3.9;
      link.pulse.visible = draw > 0.02 && draw < 0.995;
      link.curve.getPoint(draw, link.pulse.position);
      // 第 3 幕：散落便签收进屏幕，三台设备归入同一底座；不暗示自动安装或修复。
      const task = tasks[index],
        gather = ease(2.25 + connectionOrder * 0.13, 3.2 + connectionOrder * 0.13, time);
      target
        .set(0, 0.15, 0.25)
        .multiplyScalar(phone.scale.x)
        .applyQuaternion(phone.quaternion)
        .add(phone.position)
        .add(assembly.position);
      start
        .copy(target)
        .addScaledVector(initialRight, mobile ? (index === 1 ? 1.15 : -1.15) : [1.15, 1.1, -1.15][index]);
      start.y += mobile ? 0.7 : 0.95;
      task.group.position.lerpVectors(start, target, gather);
      task.group.quaternion.copy(camera.quaternion).slerp(phone.quaternion, gather);
      task.group.rotateZ([0.16, -0.12, -0.17][index] * (1 - gather));
      task.group.scale.setScalar(mix(mobile ? 0.8 : 1.04, 0.8, gather));
      const alpha = ease(0, 0.35, time) * (1 - ease(3.5, 4.25, time));
      task.group.visible = alpha > 0;
      for (const material of task.materials) material.opacity = alpha;
    });
    const plateIn = ease(4.55, 5.2, time);
    plate.visible = plateIn > 0;
    plateMaterial.opacity = plateIn;
    plate.quaternion.copy(camera.quaternion);
    plate.position.copy(camera.position).normalize().multiplyScalar(-3.2);
    plate.scale.setScalar(mix(0.96, 1, plateIn));
  }
  return { group, update };
}
