#[cfg(test)]
use crate::devices::DeviceOperations;
use crate::{models::*, parsing::re};
use std::collections::BTreeMap;

// 固定只读命令一次往返采集；单项权限不足时继续后续项，不改变设备设置。
pub const RUNTIME_SCRIPT: &str = r#"
printf '\n__ADM_memory__\n'; cat /proc/meminfo 2>/dev/null
printf '\n__ADM_storage__\n'; df -k /data 2>/dev/null
printf '\n__ADM_size__\n'; wm size 2>/dev/null
printf '\n__ADM_density__\n'; wm density 2>/dev/null
printf '\n__ADM_battery__\n'; dumpsys -t 3 battery 2>/dev/null
printf '\n__ADM_uptime__\n'; cat /proc/uptime 2>/dev/null
printf '\n__ADM_kernel__\n'; uname -r 2>/dev/null
printf '\n__ADM_cpu__\n'; cat /sys/devices/system/cpu/present 2>/dev/null
printf '\n__ADM_network__\n'; ip -o -4 addr show scope global 2>/dev/null
printf '\n__ADM_end__\n'
"#;

/// 将 getprop 与可选运行信息转换为详情；缺失属性保持空值，避免伪造设备能力。
pub fn parse_details(properties: &str, runtime: &str, owner: Option<String>) -> Details {
    let values: BTreeMap<String, String> = re(r"(?m)^\[([^\]]+)\]: \[(.*)\]\r?$")
        .captures_iter(properties)
        .map(|m| (m[1].into(), m[2].trim().into()))
        .collect();
    let get = |key: &str| values.get(key).cloned().unwrap_or_default();
    let first = |keys: &[&str]| {
        keys.iter()
            .map(|key| get(key))
            .find(|v| !v.is_empty())
            .unwrap_or_default()
    };
    Details {
        android: get("ro.build.version.release"),
        api: get("ro.build.version.sdk"),
        manufacturer: get("ro.product.manufacturer"),
        model: get("ro.product.model"),
        architecture: first(&["ro.product.cpu.abilist", "ro.product.cpu.abi"]),
        patch: get("ro.build.version.security_patch"),
        serial: first(&["ro.serialno", "ro.boot.serialno"]),
        owner,
        system: SystemInfo {
            brand: get("ro.product.brand"),
            device: get("ro.product.device"),
            product: get("ro.product.name"),
            hardware: get("ro.hardware"),
            soc: [get("ro.soc.manufacturer"), get("ro.soc.model")]
                .into_iter()
                .filter(|v| !v.is_empty())
                .collect::<Vec<_>>()
                .join(" "),
            build_id: get("ro.build.id"),
            build_number: get("ro.build.version.incremental"),
            build_type: get("ro.build.type"),
            fingerprint: get("ro.build.fingerprint"),
            bootloader: get("ro.bootloader"),
            baseband: get("gsm.version.baseband"),
            verified_boot: get("ro.boot.verifiedbootstate"),
            encryption: get("ro.crypto.state"),
            runtime: parse_runtime(runtime),
        },
    }
}

/// 解析带分段标记的只读采样；畸形、越界和缺失数据均返回 None，不把不可读取当作 0。
pub fn parse_runtime(text: &str) -> RuntimeInfo {
    let normalized = text.replace('\r', "");
    let section = |name: &str| -> &str {
        normalized
            .split_once(&format!("__ADM_{name}__\n"))
            .and_then(|(_, tail)| tail.split_once("\n__ADM_"))
            .map(|(value, _)| value.trim())
            .unwrap_or("")
    };
    let memory = section("memory");
    let kb = |key: &str| -> Option<u64> {
        let matched =
            re(&format!(r"(?m)^{}:\s+(\d+) kB\s*$", regex::escape(key))).captures(memory)?;
        matched[1].parse::<u64>().ok()?.checked_mul(1024)
    };
    let memory_total = kb("MemTotal").filter(|v| *v > 0);
    // MemFree 不等于可用内存；老系统未提供 MemAvailable 时不做近似替代。
    let memory_available =
        kb("MemAvailable").filter(|value| memory_total.is_some_and(|total| *value <= total));
    let storage = section("storage").lines().find_map(|line| {
        let fields: Vec<_> = line.split_whitespace().collect();
        // df /data 可能报告同一文件系统的绑定挂载路径，不能只接受末列等于 /data。
        if fields.len() < 6 || !fields.last()?.starts_with('/') || !fields[4].ends_with('%') {
            return None;
        }
        let total = fields[1].parse::<u64>().ok()?.checked_mul(1024)?;
        let available = fields[3].parse::<u64>().ok()?.checked_mul(1024)?;
        (total > 0 && available <= total).then_some((total, available))
    });
    let read_size = |kind: &str| {
        re(&format!(r"(?m)^{kind} size: ([1-9]\d*)x([1-9]\d*)$"))
            .captures(section("size"))
            .map(|m| format!("{} × {}", &m[1], &m[2]))
            .unwrap_or_default()
    };
    let read_density = |kind: &str| -> Option<u32> {
        re(&format!(r"(?m)^{kind} density: (\d+)$")).captures(section("density"))?[1]
            .parse()
            .ok()
            .filter(|v| *v > 0)
    };
    let cpu_cores = parse_cpu_count(section("cpu"));
    let uptime_seconds = section("uptime")
        .split_whitespace()
        .next()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0 && *v < u64::MAX as f64)
        .map(|v| v.floor() as u64);
    let mut addresses = Vec::new();
    for m in
        re(r"(?m)^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)/\d+").captures_iter(section("network"))
    {
        if let Ok(ip) = m[2].parse::<std::net::Ipv4Addr>() {
            if !ip.is_loopback() && !ip.is_unspecified() {
                let address = format!("{}: {ip}", &m[1]);
                if !addresses.contains(&address) {
                    addresses.push(address);
                }
            }
        }
    }
    RuntimeInfo {
        kernel: section("kernel").lines().next().unwrap_or("").into(),
        cpu_cores,
        memory_total,
        memory_available,
        storage_total: storage.map(|v| v.0),
        storage_available: storage.map(|v| v.1),
        physical_size: read_size("Physical"),
        override_size: read_size("Override"),
        physical_density: read_density("Physical"),
        override_density: read_density("Override"),
        battery: parse_battery(section("battery")),
        uptime_seconds,
        addresses,
    }
}

fn parse_cpu_count(text: &str) -> Option<u32> {
    let mut count = 0u32;
    let mut previous = None;
    for part in text.trim().split(',') {
        let (start, end) = part.split_once('-').unwrap_or((part, part));
        let (start, end) = (start.parse::<u32>().ok()?, end.parse::<u32>().ok()?);
        if start > end || end > 4095 || previous.is_some_and(|last| start <= last) {
            return None;
        }
        count = count.checked_add(end - start + 1)?;
        previous = Some(end);
    }
    (count > 0).then_some(count)
}

fn parse_battery(text: &str) -> BatteryInfo {
    let fields: BTreeMap<_, _> = text
        .lines()
        .filter_map(|line| line.trim().split_once(':'))
        .map(|(key, value)| (key.trim(), value.trim()))
        .collect();
    let number = |key: &str| fields.get(key).and_then(|v| v.parse::<i32>().ok());
    let present = fields.get("present").and_then(|v| v.parse::<bool>().ok());
    if present == Some(false) {
        return BatteryInfo {
            present,
            ..Default::default()
        };
    }
    let percent = number("level")
        .zip(number("scale"))
        .filter(|(level, scale)| *scale > 0 && *level >= 0 && level <= scale)
        .map(|(level, scale)| level as f64 * 100.0 / scale as f64);
    BatteryInfo {
        present,
        percent,
        status: number("status")
            .filter(|v| (1..=5).contains(v))
            .map(|v| v as u32),
        health: number("health")
            .filter(|v| (1..=7).contains(v))
            .map(|v| v as u32),
        // Android dumpsys 的温度为 0.1 °C，电压为 mV；零度是有效温度。
        temperature: number("temperature")
            .filter(|v| (-1000..=2000).contains(v))
            .map(|v| v as f64 / 10.0),
        voltage: number("voltage")
            .filter(|v| *v > 0)
            .map(|v| v as f64 / 1000.0),
        power: [
            ("AC powered", "AC"),
            ("USB powered", "USB"),
            ("Wireless powered", "wireless"),
            ("Dock powered", "dock"),
        ]
        .into_iter()
        .filter(|(key, _)| fields.get(key) == Some(&"true"))
        .map(|(_, value)| value.into())
        .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "__ADM_memory__\nMemTotal: 4096 kB\nMemAvailable: 0 kB\n\n__ADM_storage__\nFilesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-1 8192 1024 7168 13% /storage/emulated/0/Android/obb\n\n__ADM_size__\nPhysical size: 1080x2400\nOverride size: 720x1600\n\n__ADM_density__\nPhysical density: 420\nOverride density: 320\n\n__ADM_battery__\npresent: true\nlevel: 0\nscale: 200\nstatus: 3\nhealth: 2\ntemperature: 0\nvoltage: 4100\nUSB powered: true\n\n__ADM_cpu__\n0-3,6-7\n\n__ADM_uptime__\n90061.25 180000.00\n\n__ADM_kernel__\n5.15.41-android13\n\n__ADM_network__\n2: wlan0 inet 192.0.2.4/24 scope global wlan0\n1: lo inet 127.0.0.1/8 scope host lo\n\n__ADM_end__\n";

    #[test]
    fn parses_units_overrides_and_data_bind_mount() {
        let info = parse_runtime(&SAMPLE.replace('\n', "\r\n"));
        assert_eq!(info.memory_total, Some(4096 * 1024));
        assert_eq!(info.memory_available, Some(0));
        assert_eq!(info.storage_total, Some(8192 * 1024));
        assert_eq!(info.storage_available, Some(7168 * 1024));
        assert_eq!(info.physical_size, "1080 × 2400");
        assert_eq!(info.override_size, "720 × 1600");
        assert_eq!(info.override_density, Some(320));
        assert_eq!(info.cpu_cores, Some(6));
        assert_eq!(info.uptime_seconds, Some(90061));
        assert_eq!(info.battery.percent, Some(0.0));
        assert_eq!(info.battery.temperature, Some(0.0));
        assert_eq!(info.battery.voltage, Some(4.1));
        assert_eq!(info.battery.power, ["USB"]);
        assert_eq!(info.addresses, ["wlan0: 192.0.2.4"]);
    }

    #[test]
    fn missing_invalid_and_partial_data_are_not_zero() {
        let info = parse_runtime("__ADM_memory__\nMemTotal: 1024 kB\nMemFree: 512 kB\nMemAvailable: 2048 kB\n__ADM_uptime__\nNaN\n__ADM_battery__\nlevel: 10\nscale: 0\nhealth: 99\n__ADM_cpu__\n0-3,2-4\n__ADM_end__\n");
        assert_eq!(info.memory_total, Some(1024 * 1024));
        assert_eq!(info.memory_available, None);
        assert_eq!(info.cpu_cores, None);
        assert_eq!(info.uptime_seconds, None);
        assert_eq!(info.battery.percent, None);
        assert_eq!(info.battery.health, None);
        assert_eq!(info.storage_total, None);
        assert_eq!(parse_runtime("permission denied").memory_total, None);
        assert_eq!(
            parse_runtime("__ADM_memory__\nMemTotal: 18446744073709551615 kB\n__ADM_end__\n")
                .memory_total,
            None
        );
        assert_eq!(
            parse_runtime("__ADM_size__\nPhysical size: 720x1440").physical_size,
            ""
        );
    }

    #[test]
    fn battery_scale_and_absence_are_respected() {
        let info = parse_battery("present: true\nlevel: 60\nscale: 200\ntemperature: -50");
        assert_eq!(info.percent, Some(30.0));
        assert_eq!(info.temperature, Some(-5.0));
        let absent = parse_battery("present: false\nlevel: 100\nscale: 100\nstatus: 5");
        assert_eq!(absent.present, Some(false));
        assert_eq!(absent.percent, None);
        assert_eq!(absent.status, None);
    }

    #[test]
    fn properties_keep_fallbacks_and_owner_separate() {
        let info = parse_details("[ro.build.version.release]: [13]\r\n[ro.product.cpu.abi]: [arm64-v8a]\n[ro.boot.serialno]: [serial]\n[ro.soc.manufacturer]: [Vendor]\n[ro.soc.model]: [Chip]\n[ro.build.fingerprint]: [vendor/product/build:user/release-keys]\n", "", Some("com.test/.Admin".into()));
        assert_eq!(info.android, "13");
        assert_eq!(info.architecture, "arm64-v8a");
        assert_eq!(info.serial, "serial");
        assert_eq!(info.owner.as_deref(), Some("com.test/.Admin"));
        assert_eq!(info.system.soc, "Vendor Chip");
        assert_eq!(info.system.runtime.memory_total, None);
        assert_eq!(
            info.system.fingerprint,
            "vendor/product/build:user/release-keys"
        );
    }

    #[test]
    #[ignore = "需显式指定 ADM_INFO_SERIAL；仅执行信息读取，不改设备"]
    fn connected_device_read_only() {
        use crate::{adb::process::cancellation, adb::Adb};
        let serial = std::env::var("ADM_INFO_SERIAL").expect("缺少目标序列号");
        let adb = Adb::new(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources/platform-tools")
                .join(if cfg!(windows) { "adb.exe" } else { "adb" }),
            cancellation(),
        );
        let device = adb
            .devices()
            .unwrap()
            .into_iter()
            .find(|d| d.serial == serial && d.state == "device")
            .expect("目标未连接");
        let info = adb
            .details(&Target {
                serial: device.serial,
                transport_id: device.transport_id,
            })
            .unwrap();
        assert!(!info.android.is_empty());
        println!("ADM_INFO_JSON={}", serde_json::to_string(&info).unwrap());
    }
}
