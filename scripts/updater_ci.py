"""签名最终分发文件，并通过本地 HTTP 清单验证真实更新包。"""
import argparse
import functools
import http.server
import json
import os
import shutil
from pathlib import Path
import subprocess
import tarfile
import tempfile
import threading

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf8"))["version"]
RELEASE = ROOT / "release"


def artifact(platform):
    suffix = "mac-arm64.app.tar.gz" if platform == "mac" else "win-x64-setup.exe"
    return RELEASE / f"ADM-{VERSION}-{suffix}"


def sign(platform):
    """macOS 使用完成公证的 app，Windows 复用 NSIS；签名绑定安装包的实际版本。"""
    if not (os.environ.get("TAURI_SIGNING_PRIVATE_KEY") or os.environ.get("TAURI_SIGNING_PRIVATE_KEY_PATH")):
        raise ValueError("缺少 TAURI_SIGNING_PRIVATE_KEY，无法签名更新包。")
    target = artifact(platform)
    if platform == "mac":
        app = RELEASE / "mac-arm64/ADM.app"
        if os.environ.get("GITHUB_ACTIONS") == "true":
            subprocess.run(["xcrun", "stapler", "validate", str(app)], check=True)
        with tarfile.open(target, "w:gz", dereference=False) as archive:
            archive.add(app, arcname=app.name)
    signature = Path(str(target) + ".sig")
    signature.unlink(missing_ok=True)
    # 签名工具只在此进程读取私钥，失败时不打印可能携带凭据的命令输出。
    result = subprocess.run(["node", str(ROOT / "node_modules/@tauri-apps/cli/tauri.js"), "signer", "sign",
                             "--app-version", VERSION, str(target)], capture_output=True,
                            env={**os.environ, "TAURI_SIGNING_PRIVATE_KEY_PASSWORD":
                                 os.environ.get("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "")})
    if result.returncode or not signature.is_file():
        raise ValueError("更新签名失败，请核对私钥及密码。")


def test(platform):
    """只向回环地址提供本次包和签名；通过客户端同款更新器校验并在临时目录演练安装。"""
    target = artifact(platform)
    key = "darwin-aarch64" if platform == "mac" else "windows-x86_64"
    with tempfile.TemporaryDirectory(prefix="adm-feed-") as folder:
        directory = Path(folder)
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=folder)
        with http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
            url = f"http://127.0.0.1:{server.server_port}/"
            # 只提供测试需要的文件，不从工作区或私钥所在目录提供 HTTP 服务。
            shutil.copyfile(target, directory / target.name)
            manifest = {"version": VERSION, "platforms": {key: {
                "url": url + target.name, "signature": Path(str(target) + ".sig").read_text().strip(),
            }}}
            (directory / "latest.json").write_text(json.dumps(manifest), encoding="utf8")
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                subprocess.run(["cargo", "test", "--locked", "--manifest-path", str(ROOT / "src-tauri/Cargo.toml"),
                                "--test", "updater_artifact", "--", "--ignored"], check=True,
                               env={**os.environ, "ADM_TEST_FEED": url + "latest.json"})
            finally:
                server.shutdown()
                worker.join()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["sign", "test"])
    parser.add_argument("platform", choices=["mac", "win"])
    args = parser.parse_args()
    (sign if args.action == "sign" else test)(args.platform)
