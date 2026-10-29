import SwiftUI
import Foundation

// Manual UI language selection persists locally; never changes Core settings.
@MainActor
final class AppLanguage: ObservableObject {
    static let shared = AppLanguage()
    @Published var code: String {
        didSet { UserDefaults.standard.set(code, forKey: "uiLanguage") }
    }
    private init() {
        let stored = UserDefaults.standard.string(forKey: "uiLanguage")
        // English is the community first-run default. Respect saved choices,
        // including Chinese, rather than resetting an existing user's UI.
        code = stored == "zh" ? "zh" : "en"
    }
}

private let english: [String:String] = [
    "已停止": "Stopped",
    "AI 客户端": "AI client",
    "Gateway 内部工具": "Gateway internal tool",
    "MCP 连接拓扑": "MCP connection route",
    "仅保存调用时间、上游和结果，不保存内容；无法认证发起请求的 AI 客户端。": "Stores time, upstream and outcome only—not file contents. Calling AI client identity is unverified.",
    "停止连接": "Stop Core",
    "刷新状态": "Refresh status",
    "可信开发": "Trusted developer",
    "可访问": "Accessible",
    "启动连接": "Start Core",
    "工具错误": "Tool error",
    "已完成": "Completed",
    "已展开": "Expanded",
    "已收起": "Collapsed",
    "已确认可用路由，动画为示意": "Configured route available; animation is illustrative",
    "打开 macOS 隐私设置": "Open macOS Privacy Settings",
    "时间未知": "Unknown time",
    "最近 15 分钟暂无工具调用": "No tool calls in the past 15 minutes",
    "最近 15 分钟没有记录到工具调用。": "No tool calls recorded in the past 15 minutes.",
    "最近工具请求": "Recent tool calls",
    "最近工具请求：": "Recent tool calls: ",
    "服务状态": "Core status",
    "未运行": "Not running",
    "本机端口": "Local port",
    "点击展开或收起最近最多五次实际工具调用": "Expand to see up to five recent tool calls",
    "被拒绝": "Blocked",
    "路由未确认": "Route unverified",
    "运行正常": "Healthy",
    "退出": "Quit",
    "隐私与权限": "Privacy & permissions",
]

@MainActor
func tx(_ source: String) -> String {
    AppLanguage.shared.code == "en" ? (english[source] ?? source) : source
}
