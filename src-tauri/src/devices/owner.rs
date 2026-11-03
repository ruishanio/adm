use crate::{
    models::Result,
    parsing::{component, parse_owner, re},
};

pub(super) const REMOVE_UNSUPPORTED: &str =
    "此管理应用未以测试模式激活，Android 不允许通过 ADB 移除。请在管理应用中解除设备管理。";

/// 核对预期所有者，从同一份策略中读取所属用户和激活时保存的测试标记。
/// 返回 None 表示已无所有者；未知格式或对象已变更时拒绝继续，不猜测用户或权限。
pub(super) fn removal_target(policy: &str, expected: &str) -> Result<Option<(u32, bool)>> {
    let Some(current) = parse_owner(policy)? else {
        return Ok(None);
    };
    if current != expected {
        return Err("设备所有者已变更，请刷新设备信息后重新确认。".into());
    }
    let lines: Vec<_> = policy.lines().collect();
    let indent = |line: &str| line.len() - line.trim_start().len();
    let start = lines
        .iter()
        .position(|line| line.trim().eq_ignore_ascii_case("Device Owner:"))
        .ok_or("无法确认所有者所属用户，请刷新设备信息。")?;
    let user_pattern = re(r"^User ID:\s*(\d+)$");
    let user = lines[start + 1..]
        .iter()
        .take_while(|line| !line.trim().is_empty() && indent(line) > indent(lines[start]))
        .find_map(|line| user_pattern.captures(line.trim()))
        .and_then(|m| m[1].parse::<u32>().ok())
        .ok_or("无法确认所有者所属用户，请刷新设备信息。")?;
    let section_pattern = re(r"^Enabled Device Admins \(User (\d+)[,)]");
    let section = lines
        .iter()
        .position(|line| {
            section_pattern
                .captures(line.trim())
                .and_then(|m| m[1].parse::<u32>().ok())
                == Some(user)
        })
        .ok_or("无法确认管理应用的移除条件，当前系统输出不受支持。")?;
    let mut admin_indent = None;
    for line in &lines[section + 1..] {
        if line.trim().is_empty() {
            continue;
        }
        if indent(line) <= indent(lines[section]) {
            break;
        }
        if let Some(level) = admin_indent {
            if indent(line) <= level {
                break;
            }
            match line.trim() {
                "testOnlyAdmin=true" => return Ok(Some((user, true))),
                "testOnlyAdmin=false" => return Ok(Some((user, false))),
                _ => {}
            }
        } else if line
            .trim()
            .strip_suffix(':')
            .and_then(|name| component(name).ok())
            .as_deref()
            == Some(expected)
        {
            admin_indent = Some(indent(line));
        }
    }
    // 不能用当前 APK 的 TEST_ONLY 替代激活时的 testOnlyAdmin；更新 APK 不会改变后者。
    Err("无法确认管理应用的移除条件，当前系统输出不受支持。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const NAME: &str = "com.example.app/com.example.app.Admin";
    fn policy(user: u32, flag: &str) -> String {
        format!("Current Device Policy Manager state:\n  Device Owner:\n    admin=ComponentInfo{{{NAME}}}\n    name=Test\n    User ID: {user}\n\n  Enabled Device Admins (User {user}, provisioningState: 3):\n    com.example.other/.Admin:\n      testOnlyAdmin=true\n    com.example.app/.Admin:\n      uid=123\n      testOnlyAdmin={flag}\n")
    }
    #[test]
    fn removal_matches_owner_user_and_persisted_flag() {
        assert_eq!(
            removal_target(&policy(10, "true"), NAME).unwrap(),
            Some((10, true))
        );
        assert_eq!(
            removal_target(&policy(0, "false"), NAME).unwrap(),
            Some((0, false))
        );
        assert!(removal_target(&policy(0, "unknown"), NAME).is_err());
        assert!(removal_target(&policy(0, "true"), "com.other/com.other.Admin").is_err());
        assert!(removal_target(&policy(0, "true").replace("User ID: 0", "unknown"), NAME).is_err());
        assert!(removal_target(
            &policy(0, "true").replace("Admins (User 0", "Admins (User 10"),
            NAME
        )
        .is_err());
        assert_eq!(
            removal_target("Device Policy Manager state:", NAME).unwrap(),
            None
        );
    }
}
