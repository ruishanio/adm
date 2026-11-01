use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub serial: String,
    pub transport_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub serial: String,
    pub transport_id: String,
    pub state: String,
    pub model: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub android: String,
    pub api: String,
    pub owner: Option<String>,
    pub manufacturer: String,
    pub model: String,
    pub architecture: String,
    pub patch: String,
    pub serial: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Apk {
    pub id: String,
    pub file_name: String,
    pub package_name: String,
    pub version_name: String,
    pub version_code: String,
    pub minimum_sdk: String,
    pub size: u64,
    pub admins: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerCheck {
    pub can_set: bool,
    pub already_set: bool,
    pub summary: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct DeviceFile {
    pub name: String,
    pub path: String,
    pub r#type: String,
    pub size: u64,
    pub modified: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    #[serde(alias = "AdbPath")]
    pub adb_path: String,
    #[serde(alias = "Endpoint")]
    pub endpoint: String,
    #[serde(alias = "DeviceNames")]
    pub device_names: BTreeMap<String, String>,
    #[serde(alias = "HiddenDevices")]
    pub hidden_devices: Vec<String>,
    #[serde(alias = "SidebarWidth")]
    pub sidebar_width: f64,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            adb_path: String::new(),
            endpoint: String::new(),
            device_names: BTreeMap::new(),
            hidden_devices: vec![],
            sidebar_width: 248.0,
        }
    }
}
pub type Result<T> = std::result::Result<T, String>;
