use crate::models::*;
use regex::Regex;
pub fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("内部正则表达式应有效")
}
pub fn valid_package(value: &str) -> bool {
    re(r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$").is_match(value)
}
pub fn parse_devices(text: &str) -> Vec<Device> {
    let row = re(r"^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no)(?:\s|$)");
    let model = re(r"\bmodel:(\S+)");
    let transport = re(r"\btransport_id:(\d+)");
    text.lines()
        .filter_map(|line| {
            row.captures(line.trim()).map(|m| Device {
                serial: m[1].into(),
                network_boot_id: None,
                // 无线调试的自动发现连接可使用 mDNS 服务名，不一定带端口。
                network: !line
                    .split_whitespace()
                    .any(|field| field.starts_with("usb:"))
                    && (m[1]
                        .trim_end_matches('.')
                        .trim_end_matches(".local")
                        .ends_with("._adb-tls-connect._tcp")
                        || (m[1].contains(':') && endpoint(&m[1]).is_ok())),
                state: m[2].into(),
                model: model
                    .captures(line)
                    .map(|m| m[1].into())
                    .unwrap_or_default(),
                transport_id: transport
                    .captures(line)
                    .map(|m| m[1].into())
                    .unwrap_or_default(),
            })
        })
        .collect()
}
pub fn endpoint(value: &str) -> Result<String> {
    let value = value.trim();
    let port = value
        .rsplit(':')
        .next()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(0);
    if port == 0
        || !re(r"^(?:\[[0-9a-fA-F:%.]+\]|[a-zA-Z0-9][a-zA-Z0-9.\-]*):[0-9]{1,5}$").is_match(value)
    {
        return Err("请输入有效地址，例如 192.168.1.100:5555；IPv6 使用 [地址]:端口。".into());
    }
    Ok(value.into())
}
pub fn component(value: &str) -> Result<String> {
    let parts: Vec<_> = value.trim().split('/').collect();
    if parts.len() != 2
        || !valid_package(parts[0])
        || !re(r"^\.?[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$").is_match(parts[1])
    {
        return Err("管理组件格式应为 包名/.Receiver类名。".into());
    }
    let pkg = parts[0];
    let receiver = parts[1];
    Ok(format!(
        "{pkg}/{}",
        if receiver.starts_with('.') {
            format!("{pkg}{receiver}")
        } else if receiver.contains('.') {
            receiver.into()
        } else {
            format!("{pkg}.{receiver}")
        }
    ))
}
// adb shell 会重新拼接参数；必须在远端 shell 层转义空格、单引号和内部类的 $。
pub fn shell_arg(value: &str) -> String {
    if re(r"^[A-Za-z0-9_./:=\-]+$").is_match(value) {
        value.into()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}
pub fn parse_owner(text: &str) -> Result<Option<String>> {
    if !text.to_lowercase().contains("device policy manager") {
        return Err("无法读取设备管理状态，系统输出不受支持或权限不足。".into());
    }
    if let Some(m) =
        re(r"(?i)Device Owner:\s*\r?\n\s*admin=ComponentInfo\{([^}]+)\}").captures(text)
    {
        return component(&m[1]).map(Some);
    }
    if re(r"(?i)\bDevice Owner\b").is_match(text) {
        return Err("检测到设备所有者，但无法识别组件，请核对设备系统版本。".into());
    }
    Ok(None)
}
pub fn remote_path(value: &str) -> Result<String> {
    if value.len() > 4096 || !value.starts_with('/') || value.contains('\0') {
        return Err("请输入以 / 开头的设备路径。".into());
    }
    let mut parts = vec![];
    for part in value.split('/') {
        match part {
            ".." => {
                parts.pop();
            }
            "" | "." => {}
            _ => parts.push(part),
        }
    }
    Ok(format!("/{}", parts.join("/")))
}
pub fn child_path(directory: &str, name: &str) -> Result<String> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\0']) {
        return Err("文件名不能为空，不能包含 / 或父目录引用。".into());
    }
    Ok(format!(
        "{}/{}",
        remote_path(directory)?.trim_end_matches('/'),
        name
    ))
}
pub fn mutable_child_path(directory: &str, name: &str) -> Result<String> {
    if name.len() > 255 || name.chars().any(|c| c.is_control()) {
        return Err("名称不能包含控制字符，且不能超过 255 字节。".into());
    }
    let path = child_path(directory, name)?;
    // 根目录及挂载入口仅用于导航，不能通过列表操作整体重命名或删除。
    if [
        "/",
        "/storage",
        "/storage/emulated",
        "/data/media",
        "/mnt",
        "/mnt/media_rw",
    ]
    .contains(&remote_path(directory)?.as_str())
        || [
            "/storage/emulated",
            "/storage/emulated/0",
            "/data/media",
            "/data/media/0",
            "/mnt/sdcard",
        ]
        .contains(&path.as_str())
    {
        return Err("存储根目录不能重命名或删除。".into());
    }
    Ok(path)
}
pub fn parse_files(directory: &str, output: &str) -> Result<Vec<DeviceFile>> {
    let fields: Vec<_> = output.split('\0').collect();
    if fields.len() < 3
        || fields[0] != "ATF1"
        || fields[fields.len() - 2] != "END"
        || fields.last() != Some(&"")
        || fields.len() % 2 != 1
    {
        return Err("目录内容不完整，请缩小目录范围后重试。".into());
    }
    let pattern = re(r"(?i)^([0-9a-f]+) (\d+) (-?\d+)$");
    let mut files = vec![];
    for i in (1..fields.len() - 2).step_by(2) {
        let m = pattern.captures(fields[i]).ok_or("无法识别文件元数据。")?;
        let size = m[2].parse::<u64>().map_err(|_| "文件大小超出范围。")?;
        let modified = m[3].parse::<i64>().map_err(|_| "文件时间超出范围。")?;
        if size > 9_007_199_254_740_991 || !(-62135596800..=253402300799).contains(&modified) {
            return Err("文件元数据超出范围。".into());
        }
        let mode = u32::from_str_radix(&m[1], 16).map_err(|_| "文件模式不正确。")? & 0xf000;
        let kind = match mode {
            0x4000 => "directory",
            0x8000 => "file",
            0xa000 => "link",
            _ => "other",
        };
        files.push(DeviceFile {
            name: fields[i + 1].into(),
            path: child_path(directory, fields[i + 1])?,
            size,
            modified,
            r#type: kind.into(),
        });
    }
    files.sort_by(|a, b| {
        (b.r#type == "directory")
            .cmp(&(a.r#type == "directory"))
            .then(a.name.cmp(&b.name))
    });
    Ok(files)
}
pub fn friendly_error(text: &str) -> String {
    let hints = [
        (
            "DELETE_FAILED_DEVICE_POLICY_MANAGER",
            "应用受设备管理策略保护，无法卸载。",
        ),
        (
            "DELETE_FAILED_USER_RESTRICTED",
            "设备限制阻止卸载，请检查设备策略。",
        ),
        ("DELETE_FAILED_OWNER_BLOCKED", "设备管理者阻止卸载此应用。"),
        (
            "INSTALL_FAILED_UPDATE_INCOMPATIBLE",
            "应用签名不一致，无法覆盖安装。",
        ),
        (
            "INSTALL_FAILED_VERSION_DOWNGRADE",
            "系统拒绝降级，请使用更新版本。",
        ),
        ("INSTALL_FAILED_INSUFFICIENT_STORAGE", "设备空间不足。"),
        (
            "INSTALL_FAILED_NO_MATCHING_ABIS",
            "APK 不支持目标设备的 CPU 架构。",
        ),
        ("INSTALL_FAILED_OLDER_SDK", "Android 版本低于 APK 要求。"),
        ("INSTALL_FAILED_TEST_ONLY", "设备拒绝安装此测试包。"),
        (
            "INSTALL_FAILED_USER_RESTRICTED",
            "设备限制阻止安装，请检查设备提示。",
        ),
        ("unauthorized", "请在设备上确认调试授权。"),
        ("offline", "设备已离线，请检查连接。"),
        (
            "already some accounts",
            "设备仍有账号，无法设置设备所有者。",
        ),
        ("already several users", "设备存在多个用户。"),
        (
            "already set-up",
            "设备已完成初始化，当前系统不允许设置设备所有者。",
        ),
        ("Unknown admin", "未找到设备管理组件。"),
    ];
    let lower = text.to_lowercase();
    let hint = hints
        .iter()
        .find(|(token, _)| lower.contains(&token.to_lowercase()))
        .map(|(_, hint)| *hint)
        .unwrap_or("ADB 操作失败：");
    let tail: String = text
        .trim()
        .chars()
        .rev()
        .take(1600)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{hint}\n{tail}")
}
