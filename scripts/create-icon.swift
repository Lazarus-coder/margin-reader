#!/usr/bin/env swift
// Regenerate all Margin app icons with: swift scripts/create-icon.swift
// Uses only macOS frameworks and the system iconutil command.
import AppKit
import Foundation

let output = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "assets", isDirectory: true)
let fileManager = FileManager.default
try fileManager.createDirectory(at: output, withIntermediateDirectories: true)

let svg = """
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="graphite" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#4b525d"/>
      <stop offset="0.5" stop-color="#3c424c"/>
      <stop offset="1" stop-color="#313740"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="15" flood-color="#171b22" flood-opacity="0.2"/>
    </filter>
  </defs>
  <rect x="80" y="80" width="864" height="864" rx="194" fill="url(#graphite)" filter="url(#shadow)"/>
  <rect x="81" y="81" width="862" height="862" rx="193" fill="none" stroke="#ffffff" stroke-opacity="0.13" stroke-width="2"/>
  <path d="M300 380 L456 512 L300 644 M550 644 H728" fill="none" stroke="#f2f1ed" stroke-width="52" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""
try svg.write(to: output.appendingPathComponent("icon.svg"), atomically: true, encoding: .utf8)

func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}

func drawIcon(size: Int) throws -> Data {
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                            bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    context.translateBy(x: 0, y: 1024)
    context.scaleBy(x: 1, y: -1)
    let background = CGPath(roundedRect: CGRect(x: 80, y: 80, width: 864, height: 864),
                            cornerWidth: 194, cornerHeight: 194, transform: nil)
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: 14), blur: 30, color: color(0x171b22, alpha: 0.2))
    context.addPath(background)
    context.setFillColor(color(0x3c424c))
    context.fillPath()
    context.restoreGState()
    context.saveGState()
    context.addPath(background)
    context.clip()
    let colors = [color(0x4b525d), color(0x3c424c), color(0x313740)] as CFArray
    let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 0.5, 1])!
    context.drawLinearGradient(gradient, start: CGPoint(x: 80, y: 80), end: CGPoint(x: 80, y: 944), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    context.restoreGState()
    context.addPath(CGPath(roundedRect: CGRect(x: 81, y: 81, width: 862, height: 862), cornerWidth: 193, cornerHeight: 193, transform: nil))
    context.setStrokeColor(color(0xffffff, alpha: 0.13))
    context.setLineWidth(2)
    context.strokePath()

    // A restrained command prompt stays legible at small Dock and Finder sizes.
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.move(to: CGPoint(x: 300, y: 380))
    context.addLine(to: CGPoint(x: 456, y: 512))
    context.addLine(to: CGPoint(x: 300, y: 644))
    context.move(to: CGPoint(x: 550, y: 644))
    context.addLine(to: CGPoint(x: 728, y: 644))
    context.setStrokeColor(color(0xf2f1ed))
    context.setLineWidth(52)
    context.strokePath()

    let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
    return bitmap.representation(using: .png, properties: [:])!
}

try drawIcon(size: 1024).write(to: output.appendingPathComponent("icon.png"))
// Modern Windows ICO files can store PNG images at each resolution.
func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
    var little = value.littleEndian
    withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
}
let icoSizes = [16, 32, 48, 64, 128, 256]
let icoImages = try icoSizes.map { try drawIcon(size: $0) }
var ico = Data()
appendLittleEndian(UInt16(0), to: &ico)
appendLittleEndian(UInt16(1), to: &ico)
appendLittleEndian(UInt16(icoSizes.count), to: &ico)
var icoOffset = 6 + 16 * icoSizes.count
for (size, image) in zip(icoSizes, icoImages) {
    ico.append(contentsOf: [UInt8(size == 256 ? 0 : size), UInt8(size == 256 ? 0 : size), 0, 0])
    appendLittleEndian(UInt16(1), to: &ico)
    appendLittleEndian(UInt16(32), to: &ico)
    appendLittleEndian(UInt32(image.count), to: &ico)
    appendLittleEndian(UInt32(icoOffset), to: &ico)
    icoOffset += image.count
}
for image in icoImages { ico.append(image) }
try ico.write(to: output.appendingPathComponent("icon.ico"))
let iconset = fileManager.temporaryDirectory.appendingPathComponent("Margin-\(UUID().uuidString).iconset", isDirectory: true)
try fileManager.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? fileManager.removeItem(at: iconset) }
for size in [16, 32, 128, 256, 512] {
    try drawIcon(size: size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try drawIcon(size: size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["--convert", "icns", "--output", output.appendingPathComponent("icon.icns").path, iconset.path]
try process.run()
process.waitUntilExit()
guard process.terminationStatus == 0 else { fatalError("iconutil failed") }
print("Created icon.svg, icon.png, icon.ico, and icon.icns in \(output.path)")
