import { describe, expect, it } from 'vitest';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { parseManifest, readApk } from '../../src/main/apk';
const fixture = new URL('../Fixtures/AndroidManifest.axml', import.meta.url);
describe('APK 二进制清单', () => {
  it('读取真实 aapt 夹具和管理组件', async () => {
    const info = parseManifest(await readFile(fixture));
    expect(info).toMatchObject({
      packageName: 'com.ruinext.androidtool.fixture',
      versionName: '1.0',
      versionCode: '42',
      minimumSdk: '23',
      admins: ['com.ruinext.androidtool.fixture/com.ruinext.androidtool.fixture.AdminReceiver'],
    });
  });
  it.each([0, 4, 8, 28])('拒绝损坏块 %d', async (offset) => {
    const data = await readFile(fixture);
    data.fill(255, offset, offset + 4);
    expect(() => parseManifest(data)).toThrow();
  });
  it('拒绝 XML 实体和文本伪装', () => {
    expect(() => parseManifest(Buffer.from('<!DOCTYPE manifest SYSTEM "file:///etc/passwd">'))).toThrow();
  });
  it('通过 ZIP 读取元数据与文件指纹，拒绝坏包', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'android-tool-apk-'));
    try {
      const file = join(dir, 'fixture.apk'),
        zip = new ZipFile();
      zip.addBuffer(await readFile(fixture), 'AndroidManifest.xml');
      zip.end();
      await pipeline(zip.outputStream, createWriteStream(file));
      const apk = await readApk(file);
      expect(apk.info.fileName).toBe('fixture.apk');
      expect(apk.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(apk.info.admins).toHaveLength(1);
      await writeFile(file, 'bad zip');
      await expect(readApk(file)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
