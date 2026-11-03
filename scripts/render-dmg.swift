import AppKit

// 用系统字体生成 1x / 2x 背景；TIFF 保留逻辑尺寸，避免 Retina 下提示文字模糊或放大。
struct Layout: Decodable {
    let width: Int
    let height: Int
    let appPosition: [Double]
    let background: String
    let arrow: String
    let foreground: String
    let instruction: String
}

func color(_ hex: String) -> NSColor {
    let value = UInt32(hex.dropFirst(), radix: 16)!
    return NSColor(srgbRed: CGFloat((value >> 16) & 255) / 255,
                   green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1)
}

let layout = try JSONDecoder().decode(Layout.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
let size = NSSize(width: layout.width, height: layout.height)
var representations: [NSImageRep] = []
for scale in [1, 2] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil,
                                 pixelsWide: layout.width * scale, pixelsHigh: layout.height * scale,
                                 bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                 isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let transform = AffineTransform(scale: CGFloat(scale))
    (transform as NSAffineTransform).concat()
    color(layout.background).setFill()
    NSRect(origin: .zero, size: size).fill()

    // Finder 图标坐标从顶部开始，AppKit 绘图坐标从底部开始。
    let midX = size.width / 2
    let arrowY = size.height - layout.appPosition[1]
    let arrow = NSBezierPath()
    arrow.move(to: NSPoint(x: midX - 25, y: arrowY))
    arrow.line(to: NSPoint(x: midX + 25, y: arrowY))
    arrow.move(to: NSPoint(x: midX + 17, y: arrowY + 8))
    arrow.line(to: NSPoint(x: midX + 25, y: arrowY))
    arrow.line(to: NSPoint(x: midX + 17, y: arrowY - 8))
    arrow.lineWidth = 2
    arrow.lineCapStyle = .round
    arrow.lineJoinStyle = .round
    color(layout.arrow).setStroke()
    arrow.stroke()

    func text(_ value: String, top: CGFloat, fontSize: CGFloat, tint: String) {
        let text = NSAttributedString(string: value, attributes: [
            .font: NSFont.systemFont(ofSize: fontSize), .foregroundColor: color(tint),
        ])
        let bounds = text.size()
        text.draw(at: NSPoint(x: (size.width - bounds.width) / 2, y: size.height - top - bounds.height))
    }
    text(layout.instruction, top: 272, fontSize: 14, tint: layout.foreground)
    NSGraphicsContext.restoreGraphicsState()
    bitmap.size = size
    representations.append(bitmap)
}
let output = NSBitmapImageRep.representationOfImageReps(in: representations, using: .tiff, properties: [:])!
try output.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
