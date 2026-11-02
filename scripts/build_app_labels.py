#!/usr/bin/env python3
"""从项目源码重建小型应用名称读取器；桌面打包直接嵌入产物，不要求安装 Android SDK。"""
import argparse
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path, required=True)
    parser.add_argument("--build-tools", default="36.0.0")
    parser.add_argument("--platform", default="android-36")
    args = parser.parse_args()
    android = args.sdk / "platforms" / args.platform / "android.jar"
    source = ROOT / "android/app-labels"
    with tempfile.TemporaryDirectory(prefix="adm-app-labels-") as temporary:
        output = Path(temporary)
        subprocess.run(["javac", "--release", "8", "-encoding", "UTF-8", "-classpath",
                        str(android), "-d", str(output), str(source / "AppLabels.java")], check=True)
        subprocess.run([str(args.sdk / "build-tools" / args.build_tools / "d8"),
                        "--release", "--lib", str(android), "--min-api", "23", "--output", str(output),
                        str(output / "com/ruinext/adm/AppLabels.class")], check=True)
        # 固定 ZIP 时间和权限；只包含自有代码，Android SDK 仅用于编译，不进入产物。
        entry = zipfile.ZipInfo("classes.dex", date_time=(1980, 1, 1, 0, 0, 0))
        entry.external_attr = 0o644 << 16
        with zipfile.ZipFile(source / "app-labels.jar", "w") as archive:
            archive.writestr(entry, (output / "classes.dex").read_bytes())
    print(source / "app-labels.jar")


if __name__ == "__main__":
    main()
