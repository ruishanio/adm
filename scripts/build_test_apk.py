#!/usr/bin/env python3
"""构建独立的 testOnly 管理应用，仅用于隔离模拟器集成验证。"""
import argparse
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path, required=True)
    parser.add_argument("--build-tools", default="36.0.0")
    parser.add_argument("--platform", default="android-36")
    args = parser.parse_args()
    tools = args.sdk / "build-tools" / args.build_tools
    android = args.sdk / "platforms" / args.platform / "android.jar"
    output = ROOT / "artifacts/test-fixture"
    output.mkdir(parents=True, exist_ok=True)
    classes = output / "classes"
    classes.mkdir(exist_ok=True)
    fixture = ROOT / "tests/Fixtures"

    def run(*command):
        subprocess.run([str(part) for part in command], check=True, cwd=ROOT)

    run(tools / "aapt2", "compile", "--dir", fixture / "res", "-o", output / "resources.zip")
    run(tools / "aapt2", "link", "-o", output / "unsigned.apk", "-I", android,
        "--manifest", fixture / "AndroidManifest.xml", output / "resources.zip")
    run("javac", "--release", "8", "-classpath", android, "-d", classes, fixture / "AdminReceiver.java", fixture / "SmokeActivity.java")
    run(tools / "d8", "--lib", android, "--min-api", "23", "--output", output,
        classes / "com/ruinext/androidtool/fixture/AdminReceiver.class",
        classes / "com/ruinext/androidtool/fixture/SmokeActivity.class")
    with zipfile.ZipFile(output / "unsigned.apk", "a") as z:
        z.write(output / "classes.dex", "classes.dex")
        (fixture / "AndroidManifest.axml").write_bytes(z.read("AndroidManifest.xml"))
    key = output / "test.keystore"
    if not key.exists():
        # 仅测试签名，无生产用途；密钥保留在被忽略的构建目录中。
        run("keytool", "-genkeypair", "-keystore", key, "-storepass", "android", "-keypass", "android",
            "-alias", "test", "-keyalg", "RSA", "-validity", "365", "-dname", "CN=AndroidTool Test")
    run(tools / "apksigner", "sign", "--ks", key, "--ks-pass", "pass:android", "--key-pass", "pass:android",
        "--out", output / "android-tool-fixture.apk", output / "unsigned.apk")
    print(output / "android-tool-fixture.apk")


if __name__ == "__main__":
    main()
