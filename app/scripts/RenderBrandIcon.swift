import AppKit
import Foundation

// Original white-tile M mark; an independent monochrome template for macOS.
let arguments=CommandLine.arguments
guard arguments.count==2 else { fatalError("RenderBrandIcon.swift OUT_DIR") }
let out=URL(fileURLWithPath:arguments[1],isDirectory:true)
try FileManager.default.createDirectory(at:out,withIntermediateDirectories:true)

func segment(_ pts:[NSPoint], k:CGFloat) -> NSBezierPath {
    let path=NSBezierPath()
    guard let first=pts.first else {return path}
    path.move(to:first)
    for p in pts.dropFirst(){path.line(to:p)}
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    path.lineWidth = 51*k
    return path
}
func draw(_ px:Int, template:Bool) -> Data {
    guard let rep=NSBitmapImageRep(bitmapDataPlanes:nil,
        pixelsWide:px,pixelsHigh:px,bitsPerSample:8,samplesPerPixel:4,
        hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,
        bytesPerRow:0,bitsPerPixel:0),
        let gc=NSGraphicsContext(bitmapImageRep:rep)
    else {fatalError("Bitmap unavailable")}
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current=gc
    gc.imageInterpolation = .high
    let k=CGFloat(px)/512
    NSColor.clear.setFill()
    NSRect(x:0,y:0,width:px,height:px).fill()
    if !template {
        let tile=NSBezierPath(roundedRect:NSRect(x:14*k,y:14*k,width:484*k,height:484*k),
            xRadius:105*k,yRadius:105*k)
        NSColor(calibratedWhite:1,alpha:1).setFill()
        tile.fill()
        tile.lineWidth=4*k
        NSColor(calibratedWhite:0.84,alpha:0.9).setStroke()
        tile.stroke()
    }
    let violet=NSColor(calibratedRed:0.47,green:0.30,blue:0.95,alpha:1)
    let cobalt=NSColor(calibratedRed:0.16,green:0.37,blue:0.98,alpha:1)
    let aqua=NSColor(calibratedRed:0.05,green:0.69,blue:0.90,alpha:1)
    // Three contiguous soft-corner ribbons, a vivid gradient-style letter.
    let a=segment([NSPoint(x:116*k,y:160*k),NSPoint(x:184*k,y:348*k),
                   NSPoint(x:250*k,y:232*k)],k:k)
    let b=segment([NSPoint(x:184*k,y:348*k),NSPoint(x:250*k,y:232*k),
                   NSPoint(x:323*k,y:348*k)],k:k)
    let c=segment([NSPoint(x:250*k,y:232*k),NSPoint(x:323*k,y:348*k),
                   NSPoint(x:396*k,y:160*k)],k:k)
    if template {
        NSColor.black.setStroke();a.stroke();b.stroke();c.stroke()
    } else {
        violet.setStroke();a.stroke()
        cobalt.setStroke();b.stroke()
        aqua.setStroke();c.stroke()
    }
    NSGraphicsContext.restoreGraphicsState()
    guard let data=rep.representation(using:.png,properties:[:]) else {
        fatalError("PNG encoding failed")
    }
    return data
}
try draw(1024,template:false).write(to:out.appendingPathComponent("AppLogo.png"))
try draw(80,template:true).write(to:out.appendingPathComponent("MenuBarTemplate.png"))
print("PHASE3_CONNECTION_BRAND_WHITE_TILE_GRADIENT_M_READY")
