//! Rust 控制会话：有界视频投递、输入转发、录制与设备生命周期。
pub(crate) mod protocol;
mod recording;
#[cfg(test)]
mod tests;
mod transport;
use crate::{
    adb::{child_process, Adb},
    models::{Result, Target},
};
use protocol::{CONFIG, KEY, MAX_PACKET, SESSION};
use recording::Recording;
use serde::Serialize;
use std::{
    io::Read,
    net::{Shutdown, TcpStream},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::ipc::{Channel, Response};

/// 校验编译时锁定的服务端摘要，安装包自检和启动连接使用同一份清单。
pub(crate) fn verify_server(bytes: &[u8]) -> Result<()> {
    use sha2::{Digest, Sha256};
    #[derive(serde::Deserialize)]
    struct Manifest {
        sha256: String,
    }
    let manifest: Manifest =
        serde_json::from_str(include_str!("../../resources/scrcpy/version.json"))
            .map_err(|e| e.to_string())?;
    if format!("{:x}", Sha256::digest(bytes)) != manifest.sha256 {
        return Err("设备控制服务端校验失败。".into());
    }
    Ok(())
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub width: u32,
    pub height: u32,
    pub error: String,
    pub compatibility: bool,
    pub recording: bool,
    pub recording_notice: String,
}
pub struct Session {
    id: String,
    adb: Arc<Adb>,
    target: Target,
    stop: AtomicBool,
    ack: AtomicU64,
    pub status: Mutex<Status>,
    socket: Mutex<TcpStream>,
    config: Mutex<Vec<u8>>,
    recording: Mutex<Option<Recording>>,
    pending_recording: Mutex<Option<std::path::PathBuf>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}
#[derive(Default)]
pub struct Control {
    active: Mutex<Option<Arc<Session>>>,
    compatible: Arc<Mutex<Vec<Target>>>,
}
impl Control {
    /// 为 target 建立独占控制会话；max_size 限制长边，channel 传送码流，成功返回会话 ID。
    pub fn start(
        &self,
        adb: Adb,
        target: Target,
        resources: &Path,
        max_size: u32,
        channel: Channel<Response>,
    ) -> Result<String> {
        if ![720, 1080, 1600, 1920].contains(&max_size) {
            return Err("视频清晰度参数无效。".into());
        }
        let mut slot = self.active.lock().unwrap();
        if let Some(old) = slot.take() {
            old.close();
        }
        let adb = Arc::new(adb);
        let known = self.compatible.clone();
        let prefer_compatibility = known.lock().unwrap().contains(&target);
        let transport = transport::Transport::connect(
            adb.clone(),
            target.clone(),
            resources,
            max_size,
            prefer_compatibility,
        )?;
        let socket = transport.control.try_clone().map_err(|e| e.to_string())?;
        // 控制通道的剪贴板回执必须持续排空，否则设备端发送队列会阻塞。
        let mut replies = transport.control.try_clone().map_err(|e| e.to_string())?;
        thread::spawn(move || {
            let mut bytes = [0; 4096];
            while let Ok(n) = replies.read(&mut bytes) {
                if n == 0 {
                    break;
                }
            }
        });
        let session = Arc::new(Session {
            id: uuid::Uuid::new_v4().to_string(),
            adb,
            target,
            stop: AtomicBool::new(false),
            ack: AtomicU64::new(0),
            status: Mutex::new(Status {
                running: true,
                ..Default::default()
            }),
            socket: Mutex::new(socket),
            config: Mutex::new(vec![]),
            recording: Mutex::new(None),
            pending_recording: Mutex::new(None),
            worker: Mutex::new(None),
        });
        let worker = session.clone();
        *session.worker.lock().unwrap() = Some(thread::spawn(move || {
            let mut transport = transport;
            let result = worker.stream(&mut transport.video, channel, &known);
            worker.finish_recording("连接结束，录像已保存");
            let mut status = worker.status.lock().unwrap();
            status.running = false;
            if !worker.stop.load(Ordering::Relaxed) {
                if !status.compatibility && transport.log().contains("Capture/encoding error") {
                    status.error =
                        "设备视频编码器无法启动，请降低清晰度，或更新设备/模拟器系统后重试。"
                            .into();
                    return;
                }
                status.error = format!(
                    "{} {}",
                    result.err().unwrap_or_default(),
                    transport
                        .log()
                        .lines()
                        .find(|line| line.contains("ERROR"))
                        .unwrap_or("")
                );
            }
        }));
        let id = session.id.clone();
        *slot = Some(session);
        Ok(id)
    }
    pub fn get(&self, id: &str) -> Result<Arc<Session>> {
        self.active
            .lock()
            .unwrap()
            .as_ref()
            .filter(|s| s.id == id)
            .cloned()
            .ok_or_else(|| "设备控制会话已失效。".into())
    }
    pub fn stop(&self, id: &str) {
        let mut slot = self.active.lock().unwrap();
        if slot.as_ref().is_some_and(|s| s.id == id) {
            if let Some(s) = slot.take() {
                s.close();
            }
        }
    }
    pub(crate) fn is_recording(&self) -> bool {
        self.active
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|session| session.snapshot().recording)
    }
    pub fn stop_all(&self) {
        if let Some(s) = self.active.lock().unwrap().take() {
            s.close();
        }
    }
}
impl Drop for Control {
    fn drop(&mut self) {
        self.stop_all();
    }
}
impl Session {
    fn close(&self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.socket.lock().unwrap().shutdown(Shutdown::Both);
        if let Some(worker) = self.worker.lock().unwrap().take() {
            let _ = worker.join();
        }
    }
    pub fn snapshot(&self) -> Status {
        self.status.lock().unwrap().clone()
    }
    pub fn acknowledge(&self, seq: u64) {
        self.ack.fetch_max(seq, Ordering::Relaxed);
    }
    pub fn input(&self, input: protocol::Input) -> Result<()> {
        let status = self.snapshot();
        if !status.running || self.stop.load(Ordering::Relaxed) {
            return Err("设备控制连接已结束。".into());
        }
        let bytes = protocol::encode(&input, (status.width, status.height))?;
        transport::write(&mut self.socket.lock().unwrap(), &bytes)
    }
    fn finish_recording(&self, reason: &str) {
        if self.pending_recording.lock().unwrap().take().is_some() {
            let mut status = self.status.lock().unwrap();
            status.recording = false;
            status.recording_notice = "录制未收到画面，没有生成文件。".into();
        }
        if let Some(recording) = self.recording.lock().unwrap().take() {
            let result = recording.finish();
            let mut status = self.status.lock().unwrap();
            status.recording = false;
            status.recording_notice = match result {
                Ok(name) => format!("{reason}：{name}"),
                Err(e) => format!("录像保存失败：{e}"),
            };
        }
    }
    pub fn record(&self, path: &Path) -> Result<()> {
        self.adb.ensure_online(&self.target)?;
        let mut pending = self.pending_recording.lock().unwrap();
        let mut status = self.status.lock().unwrap();
        if status.recording {
            return Err("正在录像。".into());
        }
        if !status.running {
            return Err("设备控制连接已结束。".into());
        }
        // 重置编码器取得新的关键帧，静止画面也能立即开始录制，避免等待下一次屏幕变化。
        tempfile::NamedTempFile::new_in(path.parent().ok_or("保存路径无效。")?)
            .map_err(|e| e.to_string())?;
        transport::write(&mut self.socket.lock().unwrap(), &[17])?;
        *pending = Some(path.to_path_buf());
        status.recording = true;
        status.recording_notice.clear();
        Ok(())
    }
    pub fn stop_recording(&self) -> Status {
        self.finish_recording("录像已保存");
        self.snapshot()
    }
    /// 从 video 读取分包并经 channel 投递；错误交给会话线程清理，录制始终接收完整码流。
    /// 容量上限为四个未确认 IPC 消息；拥堵后丢弃到下个关键帧。
    fn stream(
        &self,
        video: &mut TcpStream,
        channel: Channel<Response>,
        known: &Mutex<Vec<Target>>,
    ) -> Result<()> {
        let mut remembered = false;
        let mut seq = 0u64;
        let mut resync = true;
        loop {
            let mut header = [0u8; 12];
            transport::read(video, &mut header, &self.stop)?;
            let flags = u64::from_be_bytes(header[..8].try_into().unwrap());
            if flags & SESSION != 0 {
                let width = u32::from_be_bytes(header[4..8].try_into().unwrap());
                let height = u32::from_be_bytes(header[8..12].try_into().unwrap());
                if width == 0 || height == 0 || width > 8192 || height > 8192 {
                    return Err("设备返回了无效画面尺寸。".into());
                }
                if self.pending_recording.lock().unwrap().is_none() {
                    self.finish_recording("画面方向或尺寸变化，已结束并保存录像");
                }
                {
                    let mut s = self.status.lock().unwrap();
                    s.compatibility = flags & protocol::SESSION_COMPATIBILITY != 0;
                    s.width = width;
                    s.height = height;
                }
                self.config.lock().unwrap().clear();
                resync = true;
                continue;
            }
            let size = u32::from_be_bytes(header[8..12].try_into().unwrap()) as usize;
            if size == 0 || size > MAX_PACKET {
                return Err("设备返回了无效视频包。".into());
            }
            let mut data = vec![0; size];
            transport::read(video, &mut data, &self.stop)?;
            let config = flags & CONFIG != 0;
            let key = flags & KEY != 0;
            let pts = flags & !(SESSION | CONFIG | KEY);
            if config {
                if let Some(path) = self.pending_recording.lock().unwrap().take() {
                    let status = self.snapshot();
                    match Recording::new(&path, (status.width, status.height), &data) {
                        Ok(recording) => *self.recording.lock().unwrap() = Some(recording),
                        Err(error) => {
                            let mut status = self.status.lock().unwrap();
                            status.recording = false;
                            status.recording_notice = format!("录像保存失败：{error}");
                        }
                    }
                }
                *self.config.lock().unwrap() = data;
                resync = true;
                continue;
            }
            let record_error = {
                let mut recording = self.recording.lock().unwrap();
                recording
                    .as_mut()
                    .and_then(|r| r.packet(pts, key, &data).err())
            };
            if let Some(error) = record_error {
                self.finish_recording(&format!("录像中断（{error}），已保存已接收部分"));
            }
            if seq.saturating_sub(self.ack.load(Ordering::Relaxed)) >= 4 {
                resync = true;
                continue;
            }
            if resync && !key {
                continue;
            }
            let cached = if key {
                self.config.lock().unwrap().clone()
            } else {
                vec![]
            };
            let status = self.snapshot();
            // 收到参数集和关键帧后才记住模式。设备重新建立 ADB transport 后重新探测。
            if status.compatibility && key && !cached.is_empty() && !remembered {
                let mut devices = known.lock().unwrap();
                if !devices.contains(&self.target) {
                    if devices.len() >= 32 {
                        devices.remove(0);
                    }
                    devices.push(self.target.clone());
                }
                remembered = true;
            }
            seq += 1;
            // 固定 32 字节头：序号、时间戳、尺寸、关键帧标志、配置长度，其后为 Annex B 数据。
            let mut packet = Vec::with_capacity(32 + cached.len() + data.len());
            packet.extend(seq.to_be_bytes());
            packet.extend(pts.to_be_bytes());
            packet.extend(status.width.to_be_bytes());
            packet.extend(status.height.to_be_bytes());
            packet.extend(u32::from(key).to_be_bytes());
            packet.extend((cached.len() as u32).to_be_bytes());
            packet.extend(cached);
            packet.extend(data);
            channel
                .send(Response::new(packet))
                .map_err(|e| e.to_string())?;
            resync = false;
        }
    }
    pub fn screenshot(&self, path: &Path) -> Result<()> {
        self.adb.ensure_online(&self.target)?;
        let file = tempfile::NamedTempFile::new_in(path.parent().ok_or("保存路径无效。")?)
            .map_err(|e| e.to_string())?;
        let mut command = Command::new(&self.adb.executable);
        command
            .args(self.adb.target(&self.target)?)
            .args(["exec-out", "screencap", "-p"])
            .stdin(Stdio::null())
            .stdout(Stdio::from(file.reopen().map_err(|e| e.to_string())?))
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let child = child_process::spawn(&mut command).map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                if !status.success() {
                    return Err("设备截图失败。".into());
                }
                break;
            }
            if Instant::now() > deadline || self.stop.load(Ordering::Relaxed) {
                return Err("截图已取消或超时。".into());
            }
            thread::sleep(Duration::from_millis(20));
        }
        let mut signature = [0; 8];
        file.reopen()
            .map_err(|e| e.to_string())?
            .read_exact(&mut signature)
            .map_err(|e| e.to_string())?;
        if signature != [137, 80, 78, 71, 13, 10, 26, 10] {
            return Err("设备未返回有效 PNG 截图。".into());
        }
        file.persist(path).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn power(&self, action: &str, consent: bool) -> Result<()> {
        if !consent || !["reboot", "shutdown"].contains(&action) {
            return Err("请确认设备电源操作。".into());
        }
        self.adb.ensure_online(&self.target)?;
        if action == "shutdown" {
            self.adb.shell(&self.target, &["reboot", "-p"])?;
        } else {
            let mut args = self.adb.target(&self.target)?;
            args.push("reboot".into());
            self.adb.cmd(args, 5000, None)?;
        }
        Ok(())
    }
}
