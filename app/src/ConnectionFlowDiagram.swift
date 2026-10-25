import SwiftUI
import Foundation

// A map of the *configured and locally checked* path, NOT observed
// packet movement. Bright particles mean route readiness; never imply
// a remote client identity or requests currently in flight.
private enum FlowPalette {
    static let violet = Color(red: 0.45, green: 0.32, blue: 0.92)
    static let blue = Color(red: 0.16, green: 0.40, blue: 0.93)
    static let cyan = Color(red: 0.08, green: 0.66, blue: 0.85)
}

private struct RouteParticles: View {
    let ready: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.16,
                                paused: !ready || reduceMotion)) { timeline in
            Canvas { context, size in
                let center = size.height / 2
                var path = Path()
                path.move(to: CGPoint(x: 1, y: center))
                path.addLine(to: CGPoint(x: max(1, size.width - 2), y: center))
                context.stroke(path,
                    with: .color(ready ? FlowPalette.blue.opacity(0.45) :
                                    Color.secondary.opacity(0.26)),
                    style: StrokeStyle(lineWidth: 1.6, lineCap: .round,
                                       dash: [2.5, 2.5]))
                var arrow = Path()
                arrow.move(to: CGPoint(x: size.width - 4, y: center - 3))
                arrow.addLine(to: CGPoint(x: size.width - 1, y: center))
                arrow.addLine(to: CGPoint(x: size.width - 4, y: center + 3))
                context.stroke(arrow, with: .color(ready ?
                    FlowPalette.blue : Color.secondary.opacity(0.4)),
                    style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
                if ready && !reduceMotion {
                    let phase = timeline.date.timeIntervalSinceReferenceDate
                        .truncatingRemainder(dividingBy: 2.1) / 2.1
                    let x = CGFloat(phase) * max(1, size.width - 7) + 1
                    let dot = CGRect(x: x - 2.4, y: center - 2.4,
                                     width: 4.8, height: 4.8)
                    context.fill(Path(ellipseIn: dot), with: .color(FlowPalette.cyan))
                }
            }
        }
        .frame(width: 18, height: 31)
        .accessibilityLabel(ready ? tx("已确认可用路由，动画为示意") : tx("路由未确认"))
    }
}

private struct FlowNode: View {
    let title: String
    let detail: String
    let symbol: String
    let tint: Color
    let highlighted: Bool

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(tint)
                .frame(height: 23)
            Text(title)
                .font(.system(size: 10.5, weight: .semibold))
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .multilineTextAlignment(.center)
            Text(detail)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, minHeight: 66)
        .padding(.horizontal, 4)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 11)
                .fill(highlighted ? tint.opacity(0.09) :
                    Color(nsColor: .windowBackgroundColor).opacity(0.7))
                .overlay(RoundedRectangle(cornerRadius: 11)
                    .strokeBorder(tint.opacity(highlighted ? 0.25 : 0.10),
                                  lineWidth: 1))
        )
        .accessibilityElement(children: .combine)
    }
}

struct ConnectionFlowDiagram: View {
    let port: Int?
    let localReady: Bool
    let activity: RecentToolActivity?
    @ObservedObject private var language = AppLanguage.shared
    private func text(_ zh: String, _ en: String) -> String { language.code == "en" ? en : zh }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(text("MCP 连接拓扑", "MCP connection")).font(.system(size: 13, weight: .semibold))
                Spacer()
                Circle().fill(localReady ? Color.green : .secondary).frame(width: 6, height: 6)
                Text(localReady ? text("本机已就绪", "Local ready") : text("本机未连接", "Local offline")).font(.system(size: 9.5)).foregroundStyle(.secondary)
            }
            HStack(spacing: 2) {
                FlowNode(title: text("AI 客户端", "AI client"), detail: text("远程", "Remote"), symbol: "bubble.left.and.bubble.right", tint: FlowPalette.violet, highlighted: false)
                RouteParticles(ready: false)
                FlowNode(title: "HTTPS", detail: "/ Tunnel", symbol: "arrow.left.arrow.right", tint: FlowPalette.blue, highlighted: false)
                RouteParticles(ready: false)
                FlowNode(title: "Starmux", detail: text("本机", "Local"), symbol: "point.3.connected.trianglepath.dotted", tint: FlowPalette.blue, highlighted: localReady)
                RouteParticles(ready: localReady)
                FlowNode(title: text("工作区", "Workspace"), detail: text("工具", "Tools"), symbol: "server.rack", tint: FlowPalette.cyan, highlighted: localReady)
            }
            Label(port.map { "127.0.0.1:\($0)/mcp" } ?? text("启动后显示本机地址", "Start to see your local endpoint"), systemImage: "link")
                .font(.system(size: 10.5, weight: .medium)).textSelection(.enabled)
            Text(text("远程入口单独配置；本机就绪不代表远程客户端已连接。", "Configure your remote route separately; local readiness does not confirm a remote client connection."))
                .font(.system(size: 9.5)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Divider()
            RecentActivityDisclosure(activity: activity)
        }.padding(10)
        .background(RoundedRectangle(cornerRadius: 15).fill(LinearGradient(colors: [FlowPalette.violet.opacity(0.075), FlowPalette.blue.opacity(0.07), FlowPalette.cyan.opacity(0.07)], startPoint: .topLeading, endPoint: .bottomTrailing)).overlay(RoundedRectangle(cornerRadius: 15).strokeBorder(FlowPalette.blue.opacity(0.18), lineWidth: 1)))
    }
}
