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
    pub network: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_boot_id: Option<String>,
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
    pub system: SystemInfo,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub brand: String,
    pub device: String,
    pub product: String,
    pub hardware: String,
    pub soc: String,
    pub build_id: String,
    pub build_number: String,
    pub build_type: String,
    pub fingerprint: String,
    pub bootloader: String,
    pub baseband: String,
    pub verified_boot: String,
    pub encryption: String,
    pub runtime: RuntimeInfo,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub kernel: String,
    pub cpu_cores: Option<u32>,
    pub memory_total: Option<u64>,
    pub memory_available: Option<u64>,
    pub storage_total: Option<u64>,
    pub storage_available: Option<u64>,
    pub physical_size: String,
    pub override_size: String,
    pub physical_density: Option<u32>,
    pub override_density: Option<u32>,
    pub battery: BatteryInfo,
    pub uptime_seconds: Option<u64>,
    pub addresses: Vec<String>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    pub present: Option<bool>,
    pub percent: Option<f64>,
    pub status: Option<u32>,
    pub health: Option<u32>,
    pub temperature: Option<f64>,
    pub voltage: Option<f64>,
    pub power: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Apk {
    pub label: Option<String>,
    pub icon: Option<String>,
    pub id: String,
    pub file_name: String,
    pub package_name: String,
    pub version_name: String,
    pub version_code: String,
    pub minimum_sdk: String,
    pub test_only: bool,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeviceAdmin {
    pub component: String,
    pub label: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerRemovalCheck {
    pub can_remove: bool,
    pub summary: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AppVersion {
    pub name: String,
    pub code: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMetadata {
    pub version: Option<AppVersion>,
    pub apk_size: Option<u64>,
    pub launch_component: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    #[serde(flatten)]
    pub metadata: AppMetadata,
    pub package_name: String,
    pub label: Option<String>,
    pub apk_path: String,
    pub system: bool,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDetails {
    #[serde(flatten)]
    pub app: InstalledApp,
    pub version_name: String,
    pub version_code: String,
    pub minimum_sdk: String,
    pub target_sdk: String,
    pub uid: String,
    pub first_install_time: String,
    pub last_update_time: String,
    pub installer: String,
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
    pub language: String,
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
            language: String::new(),
            adb_path: String::new(),
            endpoint: String::new(),
            device_names: BTreeMap::new(),
            hidden_devices: vec![],
            sidebar_width: 248.0,
        }
    }
}
pub type Result<T> = std::result::Result<T, String>;
