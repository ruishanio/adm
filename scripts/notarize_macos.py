#!/usr/bin/env python3
"""为现有 macOS 分发包签名、公证并附加票据；凭据只进入临时钥匙串。"""
import argparse
import base64
from contextlib import contextmanager
import json
import os
from pathlib import Path
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SECRET_NAMES = (
    "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY",
    "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID",
)
MACHO_HEADERS = {
    bytes.fromhex(value) for value in (
        "feedface", "cefaedfe", "feedfacf", "cffaedfe",
        "cafebabe", "bebafeca", "cafebabf", "bfbafeca",
    )
}


def credentials(environ):
    """读取六项 CI 凭据并校验签名身份；缺失时立即失败，禁止退回临时签名。"""
    values = {name: environ.get(name, "").strip() for name in SECRET_NAMES}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ValueError("缺少 macOS 签名 Secrets：" + ", ".join(missing))
    identity = values["APPLE_SIGNING_IDENTITY"]
    if not identity.startswith("Developer ID Application: ") or not identity.endswith(
        f"({values['APPLE_TEAM_ID']})"
    ):
        raise ValueError("签名身份必须是同一团队的 Developer ID Application 证书")
    try:
        base64.b64decode("".join(values["APPLE_CERTIFICATE"].split()), validate=True)
    except ValueError:
        raise ValueError("APPLE_CERTIFICATE 不是有效的 Base64 PKCS#12") from None
    return values


class Runner:
    """捕获命令输出并脱敏；错误不得包含带密码的命令行或原始异常。"""
    def __init__(self, values):
        self.hidden = [value for value in values if value]
        # 构建脚本和打包子进程不需要继承 Apple 凭据。
        self.environ = {key: value for key, value in os.environ.items() if key not in SECRET_NAMES}

    def redact(self, text):
        for value in sorted(self.hidden, key=len, reverse=True):
            text = text.replace(value, "[REDACTED]")
        return text

    def __call__(self, args, timeout=120):
        try:
            result = subprocess.run(
                [str(arg) for arg in args], capture_output=True, text=True,
                timeout=timeout, env=self.environ,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"{Path(args[0]).name} 执行超时") from None
        if result.returncode:
            detail = self.redact(result.stdout + "\n" + result.stderr)
            raise RuntimeError(f"{Path(args[0]).name} 失败 ({result.returncode})：{detail}")
        return result.stdout


@contextmanager
def signing_keychain(run, values):
    """导入证书及公证认证，返回钥匙串路径；退出时还原搜索列表并删除私钥副本。"""
    password = secrets.token_urlsafe(32)
    run.hidden.append(password)
    original = shlex.split(run(["security", "list-keychains", "-d", "user"]))
    with tempfile.TemporaryDirectory(prefix="adm-signing-", dir=os.environ.get("RUNNER_TEMP")) as temporary:
        directory = Path(temporary)
        certificate = directory / "certificate.p12"
        keychain = directory / "signing.keychain-db"
        certificate.write_bytes(base64.b64decode("".join(values["APPLE_CERTIFICATE"].split())))
        certificate.chmod(0o600)
        created = False
        try:
            run(["security", "create-keychain", "-p", password, keychain])
            created = True
            run(["security", "set-keychain-settings", "-lut", "21600", keychain])
            run(["security", "unlock-keychain", "-p", password, keychain])
            run(["security", "import", certificate, "-k", keychain,
                 "-P", values["APPLE_CERTIFICATE_PASSWORD"], "-T", "/usr/bin/codesign"])
            run(["security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:",
                 "-s", "-k", password, keychain])
            run(["security", "list-keychains", "-d", "user", "-s", keychain, *original])
            identities = run(["security", "find-identity", "-v", "-p", "codesigning", keychain])
            if values["APPLE_SIGNING_IDENTITY"] not in identities:
                raise RuntimeError("临时钥匙串中没有可用的指定签名身份")
            run(["xcrun", "notarytool", "store-credentials", "macOS-CI-Notarization",
                 "--keychain", keychain, "--apple-id", values["APPLE_ID"],
                 "--team-id", values["APPLE_TEAM_ID"], "--password", values["APPLE_PASSWORD"]])
            certificate.unlink()
            yield keychain
        finally:
            # 认证失败、签名失败、公证拒绝时也必须清理，不保留原始 P12 或临时钥匙串。
            try:
                run(["security", "list-keychains", "-d", "user", "-s", *original])
            finally:
                if created:
                    run(["security", "delete-keychain", keychain])


def sign(run, target, keychain, identity):
    """从内到外签名所有 Mach-O（包括内置 ADB），最后封装应用；DMG 单独签名。"""
    options = ["--options", "runtime"] if target.suffix == ".app" else []
    command = ["codesign", "--force", "--sign", identity,
               "--keychain", keychain, "--timestamp", *options]
    if target.suffix == ".app":
        for entry in sorted(target.rglob("*"), key=lambda item: len(item.parts), reverse=True):
            if entry.is_file() and not entry.is_symlink():
                with entry.open("rb") as stream:
                    native = stream.read(4) in MACHO_HEADERS
                if native:
                    run([*command, entry])
                    print(f"已签名原生组件：{entry.relative_to(target)}", flush=True)
    run([*command, target])
    run(["codesign", "--verify", "--deep", "--strict", target])


def notarize(run, archive, keychain, reports, label):
    """提交并等待 Apple 结果，保留提交编号及诊断；仅 Accepted 可以继续打包。"""
    auth = ["--keychain-profile", "macOS-CI-Notarization", "--keychain", keychain]
    submitted = json.loads(run(["xcrun", "notarytool", "submit", archive,
                                *auth, "--output-format", "json"], timeout=300))
    submission = submitted["id"]
    (reports / f"{label}-submission.json").write_text(json.dumps(submitted, indent=2) + "\n")
    print(f"{label} 公证已提交：{submission}", flush=True)
    # wait 超时或被拒绝都不重新上传，保留编号供查询，避免产生重复公证任务。
    try:
        run(["xcrun", "notarytool", "wait", submission, *auth,
             "--timeout", "20m", "--output-format", "json"], timeout=1230)
    except RuntimeError as error:
        print(run.redact(str(error)), flush=True)
    status = json.loads(run(["xcrun", "notarytool", "info", submission,
                             *auth, "--output-format", "json"]))
    (reports / f"{label}-status.json").write_text(json.dumps(status, indent=2) + "\n")
    if status.get("status") in {"Accepted", "Invalid", "Rejected"}:
        run(["xcrun", "notarytool", "log", submission, *auth, reports / f"{label}-log.json"])
    if status.get("status") != "Accepted":
        raise RuntimeError(f"{label} 公证未通过：{status.get('status')}，提交编号 {submission}")
    print(f"{label} 公证通过：Accepted", flush=True)


def staple_and_assess(run, path):
    run(["xcrun", "stapler", "staple", path])
    run(["xcrun", "stapler", "validate", path])
    run(["codesign", "--verify", "--deep", "--strict", path])
    options = ["--type", "execute"] if path.suffix == ".app" else [
        "--type", "open", "--context", "context:primary-signature",
    ]
    run(["spctl", "--assess", *options, "--verbose=4", path])


def package(run, values, keychain, root):
    """对 root 下本次构建的应用公证，重建最终 ZIP/DMG，返回已验证产物路径。"""
    metadata = json.loads((root / "package.json").read_text())
    release = root / "release"
    app = release / "mac-arm64" / f"{metadata['productName']}.app"
    if not (app / "Contents/Info.plist").is_file():
        raise ValueError("找不到本次应用构建，请先运行 npm run package:mac")
    reports = root / "artifacts/notarization"
    reports.mkdir(parents=True, exist_ok=True)
    name = f"{metadata['shortName']}-{metadata['version']}-mac-arm64"
    archive, dmg = release / f"{name}.zip", release / f"{name}.dmg"
    # 成功前不留下能被后续上传步骤误认的旧分发包。
    archive.unlink(missing_ok=True)
    dmg.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix="adm-notarization-", dir=os.environ.get("RUNNER_TEMP")) as temporary:
        work = Path(temporary)
        sign(run, app, keychain, values["APPLE_SIGNING_IDENTITY"])
        submit_zip = work / "app-submit.zip"
        run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, submit_zip])
        notarize(run, submit_zip, keychain, reports, "app")
        staple_and_assess(run, app)
        final_zip, final_dmg = work / archive.name, work / dmg.name
        run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, final_zip])
        run([sys.executable, root / "scripts/package_dmg.py", "build", app, final_dmg], timeout=300)
        sign(run, final_dmg, keychain, values["APPLE_SIGNING_IDENTITY"])
        notarize(run, final_dmg, keychain, reports, "dmg")
        staple_and_assess(run, final_dmg)
        # 重新解压交付 ZIP，确认 ditto 没有丢失签名和离线公证票据。
        extracted = work / "unpacked"
        run(["ditto", "-x", "-k", final_zip, extracted])
        extracted_app = extracted / app.name
        run(["xcrun", "stapler", "validate", extracted_app])
        run(["codesign", "--verify", "--deep", "--strict", extracted_app])
        run(["spctl", "--assess", "--type", "execute", extracted_app])
        shutil.copy2(final_zip, archive)
        shutil.copy2(final_dmg, dmg)
    print("macOS 应用、ZIP 和 DMG 的签名、公证与票据验证全部通过", flush=True)
    return archive, dmg


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-credentials", action="store_true", help="仅检查六项 Secrets 是否完整")
    args = parser.parse_args()
    values = credentials(os.environ)
    if args.check_credentials:
        print("macOS 签名 Secrets 已齐全")
        return
    if sys.platform != "darwin":
        raise RuntimeError("签名与公证只能在 macOS 执行")
    run = Runner(values.values())
    with signing_keychain(run, values) as keychain:
        package(run, values, keychain, ROOT)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        # 不打印 traceback，防止第三方命令异常意外携带原始凭据。
        print(Runner(os.environ.get(name, "") for name in SECRET_NAMES).redact(str(error)), file=sys.stderr)
        sys.exit(1)
