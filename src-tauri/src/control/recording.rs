//! H.264 原码流写入 MP4，不重复编码；临时文件仅在索引完整写入后替换用户选择的文件。
use super::protocol::nals;
use crate::models::Result;
use mp4::{AvcConfig, Mp4Config, Mp4Sample, Mp4Writer, TrackConfig};
use std::{
    fs::File,
    path::{Path, PathBuf},
};

pub struct Recording {
    writer: Mp4Writer<File>,
    temporary: tempfile::NamedTempFile,
    destination: PathBuf,
    pending: Option<Mp4Sample>,
    first_pts: Option<u64>,
    started: Option<std::time::Instant>,
}
impl Recording {
    pub fn new(path: &Path, size: (u32, u32), config: &[u8]) -> Result<Self> {
        let units = nals(config);
        let sps = units
            .iter()
            .find(|n| n[0] & 31 == 7)
            .ok_or("尚未收到视频配置，请稍后重试。")?;
        let pps = units
            .iter()
            .find(|n| n[0] & 31 == 8)
            .ok_or("尚未收到视频配置，请稍后重试。")?;
        if sps.len() < 4 || size.0 > u16::MAX as u32 || size.1 > u16::MAX as u32 {
            return Err("视频配置无效。".into());
        }
        let temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("保存路径无效。")?)
            .map_err(|e| e.to_string())?;
        let file = temporary.reopen().map_err(|e| e.to_string())?;
        let mut writer = Mp4Writer::write_start(
            file,
            &Mp4Config {
                major_brand: "isom".parse().unwrap(),
                minor_version: 512,
                compatible_brands: vec![
                    "isom".parse().unwrap(),
                    "iso2".parse().unwrap(),
                    "avc1".parse().unwrap(),
                    "mp41".parse().unwrap(),
                ],
                timescale: 1_000_000,
            },
        )
        .map_err(|e| e.to_string())?;
        let mut track = TrackConfig::from(AvcConfig {
            width: size.0 as u16,
            height: size.1 as u16,
            seq_param_set: sps.to_vec(),
            pic_param_set: pps.to_vec(),
        });
        track.timescale = 1_000_000;
        writer.add_track(&track).map_err(|e| e.to_string())?;
        Ok(Self {
            writer,
            temporary,
            destination: path.into(),
            pending: None,
            first_pts: None,
            started: None,
        })
    }
    /// 首个关键帧之前不写入；MP4 使用长度前缀 NAL，时间戳相对录制起点归零。
    pub fn packet(&mut self, pts: u64, key: bool, data: &[u8]) -> Result<()> {
        if self.first_pts.is_none() && !key {
            return Ok(());
        }
        self.started.get_or_insert_with(std::time::Instant::now);
        let start = *self.first_pts.get_or_insert(pts);
        let time = pts.saturating_sub(start);
        if let Some(mut previous) = self.pending.take() {
            previous.duration = time
                .saturating_sub(previous.start_time)
                .clamp(1, u32::MAX as u64) as u32;
            self.writer
                .write_sample(1, &previous)
                .map_err(|e| e.to_string())?;
        }
        let mut bytes = Vec::new();
        for nal in nals(data) {
            bytes.extend((nal.len() as u32).to_be_bytes());
            bytes.extend(nal);
        }
        self.pending = Some(Mp4Sample {
            start_time: time,
            duration: 33_333,
            rendering_offset: 0,
            is_sync: key,
            bytes: bytes.into(),
        });
        Ok(())
    }
    pub fn finish(mut self) -> Result<String> {
        let mut last = self
            .pending
            .take()
            .ok_or("录制未收到关键帧，没有生成文件。")?;
        // 静止画面可能没有新编码包，末帧应保持至点击结束的时间。
        let elapsed = self
            .started
            .map(|t| t.elapsed().as_micros() as u64)
            .unwrap_or(0);
        last.duration = elapsed
            .saturating_sub(last.start_time)
            .clamp(33_333, u32::MAX as u64) as u32;
        self.writer
            .write_sample(1, &last)
            .map_err(|e| e.to_string())?;
        self.writer.write_end().map_err(|e| e.to_string())?;
        self.writer
            .into_writer()
            .sync_all()
            .map_err(|e| e.to_string())?;
        self.temporary
            .persist(&self.destination)
            .map_err(|e| e.to_string())?;
        Ok(self
            .destination
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into())
    }
}
