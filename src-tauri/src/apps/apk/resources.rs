//! 只读 APK 资源表。偏移、条目数量与引用深度均受限，不执行 APK 代码或解压到磁盘。
use super::{Reader, INVALID};
use crate::models::Result;
use std::{fs::File, io::Read};

pub(super) fn read_entry(
    zip: &mut zip::ZipArchive<File>,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>> {
    let entry = zip.by_name(name).map_err(|e| e.to_string())?;
    if entry.size() > limit {
        return Err("APK 资源过大。".into());
    }
    let mut data = vec![];
    entry
        .take(limit + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > limit {
        return Err("APK 资源过大。".into());
    }
    Ok(data)
}

struct Variant<'a> {
    data: &'a [u8],
    package: u32,
    type_id: u32,
}
// 资源候选依次保存语言/密度排序权重、资源类型和原始值。
type RankedValue = ((u8, u16), u8, u32);
pub(super) struct Table<'a> {
    strings: Vec<String>,
    variants: Vec<Variant<'a>>,
}

/// 输入完整 resources.arsc，收集字符串池与类型块；查询时才访问所需条目，避免展开整张资源表。
impl<'a> Table<'a> {
    pub fn parse(data: &'a [u8]) -> Result<Self> {
        let r = Reader(data);
        if r.u16(0)? != 2 || r.u16(2)? < 12 || r.u32(4)? as usize != data.len() {
            return Err(INVALID.into());
        }
        let mut table = Self {
            strings: vec![],
            variants: vec![],
        };
        let mut offset = r.u16(2)? as usize;
        while offset < data.len() {
            let (kind, header, end) = chunk(&r, offset, data.len())?;
            match kind {
                1 => table.strings = r.string_pool(offset)?,
                0x200 => {
                    if header < 284 {
                        return Err(INVALID.into());
                    }
                    let package = r.u32(offset + 8)?;
                    let type_offset = if header >= 288 {
                        r.u32(offset + 284)?
                    } else {
                        0
                    };
                    if package > 255 || type_offset > 255 {
                        return Err(INVALID.into());
                    }
                    let mut at = offset + header;
                    while at < end {
                        let (kind, header, next) = chunk(&r, at, end)?;
                        if kind == 0x201 {
                            if header < 24 || table.variants.len() >= 100000 {
                                return Err(INVALID.into());
                            }
                            let type_id = data[at + 8] as u32 + type_offset;
                            if type_id == 0 || type_id > 255 {
                                return Err(INVALID.into());
                            }
                            table.variants.push(Variant {
                                data: &data[at..next],
                                package,
                                type_id,
                            });
                        }
                        at = next;
                    }
                }
                _ => {}
            }
            offset = end;
        }
        Ok(table)
    }

    pub fn resolve(&self, value: &str) -> Option<String> {
        self.values(value).into_iter().next()
    }
    pub fn values(&self, value: &str) -> Vec<String> {
        let mut budget = 256;
        self.resolve_inner(value, &mut vec![], &mut budget)
    }
    fn resolve_inner(&self, value: &str, stack: &mut Vec<u32>, budget: &mut usize) -> Vec<String> {
        if value.is_empty() {
            return vec![];
        }
        if !value.starts_with('@') {
            return vec![value.to_owned()];
        }
        let Some(id) = value
            .strip_prefix("@0x")
            .and_then(|v| u32::from_str_radix(v, 16).ok())
        else {
            return vec![];
        };
        if stack.len() >= 16 || stack.contains(&id) || *budget == 0 {
            return vec![];
        }
        *budget -= 1;
        stack.push(id);
        let mut values = self
            .variants
            .iter()
            .filter(|v| v.package == id >> 24 && v.type_id == (id >> 16) & 255)
            .filter_map(|v| v.value(id & 0xffff).ok().flatten())
            .collect::<Vec<_>>();
        // 预览采用 APK 默认语言；同语言优先较高密度，保留其他变体用于图标格式降级。
        values.sort_by_key(|v| v.0);
        let mut result = vec![];
        for (_, kind, data) in values.into_iter().take(256) {
            let decoded = match kind {
                1 => self.resolve_inner(&format!("@0x{data:x}"), stack, budget),
                3 => self
                    .strings
                    .get(data as usize)
                    .cloned()
                    .into_iter()
                    .collect(),
                0x1c..=0x1f => vec![format!("#{data:08x}")],
                _ => vec![],
            };
            for text in decoded {
                if !result.contains(&text) {
                    result.push(text);
                }
            }
        }
        stack.pop();
        result
    }
}

fn chunk(r: &Reader, at: usize, limit: usize) -> Result<(u16, usize, usize)> {
    r.range(at, 8, limit)?;
    let header = r.u16(at + 2)? as usize;
    let size = r.u32(at + 4)? as usize;
    if header < 8 || size < header {
        return Err(INVALID.into());
    }
    r.range(at, size, limit)?;
    Ok((r.u16(at)?, header, at + size))
}

impl Variant<'_> {
    fn value(&self, index: u32) -> Result<Option<RankedValue>> {
        let r = Reader(self.data);
        let header = r.u16(2)? as usize;
        let count = r.u32(12)? as usize;
        let start = r.u32(16)? as usize;
        let config_size = r.u32(20)? as usize;
        if count > 65536
            || start < header
            || start > self.data.len()
            || config_size < 4
            || 20 + config_size > header
        {
            return Err(INVALID.into());
        }
        let flags = self.data[9];
        let stride = if flags & 2 != 0 && flags & 1 == 0 {
            2
        } else {
            4
        };
        r.range(header, count * stride, start)?;
        let offset = if flags & 1 != 0 {
            let mut found = None;
            for i in 0..count {
                if r.u16(header + i * 4)? as u32 == index {
                    found = Some(r.u16(header + i * 4 + 2)? as usize * 4);
                    break;
                }
            }
            let Some(found) = found else {
                return Ok(None);
            };
            found
        } else {
            if index as usize >= count {
                return Ok(None);
            }
            if flags & 2 != 0 {
                let offset = r.u16(header + index as usize * 2)?;
                if offset == u16::MAX {
                    return Ok(None);
                }
                offset as usize * 4
            } else {
                let offset = r.u32(header + index as usize * 4)?;
                if offset == u32::MAX {
                    return Ok(None);
                }
                offset as usize
            }
        };
        let at = start + offset;
        r.range(at, 8, self.data.len())?;
        let flags = r.u16(at + 2)?;
        if flags & 1 != 0 {
            return Ok(None);
        }
        let (kind, data) = if flags & 8 != 0 {
            ((flags >> 8) as u8, r.u32(at + 4)?)
        } else {
            let size = r.u16(at)? as usize;
            if size < 8 {
                return Err(INVALID.into());
            }
            r.range(at + size, 8, self.data.len())?;
            (self.data[at + size + 3], r.u32(at + size + 4)?)
        };
        let localized = u8::from(config_size >= 12 && r.u32(28)? != 0);
        let density = if config_size >= 16 { r.u16(34)? } else { 0 };
        Ok(Some(((localized, u16::MAX - density), kind, data)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn variant(kind: u8, value: u32, compact: bool) -> Vec<u8> {
        let mut data = vec![0; 44];
        data[0..2].copy_from_slice(&0x201u16.to_le_bytes());
        data[2..4].copy_from_slice(&24u16.to_le_bytes());
        data[4..8].copy_from_slice(&44u32.to_le_bytes());
        data[8] = 1;
        data[12..16].copy_from_slice(&1u32.to_le_bytes());
        data[16..20].copy_from_slice(&28u32.to_le_bytes());
        data[20..24].copy_from_slice(&4u32.to_le_bytes());
        if compact {
            data[30..32].copy_from_slice(&(8 | (kind as u16) << 8).to_le_bytes());
            data[32..36].copy_from_slice(&value.to_le_bytes());
        } else {
            data[28..30].copy_from_slice(&8u16.to_le_bytes());
            data[36..38].copy_from_slice(&8u16.to_le_bytes());
            data[39] = kind;
            data[40..44].copy_from_slice(&value.to_le_bytes());
        }
        data
    }
    #[test]
    fn supports_compact_sparse_and_short_offsets_and_stops_cycles() {
        for compact in [false, true] {
            for flags in [0, 1, 2] {
                let mut data = variant(3, 0, compact);
                data[9] = flags;
                let table = Table {
                    strings: vec!["测试应用".into()],
                    variants: vec![Variant {
                        data: &data,
                        package: 0x7f,
                        type_id: 1,
                    }],
                };
                assert_eq!(table.resolve("@0x7f010000"), Some("测试应用".into()));
            }
        }
        let data = variant(1, 0x7f010000, false);
        let table = Table {
            strings: vec![],
            variants: vec![Variant {
                data: &data,
                package: 0x7f,
                type_id: 1,
            }],
        };
        assert!(table.resolve("@0x7f010000").is_none());
    }
    #[test]
    fn rejects_out_of_bounds_entries_and_truncated_tables() {
        let mut data = variant(3, 0, false);
        data[24..28].copy_from_slice(&0xffffff00u32.to_le_bytes());
        let v = Variant {
            data: &data,
            package: 0x7f,
            type_id: 1,
        };
        assert!(v.value(0).is_err());
        for size in 0..44 {
            assert!(Table::parse(&data[..size]).is_err());
        }
    }
}
