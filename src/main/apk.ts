import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as yauzl from 'yauzl';
import type { Apk } from '../shared/contracts';
import { component, packagePattern } from './parsing';

interface Element {
  name: string;
  attributes: Record<string, string>;
  children: Element[];
}
const android = 'http://schemas.android.com/apk/res/android';
/** 解析 Android 二进制 XML，所有偏移受块边界约束；不依赖 aapt 或任何 .NET 组件。 */
export function parseManifest(data: Buffer): Omit<Apk, 'id' | 'fileName' | 'size'> {
  const invalid = () => new Error('APK 清单损坏或格式不受支持。');
  function range(at: number, length: number, end = data.length) {
    if (at < 0 || length < 0 || at + length > end) throw invalid();
  }
  const u16 = (at: number) => {
    range(at, 2);
    return data.readUInt16LE(at);
  };
  const u32 = (at: number) => {
    range(at, 4);
    return data.readUInt32LE(at);
  };
  if (
    data.length < 8 ||
    data.length > 8 * 1024 * 1024 ||
    u16(0) !== 3 ||
    u16(2) !== 8 ||
    u32(4) !== data.length
  )
    throw invalid();
  const strings: string[] = [],
    stack: Element[] = [];
  let root: Element | undefined;
  let poolSeen = false;
  const string = (index: number) => {
    if (index === 0xffffffff) return '';
    if (index >= strings.length) throw invalid();
    return strings[index];
  };
  for (let offset = 8; offset < data.length;) {
    range(offset, 8);
    const type = u16(offset),
      header = u16(offset + 2),
      size = u32(offset + 4),
      end = offset + size;
    if (header < 8 || size < header) throw invalid();
    range(offset, size);
    if (type === 1) {
      if (header < 28 || poolSeen) throw invalid();
      poolSeen = true;
      const count = u32(offset + 8),
        utf8 = (u32(offset + 16) & 0x100) !== 0,
        start = u32(offset + 20);
      if (count > 100000 || header + count * 4 > size || start < header + count * 4 || start >= size)
        throw invalid();
      let decoded = 0;
      for (let i = 0; i < count; i++) {
        let at = offset + start + u32(offset + header + i * 4);
        const length8 = () => {
          range(at, 1, end);
          const n = data[at++];
          if (!(n & 0x80)) return n;
          range(at, 1, end);
          return ((n & 0x7f) << 8) | data[at++];
        };
        const length16 = () => {
          range(at, 2, end);
          const n = u16(at);
          at += 2;
          if (!(n & 0x8000)) return n;
          range(at, 2, end);
          const low = u16(at);
          at += 2;
          return (n & 0x7fff) * 65536 + low;
        };
        if (utf8) length8();
        const length = utf8 ? length8() : length16() * 2;
        range(at, length + (utf8 ? 1 : 2), end);
        decoded += length;
        if (decoded > 16 * 1024 * 1024) throw invalid();
        strings.push(data.toString(utf8 ? 'utf8' : 'utf16le', at, at + length));
      }
    } else if (type === 0x102) {
      if (header !== 16 || size < 36) throw invalid();
      const element: Element = {
        name: string(u32(offset + 20)),
        attributes: Object.create(null),
        children: [],
      };
      const start = u16(offset + 24),
        stride = u16(offset + 26),
        count = u16(offset + 28);
      if (stride < 20 || start < 20 || 16 + start + count * stride > size) throw invalid();
      for (let i = 0; i < count; i++) {
        const at = offset + 16 + start + i * stride,
          ns = string(u32(at)),
          name = string(u32(at + 4)),
          raw = u32(at + 8),
          valueType = data[at + 15],
          value = u32(at + 16);
        const text =
          raw !== 0xffffffff
            ? string(raw)
            : valueType === 3
              ? string(value)
              : valueType === 0x12
                ? String(value !== 0)
                : valueType === 0x10 || valueType === 0x11
                  ? String(value)
                  : '@0x' + value.toString(16);
        element.attributes[ns ? `${ns}:${name}` : name] = text;
      }
      if (stack.length) stack.at(-1)!.children.push(element);
      else if (root) throw invalid();
      else root = element;
      stack.push(element);
      if (stack.length > 128) throw invalid();
    } else if (type === 0x103) {
      if (size < 24 || !stack.length || stack.pop()!.name !== string(u32(offset + 20))) throw invalid();
    }
    offset = end;
  }
  if (!root || stack.length || root.name !== 'manifest') throw invalid();
  const attr = (el: Element, name: string) => el.attributes[`${android}:${name}`];
  const pkg = root.attributes.package;
  if (!pkg || !packagePattern.test(pkg)) throw new Error('APK 没有有效的应用包名。');
  if (root.attributes.split) throw new Error('不支持拆分 APK，请选择可独立安装的完整 APK。');
  const number = (s?: string) => (s && /^\d+$/.test(s) && BigInt(s) <= 0xffffffffn ? BigInt(s) : 0n);
  const admins =
    root.children
      .find((e) => e.name === 'application')
      ?.children.filter(
        (e) =>
          e.name === 'receiver' &&
          attr(e, 'permission') === 'android.permission.BIND_DEVICE_ADMIN' &&
          attr(e, 'enabled') !== 'false' &&
          e.children.some((c) => c.name === 'meta-data' && attr(c, 'name') === 'android.app.device_admin') &&
          e.children.some(
            (c) =>
              c.name === 'intent-filter' &&
              c.children.some(
                (a) => a.name === 'action' && attr(a, 'name') === 'android.app.action.DEVICE_ADMIN_ENABLED',
              ),
          ),
      )
      .map((e) => component(pkg + '/' + attr(e, 'name'))) ?? [];
  const sdk = root.children.find((e) => e.name === 'uses-sdk');
  return {
    packageName: pkg,
    versionName: attr(root, 'versionName') || '未知版本',
    versionCode: String((number(attr(root, 'versionCodeMajor')) << 32n) | number(attr(root, 'versionCode'))),
    minimumSdk: sdk ? attr(sdk, 'minSdkVersion') || '未声明' : '未声明',
    admins: [...new Set(admins)],
  };
}

function manifestFromZip(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new Error('无法打开 APK，请确认文件完整。'));
      let found = false;
      const fail = (error: Error) => {
        zip.close();
        reject(error);
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (!found) reject(new Error('APK 缺少 AndroidManifest.xml。'));
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== 'AndroidManifest.xml') {
          zip.readEntry();
          return;
        }
        found = true;
        if (entry.uncompressedSize < 8 || entry.uncompressedSize > 8 * 1024 * 1024)
          return fail(new Error('APK 清单大小异常。'));
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(error ?? new Error('无法解压 APK 清单。'));
          let size = 0;
          const chunks: Buffer[] = [];
          stream.on('error', fail);
          stream.on('data', (data: Buffer) => {
            size += data.length;
            if (size > 8 * 1024 * 1024) stream.destroy(new Error('APK 清单过大。'));
            else chunks.push(data);
          });
          stream.on('end', () => {
            zip.close();
            resolve(Buffer.concat(chunks));
          });
        });
      });
      zip.readEntry();
    });
  });
}
export async function fileHash(path: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex');
}
export interface ApkRecord {
  info: Apk;
  path: string;
  hash: string;
}
export async function readApk(path: string, signal?: AbortSignal): Promise<ApkRecord> {
  path = resolve(path);
  if (extname(path).toLowerCase() !== '.apk')
    throw new Error('请选择单个 .apk 文件，不支持 AAB、APKS 和拆分 APK。');
  const file = await stat(path);
  if (!file.isFile()) throw new Error('请选择 APK 文件。');
  const hash = await fileHash(path, signal),
    metadata = parseManifest(await manifestFromZip(path));
  if (hash !== (await fileHash(path, signal))) throw new Error('读取时 APK 已变化，请重新选择。');
  return { info: { ...metadata, id: randomUUID(), fileName: basename(path), size: file.size }, path, hash };
}
