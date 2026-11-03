//! 将 APK 中的位图、VectorDrawable 和自适应图标转换为受限的内联预览。
use super::{
    parse_xml,
    resources::{read_entry, Table},
    Element,
};
use std::{fmt::Write, fs::File};

pub(super) fn read_icon(
    zip: &mut zip::ZipArchive<File>,
    table: Option<&Table>,
    value: &str,
) -> Option<String> {
    let mut budget = 24;
    let body = drawable(zip, table, value, 0, &mut budget)?;
    Some(data_uri("image/svg+xml", format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"96\" height=\"96\" viewBox=\"0 0 108 108\">{body}</svg>").as_bytes()))
}

fn data_uri(mime: &str, data: &[u8]) -> String {
    let mut uri = format!("data:{mime},");
    for byte in data {
        let _ = write!(uri, "%{byte:02X}");
    }
    uri
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
fn resolved(table: Option<&Table>, value: &str) -> Option<String> {
    table
        .and_then(|t| t.resolve(value))
        .or_else(|| (!value.is_empty() && !value.starts_with('@')).then(|| value.to_owned()))
}
fn color(table: Option<&Table>, value: &str) -> Option<String> {
    let value = resolved(table, value)?;
    let hex = value.strip_prefix('#')?;
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    match hex.len() {
        3 | 6 => Some(value),
        4 => Some(format!(
            "#{}{}{}{}{}{}{}{}",
            &hex[1..2],
            &hex[1..2],
            &hex[2..3],
            &hex[2..3],
            &hex[3..4],
            &hex[3..4],
            &hex[0..1],
            &hex[0..1]
        )),
        8 => Some(format!("#{}{}", &hex[2..], &hex[..2])),
        _ => None,
    }
}

/// 递归仅允许白名单 drawable 元素；最多 8 层、24 次资源读取，失败则使用应用通用图标。
fn drawable(
    zip: &mut zip::ZipArchive<File>,
    table: Option<&Table>,
    value: &str,
    depth: usize,
    budget: &mut usize,
) -> Option<String> {
    if depth >= 8 || *budget == 0 {
        return None;
    }
    *budget -= 1;
    if let Some(fill) = color(table, value) {
        return Some(format!("<path fill=\"{fill}\" d=\"M0 0H108V108H0Z\"/>"));
    }
    let values = table
        .map(|t| t.values(value))
        .unwrap_or_else(|| vec![value.to_owned()]);
    for path in values.into_iter().take(8) {
        if !path.starts_with("res/") || path.contains("..") {
            continue;
        }
        let Ok(data) = read_entry(zip, &path, 512 * 1024) else {
            continue;
        };
        let mime = if data.starts_with(b"\x89PNG\r\n\x1a\n") {
            Some("image/png")
        } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
            Some("image/webp")
        } else if data.starts_with(&[0xff, 0xd8, 0xff]) {
            Some("image/jpeg")
        } else {
            None
        };
        if let Some(mime) = mime {
            return Some(format!(
                "<image width=\"108\" height=\"108\" href=\"{}\"/>",
                data_uri(mime, &data)
            ));
        }
        if let Ok(root) = parse_xml(&data) {
            if let Some(icon) = element(zip, table, &root, depth + 1, budget) {
                return Some(icon);
            }
        }
    }
    None
}

fn element(
    zip: &mut zip::ZipArchive<File>,
    table: Option<&Table>,
    node: &Element,
    depth: usize,
    budget: &mut usize,
) -> Option<String> {
    match node.name.as_str() {
        "adaptive-icon" => {
            let layer = |name: &str| node.children.iter().find(|n| n.name == name);
            let background = drawable(
                zip,
                table,
                layer("background")?.attr("drawable"),
                depth,
                budget,
            )?;
            let foreground = drawable(
                zip,
                table,
                layer("foreground")?.attr("drawable"),
                depth,
                budget,
            )?;
            // Android 自适应图标的中心 72/108 区域为可视窗口，保留前后景比例并采用中性圆角蒙版。
            Some(format!("<svg viewBox=\"18 18 72 72\" width=\"108\" height=\"108\"><defs><clipPath id=\"mask\"><rect x=\"18\" y=\"18\" width=\"72\" height=\"72\" rx=\"16\"/></clipPath></defs><g clip-path=\"url(#mask)\">{background}{foreground}</g></svg>"))
        }
        "vector" => {
            let width = number(node, "viewportWidth", 0.0)?;
            let height = number(node, "viewportHeight", 0.0)?;
            if width <= 0.0 || height <= 0.0 {
                return None;
            }
            let mut count = 0;
            let children = vector_children(table, &node.children, &mut count)?;
            let alpha = number(node, "alpha", 1.0)?;
            Some(format!("<svg viewBox=\"0 0 {width} {height}\" width=\"108\" height=\"108\" opacity=\"{alpha}\">{children}</svg>"))
        }
        "bitmap" => drawable(zip, table, node.attr("src"), depth, budget),
        _ => None,
    }
}
fn number(node: &Element, name: &str, default: f32) -> Option<f32> {
    if node.attr(name).is_empty() {
        return Some(default);
    }
    node.attr(name)
        .parse::<f32>()
        .ok()
        .filter(|v| v.is_finite() && v.abs() <= 100000.0)
}
fn vector_children(table: Option<&Table>, nodes: &[Element], count: &mut usize) -> Option<String> {
    let mut out = String::new();
    for node in nodes {
        *count += 1;
        if *count > 512 {
            return None;
        }
        match node.name.as_str() {
            "group" => {
                let x = number(node, "pivotX", 0.0)?;
                let y = number(node, "pivotY", 0.0)?;
                let tx = number(node, "translateX", 0.0)?;
                let ty = number(node, "translateY", 0.0)?;
                let sx = number(node, "scaleX", 1.0)?;
                let sy = number(node, "scaleY", 1.0)?;
                let rotation = number(node, "rotation", 0.0)?;
                let children = vector_children(table, &node.children, count)?;
                write!(out, "<g transform=\"translate({} {}) rotate({rotation}) scale({sx} {sy}) translate({} {})\">{children}</g>", x + tx, y + ty, -x, -y).ok()?;
            }
            "path" => {
                // 渐变、裁剪和 trimPath 暂不模拟，避免把部分路径渲染成看似正确的应用标识。
                if !node.children.is_empty()
                    || !node.attr("trimPathStart").is_empty()
                    || !node.attr("trimPathEnd").is_empty()
                    || !node.attr("trimPathOffset").is_empty()
                {
                    return None;
                }
                let path = node.attr("pathData");
                if path.is_empty() || path.len() > 128 * 1024 {
                    return None;
                }
                let fill = if node.attr("fillColor").is_empty() {
                    "none".into()
                } else {
                    color(table, node.attr("fillColor"))?
                };
                let stroke = if node.attr("strokeColor").is_empty() {
                    "none".into()
                } else {
                    color(table, node.attr("strokeColor"))?
                };
                let fill_alpha = number(node, "fillAlpha", 1.0)?;
                let stroke_alpha = number(node, "strokeAlpha", 1.0)?;
                let stroke_width = number(node, "strokeWidth", 0.0)?;
                let rule = if node.attr("fillType") == "1" {
                    "evenodd"
                } else {
                    "nonzero"
                };
                let cap = match node.attr("strokeLineCap") {
                    "1" => "round",
                    "2" => "square",
                    _ => "butt",
                };
                let join = match node.attr("strokeLineJoin") {
                    "1" => "round",
                    "2" => "bevel",
                    _ => "miter",
                };
                write!(out, "<path d=\"{}\" fill=\"{fill}\" fill-opacity=\"{fill_alpha}\" fill-rule=\"{rule}\" stroke=\"{stroke}\" stroke-opacity=\"{stroke_alpha}\" stroke-width=\"{stroke_width}\" stroke-linecap=\"{cap}\" stroke-linejoin=\"{join}\"/>", escape(path)).ok()?;
            }
            _ => return None,
        }
        if out.len() > 256 * 1024 {
            return None;
        }
    }
    Some(out)
}
