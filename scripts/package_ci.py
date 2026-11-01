#!/usr/bin/env python3
"""为 tag 打包准备固定版本 ADB，并验证最终 ZIP、架构、运行时和校验清单。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
METADATA = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
SDK_VERSION = "37.0.1"
# 下载来源为 Google 官方仓库，摘要已与官方 SDK 索引对应的文件核对。
SDK = {
    "mac": ("darwin", "ee39ad5967e95c2a07f04dbcbde96b1a0c916ba376096db5d2f498b7727a5d1d"),
    "win": ("win", "45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99"),
}


def prepare(platform):
    """校验 tag 与包版本，下载并验证 SDK，只提取打包实际使用的文件。"""
    tag = os.environ.get("GITHUB_REF_NAME", "")
    pattern = rf"v{re.escape(METADATA['version'])}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?"
    if not re.fullmatch(pattern, tag):
        raise ValueError(f"tag {tag!r} 必须为 v{METADATA['version']} 或其测试版本后缀")
    suffix, expected = SDK[platform]
    directory = ROOT / "artifacts" / "ci-sdk"
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / f"platform-tools_r{SDK_VERSION}-{suffix}.zip"
    if not archive.exists():
        with urllib.request.urlopen(
            f"https://dl.google.com/android/repository/{archive.name}", timeout=60
        ) as response:
            archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise ValueError("ADB 下载文件的 SHA-256 校验失败")
    adb_directory = directory / "platform-tools"
    adb_directory.mkdir(exist_ok=True)
    names = ["NOTICE.txt", "source.properties"] + (
        ["adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll"] if platform == "win" else ["adb"]
    )
    with zipfile.ZipFile(archive) as source:
        for name in names:
            # 只写入固定文件名，避免 ZIP 内多余内容或路径影响工作区。
            (adb_directory / name).write_bytes(source.read(f"platform-tools/{name}"))
    if platform == "mac":
        (adb_directory / "adb").chmod(0o755)
    if os.environ.get("GITHUB_ENV"):
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as env_file:
            env_file.write(f"ADB_DIR={adb_directory}\n")
    print(f"已校验 {tag}，ADB {SDK_VERSION}: {adb_directory}", flush=True)


def verify(platform, arch):
    """验证最终产物的完整性、必需文件和机器架构，输出 SHA-256 与构建来源。"""
    name = METADATA["productName"]
    filename = f"{METADATA['shortName']}-{METADATA['version']}-{platform}-{arch}.zip"
    archive_path = ROOT / "release" / filename
    if platform == "mac":
        app = f"{name}.app"
        executable = f"{app}/Contents/MacOS/{name}"
        resources = f"{app}/Contents/Resources"
        unpacked = ROOT / "release" / "mac-arm64"
        adb_name = "adb"
    else:
        executable, resources = f"{name}.exe", "resources"
        unpacked = ROOT / "release" / "win-unpacked"
        adb_name = "adb.exe"
    required = [executable, f"{resources}/app.asar", f"{resources}/README.md"]
    required += [
        f"{resources}/platform-tools/{part}"
        for part in [adb_name, "NOTICE.txt", "source.properties"]
    ]
    if platform == "win":
        required += [
            f"{resources}/platform-tools/{part}"
            for part in ["AdbWinApi.dll", "AdbWinUsbApi.dll"]
        ]
    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip() is not None:
            raise ValueError("应用 ZIP 完整性校验失败")
        for entry in required:
            if archive.getinfo(entry).file_size == 0:
                raise ValueError(f"产物文件为空：{entry}")
        properties = archive.read(f"{resources}/platform-tools/source.properties").decode("utf-8")
        if f"Pkg.Revision={SDK_VERSION}" not in properties:
            raise ValueError("包内 ADB 版本与固定版本不一致")
        asar_path = unpacked / resources / "app.asar"
        if archive.read(f"{resources}/app.asar") != asar_path.read_bytes():
            raise ValueError("ZIP 中的应用源码与打包目录不一致")
        with archive.open(executable) as binary:
            header = binary.read(64)
            if platform == "mac":
                if struct.unpack_from("<II", header) != (0xFEEDFACF, 0x100000C):
                    raise ValueError("macOS 主程序架构不匹配")
                if not archive.getinfo(executable).external_attr >> 16 & 0o111:
                    raise ValueError("macOS ZIP 丢失可执行权限")
            else:
                if header[:2] != b"MZ":
                    raise ValueError("Windows 主程序不是 PE 文件")
                binary.seek(struct.unpack_from("<I", header, 0x3C)[0])
                if binary.read(6) != b"PE\0\0\x64\x86":
                    raise ValueError("Windows 主程序不是 x64 架构")
    # 读取实际打包的应用版本与入口文件，避免只检查 ZIP 名称而漏掉错误内容。
    script = """
import { extractFile } from '@electron/asar';
const archive = process.argv[1];
const metadata = JSON.parse(extractFile(archive, 'package.json').toString());
for (const path of [metadata.main, 'dist/preload/index.cjs', 'dist/renderer/index.html']) {
    if (!extractFile(archive, path).length) throw new Error(`应用入口为空：${path}`);
}
console.log(JSON.stringify(metadata));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(asar_path)],
        cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8",
    )
    packaged = json.loads(result.stdout)
    if (packaged["name"], packaged["version"]) != (METADATA["name"], METADATA["version"]):
        raise ValueError("实际打包的应用名称或版本与源码不一致")
    # 只在对应宿主运行包内 ADB；version 不连接设备，也不会启动 ADB 服务。
    if (platform == "mac" and sys.platform == "darwin") or (platform == "win" and sys.platform == "win32"):
        subprocess.run([str(unpacked / resources / "platform-tools" / adb_name), "version"], check=True)
        if platform == "mac":
            subprocess.run(["codesign", "--verify", "--deep", "--strict", str(unpacked / app)], check=True)
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    (ROOT / "release/SHA256SUMS.txt").write_text(f"{digest}  {filename}\n", encoding="utf-8")
    info = {
        "product": name,
        "version": METADATA["version"],
        "tag": os.environ.get("GITHUB_REF_NAME"),
        "commit": os.environ.get("GITHUB_SHA"),
        "platform": platform,
        "arch": arch,
        "adbVersion": SDK_VERSION,
        "file": filename,
        "sha256": digest,
        "size": archive_path.stat().st_size,
    }
    (ROOT / "release/build-info.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(info), flush=True)


if __name__ == "__main__":
    # Windows Runner 的重定向输出默认可能是 cp1252，统一使用 UTF-8 保留中文日志。
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "verify"])
    parser.add_argument("platform", choices=["mac", "win"])
    parser.add_argument("arch", choices=["arm64", "x64"])
    args = parser.parse_args()
    if (args.platform, args.arch) not in [("mac", "arm64"), ("win", "x64")]:
        parser.error("仅支持 macOS ARM64 和 Windows x64")
    prepare(args.platform) if args.action == "prepare" else verify(args.platform, args.arch)
