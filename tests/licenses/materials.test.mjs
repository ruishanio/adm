import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkLicenses } from '../../scripts/check-licenses.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function fixture(t) {
  const target = mkdtempSync(resolve(tmpdir(), 'adm-licenses-'));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  cpSync(resolve(root, 'legal'), resolve(target, 'legal'), { recursive: true });
  const manifest = JSON.parse(readFileSync(resolve(root, 'legal/manifest.json'), 'utf8'));
  for (const name of ['package.json', ...Object.keys(manifest.inputs)]) {
    mkdirSync(dirname(resolve(target, name)), { recursive: true });
    cpSync(resolve(root, name), resolve(target, name));
  }
  return target;
}

test('锁文件变化后必须重新核对，不继续使用旧许可', (t) => {
  const target = fixture(t);
  checkLicenses(target);
  writeFileSync(resolve(target, 'package-lock.json'), '{}');
  assert.throws(() => checkLicenses(target), /package-lock.json/);
});

test('实际随包源码归档损坏会中止校验', (t) => {
  const target = fixture(t);
  const [source] = JSON.parse(readFileSync(resolve(target, 'legal/sources.json'), 'utf8'));
  writeFileSync(resolve(target, 'legal', source.file), 'corrupted');
  assert.throws(() => checkLicenses(target), /源码|sources/);
});

test('分发核对未完成时可本地构建，但不能通过上传前检查', (t) => {
  const target = fixture(t);
  const name = 'release-review.json';
  const data = JSON.stringify({ status: 'pending', unresolved: ['待验证源码'], evidence: [] });
  writeFileSync(resolve(target, 'legal', name), data);
  const path = resolve(target, 'legal/manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.files[name] = createHash('sha256').update(data).digest('hex');
  writeFileSync(path, JSON.stringify(manifest));
  checkLicenses(target);
  assert.throws(() => checkLicenses(target, { release: true }), /待验证源码/);
});
