#!/usr/bin/env python3
"""从本地 scrcpy 源码和固定版 OpenH264 构建设备端，输出桌面打包使用的 JAR 与摘要。"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE = ROOT / 'artifacts/android-build'
DEST = ROOT / 'src-tauri/resources/scrcpy'
VERSION = '2.6.0'
SOURCE_SHA = '558544ad358283a7ab2930d69a9ceddf913f4a51ee9bf1bfb9e377322af81a69'
SOURCE_URL = f'https://codeload.github.com/cisco/openh264/tar.gz/refs/tags/v{VERSION}'
def source_digest():
    # 路径使用 POSIX 格式，macOS 与 Windows 的分发检查须得到相同摘要。
    digest = hashlib.sha256()
    sources = [*(HERE / 'src/main').rglob('*'), *(HERE / 'native').rglob('*'), Path(__file__).resolve()]
    for path in sorted(sources, key=lambda item: item.relative_to(HERE).as_posix()):
        if path.is_file():
            digest.update(path.relative_to(HERE).as_posix().encode() + b'\0')
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def verify():
    meta = json.loads((DEST / 'version.json').read_text())
    if meta['sourceSha256'] != source_digest() or meta['sha256'] != hashlib.sha256((DEST / 'scrcpy-server').read_bytes()).hexdigest():
        raise ValueError('设备端源码或产物已变更，请重新构建 scrcpy-server')


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def native(work):
    """校验上游归档后静态链接编码器，只输出一个与目标设备架构相符的 JNI 库。"""
    ndk = Path(os.environ['ANDROID_NDK_HOME']).resolve()
    if 'Pkg.Revision = 27.2.12479018' not in (ndk / 'source.properties').read_text():
        raise ValueError('请使用 Android NDK r27c')
    archive = CACHE / f'openh264-v{VERSION}.tar.gz'
    if not archive.is_file():
        run('curl', '-fL', '--retry', '2', SOURCE_URL, '-o', archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA:
        raise ValueError('OpenH264 源码归档校验失败')
    run('tar', 'xzf', archive, '-C', work)
    source = work / f'openh264-{VERSION}'
    run('make', '-s', '-j8', 'OS=android', 'ARCH=x86_64', 'TARGET=android-23',
        f'NDKROOT={ndk}', 'libopenh264.a', cwd=source)
    toolchain = next((ndk / 'toolchains/llvm/prebuilt').glob('*/bin/x86_64-linux-android23-clang++'))
    library = work / 'libadmopenh264.so'
    run(toolchain, '-O3', '-shared', '-fPIC', '-static-libstdc++', '-fvisibility=hidden',
        '-Wl,-z,max-page-size=16384,--exclude-libs,ALL,--no-undefined', '-s', '-o', library,
        '-I', source / 'codec/api', HERE / 'native/encoder.cpp', source / 'libopenh264.a', '-llog', '-lm')
    shutil.copyfile(source / 'LICENSE', DEST / 'OpenH264-LICENSE.txt')
    notices = [toolchain.parents[1] / 'NOTICE', ndk / 'sources/android/cpufeatures/NOTICE']
    (DEST / 'NDK-Runtime-NOTICE.txt').write_bytes(b'\n\n'.join(path.read_bytes() for path in notices))
    return library


def dex(work, tools, platform):
    """生成隐藏 API 的 AIDL 桩和版本号，再用上游要求的 Java 8 字节码编译 DEX。"""
    gen, classes = work / 'gen', work / 'classes'
    pkg = gen / 'com/genymobile/scrcpy'
    pkg.mkdir(parents=True)
    classes.mkdir()
    (pkg / 'BuildConfig.java').write_text('package com.genymobile.scrcpy; public final class BuildConfig {'
        'public static final boolean DEBUG=false; public static final String VERSION_NAME="5.0.1";}')
    aidl = HERE / 'src/main/aidl'
    for spec in sorted(aidl.rglob('*.aidl')):
        run(tools / 'aidl', f'-o{gen}', '-I.', '-p', platform / 'framework.aidl', spec.relative_to(aidl), cwd=aidl)
    sources = sorted((HERE / 'src/main/java').rglob('*.java')) + sorted(gen.rglob('*.java'))
    run('javac', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-g:none', '-bootclasspath',
        platform / 'android.jar', '-cp', tools / 'core-lambda-stubs.jar', '-d', classes, *sources)
    run(tools / 'd8', '--min-api', '21', '--classpath', platform / 'android.jar', '--output', work,
        *sorted(classes.rglob('*.class')))
    return work / 'classes.dex'


def main():
    sdk = Path(os.environ['ANDROID_HOME'])
    tools = sdk / 'build-tools/36.0.0'
    CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=CACHE) as tmp:
        work = Path(tmp)
        library, code = native(work), dex(work, tools, sdk / 'platforms/android-36')
        archive = work / 'server.zip'
        with zipfile.ZipFile(archive, 'w') as out:
            for name, path in [('classes.dex', code), ('lib/x86_64/libadmopenh264.so', library)]:
                entry = zipfile.ZipInfo(name)
                entry.compress_type = zipfile.ZIP_STORED if name.endswith('.so') else zipfile.ZIP_DEFLATED
                out.writestr(entry, path.read_bytes())
        # mmap 直接加载 JAR 中的库，避免遗留提取的 .so；兼容 16 KiB 页大小。
        aligned = work / 'scrcpy-server'
        run(tools / 'zipalign', '-P', '16', '4', archive, aligned)
        meta = json.loads((DEST / 'version.json').read_text())
        meta['sourceSha256'] = source_digest()
        meta['sha256'] = hashlib.sha256(aligned.read_bytes()).hexdigest()
        shutil.copyfile(aligned, DEST / 'scrcpy-server')
        (DEST / 'version.json').write_text(json.dumps(meta, indent=2) + '\n')
        print('scrcpy-server', meta['sha256'])


if __name__ == '__main__':
    if sys.argv[1:] == ['--check']:
        verify()
    else:
        main()
