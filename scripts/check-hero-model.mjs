import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createDeviceModel, DEVICE_LIFT, SWAY_CENTER, SWAY_ANGLE } from '../hero-model.js';

const buffer = await readFile(new URL('../public/assets/adm-icon.glb', import.meta.url));
const { scene } = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
const model = createDeviceModel(scene);
const camera = new THREE.OrthographicCamera(-4.8, 4.8, 3.5, -2.5, 0.1, 100);
camera.position.set(Math.sin(0.69) * 18, 7, Math.cos(0.69) * 18);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} ≠ ${b}`);
const settle = () => { for (let frame = 0; frame < 150; frame++) model.update(1 / 60, { rotate: false }); };
const coordinates = new Map();
// 从实际射线命中结果采样三台设备，验证所有设备都能被独立指向。
for (let y = -0.65; y <= 0.6; y += 0.025) for (let x = -0.6; x <= 0.6; x += 0.025) {
  ray.setFromCamera(new THREE.Vector2(x, y), camera);
  const index = model.pick(ray);
  if (index !== null) coordinates.set(index, new THREE.Vector2(x, y));
}
assert.equal(coordinates.size, 3, '三台设备应分别可被指向');
assert.equal(new Set(model.phones.map(phone => phone.screen.material)).size, 3, '屏幕材质不能共用');
for (const [index, point] of coordinates) {
  model.setActive(index);
  settle();
  for (const [other, phone] of model.phones.entries()) {
    near(phone.group.position.y, phone.home.y + (index === other ? DEVICE_LIFT : 0), '仅选中的设备升起');
    near(phone.power, index === other ? 0 : 1, '仅选中的屏幕熄灭');
    near(phone.group.position.x, phone.home.x, '不横移');
    near(phone.group.position.z, phone.home.z, '始终对准原插槽');
    near(phone.group.scale.y, 1, '保持原比例');
  }
  ray.setFromCamera(point, camera);
  assert.equal(model.pick(ray), index, '拔起后原悬停位置仍需稳定命中');
  const rotation = model.group.rotation.y;
  model.update(0.1);
  near(model.group.rotation.y, rotation, '悬停时暂停旋转');
  model.setActive(null);
  for (let frame = 0; frame < 10; frame++) {
    model.update(1 / 60);
    near(model.group.rotation.y, rotation, '回插时不旋转');
    assert.ok(model.phones[index].lift >= 0 && model.phones[index].lift <= 1, '插回过程不越过插槽底部');
  }
  settle();
  near(model.phones[index].power, 1, '完全插回后亮屏');
  near(model.phones[index].group.position.y, model.phones[index].home.y, '完整复位');
}
// 连续采样上提后的轻摇，确认左右都有幅度、命中稳定且只播放一次。
model.setActive(2);
const shakes = [];
for (let frame = 0; frame < 150; frame++) {
  model.update(1 / 60, { rotate: false });
  shakes.push(model.phones[2].group.rotation.z);
  ray.setFromCamera(coordinates.get(2), camera);
  assert.equal(model.pick(ray), 2, '轻摇中原悬停位置不丢失');
}
assert.ok(Math.max(...shakes) > 0.05 && Math.min(...shakes) < -0.05, '提起后应向两边轻摇');
near(shakes.at(-1), 0, '轻摇结束后恢复直立');
assert.equal(model.moving, false, '持续悬停不重复轻摇');
model.setActive(null);
let previousPower = 0, previousDelta = 0, peaks = 0;
for (let frame = 0; frame < 150; frame++) {
  model.update(1 / 60, { rotate: false });
  const phone = model.phones[2];
  if (phone.lift > 0) near(phone.power, 0, '落座之前屏幕保持熄灭');
  const delta = phone.power - previousPower;
  if (delta < 0 && previousDelta > 0) peaks++;
  if (delta !== 0) previousDelta = delta;
  previousPower = phone.power;
}
assert.equal(peaks, 3, '落座后闪亮三次再常亮');
near(previousPower, 1, '闪亮结束后稳定常亮');
assert.equal(model.moving, false, '亮屏结束不继续刷新静止模型');
// 中途改选和移开不会残留歪斜、闪烁或屏幕错误状态。
model.setActive(0);
for (let frame = 0; frame < 40; frame++) model.update(1 / 60, { rotate: false });
model.setActive(1);
for (let frame = 0; frame < 12; frame++) model.update(1 / 60, { rotate: false });
model.setActive(null);
settle();
for (const phone of model.phones) {
  near(phone.lift, 0, '快速改选后设备全部回插');
  near(phone.group.rotation.z, 0, '快速改选后姿态回正');
  near(phone.power, 1, '快速改选后屏幕常亮');
}
// 还没离开插槽就取消时保持常亮，不触发断电或回插闪亮。
model.setActive(1);
model.update(1 / 60, { rotate: false });
assert.ok(model.phones[1].lift < 0.35, '采样尚未离座的上提状态');
near(model.phones[1].power, 1, '未离座前保持亮屏');
model.setActive(null);
for (let frame = 0; frame < 150; frame++) {
  model.update(1 / 60, { rotate: false });
  near(model.phones[1].power, 1, '取消轻微上提后不黑屏、不闪亮');
}
assert.equal(model.moving, false, '取消后停止多余动画');
model.setActive(1);
model.update(0, { instant: true, rotate: false });
near(model.phones[1].lift, 1, '减少动态效果可直接选中');
model.setActive(null);
model.update(0, { instant: true, rotate: false });
assert.equal(model.moving, false, '减少动态效果跳过轻摇与闪亮');
near(model.phones[1].power, 1, '减少动态效果直接亮屏');
// 覆盖多个完整周期：经过正面看到两侧，但不能转向背面。
let minimum = Infinity, maximum = -Infinity, reversals = 0, direction = 0;
for (let frame = 0; frame < 3600; frame++) {
  const previous = model.group.rotation.y;
  model.update(1 / 60);
  const angle = model.group.rotation.y;
  minimum = Math.min(minimum, angle);
  maximum = Math.max(maximum, angle);
  assert.ok(Math.abs(angle - SWAY_CENTER) <= SWAY_ANGLE + 1e-8, '摆动不越过正面范围');
  const next = Math.sign(angle - previous);
  if (direction && next !== direction) reversals++;
  direction = next;
}
assert.ok(minimum < SWAY_CENTER - 0.8 && maximum > SWAY_CENTER + 0.8, '两侧都应有完整展示角度');
assert.ok(reversals >= 6, '持续播放应往复摆动');
ray.setFromCamera(new THREE.Vector2(2, 2), camera);
assert.equal(model.pick(ray), null, '移出模型应取消悬停');
console.log('模型检查通过：独立悬停、命中稳定、拔起息屏、对齐回插亮屏、双侧正面摆动、上提轻摇、回插闪亮、快速改选、未离座取消不断电、减少动态效果。');
