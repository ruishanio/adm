//! 性能采样使用独立、可取消的只读会话，不占用安装与文件任务锁。
use crate::{
    adb::process::check_cancel,
    adb::Adb,
    devices::info::parse_runtime,
    models::{Result, Target},
    parsing::{re, shell_arg, valid_package},
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};

const SCRIPT: &str = r#"
printf '\n__ADM_uptime__\n'; cat /proc/uptime 2>/dev/null
printf '\n__ADM_stat__\n'; cat /proc/stat 2>/dev/null
printf '\n__ADM_frequency__\n'
for c in /sys/devices/system/cpu/cpu[0-9]*; do
  [ -d "$c" ] || continue
  f=$(cat "$c/cpufreq/scaling_cur_freq" 2>/dev/null)
  [ -n "$f" ] || f=$(cat "$c/cpufreq/cpuinfo_cur_freq" 2>/dev/null)
  o=$(cat "$c/online" 2>/dev/null)
  printf '%s %s %s\n' "${c##*/}" "${f:--}" "${o:--}"
done
printf '\n__ADM_memory__\n'; cat /proc/meminfo 2>/dev/null
printf '\n__ADM_network__\n'; cat /proc/net/dev 2>/dev/null
printf '\n__ADM_battery__\n'; dumpsys -t 2 battery 2>/dev/null
printf '\n__ADM_thermal__\n'; dumpsys -t 2 thermalservice 2>/dev/null
printf '\n__ADM_end__\n'
"#;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CpuCounter {
    name: String,
    total: Option<u64>,
    idle: Option<u64>,
    frequency_mhz: Option<f64>,
    online: Option<bool>,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NetworkCounter {
    name: String,
    received: u64,
    sent: u64,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FrameCounter {
    key: String,
    frames: u64,
    janky: u64,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSample {
    package_name: String,
    pss_bytes: Option<u64>,
    uptime_seconds: Option<f64>,
    frames: Vec<FrameCounter>,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    uptime_seconds: Option<f64>,
    cpus: Vec<CpuCounter>,
    memory_total: Option<u64>,
    memory_available: Option<u64>,
    swap_total: Option<u64>,
    swap_free: Option<u64>,
    networks: Vec<NetworkCounter>,
    battery_percent: Option<f64>,
    battery_temperature: Option<f64>,
    thermal_status: Option<u8>,
    app: Option<AppSample>,
}
fn section<'a>(text: &'a str, name: &str) -> &'a str {
    text.split_once(&format!("__ADM_{name}__\n"))
        .and_then(|(_, tail)| tail.split_once("\n__ADM_"))
        .map(|(v, _)| v.trim())
        .unwrap_or("")
}
fn finite(value: &str) -> Option<f64> {
    value
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v >= 0.0)
}
fn kb(text: &str, key: &str) -> Option<u64> {
    let m = re(&format!(r"(?m)^{}:\s+(\d+) kB\s*$", regex::escape(key))).captures(text)?;
    m[1].parse::<u64>().ok()?.checked_mul(1024)
}
/// 解析一次只读快照；权限不足或畸形数据使用 None，CPU 累计值由前端按两次样本求差。
fn parse_sample(raw: &str) -> Sample {
    let text = raw.replace('\r', "");
    let runtime = parse_runtime(&text);
    let mut cpus = BTreeMap::new();
    for line in section(&text, "stat").lines() {
        let mut fields = line.split_whitespace();
        let Some(name) = fields.next() else { continue };
        if name != "cpu"
            && !name
                .strip_prefix("cpu")
                .is_some_and(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
        {
            continue;
        }
        let values: Option<Vec<u64>> = fields.take(8).map(|v| v.parse().ok()).collect();
        if let Some(v) = values.filter(|v| v.len() >= 4) {
            // guest 已包含在 user/nice 中，不重复累计；iowait 作为非忙碌时间，回退由差值校验处理。
            let total = v.iter().try_fold(0u64, |s, v| s.checked_add(*v));
            let idle = v[3].checked_add(*v.get(4).unwrap_or(&0));
            cpus.insert(
                name.to_string(),
                CpuCounter {
                    name: name.into(),
                    total,
                    idle,
                    frequency_mhz: None,
                    online: Some(true),
                },
            );
        }
    }
    for line in section(&text, "frequency").lines() {
        let f: Vec<_> = line.split_whitespace().collect();
        if f.len() != 3 || !re(r"^cpu\d+$").is_match(f[0]) {
            continue;
        }
        let cpu = cpus.entry(f[0].into()).or_insert(CpuCounter {
            name: f[0].into(),
            total: None,
            idle: None,
            frequency_mhz: None,
            online: None,
        });
        // 部分模拟器返回 1 kHz 占位值；过滤小于 1 MHz 的无效读数，避免舍入成 0 MHz。
        cpu.frequency_mhz = finite(f[1])
            .filter(|v| *v >= 1000.0 && *v < 100_000_000.0)
            .map(|v| v / 1000.0);
        if f[2] == "0" {
            cpu.online = Some(false);
            cpu.total = None;
            cpu.idle = None;
            cpu.frequency_mhz = None;
        } else if f[2] == "1" {
            cpu.online = Some(true);
        }
    }
    let networks = section(&text, "network")
        .lines()
        .filter_map(|line| {
            let (name, rest) = line.split_once(':')?;
            let name = name.trim();
            if name == "lo" || name.len() > 64 || name.is_empty() {
                return None;
            }
            let f: Vec<_> = rest.split_whitespace().collect();
            if f.len() < 16 {
                return None;
            }
            Some(NetworkCounter {
                name: name.into(),
                received: f[0].parse().ok()?,
                sent: f[8].parse().ok()?,
            })
        })
        .collect();
    let memory = section(&text, "memory");
    let swap_total = kb(memory, "SwapTotal");
    let swap_free = kb(memory, "SwapFree").filter(|v| swap_total.is_some_and(|total| *v <= total));
    Sample {
        uptime_seconds: section(&text, "uptime")
            .split_whitespace()
            .next()
            .and_then(finite),
        cpus: cpus.into_values().collect(),
        memory_total: runtime.memory_total,
        memory_available: runtime.memory_available,
        swap_total,
        swap_free,
        networks,
        battery_percent: runtime.battery.percent,
        battery_temperature: runtime.battery.temperature,
        thermal_status: re(r"(?m)^Thermal Status:\s*(\d+)\s*$")
            .captures(section(&text, "thermal"))
            .and_then(|m| m[1].parse::<u8>().ok())
            .filter(|v| *v <= 6),
        app: None,
    }
}
/// HWUI 同时输出进程汇总与窗口统计；有窗口时仅取窗口，避免同一帧重复计数。
fn parse_frames(text: &str) -> Vec<FrameCounter> {
    let mut process = String::new();
    let mut window = None;
    let mut epoch = String::new();
    let mut total = None;
    let mut records: BTreeMap<String, (Vec<FrameCounter>, Vec<FrameCounter>)> = BTreeMap::new();
    let pid = re(r"^\*\* Graphics info for pid (\d+) \[");
    for line in text.lines().map(str::trim) {
        if let Some(m) = pid.captures(line) {
            process = m[1].into();
            window = None;
            epoch.clear();
            total = None;
        } else if let Some(name) = line.strip_prefix("Window: ") {
            window = Some(name.to_string());
            epoch.clear();
            total = None;
        } else if let Some(value) = line.strip_prefix("Stats since: ") {
            epoch = value.into();
            total = None;
        } else if let Some(value) = line.strip_prefix("Total frames rendered: ") {
            total = value.parse::<u64>().ok();
        } else if let Some(value) = line.strip_prefix("Janky frames: ") {
            if let (Some(frames), Some(janky)) = (
                total.take(),
                value
                    .split_whitespace()
                    .next()
                    .and_then(|v| v.parse::<u64>().ok()),
            ) {
                if process.is_empty() || epoch.is_empty() || janky > frames {
                    continue;
                }
                let counter = FrameCounter {
                    key: format!(
                        "{process}|{}|{epoch}",
                        window.as_deref().unwrap_or("process")
                    ),
                    frames,
                    janky,
                };
                let group = records.entry(process.clone()).or_default();
                if window.is_some() {
                    group.1.push(counter)
                } else {
                    group.0.push(counter)
                }
            }
        }
    }
    records
        .into_values()
        .flat_map(|(process, windows)| if windows.is_empty() { process } else { windows })
        .collect()
}
fn parse_app(package: &str, memory: &str, graphics: &str) -> AppSample {
    // 每个进程只读取一份 TOTAL，兼容不同 Android 版本的表格与摘要格式。
    let mut pss = None;
    for block in memory.split("** MEMINFO in pid ").skip(1) {
        let patterns = [
            r"(?m)^\s*TOTAL PSS:\s+(\d+)",
            r"(?m)^\s*TOTAL:\s+(\d+)",
            r"(?m)^\s*TOTAL\s+(\d+)",
        ];
        if let Some(value) = patterns
            .iter()
            .find_map(|p| re(p).captures(block).and_then(|m| m[1].parse::<u64>().ok()))
        {
            pss = pss.unwrap_or(0u64).checked_add(value);
        }
    }
    AppSample {
        package_name: package.into(),
        pss_bytes: pss.and_then(|v| v.checked_mul(1024)),
        uptime_seconds: re(r"(?m)^Uptime:\s+(\d+)")
            .captures(graphics)
            .and_then(|m| finite(&m[1]))
            .map(|v| v / 1000.0),
        frames: parse_frames(graphics),
    }
}
struct Session {
    adb: Adb,
    target: Target,
    busy: Mutex<()>,
    touched: Mutex<Instant>,
}
#[derive(Default)]
pub struct Performance {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}
impl Performance {
    /// 绑定目标 transport_id，返回只读采样会话；会话独立取消，不终止其他设备操作。
    pub fn start(&self, adb: Adb, target: Target) -> Result<String> {
        adb.ensure_online(&target)?;
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, s| {
            let keep = s.touched.lock().unwrap().elapsed() < Duration::from_secs(60);
            if !keep {
                s.adb.cancel.store(true, Ordering::SeqCst);
            }
            keep
        });
        if sessions.len() >= 4 {
            return Err("性能监控会话过多，请关闭旧页面后重试。".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        sessions.insert(
            id.clone(),
            Arc::new(Session {
                adb,
                target,
                busy: Mutex::new(()),
                touched: Mutex::new(Instant::now()),
            }),
        );
        Ok(id)
    }
    /// 采集系统及可选应用快照；包名验证、单会话互斥和超时限制避免重叠请求与命令注入。
    pub fn sample(&self, id: &str, package: &str) -> Result<Sample> {
        if !package.is_empty() && (package.len() > 255 || !valid_package(package)) {
            return Err("应用包名格式不正确。".into());
        }
        let session = self
            .sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or("性能监控已结束，请重新开始。")?;
        let _busy = session
            .busy
            .try_lock()
            .map_err(|_| "上一轮性能采样尚未完成。")?;
        *session.touched.lock().unwrap() = Instant::now();
        let command = |args: &[&str], timeout| {
            let mut full = session.adb.target(&session.target)?;
            full.push("shell".into());
            full.extend(args.iter().map(|s| shell_arg(s)));
            session.adb.cmd(full, timeout, None)
        };
        let raw = command(&["sh", "-c", SCRIPT], 6500)?;
        if !raw.contains("__ADM_end__") {
            return Err("性能采样未完成，请重试。".into());
        }
        let mut sample = parse_sample(&raw);
        if !package.is_empty() {
            let memory =
                command(&["dumpsys", "-t", "2", "meminfo", package], 3000).unwrap_or_default();
            check_cancel(&session.adb.cancel)?;
            let graphics =
                command(&["dumpsys", "-t", "2", "gfxinfo", package], 3000).unwrap_or_default();
            sample.app = Some(parse_app(package, &memory, &graphics));
        }
        check_cancel(&session.adb.cancel)?;
        Ok(sample)
    }
    pub fn stop(&self, id: &str) {
        if let Some(s) = self.sessions.lock().unwrap().remove(id) {
            s.adb.cancel.store(true, Ordering::SeqCst);
        }
    }
    pub fn stop_all(&self) {
        for (_, s) in self.sessions.lock().unwrap().drain() {
            s.adb.cancel.store(true, Ordering::SeqCst);
        }
    }
}
impl Drop for Performance {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adb::process::{cancellation, Cancel, Output, Runner};
    use std::path::Path;
    const SNAPSHOT: &str = "\n__ADM_uptime__\n100.5 400\n__ADM_stat__\ncpu 10 2 3 80 5 0 0 0 9 1\ncpu0 10 2 3 80 5 0 0 0\n__ADM_frequency__\ncpu0 1800000 1\ncpu1 - 0\n__ADM_memory__\nMemTotal: 4096 kB\nMemAvailable: 1024 kB\nSwapTotal: 256 kB\nSwapFree: 0 kB\n__ADM_network__\nwlan0: 1000 1 0 0 0 0 0 0 500 1 0 0 0 0 0 0\nlo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n__ADM_battery__\npresent: true\nlevel: 0\nscale: 100\ntemperature: 0\n__ADM_thermal__\nThermal Status: 2\n__ADM_end__\n";
    #[test]
    fn parses_counters_units_and_offline_cores_without_guest_double_counting() {
        let s = parse_sample(SNAPSHOT);
        assert_eq!(s.uptime_seconds, Some(100.5));
        assert_eq!((s.cpus[0].total, s.cpus[0].idle), (Some(100), Some(85)));
        assert_eq!(s.cpus[1].frequency_mhz, Some(1800.0));
        assert_eq!((s.cpus[2].online, s.cpus[2].total), (Some(false), None));
        assert_eq!(s.memory_total, Some(4096 * 1024));
        assert_eq!(s.swap_free, Some(0));
        assert_eq!(s.networks.len(), 1);
        assert_eq!(s.networks[0].received, 1000);
        assert_eq!(s.networks[0].sent, 500);
        assert_eq!(s.battery_percent, Some(0.0));
        assert_eq!(s.battery_temperature, Some(0.0));
        assert_eq!(s.thermal_status, Some(2));
    }
    #[test]
    fn unavailable_or_invalid_fields_remain_missing() {
        let s = parse_sample("__ADM_stat__\ncpu 1 2 invalid 4\n__ADM_memory__\nMemTotal: 100 kB\nMemAvailable: 101 kB\n__ADM_end__\n");
        assert!(s.cpus.is_empty());
        assert_eq!(s.memory_available, None);
        assert_eq!(s.uptime_seconds, None);
        assert_eq!(s.battery_temperature, None);
        let emulator = parse_sample("__ADM_frequency__\ncpu0 1 1\n__ADM_end__\n");
        assert_eq!(emulator.cpus[0].frequency_mhz, None);
    }
    #[test]
    fn graphics_uses_windows_instead_of_counting_process_summary_twice() {
        let text = "** Graphics info for pid 23 [com.test.app] **\nStats since: 100ns\nTotal frames rendered: 200\nJanky frames: 50 (25%)\nWindow: Main\nStats since: 200ns\nTotal frames rendered: 80\nJanky frames: 8 (10%)\nWindow: Dialog\nStats since: 201ns\nTotal frames rendered: 20\nJanky frames: 1 (5%)\n** Graphics info for pid 24 [com.test.app:remote] **\nStats since: 300ns\nTotal frames rendered: 10\nJanky frames: 2 (20%)";
        let frames = parse_frames(text);
        assert_eq!(frames.len(), 3);
        assert_eq!(frames.iter().map(|f| f.frames).sum::<u64>(), 110);
        assert_eq!(frames[0].key, "23|Main|200ns");
        assert!(parse_frames("No process found").is_empty());
    }
    #[test]
    fn pss_handles_android_versions_and_does_not_sum_duplicate_totals() {
        let mem = "** MEMINFO in pid 23 [com.test.app] **\n TOTAL 100 20 0\n TOTAL: 100 TOTAL SWAP (KB): 5\n** MEMINFO in pid 24 [com.test.app:remote] **\n TOTAL PSS: 20 TOTAL RSS: 30\n";
        assert_eq!(
            parse_app("com.test.app", mem, "Uptime: 1500 Realtime: 1600").pss_bytes,
            Some(120 * 1024)
        );
        assert_eq!(
            parse_app("com.test.app", "", "Uptime: 1500 Realtime: 1600").uptime_seconds,
            Some(1.5)
        );
        assert_eq!(
            parse_app("com.test.app", "No process found", "").pss_bytes,
            None
        );
    }
    struct Fake(Mutex<Vec<Vec<String>>>);
    impl Runner for Fake {
        fn run(
            &self,
            _: &Path,
            args: &[String],
            cancel: &Cancel,
            _: u64,
            _: Option<&str>,
        ) -> Result<Output> {
            check_cancel(cancel)?;
            self.0.lock().unwrap().push(args.to_vec());
            Ok(Output {
                stdout: if args[0] == "devices" {
                    "emulator-5570 device transport_id:42".into()
                } else {
                    SNAPSHOT.into()
                },
                stderr: String::new(),
                code: 0,
            })
        }
    }
    #[test]
    fn session_binds_transport_rejects_injection_and_stops_independently() {
        let fake = Arc::new(Fake(Mutex::new(vec![])));
        let cancel = cancellation();
        let adb = Adb {
            executable: "adb".into(),
            runner: fake.clone(),
            cancel: cancel.clone(),
        };
        let perf = Performance::default();
        let id = perf
            .start(
                adb,
                Target {
                    serial: "emulator-5570".into(),
                    transport_id: "42".into(),
                },
            )
            .unwrap();
        assert!(perf.sample(&id, "com.test;reboot").is_err());
        assert_eq!(fake.0.lock().unwrap().len(), 1);
        let sample = perf.sample(&id, "").unwrap();
        assert_eq!(sample.memory_available, Some(1024 * 1024));
        assert_eq!(&fake.0.lock().unwrap()[1][..3], &["-t", "42", "shell"]);
        perf.stop(&id);
        assert!(cancel.load(Ordering::SeqCst));
        assert!(perf.sample(&id, "").is_err());
    }
    #[test]
    #[ignore = "需要 ADM_PERF_SERIAL，仅在指定模拟器读取性能信息"]
    fn device_sample_read_only() {
        let serial = std::env::var("ADM_PERF_SERIAL").unwrap();
        assert!(serial.starts_with("emulator-"));
        let adb = Adb::new(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources/platform-tools/adb"),
            cancellation(),
        );
        let d = adb
            .devices()
            .unwrap()
            .into_iter()
            .find(|d| d.serial == serial && d.state == "device")
            .unwrap();
        let perf = Performance::default();
        let id = perf
            .start(
                adb,
                Target {
                    serial: d.serial,
                    transport_id: d.transport_id,
                },
            )
            .unwrap();
        let first = perf.sample(&id, "com.android.launcher3").unwrap();
        assert!(first.uptime_seconds.unwrap() > 0.0);
        assert!(first.memory_total.unwrap() > 0);
        let second = perf.sample(&id, "").unwrap();
        assert!(second.uptime_seconds.unwrap() >= first.uptime_seconds.unwrap());
        println!("{}", serde_json::to_string(&first).unwrap());
        perf.stop(&id);
    }
}
