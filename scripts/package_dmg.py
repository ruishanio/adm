#!/usr/bin/env python3
"""生成无需 Finder / AppleScript 的 DMG，并校验镜像内持久化的安装布局。"""
import argparse
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
LAYOUT_PATH = ROOT / "resources/dmg/layout.json"
LAYOUT = json.loads(LAYOUT_PATH.read_text(encoding="utf-8"))
TOOLS = ROOT / "artifacts/dmg-tools"


def settings(app, background):
    """根据应用路径和背景生成打包设置，所有图标与窗口尺寸均采用逻辑点。"""
    return {
        "format": "UDZO",
        "files": [str(app)],
        "symlinks": {"Applications": "/Applications"},
        # 不对已签名应用写 FinderInfo（隐藏扩展名也会写入），否则严格签名校验会失败。
        "icon": str(ROOT / "src-tauri/icons/icon.icns"),
        "background": str(background),
        "window_rect": ((200, 200), (LAYOUT["width"], LAYOUT["height"])),
        "icon_locations": {app.name: tuple(LAYOUT["appPosition"]),
                           "Applications": tuple(LAYOUT["applicationsPosition"])},
        "icon_size": LAYOUT["iconSize"],
        "text_size": LAYOUT["textSize"],
        "default_view": "icon-view",
        "include_icon_view_settings": True,
        "include_list_view_settings": False,
        "show_status_bar": False,
        "show_tab_view": False,
        "show_toolbar": False,
        "show_pathbar": False,
        "show_sidebar": False,
    }


def verify_layout(mount, app_name):
    """读取已挂载镜像的 Finder 元数据；布局缺失或被默认排版覆盖时立即阻止发布。"""
    from ds_store import DSStore
    with DSStore.open(str(mount / ".DS_Store"), "r") as store:
        view = store["."]["icvp"]
        window = store["."]["bwsp"]
        if view["iconSize"] != LAYOUT["iconSize"] or view["textSize"] != LAYOUT["textSize"]:
            raise ValueError("DMG 图标或标签尺寸错误")
        expected_size = f'{{{LAYOUT["width"]}, {LAYOUT["height"]}}}'
        if expected_size not in window["WindowBounds"]:
            raise ValueError("DMG 窗口尺寸错误")
        if any(window[key] for key in ["ShowToolbar", "ShowSidebar", "ShowStatusBar", "ShowPathbar", "ShowTabView"]):
            raise ValueError("DMG 出现多余的 Finder 工具栏")
        for name, position in [(app_name, LAYOUT["appPosition"]),
                               ("Applications", LAYOUT["applicationsPosition"])]:
            if tuple(store[name]["Iloc"]) != tuple(position):
                raise ValueError(f"DMG 图标位置错误：{name}")
        if view["backgroundType"] != 2 or not view.get("backgroundImageAlias"):
            raise ValueError("DMG 缺少安装引导背景")
    if not (mount / ".background.tiff").is_file():
        raise ValueError("DMG 安装引导背景文件缺失")
    print("DMG 窗口、图标位置、尺寸和安装引导背景验证通过", flush=True)


def build(app, output):
    """从已签名的 app 生成压缩镜像，并实际挂载回读布局；不修改 app 内容。"""
    import dmgbuild
    if not (app / "Contents/Info.plist").is_file():
        raise ValueError(f"找不到应用包：{app}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="adm-dmg-") as directory:
        background = Path(directory) / "background.tiff"
        subprocess.run(["swift", str(ROOT / "scripts/render-dmg.swift"),
                        str(LAYOUT_PATH), str(background)], check=True, timeout=120)
        dmgbuild.build_dmg(str(output), app.stem, settings=settings(app, background))
    result = subprocess.run(["hdiutil", "attach", "-readonly", "-nobrowse", "-plist", str(output)],
                            check=True, stdout=subprocess.PIPE, timeout=60)
    entities = plistlib.loads(result.stdout)["system-entities"]
    mount = Path(next(entity["mount-point"] for entity in entities if "mount-point" in entity))
    try:
        verify_layout(mount, app.name)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(mount / app.name)], check=True)
    finally:
        subprocess.run(["hdiutil", "detach", str(mount)], check=True, timeout=60)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("build")
    create.add_argument("app", type=Path)
    create.add_argument("output", type=Path)
    verify = commands.add_parser("verify")
    verify.add_argument("mount", type=Path)
    verify.add_argument("app_name")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("DMG 仅在 macOS 上生成和验证")
    # 构建工具隔离在忽略目录中；依赖和 wheel 摘要锁定，不污染系统 Python 或应用包。
    if Path(sys.prefix).resolve() != TOOLS.resolve():
        python = TOOLS / "bin/python"
        if not python.exists():
            subprocess.run([sys.executable, "-m", "venv", str(TOOLS)], check=True)
        subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check",
                        "--only-binary=:all:", "--require-hashes", "-r",
                        str(ROOT / "scripts/requirements-dmg.txt")], check=True)
        subprocess.run([str(python), str(Path(__file__).resolve()), *sys.argv[1:]], check=True)
        return
    if args.command == "build":
        build(args.app.resolve(), args.output.resolve())
    else:
        verify_layout(args.mount.resolve(), args.app_name)


if __name__ == "__main__":
    main()
