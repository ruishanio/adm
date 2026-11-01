#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    // 安装验证仅检查自身与随包 ADB，不初始化窗口、不连接设备或启动 ADB 服务。
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|a| a == "--adm-self-check") {
        let result = adm::self_check().and_then(|info| {
            let data = serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?;
            if let Some(path) = args.get(2) {
                std::fs::write(path, &data).map_err(|e| e.to_string())?;
            }
            println!("{data}");
            Ok(())
        });
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    adm::run();
}
