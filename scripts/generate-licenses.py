#!/usr/bin/env python3
"""更新离线许可快照。需要 npm ci、锁定 Rust 工具链及网络；日常构建只校验快照，不下载许可。"""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import subprocess
import tomllib

ROOT = Path(__file__).resolve().parent.parent
LEGAL = ROOT / "legal"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def license_files(directory):
    # copying.rs 是 Objective-C 的复制接口，不是许可证；只收录文档，避免同名源码误判。
    return sorted(p for p in directory.rglob("*") if p.is_file()
                  and p.suffix.lower() not in (".rs", ".c", ".h", ".cpp", ".py", ".js", ".ts", ".map")
                  and re.search(r"(^|[-_.])(licen[cs]e|copying|notice|copyright)([-_.]|$)", p.name, re.I))


class PlainText(HTMLParser):
    """保留标准库声明的正文和段落；UI 永远不执行第三方 HTML。"""
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip = True
        if tag in ("div", "p", "br", "h1", "h2", "h3", "li", "pre"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = False
        if tag in ("div", "p", "h1", "h2", "h3", "li", "pre"):
            self.parts.append("\n")

    def handle_data(self, text):
        if not self.skip:
            self.parts.append(text)


def main():
    metadata = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    entries = []
    upstream = json.loads((LEGAL / "upstream.json").read_text(encoding="utf-8"))
    for item in upstream:
        if digest(LEGAL / "vendor" / item["file"]) != item["sha256"]:
            raise ValueError(f"上游许可摘要不匹配：{item['file']}")

    def add(key, name, version, license_id, group, source, files, note=""):
        if not files or any(not text.strip() for _, text in files):
            raise ValueError(f"缺少许可正文：{key}，请补充精确版本上游原文")
        text = "\n\n".join(f"--- {name} ---\n{body.strip()}" for name, body in files)
        # SPDX 的 AND 保持全部义务；明确的 OR 分支可选择 MIT，不改写上游原始声明。
        selection = license_id
        if " OR " in license_id and " AND " not in license_id and re.search(r"\bMIT(?:$|[ )])", license_id):
            selection = "MIT"
        elif license_id == "(MIT OR Apache-2.0) AND Unicode-3.0":
            selection = "MIT AND Unicode-3.0"
        entries.append(dict(id=key, name=name, version=version, license=license_id,
                            selection=selection, group=group, source=source, note=note, text=text))

    add("adm", "ADM", metadata["version"], "MIT", "project", "https://github.com/ruishanio/adm",
        [("LICENSE", (ROOT / "LICENSE").read_text(encoding="utf-8"))])
    for name, title in [("ATTRIBUTION.txt", "Android robot & trademarks"),
                        ("SOURCE-CODE.md", "Source code / 源码获取"),
                        ("WINDOWS-RUNTIME.txt", "Microsoft Edge WebView2 Runtime")]:
        add(name, title, "", "CC-BY-3.0" if name == "ATTRIBUTION.txt" else "See notice",
            "platform" if name.startswith("WINDOWS") else "project", "",
            [(name, (LEGAL / name).read_text(encoding="utf-8"))])

    npm = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))["packages"]
    seen = set()
    for location, package in sorted(npm.items()):
        if not location or (package.get("dev") and location != "node_modules/tailwindcss"):
            continue
        directory = ROOT / location
        info = json.loads((directory / "package.json").read_text(encoding="utf-8"))
        key = f"npm:{info['name']}@{package['version']}"
        if key in seen:
            continue
        seen.add(key)
        files = [(p.name, p.read_text(encoding="utf-8", errors="strict")) for p in license_files(directory)
                 if "node_modules" not in p.relative_to(directory).parts]
        license_id = "ISC AND MIT" if info["name"] == "@lucide/vue" else package["license"]
        add(key, info["name"], package["version"], license_id, "frontend",
            package.get("resolved", ""), files,
            "Production dependency graph (includes tree-shaken and build-time code).")

    cargo_lock = tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text(encoding="utf-8"))
    checksums = {(p["name"], p["version"]): p.get("checksum") for p in cargo_lock["package"]}
    crates = {}
    for target in ("aarch64-apple-darwin", "x86_64-pc-windows-msvc"):
        result = subprocess.check_output(["cargo", "metadata", "--locked", "--format-version", "1",
                                          "--filter-platform", target, "--manifest-path", "src-tauri/Cargo.toml"], cwd=ROOT)
        for p in json.loads(result)["packages"]:
            if p["source"]:
                crates[(p["name"], p["version"])] = p
    sources = []
    for (name, version), p in sorted(crates.items()):
        directory = Path(p["manifest_path"]).parent
        license_id = p["license"]
        if not license_id:
            raise ValueError(f"未声明许可：{name}@{version}")
        files = [(str(f.relative_to(directory)), f.read_text(encoding="utf-8")) for f in license_files(directory)]
        for item in upstream:
            if item["component"] == f"{name}@{version}":
                files.append((item["url"], (LEGAL / "vendor" / item["file"]).read_text(encoding="utf-8")))
        # objc2 上游仅以链接指向 MIT 正文，保留其原文及作者元数据，并附完整标准条款。
        if p.get("repository", "").rstrip("/") == "https://github.com/madsmtm/objc2":
            if p["authors"]:
                files.append(("Upstream package authors", "\n".join(p["authors"])))
            files.append(("MIT terms (linked by upstream)", (LEGAL / "vendor/MIT.txt").read_text(encoding="utf-8")))
        if name == "selectors":
            files += [("MPL-2.0", (LEGAL / "vendor/MPL-2.0.txt").read_text(encoding="utf-8"))]
        source = f"https://static.crates.io/crates/{name}/{name}-{version}.crate"
        add(f"crate:{name}@{version}", name, version, license_id, "native", source, files,
            "Unmodified registry source. macOS/Windows resolved graph includes build dependencies; "
            "not all listed code is linked. All upstream license alternatives and notices are retained.")
        if "MPL-2.0" in license_id:
            # Cargo 缓存保留发布者原始归档；与锁文件摘要核对后随应用分发，避免只给易失效链接。
            cache = directory.parents[2] / "cache" / directory.parent.name / f"{name}-{version}.crate"
            if digest(cache) != checksums[(name, version)]:
                raise ValueError(f"源码归档与 Cargo.lock 不符：{name}@{version}")
            dest = LEGAL / "sources" / cache.name
            dest.parent.mkdir(exist_ok=True)
            shutil.copyfile(cache, dest)
            sources.append(dict(name=name, version=version, file=f"sources/{cache.name}",
                                sha256=digest(dest), url=source, modified=False))

    sysroot = Path(subprocess.check_output(["rustc", "--print", "sysroot"], cwd=ROOT, text=True).strip())
    std_path = sysroot / "share/doc/rust/COPYRIGHT-library.html"
    std = PlainText()
    std.feed(std_path.read_text(encoding="utf-8"))
    rust_version = tomllib.loads((ROOT / "rust-toolchain.toml").read_text(encoding="utf-8"))["toolchain"]["channel"]
    add("rust-std", "Rust standard library", rust_version, "See component notices", "native",
        f"https://github.com/rust-lang/rust/tree/{rust_version}/library",
        [("COPYRIGHT-library.html (plain text)", "".join(std.parts))],
        "Full toolchain library notice; includes targets and features ADM does not use.")
    for item in upstream:
        if item.get("entry"):
            e = item["entry"]
            add(item["file"], e["name"], e["version"], e["license"], e["group"], item["url"],
                [(item["file"], (LEGAL / "vendor" / item["file"]).read_text(encoding="utf-8"))], e.get("note", ""))
    write_json(LEGAL / "catalog.json", entries)
    write_json(LEGAL / "sources.json", sources)
    shutil.copyfile(ROOT / "LICENSE", LEGAL / "LICENSE")
    (LEGAL / "WINDOWS-INSTALLER.txt").write_text(
        "ADM — Device manager for Android\n\n"
        "ADM 自有代码适用 MIT；下述 Microsoft 条款仅适用于独立的 WebView2 运行时。\n"
        "ADM original code uses MIT. Microsoft terms below apply only to the separate WebView2 Runtime.\n\n" +
        (ROOT / "LICENSE").read_text(encoding="utf-8") + "\n\n" +
        (LEGAL / "WINDOWS-RUNTIME.txt").read_text(encoding="utf-8") + "\n\n" +
        (LEGAL / "vendor/webview2-runtime-terms.txt").read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    (LEGAL / "THIRD-PARTY-NOTICES.txt").write_text(
        "ADM — Device manager for Android\nThird-party licenses / 第三方许可\n"
        "ADM's MIT license applies to its original code, not to third-party components.\n"
        "This conservative inventory includes build-only dependencies.\n\n" +
        "\n\n".join(f"{'=' * 72}\n{e['name']} {e['version']}\nLicense: {e['license']}\nLicense selection: {e['selection']}\n"
                      f"Source: {e['source']}\n{e['note']}\n\n{e['text']}" for e in entries), encoding="utf-8", newline="\n")
    inputs = ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock",
              "src-tauri/tauri.conf.json", "src-tauri/tauri.windows.conf.json",
              "rust-toolchain.toml", "vite.config.ts", "LICENSE",
              "scripts/package_ci.py", "scripts/generate-licenses.py"]
    payload = [p for p in LEGAL.rglob("*") if p.is_file() and p.name != "manifest.json"]
    write_json(LEGAL / "manifest.json", dict(schema=1, version=metadata["version"],
        inputs={n: digest(ROOT / n) for n in inputs},
        files={str(p.relative_to(LEGAL)): digest(p) for p in sorted(payload)}))
    print(f"已归档 {len(entries)} 项声明、{len(sources)} 份 MPL 精确版本源码；请审阅差异后再发布。")


if __name__ == "__main__":
    main()
