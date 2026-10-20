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
    let snapshot: GatewayConnectionSnapshot?
    @ObservedObject private var uiLanguage = AppLanguage.shared

    private var tunnelReady: Bool {
        snapshot?.tunnelRunning == true &&
        snapshot?.tunnelPointsToLiveGateway == true
    }
    private var upstreamReady: Bool {
        snapshot?.upstreamState == "ready"
    }
    private var directDescription: String {
        if snapshot?.directHttpsStatus == "disabled" ||
           snapshot?.directHttpsStatus == "stopped" {
            return tx("HTTPS 直连未启用")
        }
        if snapshot?.directHttpsStatus == "running" {
            return tx("HTTPS 入口进程运行（外部连通性未验证）")
        }
        return tx("HTTPS 直连状态待核验")
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center) {
                Text(tx("MCP 连接拓扑"))
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
                HStack(spacing: 5) {
                    Circle()
                        .fill(tunnelReady ? Color.green : Color.orange)
                        .frame(width: 6, height: 6)
                    Text(tunnelReady ? tx("Tunnel 路径可用") : tx("连接路径待确认"))
                        .font(.system(size: 9.5, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 2) {
                FlowNode(title: snapshot?.configuredClient == "ChatGPT"
                    ? "ChatGPT" : tx("AI 客户端"), detail: tx("已配置"),
                    symbol: "bubble.left.and.bubble.right",
                    tint: FlowPalette.violet, highlighted: tunnelReady)
                RouteParticles(ready: tunnelReady)
                FlowNode(title: "OpenAI", detail: "Tunnel",
                    symbol: "arrow.left.arrow.right",
                    tint: FlowPalette.blue, highlighted: tunnelReady)
                RouteParticles(ready: tunnelReady)
                FlowNode(title: "Mac MCP", detail: "Gateway",
                    symbol: "point.3.connected.trianglepath.dotted",
                    tint: FlowPalette.blue, highlighted: tunnelReady)
                RouteParticles(ready: upstreamReady)
                FlowNode(title: "Desktop", detail: "Commander",
                    symbol: "server.rack",
                    tint: FlowPalette.cyan, highlighted: upstreamReady)
            }
            HStack(spacing: 5) {
                Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                    .font(.system(size: 11))
                    .foregroundStyle(FlowPalette.blue)
                Text(tx("当前通道：Secure MCP Tunnel → 本机 8793"))
                    .font(.system(size: 10.5, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Spacer(minLength: 2)
            }
            HStack(spacing: 5) {
                Image(systemName: "globe")
                    .foregroundStyle(.secondary)
                Text(tx("HTTPS 直连"))
                    .font(.system(size: 9.8, weight: .medium))
                RouteParticles(ready: false)
                    .frame(width: 22)
                Text(snapshot?.directHttpsStatus == "disabled"
                    ? tx("未启用") : directDescription)
                    .font(.system(size: 9.8))
                    .foregroundStyle(.secondary)
                Spacer()
                if let count = snapshot?.upstreamToolCount, upstreamReady {
                    Text(uiLanguage.code == "en" ? "\(count) tools" : "\(count) 项工具")
                        .font(.system(size: 9.8, weight: .medium))
                        .foregroundStyle(FlowPalette.blue)
                }
            }
            Rectangle().fill(FlowPalette.blue.opacity(0.12)).frame(height: 0.5)
            RecentActivityDisclosure(activity: snapshot?.recentToolActivity)
            Text(tx("流动光点表示已配置且可用的路线，不代表真实数据包；客户端身份尚未验证。"))
                .font(.system(size: 9.3))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 15)
                .fill(LinearGradient(colors: [
                    FlowPalette.violet.opacity(0.075),
                    FlowPalette.blue.opacity(0.07),
                    FlowPalette.cyan.opacity(0.07)
                ], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(RoundedRectangle(cornerRadius: 15)
                    .strokeBorder(FlowPalette.blue.opacity(0.18), lineWidth: 1))
        )
    }
}
