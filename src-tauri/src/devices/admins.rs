use crate::{
    adb::{process::check_cancel, Adb},
    apps::reader_json,
    models::{DeviceAdmin, Result, Target},
    parsing::component,
};
use std::collections::BTreeMap;

/// 从版本化输出读取候选组件，规范化身份并去重；格式异常必须报错，不能伪装成没有应用。
fn parse_admins(text: &str) -> Result<Vec<DeviceAdmin>> {
    let entries: Vec<DeviceAdmin> = reader_json(text, "ADM_ADMINS_V1:")?;
    if entries.len() > 2048 {
        return Err("设备管理组件数量异常。".into());
    }
    let mut unique = BTreeMap::new();
    for mut entry in entries {
        entry.component = component(&entry.component)?;
        entry.label = entry.label.and_then(|label| {
            let label = label.split_whitespace().collect::<Vec<_>>().join(" ");
            (!label.is_empty()
                && label.chars().count() <= 512
                && !label.chars().any(char::is_control))
            .then_some(label)
        });
        unique.entry(entry.component.clone()).or_insert(entry);
    }
    Ok(unique.into_values().collect())
}

impl Adb {
    /// 读取指定传输会话中主用户的合法管理接收器；不激活管理员、不安装应用或修改策略。
    pub fn scan_device_admins(&self, target: &Target) -> Result<Vec<DeviceAdmin>> {
        self.ensure_online(target)?;
        let output = self.app_reader(target, &["admins"]);
        check_cancel(&self.cancel)?;
        self.ensure_online(target)?;
        let output =
            output.map_err(|_| "无法扫描设备管理应用，请重试或手动填写组件。".to_string())?;
        parse_admins(&output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receivers_are_normalized_deduplicated_and_keep_missing_labels() {
        let entries = parse_admins(r#"diagnostic
ADM_ADMINS_V1:[{"component":"com.example.app/.Admin","label":"  管理\n应用 "},{"component":"com.example.app/com.example.app.Admin","label":"重复"},{"component":"com.example.app/.Other$Receiver"}]
"#).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries[0].component,
            "com.example.app/com.example.app.Admin"
        );
        assert_eq!(entries[0].label.as_deref(), Some("管理 应用"));
        assert_eq!(entries[1].label, None);
    }

    #[test]
    fn empty_success_is_distinct_from_failure_and_invalid_components() {
        assert!(parse_admins("ADM_ADMINS_V1:[]").unwrap().is_empty());
        for text in [
            "",
            "Permission denied",
            "ADM_ADMINS_V1:{}",
            r#"ADM_ADMINS_V1:[{"component":"com.example/.Admin;reboot"}]"#,
        ] {
            assert!(parse_admins(text).is_err());
        }
        let too_many = format!(
            "ADM_ADMINS_V1:[{}]",
            vec![r#"{"component":"com.example/.Admin"}"#; 2049].join(",")
        );
        assert!(parse_admins(&too_many).is_err());
    }
}
