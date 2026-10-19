#!/usr/bin/env swift
// Regenerates icon.png, icon.ico, and icon.icns from assets/icon.svg.
// Run from the repository root: swift scripts/create-icon.swift
// Uses only macOS frameworks and the system iconutil command.
import AppKit
import Foundation

let output = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "assets", isDirectory: true)
let fileManager = FileManager.default

let svgURL = output.appendingPathComponent("icon.svg")
guard
    let svgData = try? Data(contentsOf: svgURL),
    let artwork = NSImage(data: svgData)
else {
    fatalError("Could not load \(svgURL.path)")
}

func render(size: Int) -> Data {
    guard
        let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )
    else { fatalError("Could not allocate a \(size)px canvas") }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    artwork.draw(
        in: NSRect(x: 0, y: 0, width: size, height: size),
        from: .zero, operation: .sourceOver, fraction: 1
    )
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode a \(size)px PNG")
    }
    return png
}

try render(size: 1024).write(to: output.appendingPathComponent("icon.png"))

// Modern Windows ICO files can store PNG images at each resolution.
func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
    var little = value.littleEndian
    withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
}
let icoSizes = [16, 32, 48, 64, 128, 256]
let icoImages = icoSizes.map(render(size:))
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
    try render(size: size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try render(size: size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["--convert", "icns", "--output", output.appendingPathComponent("icon.icns").path, iconset.path]
try process.run()
process.waitUntilExit()
guard process.terminationStatus == 0 else { fatalError("iconutil failed") }
print("Created icon.png, icon.ico, and icon.icns in \(output.path) from icon.svg")