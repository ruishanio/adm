use crate::{adb::Adb, models::Device, parsing::re};

/// 为同时在线的网络传输读取本次开机 UUID。读取失败时保留原始连接，普通设备操作仍使用 transport_id。
pub(crate) fn identify(adb: &Adb, devices: &mut [Device], previous: &[Device]) {
    let online = |d: &Device| d.network && d.state == "device" && !d.transport_id.is_empty();
    let compare = devices.iter().filter(|d| online(d)).count() > 1;
    let uuid = re(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    for device in devices.iter_mut().filter(|d| online(d)) {
        // 只复用上一次列表里仍然在线的同一条传输；断线、重连后重新核对。
        device.network_boot_id = previous
            .iter()
            .find(|old| {
                online(old)
                    && old.serial == device.serial
                    && old.transport_id == device.transport_id
            })
            .and_then(|old| old.network_boot_id.clone());
        if !compare || device.network_boot_id.is_some() {
            continue;
        }
        let args = [
            "-t",
            &device.transport_id,
            "shell",
            "cat",
            "/proc/sys/kernel/random/boot_id",
        ];
        if let Ok(output) = adb.cmd(args.iter().map(|s| s.to_string()).collect(), 1500, None) {
            let id = output.trim();
            if uuid.is_match(id) {
                device.network_boot_id = Some(id.to_owned());
            }
        }
    }
}
