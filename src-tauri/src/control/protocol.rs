//! scrcpy 5.0.1 的视频分包与控制消息；端序、标志位和长度均在边界校验。
use crate::models::Result;
use serde::Deserialize;

pub const SESSION: u64 = 1 << 63;
pub const SESSION_COMPATIBILITY: u64 = 2 << 32; // 会话头高 32 位中的模式标记
pub const CONFIG: u64 = 1 << 62;
pub const KEY: u64 = 1 << 61;
pub const MAX_PACKET: usize = 8 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Input {
    Key {
        action: u8,
        key_code: u32,
        meta: u32,
    },
    Touch {
        action: u8,
        x: u32,
        y: u32,
        width: u16,
        height: u16,
    },
    Scroll {
        x: u32,
        y: u32,
        width: u16,
        height: u16,
        horizontal: f64,
        vertical: f64,
    },
    Text {
        text: String,
    },
    Rotate,
    Screen {
        on: bool,
    },
}

fn position(out: &mut Vec<u8>, x: u32, y: u32, width: u16, height: u16) -> Result<()> {
    if width == 0 || height == 0 || x >= width.into() || y >= height.into() {
        return Err("触控坐标已失效，请等待画面更新。".into());
    }
    out.extend(x.to_be_bytes());
    out.extend(y.to_be_bytes());
    out.extend(width.to_be_bytes());
    out.extend(height.to_be_bytes());
    Ok(())
}

/// 将受限输入转换为协议消息；画面尺寸必须匹配当前会话，防止旋转后坐标落到错误位置。
pub fn encode(input: &Input, size: (u32, u32)) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(32);
    match input {
        Input::Key {
            action,
            key_code,
            meta,
        } => {
            if *action > 1 || *key_code > 288 || *meta > 0x00ff_ffff {
                return Err("按键参数无效。".into());
            }
            out.extend([0, *action]);
            out.extend(key_code.to_be_bytes());
            out.extend(0u32.to_be_bytes());
            out.extend(meta.to_be_bytes());
        }
        Input::Touch {
            action,
            x,
            y,
            width,
            height,
        } => {
            if ![0, 1, 2, 3].contains(action) || size != ((*width).into(), (*height).into()) {
                return Err("触控会话尺寸已变化。".into());
            }
            out.extend([2, *action]);
            out.extend((-2i64).to_be_bytes());
            position(&mut out, *x, *y, *width, *height)?;
            out.extend(
                if [1, 3].contains(action) {
                    0u16
                } else {
                    u16::MAX
                }
                .to_be_bytes(),
            );
            out.extend([0u8; 8]);
        }
        Input::Scroll {
            x,
            y,
            width,
            height,
            horizontal,
            vertical,
        } => {
            if size != ((*width).into(), (*height).into())
                || !horizontal.is_finite()
                || !vertical.is_finite()
            {
                return Err("滚动参数无效。".into());
            }
            out.push(3);
            position(&mut out, *x, *y, *width, *height)?;
            for value in [horizontal, vertical] {
                out.extend(
                    ((value.clamp(-16., 16.) / 16. * 32768.).clamp(-32768., 32767.) as i16)
                        .to_be_bytes(),
                );
            }
            out.extend([0u8; 4]);
        }
        Input::Text { text } => {
            if text.len() > 4096 || text.contains('\0') {
                return Err("文本过长或包含无效字符。".into());
            }
            // 使用设备剪贴板粘贴，支持中文；不自动读取或同步电脑剪贴板。
            out.push(9);
            out.extend(0u64.to_be_bytes());
            out.push(1);
            out.extend((text.len() as u32).to_be_bytes());
            out.extend(text.as_bytes());
        }
        Input::Rotate => out.push(11),
        Input::Screen { on } => out.extend([10, u8::from(*on)]),
    }
    Ok(out)
}

/// 拆分 Annex B NAL 单元，兼容三字节和四字节起始码；返回不含起始码的切片。
pub fn nals(data: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= data.len() {
        let n = if data[i..].starts_with(&[0, 0, 0, 1]) {
            4
        } else if data[i..].starts_with(&[0, 0, 1]) {
            3
        } else {
            0
        };
        if n > 0 {
            starts.push((i, i + n));
            i += n;
        } else {
            i += 1;
        }
    }
    starts
        .iter()
        .enumerate()
        .filter_map(|(i, (_, start))| {
            let end = starts.get(i + 1).map(|v| v.0).unwrap_or(data.len());
            (*start < end).then_some(&data[*start..end])
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn touch_has_exact_layout_and_rejects_rotated_coordinates() {
        let input = Input::Touch {
            action: 0,
            x: 10,
            y: 20,
            width: 720,
            height: 1280,
        };
        let bytes = encode(&input, (720, 1280)).unwrap();
        assert_eq!(bytes.len(), 32);
        assert_eq!(
            &bytes[..10],
            &[2, 0, 255, 255, 255, 255, 255, 255, 255, 254]
        );
        assert_eq!(&bytes[18..24], &[2, 208, 5, 0, 255, 255]);
        assert!(encode(&input, (1280, 720)).is_err());
    }
    #[test]
    fn clipboard_length_is_utf8_bytes_and_nals_support_both_prefixes() {
        let bytes = encode(
            &Input::Text {
                text: "中文".into(),
            },
            (720, 1280),
        )
        .unwrap();
        assert_eq!(&bytes[10..14], &6u32.to_be_bytes());
        assert_eq!(
            nals(&[0, 0, 0, 1, 0x67, 2, 0, 0, 1, 0x68, 3]),
            vec![&[0x67, 2][..], &[0x68, 3][..]]
        );
    }
}
