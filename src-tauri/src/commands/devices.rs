use super::{decoded, decoded_empty, encoded};
use crate::devices::DeviceOperations;
use crate::{
    adb::process::{cancellation, Cancel},
    models::*,
    state::AppState,
};
use serde_json::{json, Value};

impl AppState {
    /// 设置前的阻断原因属于 ADM 文案；保留组件、包名和未知的 ADB 诊断原文。
    fn owner_reason(&self, reason: &str) -> String {
        for (prefix, template) in [
            ("已配置其他设备所有者：", "已配置其他设备所有者：{value}"),
            ("应用尚未安装到主用户：", "应用尚未安装到主用户：{value}"),
        ] {
            if let Some(value) = reason.strip_prefix(prefix) {
                return self.localized(template).replace("{value}", value);
            }
        }
        self.localized(reason)
    }

    pub(crate) fn devices_command(
        &self,
        app: &tauri::AppHandle,
        method: &str,
        args: Value,
        cancel: Cancel,
    ) -> Result<Value> {
        match method {
            "refresh" => {
                decoded_empty(args)?;
                let store = self.store.lock().unwrap().value.clone();
                let mut error = None;
                let mut adb_path = String::new();
                match self.adb(cancellation()) {
                    Ok(adb) => {
                        adb_path = adb.executable.to_string_lossy().into_owned();
                        if self.active.lock().unwrap().is_none() {
                            match adb.devices() {
                                Ok(list) => *self.devices.lock().unwrap() = list,
                                Err(e) => {
                                    error = Some(e);
                                    self.devices.lock().unwrap().clear();
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error = Some(e);
                        self.devices.lock().unwrap().clear();
                    }
                }
                let devices: Vec<_> = self
                    .devices
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|d| !store.hidden_devices.contains(&d.serial))
                    .cloned()
                    .collect();
                Ok(
                    json!({"devices":devices,"settings":store,"adbPath":adb_path,"platform":if cfg!(windows){"win32"}else{"darwin"},"version":app.package_info().version.to_string(),"error":error}),
                )
            }
            "details" => {
                let (target,): (Target,) = decoded(args)?;
                encoded(self.adb(cancel)?.details(&target)?)
            }
            "connect" => {
                let (endpoint,): (String,) = decoded(args)?;
                let endpoint = self.adb(cancel)?.connect(&endpoint)?;
                self.update(|s| {
                    s.endpoint = endpoint.clone();
                    s.hidden_devices.retain(|v| v != &endpoint);
                })?;
                Ok(Value::Null)
            }
            "pair" => {
                let (endpoint, code): (String, String) = decoded(args)?;
                self.adb(cancel)?.pair(&endpoint, &code)?;
                Ok(Value::Null)
            }
            "scanDeviceAdmins" => {
                let (target,): (Target,) = decoded(args)?;
                encoded(self.adb(cancel)?.scan_device_admins(&target)?)
            }
            "checkOwner" => {
                let (target, name): (Target, String) = decoded(args)?;
                encoded(self.adb(cancel)?.check_owner(&target, &name)?)
            }
            "setOwner" => {
                let (target, name, consent): (Target, String, bool) = decoded(args)?;
                if !consent {
                    return Err("请明确确认设备所有者授权。".into());
                }
                self.adb(cancel)?
                    .set_owner(&target, &name)
                    .map_err(|reason| self.owner_reason(&reason))?;
                Ok(Value::Null)
            }
            "checkOwnerRemoval" => {
                let (target, name): (Target, String) = decoded(args)?;
                encoded(self.adb(cancel)?.check_owner_removal(&target, &name)?)
            }
            "removeOwner" => {
                let (target, name, consent): (Target, String, bool) = decoded(args)?;
                self.adb(cancel)?.remove_owner(&target, &name, consent)?;
                Ok(Value::Null)
            }
            _ => Err("不支持的操作。".into()),
        }
    }
}
