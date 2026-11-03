//! 每次连接拥有独立的服务端路径、端口转发与子进程，失败和退出只清理自己的资源。
use crate::{
    adb::{
        child_process::{self, Client},
        Adb,
    },
    models::{Result, Target},
    parsing::shell_arg,
};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{Shutdown, TcpStream},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

pub struct Transport {
    pub video: TcpStream,
    pub control: TcpStream,
    owner: Owner,
}
struct Owner {
    adb: Arc<Adb>,
    target: Target,
    remote: String,
    port: String,
    child: Option<Client>,
    pub log: Arc<Mutex<String>>,
}
impl Drop for Owner {
    fn drop(&mut self) {
        self.child.take();
        let mut args = self.adb.target(&self.target).unwrap_or_default();
        if !self.port.is_empty() {
            args.extend([
                "forward".into(),
                "--remove".into(),
                format!("tcp:{}", self.port),
            ]);
            let _ = self.adb.cmd(args, 2000, None);
        }
        let mut args = self.adb.target(&self.target).unwrap_or_default();
        args.extend(["shell".into(), format!("rm -f {}", shell_arg(&self.remote))]);
        let _ = self.adb.cmd(args, 2000, None);
    }
}
impl Transport {
    pub fn connect(adb: Arc<Adb>, target: Target, resources: &Path, max_size: u32) -> Result<Self> {
        adb.ensure_online(&target)?;
        let bundled = resources.join("scrcpy/scrcpy-server");
        let path = if bundled.is_file() || !cfg!(debug_assertions) {
            bundled
        } else {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/scrcpy/scrcpy-server")
        };
        let bytes = std::fs::read(&path).map_err(|e| format!("缺少设备控制服务端：{e}"))?;
        if format!("{:x}", Sha256::digest(&bytes))
            != "764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536"
        {
            return Err("设备控制服务端校验失败。".into());
        }
        let scid = (uuid::Uuid::new_v4().as_u128() as u32) & 0x7fff_ffff;
        let remote = format!("/data/local/tmp/adm-scrcpy-{scid:08x}.jar");
        let mut owner = Owner {
            adb: adb.clone(),
            target: target.clone(),
            remote: remote.clone(),
            port: String::new(),
            child: None,
            log: Arc::new(Mutex::new(String::new())),
        };
        let mut args = adb.target(&target)?;
        args.extend(["push".into(), path.to_string_lossy().into(), remote.clone()]);
        adb.cmd(args, 20000, None)?;
        let mut args = adb.target(&target)?;
        args.extend([
            "forward".into(),
            "tcp:0".into(),
            format!("localabstract:scrcpy_{scid:08x}"),
        ]);
        owner.port = adb.cmd(args, 5000, None)?.trim().into();
        let port = owner
            .port
            .parse::<u16>()
            .map_err(|_| "设备控制端口无效。")?;
        let mut command = Command::new(&adb.executable);
        command.args(adb.target(&target)?).arg("shell").arg(format!("CLASSPATH={} app_process / com.genymobile.scrcpy.Server 5.0.1 scid={scid:08x} log_level=debug tunnel_forward=true audio=false control=true video_codec=h264 max_size={max_size} max_fps=60 video_bit_rate=8000000 video_codec_options=i-frame-interval=1 clipboard_autosync=false send_device_meta=false cleanup=true",shell_arg(&remote)))
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let child = child_process::spawn(&mut command).map_err(|e| e.to_string())?;
        for pipe in [
            child.stdout().map(|p| Box::new(p) as Box<dyn Read + Send>),
            child.stderr().map(|p| Box::new(p) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        {
            let log = owner.log.clone();
            thread::spawn(move || {
                let mut pipe = pipe;
                let mut buf = [0; 1024];
                while let Ok(n) = pipe.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let mut text = log.lock().unwrap();
                    text.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if text.len() > 8192 {
                        let end = text
                            .char_indices()
                            .find(|(i, _)| *i >= 4096)
                            .map(|v| v.0)
                            .unwrap_or(text.len());
                        text.drain(..end);
                    }
                }
            });
        }
        owner.child = Some(child);
        let deadline = Instant::now() + Duration::from_secs(12);
        let mut video = loop {
            if let Ok(mut stream) = TcpStream::connect_timeout(
                &([127, 0, 0, 1], port).into(),
                Duration::from_millis(200),
            ) {
                let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
                if stream.read_exact(&mut [0u8; 1]).is_ok() {
                    break stream;
                }
            }
            if Instant::now() > deadline
                || owner
                    .child
                    .as_ref()
                    .unwrap()
                    .try_wait()
                    .map_err(|e| e.to_string())?
                    .is_some()
            {
                return Err(format!(
                    "无法启动设备控制：{}",
                    owner.log.lock().unwrap().trim()
                ));
            }
            thread::sleep(Duration::from_millis(80));
        };
        let control =
            TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2))
                .map_err(|e| e.to_string())?;
        control.set_nodelay(true).map_err(|e| e.to_string())?;
        control
            .set_write_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| e.to_string())?;
        video
            .set_read_timeout(Some(Duration::from_secs(3)))
            .map_err(|e| e.to_string())?;
        let mut codec = [0u8; 4];
        video.read_exact(&mut codec).map_err(|e| e.to_string())?;
        if &codec != b"h264" {
            return Err("设备没有提供 H.264 视频流。".into());
        }
        video
            .set_read_timeout(Some(Duration::from_millis(500)))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            video,
            control,
            owner,
        })
    }
    pub fn log(&self) -> String {
        self.owner.log.lock().unwrap().clone()
    }
}
impl Drop for Transport {
    fn drop(&mut self) {
        let _ = self.video.shutdown(Shutdown::Both);
        let _ = self.control.shutdown(Shutdown::Both);
    }
}

/// 超时只用于检查取消，不丢弃已读到的半包；断线与非法长度由上层终止会话。
pub fn read(stream: &mut TcpStream, mut data: &mut [u8], stop: &AtomicBool) -> Result<()> {
    while !data.is_empty() {
        if stop.load(Ordering::Relaxed) {
            return Err("设备控制已结束。".into());
        }
        match stream.read(data) {
            Ok(0) => return Err("设备控制连接已断开。".into()),
            Ok(n) => {
                data = &mut data[n..];
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}
pub fn write(stream: &mut TcpStream, data: &[u8]) -> Result<()> {
    stream.write_all(data).map_err(|e| e.to_string())
}
