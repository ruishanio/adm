#!/usr/bin/env python3
"""为 tag 打包准备固定版本 ADB，并验证分发包、安装流程和校验清单。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
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


def installer_path(platform, arch):
    suffix = ".dmg" if platform == "mac" else "-setup.exe"
    return ROOT / "release" / f"{METADATA['shortName']}-{METADATA['version']}-{platform}-{arch}{suffix}"


def prepare(platform):
    """校验 tag 与包版本，下载并验证 SDK，只提取打包实际使用的文件。"""
    tag = os.environ.get("GITHUB_REF_NAME", "")
    pattern = rf"v{re.escape(METADATA['version'])}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?"
    if os.environ.get("GITHUB_REF_TYPE") == "tag" and not re.fullmatch(pattern, tag):
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
    adb_directory = ROOT / "src-tauri/resources/platform-tools"
    shutil.rmtree(adb_directory, ignore_errors=True)
    adb_directory.mkdir(parents=True)
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
        executable = f"{app}/Contents/MacOS/adm"
        resources = f"{app}/Contents/Resources"
        unpacked = ROOT / "release" / "mac-arm64"
        adb_name = "adb"
    else:
        executable, resources = "adm.exe", "."
        unpacked = ROOT / "release" / "win-unpacked"
        adb_name = "adb.exe"
    required = [executable]
    legal = json.loads((ROOT / "legal/manifest.json").read_text(encoding="utf-8"))
    legal_files = {**legal["files"], "manifest.json": hashlib.sha256((ROOT / "legal/manifest.json").read_bytes()).hexdigest()}
    required += [
        str(Path(resources) / "platform-tools" / part).replace("\\", "/")
        for part in [adb_name, "NOTICE.txt", "source.properties"]
    ]
    if platform == "win":
        required += [
            str(Path(resources) / "platform-tools" / part).replace("\\", "/")
            for part in ["AdbWinApi.dll", "AdbWinUsbApi.dll"]
        ]
    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip() is not None:
            raise ValueError("应用 ZIP 完整性校验失败")
        for entry in required:
            if archive.getinfo(entry).file_size == 0:
                raise ValueError(f"产物文件为空：{entry}")
        # 核对实际 ZIP 字节，防止声明存在于仓库却未随应用、便携版或源码归档交付。
        for entry, expected in legal_files.items():
            packaged_name = str(Path(resources) / "legal" / entry).replace("\\", "/")
            if hashlib.sha256(archive.read(packaged_name)).hexdigest() != expected:
                raise ValueError(f"产物许可或源码归档不一致：{entry}")
        properties = archive.read(str(Path(resources) / "platform-tools/source.properties").replace("\\", "/")).decode("utf-8")
        if f"Pkg.Revision={SDK_VERSION}" not in properties:
            raise ValueError("包内 ADB 版本与固定版本不一致")
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
    # 执行原生主程序的只读自检，核对真实二进制版本和资源路径，不依赖宿主 SDK。
    with tempfile.TemporaryDirectory(prefix="adm-self-check-") as directory:
        report = Path(directory) / "result.json"
        subprocess.run([str(unpacked / executable), "--adm-self-check", str(report)], check=True, timeout=30)
        packaged = json.loads(report.read_text(encoding="utf-8"))
    if packaged["version"] != METADATA["version"] or packaged["framework"] != "Tauri 2":
        raise ValueError("原生程序版本或技术栈不匹配")
    if packaged["arch"] != ("aarch64" if platform == "mac" else "x86_64"):
        raise ValueError("原生程序自检架构不匹配")
    # 只在对应宿主运行包内 ADB；version 不连接设备，也不会启动 ADB 服务。
    if (platform == "mac" and sys.platform == "darwin") or (platform == "win" and sys.platform == "win32"):
        subprocess.run([str(unpacked / resources / "platform-tools" / adb_name), "version"], check=True)
        if platform == "mac":
            subprocess.run(["codesign", "--verify", "--deep", "--strict", str(unpacked / app)], check=True)
    installer = installer_path(platform, arch)
    with installer.open("rb") as binary:
        if platform == "mac":
            # UDIF 镜像尾部有固定的 koly 签名，实际挂载检查另在宿主平台执行。
            binary.seek(-512, os.SEEK_END)
            if binary.read(4) != b"koly":
                raise ValueError("DMG 文件格式不正确")
        elif binary.read(2) != b"MZ":
            raise ValueError("Windows 安装程序不是 EXE 文件")
    files = [
        {"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
         "size": path.stat().st_size}
        for path in [archive_path, installer]
    ]
    (ROOT / "release/SHA256SUMS.txt").write_text(
        "".join(f"{entry['sha256']}  {entry['file']}\n" for entry in files), encoding="utf-8"
    )
    info = {
        "product": name,
        "framework": "Tauri 2",
        "version": METADATA["version"],
        "tag": os.environ.get("GITHUB_REF_NAME"),
        "commit": os.environ.get("GITHUB_SHA"),
        "platform": platform,
        "arch": arch,
        "adbVersion": SDK_VERSION,
        "legalManifestSha256": legal_files["manifest.json"],
        "distributionReview": json.loads((ROOT / "legal/release-review.json").read_text(encoding="utf-8"))["status"],
        "files": files,
    }
    (ROOT / "release/build-info.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(info), flush=True)


def verify_installed_legal(directory):
    """核对安装后的全部声明及源码，避免只验证便携 ZIP。"""
    manifest = json.loads((ROOT / "legal/manifest.json").read_text(encoding="utf-8"))
    for name, expected in manifest["files"].items():
        if hashlib.sha256((directory / "legal" / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"安装后许可材料不一致：{name}")
    if (directory / "legal/manifest.json").read_bytes() != (ROOT / "legal/manifest.json").read_bytes():
        raise ValueError("安装后许可清单不一致")


def smoke_install(platform, arch):
    """按 platform/arch 验证安装包，无返回值；仅在临时 Runner 执行，失败抛错并清理安装或镜像。"""
    # 本机运行校验脚本不应安装应用或影响已有安装；真实安装只在 CI 临时环境进行。
    if os.environ.get("GITHUB_ACTIONS") != "true" or not os.environ.get("RUNNER_TEMP"):
        raise RuntimeError("安装流程验证仅允许在 GitHub Actions Runner 执行")
    expected_host = "darwin" if platform == "mac" else "win32"
    if sys.platform != expected_host:
        raise RuntimeError("安装包必须在对应平台验证")
    installer = installer_path(platform, arch)
    name = METADATA["productName"]
    if platform == "mac":
        subprocess.run(["hdiutil", "verify", str(installer)], check=True, timeout=120)
        result = subprocess.run(
            ["hdiutil", "attach", "-readonly", "-nobrowse", "-plist", str(installer)],
            check=True, stdout=subprocess.PIPE, timeout=60,
        )
        entities = plistlib.loads(result.stdout)["system-entities"]
        mount = Path(next(entity["mount-point"] for entity in entities if "mount-point" in entity))
        try:
            app = mount / f"{name}.app"
            original = ROOT / "release/mac-arm64" / f"{name}.app"
            verify_installed_legal(app / "Contents/Resources")
            for entry in ["Contents/MacOS/adm",
                          "Contents/Resources/platform-tools/adb"]:
                if (app / entry).read_bytes() != (original / entry).read_bytes():
                    raise ValueError(f"DMG 中的应用内容不一致：{entry}")
            if not (mount / "Applications").is_symlink() or os.readlink(mount / "Applications") != "/Applications":
                raise ValueError("DMG 缺少应用程序目录的安装快捷方式")
            subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
        finally:
            subprocess.run(["hdiutil", "detach", str(mount)], check=True, timeout=60)
        print("DMG 完整性、只读挂载、应用内容、签名和 Applications 快捷方式验证通过", flush=True)
    else:
        with tempfile.TemporaryDirectory(prefix="adm-install-", dir=os.environ["RUNNER_TEMP"]) as directory:
            install_dir = Path(directory) / "app"
            executable = install_dir / "adm.exe"
            uninstaller = install_dir / "uninstall.exe"
            try:
                # NSIS 要求 /D 放在最后且不加引号；shell=False 直接交给 Windows 创建进程。
                subprocess.run(f'"{installer}" /S /currentuser /D={install_dir}', check=True, timeout=180)
                original = ROOT / "release/win-unpacked"
                verify_installed_legal(install_dir)
                for entry in ["adm.exe", "platform-tools/adb.exe"]:
                    if (install_dir / entry).read_bytes() != (original / entry).read_bytes():
                        raise ValueError(f"安装后的应用内容不一致：{entry}")
                report = Path(directory) / "installed.json"
                subprocess.run([str(executable), "--adm-self-check", str(report)], check=True, timeout=30)
                if json.loads(report.read_text(encoding="utf-8"))["version"] != METADATA["version"]:
                    raise ValueError("安装后的主程序版本错误")
                if not uninstaller.is_file():
                    raise ValueError("安装后缺少卸载程序")
                subprocess.run([str(install_dir / "platform-tools/adb.exe"), "version"], check=True)
            finally:
                if uninstaller.is_file():
                    # _?= 在原目录运行卸载器，确保等待的是实际卸载进程，不误判后台卸载完成。
                    subprocess.run(f'"{uninstaller}" /S /currentuser _?={install_dir}', check=True, timeout=120)
            if executable.exists():
                raise ValueError("卸载后应用主程序仍然存在")
        print("Windows 安装程序静默安装、文件回读、内置 ADB 与卸载验证通过", flush=True)


if __name__ == "__main__":
    # Windows Runner 的重定向输出默认可能是 cp1252，统一使用 UTF-8 保留中文日志。
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "verify", "smoke-install"])
    parser.add_argument("platform", choices=["mac", "win"])
    parser.add_argument("arch", choices=["arm64", "x64"])
    args = parser.parse_args()
    if (args.platform, args.arch) not in [("mac", "arm64"), ("win", "x64")]:
        parser.error("仅支持 macOS ARM64 和 Windows x64")
    if args.action == "prepare":
        prepare(args.platform)
    elif args.action == "verify":
        verify(args.platform, args.arch)
    else:
        smoke_install(args.platform, args.arch)
