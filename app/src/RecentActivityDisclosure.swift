import Foundation
import SwiftUI

// The server returns at most five anonymous, memory-only tool outcomes.
// Expanding is UI-local state: no additional request or permission.
struct RecentActivityDisclosure: View {
    let activity: RecentToolActivity?
    @ObservedObject private var uiLanguage = AppLanguage.shared

    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var items: [RecentToolEvent] {
        Array((activity?.recent ?? []).prefix(5))
    }
    private var isAvailable: Bool { activity != nil }

    private func upstreamName(_ route: String) -> String {
        switch route {
        case "desktop": return "Desktop Commander"
        case "gateway": return tx("Gateway 内部工具")
        case "unknown": return tx("路由未确认")
        default: return "MCP · " + route
        }
    }
    private func outcomeLabel(_ outcome: String) -> String {
        switch outcome {
        case "blocked": return tx("被拒绝")
        case "error": return tx("工具错误")
        default: return tx("已完成")
        }
    }
    private func outcomeColor(_ outcome: String) -> Color {
        switch outcome {
        case "blocked": return .orange
        case "error": return .red
        default: return .green
        }
    }
    private func outcomeSymbol(_ outcome: String) -> String {
        switch outcome {
        case "blocked": return "minus.circle.fill"
        case "error": return "xmark.circle.fill"
        default: return "checkmark.circle.fill"
        }
    }
    private func localTime(_ value: String, seconds: Bool = false) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value) ??
            ISO8601DateFormatter().date(from: value)
        else { return tx("时间未知") }
        return seconds
            ? date.formatted(.dateTime.hour().minute().second())
            : date.formatted(date: .omitted, time: .shortened)
    }

    private var lastSummary: String {
        guard isAvailable else { return (uiLanguage.code == "en" ? "Activity unavailable" : "暂无调用观测") }
        guard let last = items.first else { return tx("最近 15 分钟暂无工具调用") }
        return localTime(last.at) + " · " + upstreamName(last.route) +
            " · " + outcomeLabel(last.outcome)
    }
    private var lastColor: Color {
        guard let last = items.first else { return .secondary }
        return outcomeColor(last.outcome)
    }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) {
                    expanded.toggle()
                }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .frame(width: 17)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(tx("最近工具请求"))
                                .font(.system(size: 10.7, weight: .semibold))
                                .foregroundStyle(.primary)
                            if !items.isEmpty {
                                Circle().fill(lastColor)
                                    .frame(width: 5, height: 5)
                            }
                        }
                        Text(lastSummary)
                            .font(.system(size: 9.7))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.81)
                    }
                    Spacer(minLength: 2)
                    if !items.isEmpty {
                        Text(uiLanguage.code == "en" ? "\(items.count) calls" : "\(items.count) 条")
                            .font(.system(size: 9.5, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 15)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(tx("最近工具请求：") + lastSummary)
            .accessibilityValue(expanded ? tx("已展开") : tx("已收起"))
            .accessibilityHint(tx("点击展开或收起最近最多五次实际工具调用"))

            if expanded {
                Rectangle()
                    .fill(Color.secondary.opacity(0.12))
                    .frame(height: 0.5)
                    .padding(.bottom, 9)
                VStack(alignment: .leading, spacing: 9) {
                    if items.isEmpty {
                        Label(isAvailable
                              ? tx("最近 15 分钟没有记录到工具调用。")
                              : (uiLanguage.code == "en" ? "No activity snapshot is available for this workspace." : "当前工作区暂无可用的调用记录。"),
                              systemImage: "info.circle")
                            .font(.system(size: 10.2))
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(items.enumerated()), id: \.offset) { offset, event in
                            if offset > 0 {
                                Rectangle()
                                    .fill(Color.secondary.opacity(0.08))
                                    .frame(height: 0.5)
                            }
                            eventRow(event)
                        }
                    }
                    Text(tx("仅保存调用时间、上游和结果，不保存内容；无法认证发起请求的 AI 客户端。"))
                        .font(.system(size: 9.3))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.bottom, 6)
                .transition(reduceMotion ? .identity : .opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, 9)
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.56),
                    in: RoundedRectangle(cornerRadius: 10))
    }

    private func eventRow(_ event: RecentToolEvent) -> some View {
        let color = outcomeColor(event.outcome)
        return HStack(alignment: .center, spacing: 9) {
            Image(systemName: outcomeSymbol(event.outcome))
                .font(.system(size: 12))
                .foregroundStyle(color)
                .frame(width: 17)
                .accessibilityHidden(true)
            Text(localTime(event.at, seconds: true))
                .font(.system(size: 10.2, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(.primary)
                .frame(width: 68, alignment: .leading)
            Text(upstreamName(event.route))
                .font(.system(size: 10.3))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Spacer(minLength: 0)
            Text(outcomeLabel(event.outcome))
                .font(.system(size: 9.7, weight: .medium))
                .foregroundStyle(color)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(color.opacity(0.09), in: Capsule())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(localTime(event.at, seconds: true) + "，" +
            upstreamName(event.route) + "，" + outcomeLabel(event.outcome))
    }
}
