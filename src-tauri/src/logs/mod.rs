//! Logcat 使用独立客户端与有界缓存，不占用安装/文件任务锁，也不清空设备日志。
use crate::{
    adb::process::{cancellation, Cancel},
    adb::Adb,
    models::{Result, Target},
    parsing::re,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{atomic::Ordering, Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

const MAX_ENTRIES: usize = 10_000;
const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_LINE: usize = 16 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    pub time: String,
    pub uid: String,
    pub pid: String,
    pub tid: String,
    pub level: String,
    pub tag: String,
    pub message: String,
    pub raw: String,
    pub crash: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBatch {
    entries: Vec<LogEntry>,
    first_id: u64,
    next_id: u64,
    dropped: u64,
    truncated: u64,
    running: bool,
    error: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogFilter {
    uid: String,
    level: String,
    keyword: String,
    crashes_only: bool,
}
impl LogFilter {
    fn validate(&self) -> Result<()> {
        if self.uid.len() > 32
            || !self
                .uid
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
            || !["V", "D", "I", "W", "E", "F"].contains(&self.level.as_str())
            || self.keyword.len() > 1024
        {
            return Err("日志筛选条件无效。".into());
        }
        Ok(())
    }
    fn matches(&self, entry: &LogEntry) -> bool {
        let rank = |s: &str| "VDIWEF".find(s).unwrap_or(0);
        (self.uid.is_empty() || self.uid == entry.uid)
            && rank(&entry.level) >= rank(&self.level)
            && (!self.crashes_only || entry.crash)
            && (self.keyword.is_empty()
                || entry
                    .raw
                    .to_lowercase()
                    .contains(&self.keyword.trim().to_lowercase()))
    }
}

/// 解析指定的 threadtime/year/uid 格式；缺失 UID 和未知行保留原文，不伪造应用归属。
fn parse_line(raw: &str) -> Option<LogEntry> {
    if raw.is_empty() || raw.starts_with("--------- ") {
        return None;
    }
    let mut entry = LogEntry {
        id: 0,
        time: String::new(),
        uid: String::new(),
        pid: String::new(),
        tid: String::new(),
        level: "?".into(),
        tag: String::new(),
        message: raw.into(),
        raw: raw.into(),
        crash: false,
    };
    static ROW: OnceLock<regex::Regex> = OnceLock::new();
    if let Some(m) = ROW.get_or_init(|| re(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(?:(\S+)\s+)?(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?): ?(.*)$")).captures(raw) {
        entry.time = m[1].into();
        entry.uid = m.get(2).map_or("", |v| v.as_str()).into();
        entry.pid = m[3].into(); entry.tid = m[4].into();
        entry.level = if &m[5] == "A" { "F".into() } else { m[5].into() };
        entry.tag = m[6].trim().into(); entry.message = m[7].into();
    }
    entry.crash = entry.level == "F"
        || (entry.tag == "AndroidRuntime" && entry.level == "E")
        || entry.message.contains("FATAL EXCEPTION:")
        || entry.message.contains("Fatal signal ")
        || entry.message.starts_with("ANR in ");
    Some(entry)
}

/// 将日志里的短账户名解析为设备 UID；每个名称只查一次，失败保留为空以明确无法归属。
fn numeric_uid(
    uid: &str,
    aliases: &mut HashMap<String, String>,
    mut resolve: impl FnMut(&str) -> Option<String>,
) -> String {
    if !uid.is_empty() && uid.bytes().all(|b| b.is_ascii_digit()) {
        return uid.into();
    }
    if uid.is_empty()
        || uid.len() > 5
        || !uid.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return String::new();
    }
    if let Some(value) = aliases.get(uid) {
        return value.clone();
    }
    if aliases.len() >= 64 {
        return String::new();
    }
    let value = resolve(uid)
        .and_then(|value| value.trim().parse::<u32>().ok())
        .map(|value| value.to_string())
        .unwrap_or_default();
    aliases.insert(uid.into(), value.clone());
    value
}

struct Buffer {
    entries: VecDeque<LogEntry>,
    bytes: usize,
    sequence: u64,
    dropped: u64,
    truncated: u64,
    running: bool,
    error: Option<String>,
    touched: Instant,
}
impl Buffer {
    fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            bytes: 0,
            sequence: 0,
            dropped: 0,
            truncated: 0,
            running: true,
            error: None,
            touched: Instant::now(),
        }
    }
    #[cfg(test)]
    fn push(&mut self, raw: &str, truncated: bool) {
        self.push_entry(parse_line(raw), truncated);
    }
    fn push_entry(&mut self, entry: Option<LogEntry>, truncated: bool) {
        if truncated {
            self.truncated += 1;
        }
        if let Some(mut entry) = entry {
            self.sequence += 1;
            entry.id = self.sequence;
            self.bytes += entry.raw.len();
            self.entries.push_back(entry);
            while self.entries.len() > MAX_ENTRIES || self.bytes > MAX_BYTES {
                if let Some(old) = self.entries.pop_front() {
                    self.bytes -= old.raw.len();
                    self.dropped += 1;
                }
            }
        }
    }
    fn batch(&mut self, after: u64) -> LogBatch {
        self.touched = Instant::now();
        let entries: Vec<_> = self
            .entries
            .iter()
            .filter(|e| e.id > after)
            .take(500)
            .cloned()
            .collect();
        let next_id = entries.last().map_or(after, |e| e.id);
        LogBatch {
            entries,
            first_id: self.entries.front().map_or(self.sequence + 1, |e| e.id),
            next_id,
            dropped: self.dropped,
            truncated: self.truncated,
            running: self.running || next_id < self.sequence,
            error: self.error.clone(),
        }
    }
}
struct Session {
    buffer: Arc<Mutex<Buffer>>,
    cancel: Cancel,
    worker: Option<thread::JoinHandle<()>>,
}
#[derive(Default)]
pub struct Logcat {
    sessions: Mutex<HashMap<String, Session>>,
}
impl Logcat {
    /// 校验目标传输会话后启动独立 Logcat；adb 提供路径与 UID 查询能力，返回用于轮询和停止的会话 ID。
    pub fn start(&self, adb: Adb, target: Target) -> Result<String> {
        adb.ensure_online(&target)?;
        let mut args = adb.target(&target)?;
        args.extend(
            [
                "logcat",
                "-b",
                "main,system,crash",
                "-v",
                "threadtime",
                "-v",
                "year",
                "-v",
                "uid",
                "-T",
                "500",
                "*:V",
            ]
            .map(str::to_string),
        );
        self.spawn(adb.executable.clone(), args, Some((adb, target)))
    }
    /// 启动客户端并持续排空输出，参数为程序、固定参数及可选设备 UID 解析器；返回有界缓存会话 ID。
    fn spawn(
        &self,
        executable: std::path::PathBuf,
        args: Vec<String>,
        resolver: Option<(Adb, Target)>,
    ) -> Result<String> {
        let mut sessions = self.sessions.lock().unwrap();
        // 页面异常关闭时由心跳回收；过期缓存不随重复进入页面无限累积。
        sessions.retain(|_, s| {
            let retain = s.buffer.lock().unwrap().touched.elapsed() < Duration::from_secs(60);
            if !retain {
                s.cancel.store(true, Ordering::SeqCst);
            }
            retain
        });
        if sessions.len() >= 4 {
            return Err("日志会话过多，请关闭旧日志页后重试。".into());
        }
        let mut command = Command::new(executable);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let child = crate::adb::child_process::spawn(&mut command)
            .map_err(|e| format!("无法启动 Logcat：{e}"))?;
        let out = child.stdout().unwrap();
        let err = child.stderr().unwrap();
        let buffer = Arc::new(Mutex::new(Buffer::new()));
        let cancel = cancellation();
        let id = uuid::Uuid::new_v4().to_string();
        sessions.insert(
            id.clone(),
            Session {
                buffer: buffer.clone(),
                cancel: cancel.clone(),
                worker: None,
            },
        );
        let worker = thread::spawn(move || {
            let stdout_buffer = buffer.clone();
            let lookup_cancel = cancel.clone();
            let stdout = thread::spawn(move || {
                let mut aliases = HashMap::new();
                let resolver = resolver.map(|(mut adb, target)| {
                    adb.cancel = lookup_cancel;
                    (adb, target)
                });
                read_lines(out, |line, cut| {
                    let mut entry = parse_line(line);
                    if let (Some(entry), Some((adb, target))) = (&mut entry, &resolver) {
                        // Android 的 id 不保证支持数字用户名；按日志账户名查数字 UID，并保留导出的原文。
                        entry.uid = numeric_uid(&entry.uid, &mut aliases, |name| {
                            let mut args = adb.target(target).ok()?;
                            args.extend(["shell", "id", "-u", name].map(str::to_string));
                            adb.cmd(args, 2000, None).ok()
                        });
                    }
                    stdout_buffer.lock().unwrap().push_entry(entry, cut);
                })
            });
            let stderr = thread::spawn(move || {
                let mut text = String::new();
                read_lines(err, |line, _| {
                    if text.len() < 8192 {
                        text.push_str(line);
                        text.push('\n');
                    }
                });
                text
            });
            let status = loop {
                if cancel.load(Ordering::SeqCst)
                    || buffer.lock().unwrap().touched.elapsed() >= Duration::from_secs(60)
                {
                    let _ = child.kill();
                    break child.wait();
                }
                match child.try_wait() {
                    Ok(Some(status)) => break Ok(status),
                    Err(error) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break Err(error);
                    }
                    _ => thread::sleep(Duration::from_millis(25)),
                }
            };
            let _ = stdout.join();
            let error = stderr.join().unwrap_or_default();
            let mut buffer = buffer.lock().unwrap();
            buffer.running = false;
            if !cancel.load(Ordering::SeqCst) {
                buffer.error = Some(if !error.trim().is_empty() {
                    error.trim().to_string()
                } else if let Err(e) = status {
                    format!("Logcat 读取失败：{e}")
                } else {
                    "Logcat 已结束，设备可能已断开；可重新开始读取。".into()
                });
            }
        });
        sessions.get_mut(&id).unwrap().worker = Some(worker);
        Ok(id)
    }
    pub fn read(&self, id: &str, after: u64) -> Result<LogBatch> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(id).ok_or("日志会话已结束，请重新开始读取。")?;
        let batch = session.buffer.lock().unwrap().batch(after);
        Ok(batch)
    }
    pub fn stop(&self, id: &str) {
        let session = self.sessions.lock().unwrap().remove(id);
        Self::finish(session.into_iter().collect());
    }
    pub fn stop_all(&self) {
        let sessions = self
            .sessions
            .lock()
            .unwrap()
            .drain()
            .map(|(_, s)| s)
            .collect();
        Self::finish(sessions);
    }
    /// 先取消全部会话，再有限等待读线程；不能只发出停止信号就让宿主退出。
    fn finish(sessions: Vec<Session>) {
        for session in &sessions {
            session.cancel.store(true, Ordering::SeqCst);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        for session in sessions {
            if let Some(worker) = session.worker {
                while !worker.is_finished() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(10));
                }
                if worker.is_finished() {
                    let _ = worker.join();
                } else {
                    eprintln!("ADM 日志读线程停止等待超时");
                }
            }
        }
    }
    /// 在打开保存对话框之前截取快照；后续新日志或筛选变化不改变本次导出内容。
    pub fn export(&self, id: &str, filter: LogFilter, through: u64) -> Result<String> {
        filter.validate()?;
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(id).ok_or("日志会话已结束，请重新开始读取。")?;
        let buffer = session.buffer.lock().unwrap();
        let text: String = buffer
            .entries
            .iter()
            .filter(|e| e.id <= through && filter.matches(e))
            .map(|e| format!("{}\n", e.raw))
            .collect();
        if text.is_empty() {
            return Err("当前筛选没有可导出的日志。".into());
        }
        Ok(text)
    }
}
impl Drop for Logcat {
    fn drop(&mut self) {
        self.stop_all();
    }
}

/// 分块读取并限制单行长度；超长行只截断显示，仍持续排空管道，避免阻塞设备客户端。
fn read_lines(mut reader: impl Read, mut receive: impl FnMut(&str, bool)) {
    let mut block = [0; 8192];
    let mut line = Vec::new();
    let mut cut = false;
    loop {
        let count = match reader.read(&mut block) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        for &byte in &block[..count] {
            if byte == b'\n' {
                let mut text = String::from_utf8_lossy(&line)
                    .trim_end_matches('\r')
                    .to_string();
                if cut {
                    text.push_str(" … [truncated]");
                }
                receive(&text, cut);
                line.clear();
                cut = false;
            } else if line.len() < MAX_LINE {
                line.push(byte);
            } else {
                cut = true;
            }
        }
    }
    if !line.is_empty() {
        let mut text = String::from_utf8_lossy(&line).into_owned();
        if cut {
            text.push_str(" … [truncated]");
        }
        receive(&text, cut);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogApp {
    package_name: String,
    label: Option<String>,
    uid: String,
}
impl Adb {
    pub fn logcat_apps(&self, target: &Target) -> Result<Vec<LogApp>> {
        let apps = self.list_apps(target)?;
        let output = self.shell(target, &["pm", "list", "packages", "-U", "--user", "0"])?;
        let uids: HashMap<_, _> = output
            .lines()
            .filter_map(|line| {
                let (package, uid) = line.strip_prefix("package:")?.split_once(" uid:")?;
                uid.trim()
                    .parse::<u32>()
                    .ok()
                    .map(|uid| (package.to_string(), uid))
            })
            .collect();
        self.ensure_online(target)?;
        Ok(apps
            .into_iter()
            .filter_map(|app| {
                let uid = uids.get(&app.package_name)?;
                Some(LogApp {
                    package_name: app.package_name,
                    label: app.label,
                    uid: uid.to_string(),
                })
            })
            .collect())
    }
}

pub fn save_export(path: &std::path::Path, text: &str) -> Result<()> {
    let parent = path.parent().ok_or("日志保存路径无效。")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path)
        .map_err(|e| format!("保存日志失败：{}", e.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(uid: &str, level: &str, tag: &str, text: &str) -> String {
        format!("2026-11-02 09:44:00.008 {uid} 555 556 {level} {tag}: {text}")
    }
    fn filter() -> LogFilter {
        LogFilter {
            uid: String::new(),
            level: "V".into(),
            keyword: String::new(),
            crashes_only: false,
        }
    }
    #[test]
    fn resolves_named_uids_once_without_losing_numeric_uids() {
        let mut aliases = HashMap::new();
        let mut calls = 0;
        for _ in 0..2 {
            assert_eq!(
                numeric_uid("shell", &mut aliases, |_| {
                    calls += 1;
                    Some("2000\n".into())
                }),
                "2000"
            );
        }
        assert_eq!(calls, 1);
        assert_eq!(
            numeric_uid("10123", &mut aliases, |_| panic!("数字 UID 无需查询")),
            "10123"
        );
        assert_eq!(
            numeric_uid("x;bad", &mut aliases, |_| panic!("无效名称不允许执行")),
            ""
        );
        assert_eq!(numeric_uid("nfc", &mut aliases, |_| None), "");
    }
    #[test]
    fn parses_uid_formats_and_preserves_unknown_text() {
        for uid in ["10123", "root", "radio", ""] {
            let text = line(uid, "D", "Test ", "冒号: 中文日志");
            let e = parse_line(&text).unwrap();
            assert_eq!(
                (e.uid.as_str(), e.pid.as_str(), e.tid.as_str()),
                (uid, "555", "556")
            );
            assert_eq!(e.tag, "Test");
            assert_eq!(e.message, "冒号: 中文日志");
            assert_eq!(e.raw, text);
        }
        assert!(parse_line("--------- beginning of main").is_none());
        assert_eq!(
            parse_line("unformatted line").unwrap().message,
            "unformatted line"
        );
    }
    #[test]
    fn highlights_crash_stacks_without_treating_every_error_as_crash() {
        for (level, tag, message) in [
            ("E", "AndroidRuntime", " at example.Main.run(Main.java:12)"),
            ("F", "DEBUG", "backtrace:"),
            ("A", "libc", "abort"),
            ("E", "libc", "Fatal signal 11 (SIGSEGV)"),
            ("E", "ActivityManager", "ANR in com.example"),
            ("E", "Test", "FATAL EXCEPTION: main"),
        ] {
            assert!(
                parse_line(&line("10001", level, tag, message))
                    .unwrap()
                    .crash
            );
        }
        assert!(
            !parse_line(&line("10001", "E", "Wifi", "Connection failed"))
                .unwrap()
                .crash
        );
    }
    #[test]
    fn combines_uid_priority_keyword_and_crash_filters() {
        let mut f = filter();
        f.uid = "10001".into();
        f.level = "W".into();
        f.keyword = " exception ".into();
        f.crashes_only = true;
        assert!(f.matches(
            &parse_line(&line(
                "10001",
                "E",
                "AndroidRuntime",
                "FATAL EXCEPTION: main"
            ))
            .unwrap()
        ));
        assert!(!f.matches(&parse_line(&line("10002", "F", "DEBUG", "exception")).unwrap()));
        assert!(!f.matches(&parse_line(&line("10001", "I", "Test", "exception")).unwrap()));
        f.uid = "10001;rm".into();
        assert!(f.validate().is_err());
    }
    #[test]
    fn bounds_cache_and_drains_batches_after_exit() {
        let mut b = Buffer::new();
        for _ in 0..10_020 {
            b.push("entry", false);
        }
        assert_eq!(b.entries.len(), MAX_ENTRIES);
        assert_eq!(b.dropped, 20);
        b.running = false;
        let batch = b.batch(0);
        assert_eq!(
            (batch.first_id, batch.next_id, batch.entries.len()),
            (21, 520, 500)
        );
        assert!(batch.running);
        assert!(!b.batch(10_020).running);
        let large = "x".repeat(MAX_LINE);
        for _ in 0..600 {
            b.push(&large, true);
        }
        assert!(b.bytes <= MAX_BYTES);
        assert!(b.entries.len() <= MAX_ENTRIES);
        assert_eq!(b.truncated, 600);
    }
    #[test]
    fn oversized_lines_do_not_block_following_records() {
        let text = format!("{}\n中文\r\nlast", "x".repeat(MAX_LINE + 500));
        let mut received = vec![];
        read_lines(text.as_bytes(), |s, cut| {
            received.push((s.to_string(), cut))
        });
        assert!(received[0].1);
        assert!(received[0].0.len() < MAX_LINE + 30);
        assert_eq!(received[1], ("中文".into(), false));
        assert_eq!(received[2], ("last".into(), false));
    }
    #[test]
    fn export_respects_snapshot_and_filter_and_saves_exact_text() {
        let logs = Logcat::default();
        let mut b = Buffer::new();
        b.push(&line("10001", "I", "Test", "one"), false);
        let expected = format!("{}\n", line("10001", "E", "Test", "two"));
        b.push(expected.trim_end(), false);
        b.push(&line("10001", "E", "Test", "newer"), false);
        logs.sessions.lock().unwrap().insert(
            "test".into(),
            Session {
                buffer: Arc::new(Mutex::new(b)),
                cancel: cancellation(),
                worker: None,
            },
        );
        let mut f = filter();
        f.level = "E".into();
        assert_eq!(logs.export("test", f.clone(), 2).unwrap(), expected);
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.log");
        save_export(&path, &expected).unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), expected);
        f.uid = "99999".into();
        assert!(logs.export("test", f, 3).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn continuous_process_streams_and_stop_reaps_client() {
        let logs = Logcat::default();
        let id = logs
            .spawn(
                "/bin/sh".into(),
                vec!["-c".into(), "printf 'first\\n'; exec sleep 30".into()],
                None,
            )
            .unwrap();
        let buffer = logs.sessions.lock().unwrap()[&id].buffer.clone();
        let deadline = Instant::now() + Duration::from_secs(3);
        while logs.read(&id, 0).unwrap().entries.is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(logs.read(&id, 0).unwrap().entries[0].raw, "first");
        logs.stop(&id);
        // stop 返回即完成客户端和读线程回收，不需要调用方再轮询等待。
        assert!(!buffer.lock().unwrap().running);
        assert!(logs.read(&id, 0).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn surfaces_stderr_when_client_exits() {
        let logs = Logcat::default();
        let id = logs
            .spawn(
                "/bin/sh".into(),
                vec!["-c".into(), "printf 'device offline' >&2; exit 1".into()],
                None,
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while logs.read(&id, 0).unwrap().running && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            logs.read(&id, 0).unwrap().error.as_deref(),
            Some("device offline")
        );
    }
    /// 仅在显式选定的模拟器读取真实 Logcat；不清空缓冲区、不写入日志、不安装应用。
    #[test]
    #[ignore = "需要 ADM_LOG_SERIAL，显式选择只读日志验收模拟器"]
    fn device_read_smoke() {
        let serial = std::env::var("ADM_LOG_SERIAL").unwrap();
        assert!(serial.starts_with("emulator-"));
        let adb = Adb::new(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources/platform-tools/adb"),
            cancellation(),
        );
        let device = adb
            .devices()
            .unwrap()
            .into_iter()
            .find(|d| d.serial == serial && d.state == "device")
            .unwrap();
        let target = Target {
            serial: device.serial,
            transport_id: device.transport_id,
        };
        let apps = adb.logcat_apps(&target).unwrap();
        assert!(apps
            .iter()
            .any(|a| a.package_name == "com.android.settings" && a.uid == "1000"));
        let logs = Logcat::default();
        let id = logs.start(adb, target).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while logs.read(&id, 0).unwrap().entries.is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        let batch = logs.read(&id, 0).unwrap();
        assert!(!batch.entries.is_empty(), "{:?}", batch.error);
        assert!(batch
            .entries
            .iter()
            .any(|e| !e.uid.is_empty() && !e.time.is_empty()));
        for entry in batch.entries.iter().filter(|e| e.raw.contains(" shell ")) {
            assert_eq!(entry.uid, "2000");
        }
        let text = logs.export(&id, filter(), batch.next_id).unwrap();
        assert!(!text.is_empty());
        println!(
            "通过：{serial}，{} 个应用 UID，{} 行真实日志，游标 {}，可导出 {} 字节",
            apps.len(),
            batch.entries.len(),
            batch.next_id,
            text.len()
        );
        logs.stop(&id);
        assert!(logs.read(&id, 0).is_err());
    }
}
