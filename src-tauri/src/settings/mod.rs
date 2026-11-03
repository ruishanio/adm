use crate::models::*;
use std::{fs, io::Write, path::PathBuf};
pub struct SettingsStore {
    pub value: Settings,
    pub path: PathBuf,
}
impl SettingsStore {
    pub fn load(path: PathBuf, legacy: &[PathBuf]) -> Self {
        let value = std::iter::once(&path)
            .chain(legacy.iter())
            .find(|p| p.is_file())
            .and_then(|p| fs::read(p).ok())
            .and_then(|s| serde_json::from_slice::<Settings>(&s).ok())
            .unwrap_or_default();
        let mut store = Self { value, path };
        store.value.sidebar_width = store.value.sidebar_width.clamp(220., 3000.);
        // 空值交由前端首次识别并保存；迁移旧版 system 时不丢弃设备备注等偏好。
        if !crate::platform::i18n::is_supported(&store.value.language) {
            store.value.language.clear();
        }
        store
    }
    pub fn save(&mut self, next: Settings) -> Result<()> {
        let parent = self.path.parent().ok_or("配置路径无效")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        // 同目录临时文件原子替换，写入失败不破坏已有偏好；兼容 Windows 的覆盖语义。
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temporary
            .write_all(&serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary.persist(&self.path).map_err(|e| e.to_string())?;
        self.value = next;
        Ok(())
    }
}
pub fn data_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Android Tool/settings.json")
}
