#!/usr/bin/env python3
"""汇总同一次 tag 构建的双平台产物；显式传入 --publish 才调用 GitHub 发布。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_assets(root, downloads, output, tag, commit):
    """校验版本、提交和两平台文件，再汇总到新目录；返回可上传附件路径列表。"""
    metadata = json.loads((root / "package.json").read_text(encoding="utf-8"))
    version = metadata["version"]
    if not re.fullmatch(rf"v{re.escape(version)}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?", tag):
        raise ValueError("发布 tag 必须匹配 package.json 版本。")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("缺少有效的构建提交 SHA。")
    manifest_hash = digest(root / "legal/manifest.json")
    review = json.loads((root / "legal/release-review.json").read_text(encoding="utf-8"))
    copies = []
    for platform, arch, installer in [("mac", "arm64", ".dmg"), ("win", "x64", "-setup.exe")]:
        target = f"{platform}-{arch}"
        directory = downloads / f"ADM-{tag}-{target}"
        info_path = directory / "build-info.json"
        info = json.loads(info_path.read_text(encoding="utf-8"))
        expected = {
            "product": metadata["productName"], "framework": "Tauri 2", "version": version,
            "tag": tag, "commit": commit, "platform": platform, "arch": arch,
            "legalManifestSha256": manifest_hash, "distributionReview": review["status"],
            "distributionPolicy": review.get("distributionPolicy"),
        }
        for key, value in expected.items():
            if info.get(key) != value:
                raise ValueError(f"{target} 的 {key} 与本次发布不一致。")
        prefix = f"{metadata['shortName']}-{version}-{target}"
        names = {prefix + ".zip", prefix + installer}
        entries = info.get("files", [])
        if len(entries) != 2 or {entry["file"] for entry in entries} != names:
            raise ValueError(f"{target} 缺少安装包或便携包，或包含意外文件。")
        sums = (directory / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines()
        if sorted(sums) != sorted(f"{entry['sha256']}  {entry['file']}" for entry in entries):
            raise ValueError(f"{target} 的校验清单与构建信息不一致。")
        for entry in entries:
            path = directory / entry["file"]
            if path.is_symlink() or path.stat().st_size <= 0 or path.stat().st_size != entry["size"]:
                raise ValueError(f"文件大小或类型不正确：{path.name}")
            if digest(path) != entry["sha256"]:
                raise ValueError(f"SHA-256 校验失败：{path.name}")
            copies.append((path, path.name))
        # 构建信息按平台命名，防止下载合并时覆盖另一个平台的来源信息。
        copies.append((info_path, f"build-info-{target}.json"))
    # 全部输入验证后再创建目录，不将缺失平台或旧目录残留当作可发布附件。
    output.mkdir(parents=True, exist_ok=False)
    for source, name in copies:
        shutil.copyfile(source, output / name)
    assets = sorted(output.iterdir())
    sums_path = output / "SHA256SUMS.txt"
    sums_path.write_text("".join(f"{digest(path)}  {path.name}\n" for path in assets), encoding="utf-8")
    return [*assets, sums_path]


def gh(*args):
    """通过参数数组调用 GitHub CLI，失败即中止，不把 tag 或路径交给 shell 解释。"""
    return subprocess.run(["gh", *map(str, args)], check=True, text=True, capture_output=True).stdout


def get_release(repository, tag):
    try:
        return json.loads(gh("api", f"repos/{repository}/releases/tags/{quote(tag, safe='')}"))
    except subprocess.CalledProcessError as error:
        # 只有明确的 404 表示未创建；权限、限流或网络失败不能当成缺失继续发布。
        if "(HTTP 404)" in (error.stderr or ""):
            return None
        raise


def verify_remote_assets(release, assets):
    """核对 GitHub 回读的附件名、大小和摘要，全部一致才允许公开或确认重跑成功。"""
    remote = {entry["name"]: entry for entry in release["assets"]}
    if len(remote) != len(release["assets"]) or set(remote) != {path.name for path in assets}:
        raise ValueError("Release 附件未齐全或含额外文件，保留现状，请检查草稿。")
    for path in assets:
        item = remote[path.name]
        if (item.get("state") != "uploaded" or item.get("size") != path.stat().st_size
                or item.get("digest") != f"sha256:{digest(path)}"):
            raise ValueError(f"Release 附件与本次构建不一致：{path.name}；已发布版本不能自动覆盖。")


def publish(repository, tag, commit, assets):
    """创建或恢复草稿，上传并回读附件后公开；已发布版本只校验，不覆盖文件。"""
    remote_commit = json.loads(gh("api", f"repos/{repository}/commits/{quote(tag, safe='')}"))
    if remote_commit["sha"] != commit:
        raise ValueError("远端 tag 已变化，与构建提交不同，停止发布。")
    release = get_release(repository, tag)
    if release and not release["draft"]:
        verify_remote_assets(release, assets)
        return release["html_url"]
    prerelease = "-" in tag
    if release is None:
        notes = assets[0].parent.parent / "release-notes.md"
        notes.write_text(
            f"ADM {tag}\n\n"
            "- macOS Apple Silicon：下载 `.dmg` 安装，或使用应用 ZIP。\n"
            "- Windows x64：下载 `-setup.exe` 安装，或使用便携 ZIP。\n"
            "- `SHA256SUMS.txt` 可核对附件；两份 `build-info-*.json` 记录构建来源。\n\n"
            "macOS 使用 ad-hoc 签名，尚未公证；Windows 尚未代码签名。\n\n"
            f"构建提交：`{commit}`\n", encoding="utf-8",
        )
        gh("release", "create", tag, "--repo", repository, "--verify-tag", "--draft",
           "--title", f"ADM {tag}", "--notes-file", notes, f"--prerelease={str(prerelease).lower()}")
    # 仅草稿允许替换同名附件；中途失败仍保留草稿，重跑发布任务可继续。
    gh("release", "upload", tag, *assets, "--repo", repository, "--clobber")
    release = get_release(repository, tag)
    if not release or not release["draft"]:
        raise ValueError("发布期间 Release 状态发生变化，停止修改。")
    verify_remote_assets(release, assets)
    flags = ["--latest=false"] if prerelease else []
    template = ROOT / "docs/releases" / f"{tag}.md"
    if template.is_file():
        # 已有草稿也更新为本次审阅的说明，不保留此前临时的发布阻塞文字。
        notes = assets[0].parent.parent / "release-notes.md"
        notes.write_text(template.read_text(encoding="utf-8").replace("{{commit}}", commit), encoding="utf-8")
        flags += ["--notes-file", str(notes)]
    gh("release", "edit", tag, "--repo", repository, "--draft=false",
       f"--prerelease={str(prerelease).lower()}", *flags)
    return release["html_url"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, default=ROOT / "artifacts/release-downloads")
    parser.add_argument("--output", type=Path, default=ROOT / "release/publish")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    # 本地预检也保留既有分发门槛；不能仅凭产物里的 ready 字样绕过仓库核对。
    subprocess.run(["node", str(ROOT / "scripts/check-licenses.mjs"), "--release"], check=True)
    tag, commit = os.environ.get("GITHUB_REF_NAME", ""), os.environ.get("GITHUB_SHA", "")
    if os.environ.get("GITHUB_REF_TYPE") != "tag":
        raise ValueError("仅允许为已有 tag 汇总发布产物。")
    assets = prepare_assets(ROOT, args.artifacts, args.output, tag, commit)
    print("附件已验证：\n" + "\n".join(path.name for path in assets), flush=True)
    if args.publish:
        url = publish(os.environ["GITHUB_REPOSITORY"], tag, commit, assets)
        print(f"Release 已发布并核对附件：{url}")
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
                summary.write(f"[下载 ADM {tag}]({url})\n\n已核对 macOS ARM64 / Windows x64 的全部附件。\n")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr, file=sys.stderr)
        raise SystemExit(error.returncode) from error
    except (OSError, ValueError, KeyError) as error:
        print(f"发布失败：{error}", file=sys.stderr)
        raise SystemExit(1) from error
