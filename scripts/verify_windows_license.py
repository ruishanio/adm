#!/usr/bin/env python3
"""在临时 Windows Runner 打开真实安装器，核对许可页正文；不接受许可或执行安装。"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def normalize(text):
    """消除 NSIS 富文本控件的换行差异，保留全部实际许可文字。"""
    return " ".join(text.lstrip("\ufeff").split())


def verify_license_page(installer, expected_file, report_file):
    """打开 installer 并比较 expected_file；把只读核对结果写入 report_file，失败抛错。"""
    if sys.platform != "win32" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("安装器许可页面核对仅允许在临时 Windows CI 中运行")
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.EnumChildWindows.argtypes = [wintypes.HWND, callback_type, wintypes.LPARAM]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetDlgItem.restype = wintypes.HWND
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

    expected = normalize(expected_file.read_text(encoding="utf-8"))
    required = ["Microsoft Edge WebView2 Runtime", "SmartScreen", "https://aka.ms/privacy"]
    if not all(text in expected for text in required):
        raise ValueError("源许可文件缺少运行时条款或隐私通知")

    process = subprocess.Popen([str(installer), "/currentuser"])
    deadline = time.monotonic() + 40
    advanced = False
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("安装器在显示许可页面之前退出")
            windows = []

            @callback_type
            def collect_window(hwnd, _):
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value == process.pid and user32.IsWindowVisible(hwnd):
                    windows.append(hwnd)
                return True

            user32.EnumWindows(collect_window, 0)
            for window in windows:
                controls = []

                @callback_type
                def collect_control(hwnd, _):
                    name = ctypes.create_unicode_buffer(256)
                    user32.GetClassNameW(hwnd, name, len(name))
                    if "richedit" in name.value.lower() and user32.IsWindowVisible(hwnd):
                        controls.append(hwnd)
                    return True

                user32.EnumChildWindows(window, collect_control, 0)
                for control in controls:
                    # WM_GETTEXT 使用真实可见的控件正文，不能用打包输入代替页面证据。
                    size = user32.SendMessageW(control, 0x000E, 0, 0) + 1
                    content = ctypes.create_unicode_buffer(size)
                    user32.SendMessageW(control, 0x000D, size, ctypes.addressof(content))
                    actual = normalize(content.value)
                    if actual != expected:
                        raise ValueError("安装器可见许可正文与归档不一致或发生截断")
                    report_file.parent.mkdir(parents=True, exist_ok=True)
                    report_file.write_text(json.dumps({
                        "installer": installer.name,
                        "installerSha256": hashlib.sha256(installer.read_bytes()).hexdigest(),
                        "licenseSha256": hashlib.sha256(expected_file.read_bytes()).hexdigest(),
                        "visibleLicenseMatches": True,
                        "requiredNotices": required,
                        "acceptedLicense": False,
                        "installed": False,
                    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    print("真实 Windows 安装器许可页面：完整正文、WebView2 条款和隐私通知核对通过")
                    return
                if not advanced:
                    # 仅点击欢迎页的“下一步”；到许可页立即读取并退出，不代替用户接受条款。
                    next_button = user32.GetDlgItem(window, 1)
                    if next_button:
                        user32.SendMessageW(next_button, 0x00F5, 0, 0)
                        advanced = True
            time.sleep(0.2)
        raise TimeoutError("未能在 40 秒内读取安装器的可见许可页面")
    finally:
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=10)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    root = Path(__file__).resolve().parent.parent
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    verify_license_page(root / f"release/ADM-{version}-win-x64-setup.exe",
                        root / "legal/WINDOWS-INSTALLER.txt",
                        root / "artifacts/windows-license-page.json")
