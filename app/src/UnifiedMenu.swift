import SwiftUI
import AppKit

private enum ProductPalette {
    static let blue = Color(red: 0.15, green: 0.38, blue: 0.88)
    static let aqua = Color(red: 0.10, green: 0.62, blue: 0.81)
    static let surface = Color(nsColor: .controlBackgroundColor)
}
private struct TextIcon: View {
    let symbol: String
    var tint: Color = ProductPalette.blue
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 17, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: 38, height: 38)
            .background(tint.opacity(0.09), in: RoundedRectangle(cornerRadius: 11))
    }
}

private struct NavigationTile: View {
    let title: String
    let detail: String
    let symbol: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                TextIcon(symbol: symbol)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.primary)
                    Text(detail)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 7)
            .padding(.horizontal, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(ProductPalette.surface.opacity(0.46), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel(title)
        .help(detail)
    }
}

private struct QuickAction: View {
    let title: String
    let caption: String
    let symbol: String
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(alignment: .center, spacing: 5) {
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(disabled ? Color.gray : ProductPalette.blue)
                    .frame(height: 21)
                Text(title).font(.system(size: 11.3, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1).minimumScaleFactor(0.72)
                Text(caption).font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .lineLimit(1).minimumScaleFactor(0.75)
            }
            .frame(maxWidth: .infinity, minHeight: 60)
            .padding(.horizontal, 5).padding(.vertical, 7)
            .background(ProductPalette.surface.opacity(0.70),
                        in: RoundedRectangle(cornerRadius: 11))
            .contentShape(RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
    }
}

private struct InfoPill: View {
    let title: String
    let value: String
    let icon: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
            Text(value).font(.system(size: 12, weight: .semibold))
                .lineLimit(2)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        .padding(10)
        .background(ProductPalette.surface.opacity(0.65),
                    in: RoundedRectangle(cornerRadius: 12))
    }
}

// The menu observes the same authenticated instance registry as the manager.
// Opening it never initializes a workspace or changes the selected runtime.
struct UnifiedGatewayMenu: View {
    @ObservedObject private var model = InstanceController.shared
    @ObservedObject private var language = AppLanguage.shared
    @State private var permissions = false
    @State private var activity: RecentToolActivity?
    @State private var capability: CurrentPermissionSnapshot?
    @State private var configuration: ManagedInstance.Configuration?
    @State private var checkedAt: Date?
    private var instance: ManagedInstance? { model.instances.first { $0.id == model.selectedId && !$0.archived } }
    private var ready: Bool { instance?.ready == true }
    private var tint: Color { ready ? .green : instance?.running == true ? .orange : .secondary }
    private func text(_ zh: String, _ en: String) -> String { language.code == "en" ? en : zh }
    private var mode: String {
        guard let config = configuration else { return text("等待配置", "Awaiting configuration") }
        if config.accessRole == "trusted" {
            return config.writeScope == "home-only" ? text("编程 · Home 沙箱", "Coding · Home sandbox") : text("编程 · 当前账户", "Coding · OS account")
        }
        return config.mode == "read-only" ? text("只读", "Read-only") : text("受限文件写入", "Restricted file writes")
    }
    private var phase: String {
        guard let instance else { return text("尚未设置", "Not set up") }
        if ready { return text("运行正常", "Running") }
        switch instance.phase {
        case "starting": return text("正在启动", "Starting")
        case "stopping": return text("正在停止", "Stopping")
        case "stopped": return text("已停止", "Stopped")
        default: return text("需要检查", "Needs attention")
        }
    }
    private func refresh() async {
        await model.refresh()
        guard let selected = instance else { configuration = nil; activity = nil; capability = nil; checkedAt = Date(); return }
        let id = selected.id
        let saved = try? await Task.detached {
            let bytes = try InstanceController.execute(["config", "show", "-i", id])
            struct Envelope: Decodable { let config: ManagedInstance.Configuration }
            return try JSONDecoder().decode(Envelope.self, from: bytes).config
        }.value
        guard instance?.id == id, !Task.isCancelled else { return }
        configuration = selected.running ? selected.active?.config : saved
        if !selected.ready { activity = nil; capability = nil }
        if selected.ready, let port = selected.port {
            let observed = await ConnectionDiagnostics.readActivity(port: port)
            let access = permissions ? await CurrentPermissionProbe.read(port: port) : nil
            guard instance?.id == id, !Task.isCancelled else { return }
            activity = observed; capability = access
        }
        checkedAt = Date()
    }
    private func setup() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.message = text("选择 AI 可以读取的工作区", "Choose a workspace for your AI to read")
        panel.prompt = text("选择工作区", "Choose workspace")
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        Task {
            guard await model.perform(["init", folder.path, "--read"]) != nil, let selected = instance else { return }
            await model.start(selected); await refresh()
        }
    }
    private func dashboard() {
        guard let selected = instance, selected.ready else { return }
        Task { _ = await model.perform(["dashboard", "-i", selected.id]) }
    }
    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if permissions { privacy } else { home }
                    if let issue = model.issue ?? instance?.configProblem ?? (instance?.phase == "error" ? instance?.runtimeProblem : nil) {
                        Label(issue, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange).textSelection(.enabled)
                    }
                }.padding(17).frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack {
                Text(checkedAt.map { text("检查于 ", "Checked ") + $0.formatted(date: .omitted, time: .shortened) } ?? text("正在检查…", "Checking…"))
                    .font(.system(size: 10)).foregroundStyle(.secondary)
                Spacer()
                Picker("Language", selection: $language.code) { Text("EN").tag("en"); Text("中文").tag("zh") }.labelsHidden().frame(width: 75)
                Button(text("退出", "Quit")) { NSApp.terminate(nil) }.controlSize(.small)
            }.padding(.horizontal, 17).padding(.vertical, 10)
        }
        .frame(width: 430, height: 700)
        .background(Color(nsColor: .windowBackgroundColor))
        .onChange(of: permissions) { _ in Task { await refresh() } }
        .task(id: model.selectedId) {
            configuration = nil; activity = nil; capability = nil
            await refresh()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { break }
                await refresh()
            }
        }
    }
    private var header: some View {
        HStack(spacing: 11) {
            if permissions {
                Button { permissions = false } label: { Image(systemName: "chevron.left").frame(width: 36, height: 36) }.buttonStyle(.plain).accessibilityLabel(text("返回", "Back"))
            } else if let url = Bundle.main.url(forResource: "AppLogo", withExtension: "png"), let image = NSImage(contentsOf: url) {
                Image(nsImage: image).resizable().frame(width: 36, height: 36)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(permissions ? text("隐私与权限", "Privacy & permissions") : "Starmux").font(.system(size: 15, weight: .bold))
                Text(text("你的电脑，你的工具，连接你的 AI。", "Your computer. Your tools. Your AI.")).font(.system(size: 10.5)).foregroundStyle(.secondary)
            }
            Spacer()
            Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise").frame(width: 30, height: 30) }
                .buttonStyle(.plain).help(text("刷新状态", "Refresh status")).disabled(model.busy)
        }.padding(16)
    }
    private var home: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.instances.filter({ !$0.archived }).count > 1 {
                Picker(text("工作区", "Workspace"), selection: $model.selectedId) {
                    ForEach(model.instances.filter { !$0.archived }) { Text($0.name).tag(Optional($0.id)) }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Circle().fill(tint).frame(width: 8, height: 8)
                    Text(text("服务状态", "Service status")).font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Text(phase).font(.system(size: 11, weight: .semibold)).foregroundStyle(tint).padding(.horizontal, 9).padding(.vertical, 5).background(tint.opacity(0.1), in: Capsule())
                }
                Text(configuration?.projectRoot.replacingOccurrences(of: NSHomeDirectory() + "/", with: "~/") ?? text("选择项目，即可开始安全的只读连接。", "Choose a project to start a safe, read-only connection."))
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                if instance != nil {
                    Label(mode, systemImage: "lock.shield").font(.system(size: 11)).foregroundStyle(ProductPalette.blue)
                    if instance?.configState == "pending" { Text(text("有待应用的设置 · 当前仍使用运行配置", "Changes pending · showing active settings")).font(.caption).foregroundStyle(.orange) }
                }
            }.padding(12).background(RoundedRectangle(cornerRadius: 15).fill(LinearGradient(colors: [ProductPalette.blue.opacity(0.12), ProductPalette.aqua.opacity(0.065)], startPoint: .topLeading, endPoint: .bottomTrailing)).overlay(RoundedRectangle(cornerRadius: 15).strokeBorder(ProductPalette.blue.opacity(0.12), lineWidth: 1)))
            if let selected = instance {
                HStack(spacing: 8) {
                    QuickAction(title: text("访问控制台", "Access console"), caption: text("管理客户端", "Manage clients"), symbol: "rectangle.on.rectangle", disabled: !ready, action: dashboard)
                    QuickAction(title: text("隐私与权限", "Permissions"), caption: mode, symbol: "lock.shield") { permissions = true }
                    QuickAction(title: selected.running ? text("停止连接", "Stop") : text("启动连接", "Start"), caption: text("本机服务", "Local gateway"), symbol: selected.running ? "stop.circle" : "play.circle", disabled: model.busy) {
                        Task {
                            if selected.running { _ = await model.perform(["down", "-i", selected.id]) } else { await model.start(selected) }
                            await refresh()
                        }
                    }
                }
                ConnectionFlowDiagram(port: selected.ready ? selected.port : nil, localReady: ready, activity: activity)
                HStack(spacing: 8) {
                    InfoPill(title: text("鉴权", "Authentication"), value: selected.requiredAccess == "api-key" ? "API Key" : selected.requiredAccess == "oauth" ? "OAuth" : "Ingress", icon: "key")
                    InfoPill(title: text("运行方式", "Runtime"), value: selected.runtime?.launcher == "app" ? text("由 App 管理", "App-owned") : selected.executionMode == "background" ? text("后台运行", "Background") : selected.running ? text("终端前台", "Foreground") : text("已停止", "Stopped"), icon: "terminal")
                }
            } else {
                Button(action: setup) { Label(text("选择工作区并启动", "Choose workspace & start"), systemImage: "folder.badge.plus").frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).disabled(model.busy)
                Text(text("默认只读。首次启用编程权限时会要求确认。", "Read-only by default. Coding permissions require your confirmation.")).font(.caption).foregroundStyle(.secondary)
            }
            NavigationTile(title: text("工作区与设置", "Workspaces & settings"), detail: text("配置、权限模式与进阶实例管理", "Configuration, coding mode and advanced instances"), symbol: "slider.horizontal.3") { InstanceManagerWindow.shared.show() }
        }
    }
    private var privacy: some View {
        VStack(alignment: .leading, spacing: 12) {
            InfoPill(title: text("当前权限", "Current permissions"), value: mode, icon: "lock.shield")
            Text(configuration?.accessRole == "trusted"
                 ? configuration?.writeScope == "home-only" ? text("保留迁移配置的 Home 写入沙箱。", "This migrated configuration retains its Home-write sandbox.") : text("AI 可修改当前账户可访问的文件并执行 Shell/Git。", "AI can modify files accessible to your OS account and execute Shell/Git.")
                 : configuration?.mode == "read-write" ? text("文件写入受配置规则限制，禁止任意 Shell。", "File writes follow the configured rules; arbitrary Shell is blocked.") : text("只读模式禁止文件写入与任意 Shell。", "Read-only mode blocks file writes and arbitrary Shell."))
                .font(.callout).foregroundStyle(.secondary)
            if let capability {
                Text(text("本机目录访问检查", "Local directory access")).font(.headline)
                ForEach(capability.checks, id: \.id) { check in
                    HStack { Text(tx(check.label)); Spacer(); Text(check.state == "READ_OK" ? text("可访问", "Accessible") : check.state == "OS_DENIED" ? text("系统拒绝", "OS denied") : check.state == "MISSING" ? text("不存在", "Missing") : text("未确认", "Unknown")).font(.caption).foregroundStyle(.secondary); Image(systemName: check.state == "READ_OK" ? "checkmark.circle.fill" : "minus.circle").foregroundStyle(check.state == "READ_OK" ? Color.green : .secondary) }
                }
                Text(text("反映系统目录访问能力，不代表 AI 工具授权。", "Shows OS directory access, separately from AI tool permissions.")).font(.caption).foregroundStyle(.secondary)
            } else { Text(text("启动服务后可查看本机目录访问情况。", "Start the service to check local directory access.")).font(.caption).foregroundStyle(.secondary) }
            NavigationTile(title: text("管理权限模式", "Manage permission mode"), detail: text("只读或完整编程权限", "Read-only or full coding access"), symbol: "slider.horizontal.3") { InstanceManagerWindow.shared.show() }
            Button(text("打开 macOS 隐私设置", "Open macOS privacy settings")) {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") { NSWorkspace.shared.open(url) }
            }
        }
    }
}

// Reopening the App offers the same monitor as the menu bar, not advanced settings.
@MainActor
final class MonitorWindow {
    static let shared = MonitorWindow()
    private var window: NSWindow?
    func show() {
        if window == nil {
            let value = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 430, height: 700), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            value.title = "Starmux"; value.contentView = NSHostingView(rootView: UnifiedGatewayMenu())
            value.isReleasedWhenClosed = false; value.center(); window = value
        }
        NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil)
    }
}
extension AppForegroundExitDelegate {
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        Task { @MainActor in MonitorWindow.shared.show() }; return true
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Explicit developer/accessibility entrypoint; ordinary launch stays in the menu bar.
        if CommandLine.arguments.contains("--show-monitor") { Task { @MainActor in MonitorWindow.shared.show() } }
    }
}

@main
struct StarmuxApp: App {
    @NSApplicationDelegateAdaptor(AppForegroundExitDelegate.self) private var lifecycle
    private let menuMark: NSImage? = {
        guard let path = Bundle.main.path(forResource: "MenuBarTemplate", ofType: "png"),
              let image = NSImage(contentsOfFile: path) else { return nil }
        image.isTemplate = true
        image.size = NSSize(width: 19, height: 19)
        return image
    }()
    var body: some Scene {
        MenuBarExtra {
            UnifiedGatewayMenu()
        } label: {
            if let menuMark {
                Image(nsImage: menuMark)
                    .interpolation(.high)
                    .accessibilityLabel("Starmux")
            } else {
                Image(systemName: "point.3.connected.trianglepath.dotted")
            }
        }
        .menuBarExtraStyle(.window)
    }
}
