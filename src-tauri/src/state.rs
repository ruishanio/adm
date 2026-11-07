//! 应用服务的共享状态、串行任务和退出回收；各领域命令不自行创建第二套任务锁。
use crate::{
    adb,
    adb::process::{cancellation, Cancel},
    apps::apk,
    control, logs,
    models::*,
    performance, settings,
};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{atomic::Ordering, Mutex},
};
pub(crate) struct AppState {
    pub(crate) store: Mutex<settings::SettingsStore>,
    pub(crate) devices: Mutex<Vec<Device>>,
    pub(crate) apk: Mutex<Option<apk::ApkRecord>>,
    pub(crate) active: Mutex<Option<Cancel>>,
    pub(crate) drops: Mutex<HashSet<PathBuf>>,
    pub(crate) resources: PathBuf,
    pub(crate) control: control::Control,
    pub(crate) logs: logs::Logcat,
    pub(crate) performance: performance::Performance,
}
pub(crate) struct Operation<'a>(&'a AppState, pub(crate) Cancel);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        *self.0.active.lock().unwrap() = None;
    }
}
impl AppState {
    /// 列表偏好应用到这台设备当前已核实的各条网络连接；未知标识只修改自身。
    pub(crate) fn device_serials(&self, serial: &str) -> Vec<String> {
        let devices = self.devices.lock().unwrap();
        let identity = devices
            .iter()
            .find(|d| d.serial == serial)
            .and_then(|d| d.network_boot_id.as_ref());
        match identity {
            Some(id) => devices
                .iter()
                .filter(|d| d.network_boot_id.as_ref() == Some(id))
                .map(|d| d.serial.clone())
                .collect(),
            None => vec![serial.to_owned()],
        }
    }

    /// 在打开原生对话框前取当前语言，避免持有设置锁等待用户操作。
    pub(crate) fn localized(&self, source: &str) -> String {
        crate::platform::i18n::text(&self.store.lock().unwrap().value.language, source).into()
    }

    pub(crate) fn begin(&self) -> Result<Operation<'_>> {
        let mut active = self.active.lock().unwrap();
        if active.is_some() {
            return Err("另一项操作正在执行，请等待完成。".into());
        }
        let cancel = cancellation();
        *active = Some(cancel.clone());
        Ok(Operation(self, cancel))
    }
    pub(crate) fn cancel(&self) {
        if let Some(cancel) = self.active.lock().unwrap().as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
    pub(crate) fn adb(&self, cancel: Cancel) -> Result<adb::Adb> {
        let settings = self.store.lock().unwrap().value.clone();
        self.adb_with_settings(&settings, cancel)
    }
    pub(crate) fn adb_with_settings(
        &self,
        settings: &Settings,
        cancel: Cancel,
    ) -> Result<adb::Adb> {
        let path = adb::find_adb(settings, &self.resources)
            .map_err(|e| crate::platform::i18n::text(&settings.language, &e).to_owned())?;
        Ok(adb::Adb::new(path, cancel))
    }
    pub(crate) fn update(&self, apply: impl FnOnce(&mut Settings)) -> Result<()> {
        let mut store = self.store.lock().unwrap();
        let mut next = store.value.clone();
        apply(&mut next);
        store.save(next)
    }
    pub(crate) fn inspect(&self, path: PathBuf, cancel: &Cancel) -> Result<Apk> {
        let record = apk::read_apk(&path, cancel)?;
        let info = record.info.clone();
        *self.apk.lock().unwrap() = Some(record);
        Ok(info)
    }
    pub(crate) fn new(store: settings::SettingsStore, resources: PathBuf) -> Self {
        Self {
            store: Mutex::new(store),
            devices: Mutex::new(vec![]),
            apk: Mutex::new(None),
            active: Mutex::new(None),
            drops: Mutex::new(HashSet::new()),
            resources,
            control: control::Control::default(),
            logs: logs::Logcat::default(),
            performance: performance::Performance::default(),
        }
    }
    pub(crate) fn stop_sessions(&self) {
        self.cancel();
        self.control.stop_all();
        self.logs.stop_all();
        self.performance.stop_all();
    }
    /// 最终退出时阻止新客户端，并确认已有客户端退出；窗口关闭和菜单退出共用入口。
    pub(crate) fn shutdown(&self) {
        self.cancel();
        self.control.stop_all();
        self.performance.stop_all();
        crate::adb::child_process::shutdown();
        self.logs.stop_all();
    }
}
