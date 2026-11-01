use crate::{
    models::*,
    parsing::{component, valid_package},
    process::{check_cancel, Cancel},
};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};
const INVALID: &str = "APK 清单损坏或格式不受支持。";
const ANDROID: &str = "http://schemas.android.com/apk/res/android";
#[derive(Default)]
struct Element {
    name: String,
    attributes: BTreeMap<String, String>,
    children: Vec<Element>,
}
impl Element {
    fn attr(&self, key: &str) -> &str {
        self.attributes
            .get(&format!("{ANDROID}:{key}"))
            .map(String::as_str)
            .unwrap_or("")
    }
}
struct Reader<'a>(&'a [u8]);
impl Reader<'_> {
    fn range(&self, at: usize, size: usize, end: usize) -> Result<&[u8]> {
        if at.checked_add(size).filter(|v| *v <= end).is_none() {
            return Err(INVALID.into());
        }
        self.0.get(at..at + size).ok_or_else(|| INVALID.into())
    }
    fn u16(&self, at: usize) -> Result<u16> {
        Ok(u16::from_le_bytes(
            self.range(at, 2, self.0.len())?.try_into().unwrap(),
        ))
    }
    fn u32(&self, at: usize) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.range(at, 4, self.0.len())?.try_into().unwrap(),
        ))
    }
    fn length8(&self, at: &mut usize, end: usize) -> Result<usize> {
        let n = self.range(*at, 1, end)?[0];
        *at += 1;
        if n & 0x80 == 0 {
            Ok(n as usize)
        } else {
            let low = self.range(*at, 1, end)?[0];
            *at += 1;
            Ok(((n as usize & 0x7f) << 8) | low as usize)
        }
    }
    fn length16(&self, at: &mut usize, end: usize) -> Result<usize> {
        self.range(*at, 2, end)?;
        let n = self.u16(*at)?;
        *at += 2;
        if n & 0x8000 == 0 {
            Ok(n as usize)
        } else {
            self.range(*at, 2, end)?;
            let low = self.u16(*at)?;
            *at += 2;
            Ok(((n as usize & 0x7fff) << 16) | low as usize)
        }
    }
}
fn string(pool: &[String], index: u32) -> Result<String> {
    if index == u32::MAX {
        Ok(String::new())
    } else {
        pool.get(index as usize)
            .cloned()
            .ok_or_else(|| INVALID.into())
    }
}
/// 解析有界 Android 二进制 XML。输入清单字节，返回应用信息；异常偏移、深度和拆分包均拒绝。
pub fn parse_manifest(data: &[u8]) -> Result<Apk> {
    let r = Reader(data);
    if data.len() < 8
        || data.len() > 8 * 1024 * 1024
        || r.u16(0)? != 3
        || r.u16(2)? != 8
        || r.u32(4)? as usize != data.len()
    {
        return Err(INVALID.into());
    }
    let mut strings = vec![];
    let mut stack: Vec<Element> = vec![];
    let mut root = None;
    let mut pool_seen = false;
    let mut offset = 8;
    while offset < data.len() {
        r.range(offset, 8, data.len())?;
        let kind = r.u16(offset)?;
        let header = r.u16(offset + 2)? as usize;
        let size = r.u32(offset + 4)? as usize;
        if header < 8 || size < header {
            return Err(INVALID.into());
        }
        r.range(offset, size, data.len())?;
        let end = offset + size;
        if kind == 1 {
            if header < 28 || pool_seen {
                return Err(INVALID.into());
            }
            pool_seen = true;
            let count = r.u32(offset + 8)? as usize;
            let utf8 = r.u32(offset + 16)? & 0x100 != 0;
            let start = r.u32(offset + 20)? as usize;
            if count > 100000
                || header + count * 4 > size
                || start < header + count * 4
                || start >= size
            {
                return Err(INVALID.into());
            }
            let mut decoded = 0;
            for i in 0..count {
                let mut at = offset + start + r.u32(offset + header + i * 4)? as usize;
                if utf8 {
                    r.length8(&mut at, end)?;
                }
                let length = if utf8 {
                    r.length8(&mut at, end)?
                } else {
                    r.length16(&mut at, end)? * 2
                };
                r.range(at, length + if utf8 { 1 } else { 2 }, end)?;
                decoded += length;
                if decoded > 16 * 1024 * 1024 {
                    return Err(INVALID.into());
                }
                let bytes = r.range(at, length, end)?;
                let text = if utf8 {
                    String::from_utf8(bytes.to_vec()).map_err(|_| INVALID)?
                } else {
                    String::from_utf16(
                        &bytes
                            .as_chunks::<2>()
                            .0
                            .iter()
                            .map(|b| u16::from_le_bytes([b[0], b[1]]))
                            .collect::<Vec<_>>(),
                    )
                    .map_err(|_| INVALID)?
                };
                strings.push(text);
            }
        } else if kind == 0x102 {
            if header != 16 || size < 36 {
                return Err(INVALID.into());
            }
            let mut element = Element {
                name: string(&strings, r.u32(offset + 20)?)?,
                ..Default::default()
            };
            let start = r.u16(offset + 24)? as usize;
            let stride = r.u16(offset + 26)? as usize;
            let count = r.u16(offset + 28)? as usize;
            if stride < 20 || start < 20 || 16 + start + count * stride > size {
                return Err(INVALID.into());
            }
            for i in 0..count {
                let at = offset + 16 + start + i * stride;
                let ns = string(&strings, r.u32(at)?)?;
                let name = string(&strings, r.u32(at + 4)?)?;
                let raw = r.u32(at + 8)?;
                let value_type = data[at + 15];
                let value = r.u32(at + 16)?;
                let text = if raw != u32::MAX {
                    string(&strings, raw)?
                } else {
                    match value_type {
                        3 => string(&strings, value)?,
                        0x12 => (value != 0).to_string(),
                        0x10 | 0x11 => value.to_string(),
                        _ => format!("@0x{value:x}"),
                    }
                };
                element.attributes.insert(
                    if ns.is_empty() {
                        name
                    } else {
                        format!("{ns}:{name}")
                    },
                    text,
                );
            }
            stack.push(element);
            if stack.len() > 128 {
                return Err(INVALID.into());
            }
        } else if kind == 0x103 {
            if size < 24 {
                return Err(INVALID.into());
            }
            let element = stack.pop().ok_or(INVALID)?;
            if element.name != string(&strings, r.u32(offset + 20)?)? {
                return Err(INVALID.into());
            }
            if let Some(parent) = stack.last_mut() {
                parent.children.push(element);
            } else if root.is_some() {
                return Err(INVALID.into());
            } else {
                root = Some(element);
            }
        }
        offset = end;
    }
    let root = root.ok_or(INVALID)?;
    if !stack.is_empty() || root.name != "manifest" {
        return Err(INVALID.into());
    }
    let pkg = root
        .attributes
        .get("package")
        .ok_or("APK 没有有效的应用包名。")?;
    if !valid_package(pkg) {
        return Err("APK 没有有效的应用包名。".into());
    }
    if root.attributes.get("split").is_some_and(|v| !v.is_empty()) {
        return Err("不支持拆分 APK，请选择可独立安装的完整 APK。".into());
    }
    let number = |s: &str| s.parse::<u32>().unwrap_or(0) as u64;
    let mut admins = vec![];
    if let Some(app) = root.children.iter().find(|c| c.name == "application") {
        for receiver in &app.children {
            if receiver.name == "receiver"
                && receiver.attr("permission") == "android.permission.BIND_DEVICE_ADMIN"
                && receiver.attr("enabled") != "false"
                && receiver
                    .children
                    .iter()
                    .any(|c| c.name == "meta-data" && c.attr("name") == "android.app.device_admin")
                && receiver.children.iter().any(|c| {
                    c.name == "intent-filter"
                        && c.children.iter().any(|a| {
                            a.name == "action"
                                && a.attr("name") == "android.app.action.DEVICE_ADMIN_ENABLED"
                        })
                })
            {
                let admin = component(&format!("{pkg}/{}", receiver.attr("name")))?;
                if !admins.contains(&admin) {
                    admins.push(admin);
                }
            }
        }
    }
    let minimum_sdk = root
        .children
        .iter()
        .find(|c| c.name == "uses-sdk")
        .map(|c| c.attr("minSdkVersion"))
        .filter(|s| !s.is_empty())
        .unwrap_or("未声明")
        .into();
    Ok(Apk {
        id: String::new(),
        file_name: String::new(),
        package_name: pkg.clone(),
        version_name: if root.attr("versionName").is_empty() {
            "未知版本".into()
        } else {
            root.attr("versionName").into()
        },
        version_code: ((number(root.attr("versionCodeMajor")) << 32)
            | number(root.attr("versionCode")))
        .to_string(),
        minimum_sdk,
        size: 0,
        admins,
    })
}
pub fn file_hash(path: &Path, cancel: &Cancel) -> Result<String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        check_cancel(cancel)?;
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
#[derive(Clone)]
pub struct ApkRecord {
    pub info: Apk,
    pub path: PathBuf,
    pub hash: String,
}
pub fn read_apk(path: &Path, cancel: &Cancel) -> Result<ApkRecord> {
    if path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        != "apk"
    {
        return Err("请选择单个 .apk 文件，不支持 AAB、APKS 和拆分 APK。".into());
    }
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let metadata = path.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("请选择 APK 文件。".into());
    }
    let hash = file_hash(&path, cancel)?;
    let mut zip = zip::ZipArchive::new(File::open(&path).map_err(|e| e.to_string())?)
        .map_err(|_| "无法打开 APK，请确认文件完整。")?;
    let mut entry = zip
        .by_name("AndroidManifest.xml")
        .map_err(|_| "APK 缺少 AndroidManifest.xml。")?;
    if !(8..=8 * 1024 * 1024).contains(&entry.size()) {
        return Err("APK 清单大小异常。".into());
    }
    let mut data = vec![];
    (&mut entry)
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut data)
        .map_err(|_| "无法解压 APK 清单。")?;
    let mut info = parse_manifest(&data)?;
    if hash != file_hash(&path, cancel)? {
        return Err("读取时 APK 已变化，请重新选择。".into());
    }
    info.id = uuid::Uuid::new_v4().to_string();
    info.file_name = path.file_name().unwrap().to_string_lossy().into_owned();
    info.size = metadata.len();
    Ok(ApkRecord { info, path, hash })
}
