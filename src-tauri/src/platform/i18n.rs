//! 原生界面与前端共用离线词典，避免菜单、选择器和已保存的语言不一致。
use std::{collections::HashMap, sync::OnceLock};

pub const LOCALES: [&str; 9] = ["en", "zh-CN", "zh-TW", "ja", "ko", "fr", "de", "es", "ru"];
const SOURCES: [&str; 8] = [
    include_str!("../../../src/shared/i18n/locales/en.json"),
    include_str!("../../../src/shared/i18n/locales/zh-TW.json"),
    include_str!("../../../src/shared/i18n/locales/ja.json"),
    include_str!("../../../src/shared/i18n/locales/ko.json"),
    include_str!("../../../src/shared/i18n/locales/fr.json"),
    include_str!("../../../src/shared/i18n/locales/de.json"),
    include_str!("../../../src/shared/i18n/locales/es.json"),
    include_str!("../../../src/shared/i18n/locales/ru.json"),
];

pub fn is_supported(language: &str) -> bool {
    LOCALES.contains(&language)
}

/// 只翻译 ADM 自有的界面文案；包名、路径与系统返回的诊断内容保持原样。
pub fn text<'a>(language: &str, source: &'a str) -> &'a str {
    if language == "zh-CN" {
        return source;
    }
    static CATALOGS: OnceLock<Vec<HashMap<String, String>>> = OnceLock::new();
    let catalogs = CATALOGS.get_or_init(|| {
        SOURCES
            .iter()
            .map(|source| serde_json::from_str(source).expect("内置翻译词典格式无效"))
            .collect()
    });
    let index = ["en", "zh-TW", "ja", "ko", "fr", "de", "es", "ru"]
        .iter()
        .position(|locale| *locale == language)
        .unwrap_or(0);
    catalogs[index]
        .get(source)
        .map(String::as_str)
        .unwrap_or(source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogs_cover_native_text_and_have_identical_keys() {
        let english: HashMap<String, String> = serde_json::from_str(SOURCES[0]).unwrap();
        for source in SOURCES {
            let messages: HashMap<String, String> = serde_json::from_str(source).unwrap();
            assert_eq!(messages.len(), english.len());
            assert!(english
                .keys()
                .all(|key| messages.get(key).is_some_and(|s| !s.is_empty())));
        }
        assert!(is_supported("ko"));
        assert_eq!(text("ko", "选择 APK"), "APK 선택");
        assert_eq!(text("ko", "编辑"), "편집");
        assert_eq!(text("fr", "选择 APK"), "Choisir un APK");
        assert_eq!(text("de", "编辑"), "Bearbeiten");
        assert_eq!(text("zh-TW", "文件"), "檔案");
        assert_eq!(text("unknown", "帮助"), "Help");
        assert_eq!(text("ja", "com.example.app"), "com.example.app");
    }
}
