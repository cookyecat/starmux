import SwiftUI
import AppKit

private enum ProductPalette {
    static let blue = Color(red: 0.15, green: 0.38, blue: 0.88)
    static let aqua = Color(red: 0.10, green: 0.62, blue: 0.81)
    static let surface = Color(nsColor: .controlBackgroundColor)
}
private enum MenuPage {
    case home
    case services
    case history
    case settings
    case configuration
}

@MainActor
final class UnifiedObserver: ObservableObject {
    @Published var gateway: SafeSnapshot?
    @Published var diagnostics: NativeDiagnosticSnapshot?
    @Published var connections: GatewayConnectionSnapshot?
    @Published var currentPermissions: CurrentPermissionSnapshot?
    @Published var issue: String?
    private var lastPermissionCheck: Date?
    private var lastPermissionPort: Int?
    @Published var busy = false

    func reload(forcePermissions: Bool = false) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        let result = await Task.detached(priority: .utility) {
            let gateway = try? StatusProbe.read()
            async let connection = ConnectionDiagnostics.read(port: gateway?.port ?? 8793)
            return (gateway, await connection)
        }.value
        gateway = result.0
        connections = result.1
        issue = result.0 == nil ? tx("暂时无法检查连接，请稍后重试") : nil
        guard result.0?.health == "ok", let port = result.0?.port else {
            currentPermissions = nil
            lastPermissionPort = nil
            lastPermissionCheck = nil
            return
        }
        let expired = lastPermissionCheck.map { Date().timeIntervalSince($0) >= 120 } ?? true
        if forcePermissions || lastPermissionPort != port || expired {
            currentPermissions = await CurrentPermissionProbe.read(port: port)
            lastPermissionPort = port
            lastPermissionCheck = Date()
        }
    }
    func loadHistoricalDiagnostics() async {
        let result = await Task.detached(priority: .utility) {
            NativeDiagnosticProbe.read()
        }.value
        diagnostics = result
    }
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
        .frame(maxWidth: .infinity, minHeight: 66, alignment: .leading)
        .padding(10)
        .background(ProductPalette.surface.opacity(0.65),
                    in: RoundedRectangle(cornerRadius: 12))
    }
}

struct UnifiedGatewayMenu: View {
    @StateObject private var observer = UnifiedObserver()
    @ObservedObject private var appRunner = AppGatewayRunner.shared
    @ObservedObject private var firstRun = FirstRunCoordinator.shared
    @ObservedObject private var uiLanguage = AppLanguage.shared
    // New user default: Home is writable, other paths are read-only for
    // the sandboxed Desktop Commander and its subprocesses.
    @State private var chosenFolder: URL? = FileManager.default.homeDirectoryForCurrentUser
    @State private var chosenConnection = "tunnel"
    @State private var chosenAccessRole = "trusted"
    @State private var trustedAcknowledged = false
    @State private var page: MenuPage = .home
    private var configuringLive: Bool { page == .configuration }
    private var needsFirstRun: Bool {
        // Never mistake a missing / still-loading observer snapshot for a
        // fresh installation. Existing owner live profile must show the
        // normal Core screen even if it is currently stopped.
        firstRun.available && !firstRun.configured && !healthy &&
        observer.gateway?.profile == "setup"
    }

    private var state: RuntimeKind { observer.gateway?.state ?? .unavailable }
    private var healthy: Bool { state == .externalForeground || state == .serviceRunning }
    private var appOwns: Bool { appRunner.ownsGateway }
    private var stateColor: Color {
        if healthy { return .green }
        return state == .stopped ? .secondary : .orange
    }
    private var lastChecked: String {
        guard let dateString = observer.gateway?.checkedAt ?? observer.diagnostics?.snapshotAt,
              let date = ISO8601DateFormatter().date(from: dateString) else { return tx("尚未检查") }
        return date.formatted(date: .omitted, time: .shortened)
    }
    private var logo: NSImage? {
        Bundle.main.url(forResource: "AppLogo", withExtension: "png")
            .flatMap(NSImage.init(contentsOf:))
    }
    private func prettyTime(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return tx("时间未知") }
        return date.formatted(.dateTime.month(.twoDigits).day(.twoDigits).hour().minute())
    }
    private func clipboardCommand() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("mac-mcp-gateway run", forType: .string)
    }
    private func openDashboard() {
        guard let port = observer.gateway?.port, (1024...65535).contains(port),
              observer.gateway?.health == "ok",
              let link = URL(string: "http://127.0.0.1:\(port)/dashboard") else { return }
        NSWorkspace.shared.open(link)
    }
    private func openFDASettings() {
        guard let link = URL(string:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") else { return }
        NSWorkspace.shared.open(link)
    }
    private func headerTitle() -> String {
        switch page {
        case .home: return "Mac MCP Gateway"
        case .services: return tx("隐私与权限")
        case .history: return tx("历史诊断记录")
        case .settings: return tx("设置与帮助")
        case .configuration: return tx("文件访问与工具设置")
        }
    }
    private func headerDetail() -> String {
        switch page {
        case .home: return tx("连接状态与快捷操作")
        case .services: return tx("仅检查本机文件访问能力")
        case .history: return tx("仅供排查问题时参考")
        case .settings: return tx("版本信息和高级诊断")
        case .configuration: return tx("管理当前 Core 的文件写入范围")
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(.separator).frame(height: 0.5)
            ScrollView {
                VStack(alignment: .leading, spacing: 13) {
                    switch page {
                    case .home:
                        if needsFirstRun { firstRunPage }
                        else { home }
                    case .services: services
                    case .history: history
                    case .settings: settings
                    case .configuration: firstRunPage
                    }
                }
                .padding(.horizontal, 17)
                .padding(.vertical, 13)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.automatic)
            .id(page) // New page gets a fresh scroll offset; header stays fixed.
            Rectangle().fill(.separator).frame(height: 0.5)
            footer
        }
        .frame(width: 430, height: 530)
        .background(Color(nsColor: .windowBackgroundColor))
        .task {
            firstRun.refresh()
            await observer.reload()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(25))
                if Task.isCancelled { break }
                await observer.reload()
            }
        }
    }

    private var header: some View {
        HStack(spacing: 11) {
            if page != .home {
                Button {
                    page = page == .configuration || page == .history ? .settings : .home
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                        .background(ProductPalette.surface.opacity(0.7),
                                    in: RoundedRectangle(cornerRadius: 11))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tx("返回上一页"))
                .help(tx("返回上一页"))
            } else if let logo {
                Image(nsImage: logo).resizable().interpolation(.high)
                    .frame(width: 36, height: 36)
                    .accessibilityLabel(tx("Mac MCP Gateway 标识"))
            } else {
                TextIcon(symbol: "point.3.connected.trianglepath.dotted")
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(headerTitle())
                    .font(.system(size: 15, weight: .bold))
                Text(headerDetail())
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button { Task { await observer.reload(forcePermissions: true) } } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 30, height: 30)
                    .background(ProductPalette.surface,
                                in: RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .disabled(observer.busy)
            .help(tx("刷新状态"))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
    }


    // Alfred-style guided first run, not a second technical settings panel:
    // choose a folder and decide a transport before writing a private profile.
    // FDA is not mandatory; the current Core tests protected directories later.
    private func chooseWorkFolder() {
        let panel = NSOpenPanel()
        panel.message = tx("选择默认启动目录（不改变 Home 内写入 / Home 外只读规则）")
        panel.prompt = tx("选择此文件夹")
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        // The menu-bar popup has no durable NSWindow sheet host. Async
        // begin() may dismiss behind its transient popover. Present a true
        // application-modal native panel synchronously on the main actor.
        let preferred = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Developer", isDirectory: true)
        if FileManager.default.fileExists(atPath: preferred.path) {
            panel.directoryURL = preferred
        }
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK, let url = panel.url {
            chosenFolder = url.standardizedFileURL
        }
    }

    private var firstRunPage: some View {
        VStack(alignment: .leading, spacing: 15) {
            VStack(alignment: .leading, spacing: 6) {
                Text(configuringLive ? tx("管理现有 Mac MCP Gateway") : tx("欢迎使用 Mac MCP Gateway"))
                    .font(.system(size: 17, weight: .bold))
                Text(tx("默认对用户 Home 内文件可读写，Home 之外只读；Desktop Commander 及其 Shell 子进程使用 macOS 沙箱执行。"))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                if configuringLive {
                    Label(tx("当前真实权限：") +
                          (observer.gateway?.writeScope == "home-only"
                            ? tx("Home 内读写 / Home 外只读（已生效）")
                            : tx("旧版可信开发（Home 外写入尚未限制）")),
                          systemImage: "slider.horizontal.3")
                        .font(.system(size: 11))
                        .foregroundStyle(observer.gateway?.writeScope == "home-only"
                                         ? .green : .orange)
                    Text(tx("应用时将安全停止唯一 Core、保存已确认的权限范围，再重新启动；并不会改变 Tunnel 或系统 FDA 权限。"))
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Label(tx("第 1 步 · 默认文件访问范围"), systemImage: "folder")
                    .font(.system(size: 13, weight: .semibold))
                if chosenAccessRole == "trusted" {
                    Label(tx("用户 Home · 可读写"), systemImage: "checkmark.shield.fill")
                        .foregroundStyle(.green)
                    Label(tx("Home 以外 · 只读"), systemImage: "lock.shield")
                        .foregroundStyle(ProductPalette.blue)
                    Text(tx("此规则覆盖受沙箱约束的 Desktop Commander 文件工具与它启动的 Shell。macOS 文件权限、TCC 和 Desktop Commander 自身策略仍然有效。"))
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                } else {
                    Text(tx("受限只读模式只允许访问指定项目目录，不开放写入或任意 Shell。请选择一个具体项目，不能选择整个 Home。"))
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if !configuringLive {
                    Button(chosenAccessRole == "trusted" ? tx("更改默认启动目录（可选）") :
                           (chosenFolder == nil ? tx("选择受限项目目录…") : tx("更换项目目录…"))) {
                        chooseWorkFolder()
                    }
                    .buttonStyle(.borderedProminent)
                }
                if let chosenFolder {
                    Label(chosenFolder.lastPathComponent, systemImage: "folder.fill")
                        .font(.system(size: 12))
                        .lineLimit(1)
                        .help(chosenFolder.path)
                }
                Label(chosenAccessRole == "trusted"
                      ? tx("Home 内读写 / Home 外只读 · macOS 进程级沙箱")
                      : tx("受限只读 · 禁止任意 Shell · 不自动授予全盘访问"),
                      systemImage: "lock.shield")
                    .font(.system(size: 11))
                    .foregroundStyle(chosenAccessRole == "trusted" ? .orange : .green)
            }
            .padding(13)
            .background(ProductPalette.surface, in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 10) {
                Label(tx("第 2 步 · 选择工具能力"), systemImage: "terminal")
                    .font(.system(size: 13, weight: .semibold))
                Picker(tx("能力模式"), selection: $chosenAccessRole) {
                    Text(tx("受限只读")).tag("restricted")
                    Text(tx("可信开发")).tag("trusted")
                }
                .pickerStyle(.segmented)
                .disabled(configuringLive)
                .onChange(of: chosenAccessRole) { role in
                    chosenFolder = role == "trusted" ?
                        FileManager.default.homeDirectoryForCurrentUser : nil
                    trustedAcknowledged = false
                }
                if configuringLive {
                    Text(tx("当前只支持将已有的可信开发 live 配置正式切换为 Home 内可写 / Home 外只读。新用户仍可在首次安装时选择受限只读。"))
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if chosenAccessRole == "trusted" {
                    Text(tx("原生 Desktop Commander 文件读写、搜索、Git、Shell 可用。使用 macOS 进程级沙箱限制其文件写入范围：Home 内允许写入，Home 外拒绝写入；读取仍受 macOS 本身保护。"))
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                    Text(tx("仅限已认证且受信任的 AI 客户端。此限制作用于 DC 进程树，不是整个 Mac 的全局权限开关；通过其他未受约束的上游或应用间通信仍可能绕开它。"))
                        .font(.system(size: 11)).foregroundStyle(.orange)
                    Toggle(tx("我了解可信开发权限范围及 Shell、应用间通信风险"), isOn: $trustedAcknowledged)
                        .font(.system(size: 11))
                        .toggleStyle(.checkbox)
                } else {
                    Text(tx("适合首次体验或低信任连接：Gateway 将执行项目范围内的只读授权，禁用任意 Shell 和写入。"))
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            .padding(13)
            .background(ProductPalette.surface, in: RoundedRectangle(cornerRadius: 12))

            if !configuringLive {
            VStack(alignment: .leading, spacing: 10) {
                Label(tx("第 3 步 · 选择远程连接方式"), systemImage: "network")
                    .font(.system(size: 13, weight: .semibold))
                Picker(tx("连接方式"), selection: $chosenConnection) {
                    Text(tx("安全隧道")).tag("tunnel")
                    Text(tx("自建 HTTPS")).tag("https")
                }
                .pickerStyle(.segmented)
                Text(chosenConnection == "tunnel"
                    ? tx("适合无需开放路由器端口的网络环境。需要支持该功能的 ChatGPT 账号。")
                    : tx("适合拥有自己 HTTPS 域名的用户。必须另外完成 TLS 与身份认证。"))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                Text(tx("这里只保存偏好，不会自动建立公开连接。"))
                    .font(.system(size: 10.5)).foregroundStyle(.secondary)
            }
            .padding(13)
            .background(ProductPalette.surface, in: RoundedRectangle(cornerRadius: 12))
            }

            VStack(alignment: .leading, spacing: 9) {
                Button(configuringLive ? tx("应用权限并重新启动 Core") : tx("保存设置并启动本机连接")) {
                    Task {
                        if configuringLive {
                            // Reuse the single global owner lease. Never edit a
                            // running Core profile or overwrite another setup.
                            if healthy {
                                guard await appRunner.stopGlobal() else { return }
                            } else if state != .stopped { return }
                            let saved = await firstRun.applyLiveHomeScope()
                            await appRunner.start()
                            await observer.reload(forcePermissions: true)
                            if saved && observer.gateway?.health == "ok" {
                                page = .home
                            }
                        } else if let folder = chosenFolder {
                            if await firstRun.save(project: folder,
                                                   connection: chosenConnection,
                                                   accessRole: chosenAccessRole,
                                                   trustedAcknowledged: trustedAcknowledged) {
                                await appRunner.start()
                                await observer.reload(forcePermissions: true)
                            }
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(chosenFolder == nil || firstRun.busy || firstRun.liveBusy ||
                          (configuringLive && (!["stopped","ok"].contains(observer.gateway?.health ?? "") ||
                           appRunner.phase == .starting || appRunner.phase == .stopping)) ||
                          (chosenAccessRole == "trusted" && !trustedAcknowledged))
                if firstRun.busy || firstRun.liveBusy {
                    ProgressView(tx("正在安全应用设置…"))
                }
                if let problem = configuringLive ? firstRun.liveProblem : firstRun.problem {
                    Label(tx(problem), systemImage: "exclamationmark.triangle")
                        .font(.system(size: 11)).foregroundStyle(.orange)
                }
                if configuringLive, let problem = appRunner.problem {
                    Label(tx("设置已执行，但 Core 运行状态需要检查：") + problem,
                          systemImage: "exclamationmark.triangle")
                        .font(.system(size: 11)).foregroundStyle(.orange)
                }
                Text(tx("无需单独安装 Node.js、Python，也不必先授予“完全磁盘访问”。"))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
    }

    private var home: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    Circle().fill(stateColor).frame(width: 8, height: 8)
                    Text(tx("服务状态")).font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Text(healthy ? tx("运行正常") : tx(state.label))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(stateColor)
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(stateColor.opacity(0.10),
                                    in: Capsule())
                }
                Text(healthy ? tx("本机服务已就绪")
                     : state == .stopped ? tx("当前已停止，你可以随时启动")
                     : observer.issue ?? tx("暂时无法确认连接状态"))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                if healthy {
                    Label(observer.gateway?.writeScope == "home-only"
                        ? tx("有效权限：Home 内读写 · Home 外只读")
                        : tx("当前权限：旧版可信开发（Home 外写入未限制）"),
                          systemImage: observer.gateway?.writeScope == "home-only"
                              ? "lock.shield.fill" : "exclamationmark.shield")
                        .font(.system(size: 11))
                        .foregroundStyle(observer.gateway?.writeScope == "home-only"
                            ? .green : .orange)
                }
            }
            .padding(11)
            .background(
                RoundedRectangle(cornerRadius: 15)
                    .fill(LinearGradient(colors: [ProductPalette.blue.opacity(0.12), ProductPalette.aqua.opacity(0.065)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay(RoundedRectangle(cornerRadius: 15)
                        .strokeBorder(ProductPalette.blue.opacity(0.12), lineWidth: 1))
            )

            VStack(alignment: .leading, spacing: 6) {
                Text(tx("快捷操作")).font(.system(size: 12, weight: .semibold))
                HStack(alignment: .top, spacing: 8) {
                    QuickAction(title: tx("打开 Dashboard"), caption: tx("浏览器查看服务"),
                                symbol: "rectangle.on.rectangle",
                                disabled: !healthy, action: openDashboard)
                    QuickAction(title: tx("隐私与权限"), caption: permissionShortLabel,
                                symbol: "lock.shield") { page = .services }
                    if healthy && state != .serviceRunning {
                        QuickAction(title: tx("停止连接"),
                                    caption: tx("暂停 AI 访问这台 Mac"),
                                    symbol: "stop.circle",
                                    disabled: appRunner.phase == .stopping) {
                            Task {
                                _ = await appRunner.stopGlobal()
                                await observer.reload()
                            }
                        }
                    } else if state == .stopped && appRunner.phase == .idle {
                        QuickAction(title: tx("启动连接"),
                                    caption: tx("启动本机服务"),
                                    symbol: "play.circle") {
                            Task {
                                await appRunner.start()
                                await observer.reload()
                            }
                        }
                    }
                }
                if appRunner.phase == .starting || appRunner.phase == .stopping {
                    ProgressView(appRunner.phase == .starting
                                 ? tx("正在启动…") : tx("正在停止连接…"))
                        .font(.system(size: 10))
                }
                if let problem = appRunner.problem {
                    Label(tx(problem), systemImage: "exclamationmark.triangle")
                        .font(.system(size: 10))
                        .foregroundStyle(.orange)
                }
            }

            ConnectionFlowDiagram(snapshot: observer.connections)
            if healthy && observer.gateway?.profile == "setup" {
                Label(tx("本机服务已启动。远程 ChatGPT 连接还需单独配置和验证。"),
                      systemImage: "info.circle")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 5) {
                NavigationTile(title: tx("连接与帮助"),
                               detail: tx("版本信息、连接说明及排查问题"),
                               symbol: "gearshape") { page = .settings }
            }
        }
    }

    private var permissionShortLabel: String {
        guard healthy else { return tx("连接停止，尚未检测") }
        guard let result = observer.currentPermissions else { return tx("暂时无法检查") }
        if result.summary == "verified" { return tx("已验证可访问") }
        if result.deniedCount > 0 { return tx("部分目录不可访问") }
        return tx("有些目录未能确认")
    }

    private func permissionLabel(_ state: String) -> String {
        switch state {
        case "READ_OK": return tx("可访问")
        case "OS_DENIED": return tx("无法访问")
        case "MISSING": return tx("目录不存在")
        default: return tx("无法确认")
        }
    }

    private var services: some View {
        VStack(alignment: .leading, spacing: 13) {
            if !healthy {
                Label(tx("连接尚未启动"), systemImage: "info.circle")
                    .font(.system(size: 13, weight: .semibold))
                Text(tx("启动连接后，这里会显示实际文件访问检查结果。"))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            } else if let access = observer.currentPermissions {
                Label(access.summary == "verified" ? tx("文件访问检查通过") :
                      access.deniedCount > 0 ? tx("部分目录无法访问") : tx("部分目录尚未确认"),
                      systemImage: access.summary == "verified"
                        ? "checkmark.shield.fill" : "exclamationmark.shield")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(access.summary == "verified" ? .green : .orange)
                Text(uiLanguage.code == "en" ?
                     "\(access.allowedCount) of 6 protected folders readable" :
                     "已验证 \(access.allowedCount)/6 个受保护目录可读取")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                ForEach(access.checks, id: \.id) { item in
                    HStack {
                        Image(systemName: item.state == "READ_OK"
                              ? "checkmark.circle.fill" : "minus.circle.fill")
                            .foregroundStyle(item.state == "READ_OK" ? .green : .orange)
                        Text(item.label).font(.system(size: 11.5))
                        Spacer()
                        Text(permissionLabel(item.state))
                            .font(.system(size: 10.5)).foregroundStyle(.secondary)
                    }
                }
                if access.deniedCount > 0 {
                    Text(tx("仅在你确实需要访问这些目录时，才需要额外授权。"))
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                    Text(tx("若已经授权仍无法访问，请停止连接、完全退出 App 后重新打开，再点击“重新检查”。"))
                        .font(.system(size: 10.5)).foregroundStyle(.secondary)
                    Button(tx("打开 macOS 隐私设置")) { openFDASettings() }
                        .buttonStyle(.bordered)
                }
            } else {
                Label(tx("暂时无法验证文件访问"), systemImage: "info.circle")
                    .font(.system(size: 13, weight: .medium))
                Text(tx("服务已经运行，但没有取得当前权限检查结果。请刷新重试。"))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Button(tx("重新检查")) {
                Task { await observer.reload(forcePermissions: true) }
            }
            .buttonStyle(.bordered)
            .disabled(!healthy || observer.busy)
            Text(tx("这是只读访问能力检测，不读取文件内容，也不等于 macOS 授权开关的状态。项目文件访问范围由你另外控制。"))
                .font(.system(size: 10.5)).foregroundStyle(.secondary)
        }
        .padding(12)
        .background(ProductPalette.surface.opacity(0.45),
                    in: RoundedRectangle(cornerRadius: 12))
    }

    private func historyTitle(_ outcome: String) -> String {
        switch outcome {
        case "READ_OK": return tx("允许读取")
        case "OS_DENIED": return tx("macOS 拒绝访问")
        case "APP_POLICY_DENIED": return tx("Gateway 拒绝访问")
        default: return tx("结果未判定")
        }
    }
    private var history: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(tx("以下是过去的 CloudDocs 只读实验，不是当前 FDA 检测。"))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let items = observer.diagnostics?.recentEvidence, !items.isEmpty {
                ForEach(items, id: \.observedAt) { e in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: e.protectedState == "READ_OK"
                              ? "checkmark.circle.fill" : "minus.circle.fill")
                            .font(.system(size: 17))
                            .foregroundStyle(e.protectedState == "READ_OK" ? .green : .orange)
                            .frame(width: 22)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(historyTitle(e.protectedState))
                                .font(.system(size: 12, weight: .semibold))
                            Text(prettyTime(e.observedAt))
                                .font(.system(size: 10.5))
                                .foregroundStyle(.secondary)
                            Text(e.protectedState == "OS_DENIED"
                                 ? tx("系统当时拒绝读取 · 用于权限对照")
                                 : e.protectedState == "READ_OK"
                                 ? tx("当时的只读测试成功")
                                 : tx("当时未能完成读取"))
                                .font(.system(size: 10.5))
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 2)
                        Text(e.controlsPassed ? tx("记录有效") : tx("记录待核查"))
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .background(ProductPalette.surface.opacity(0.62),
                                in: RoundedRectangle(cornerRadius: 12))
                }
            } else {
                Text(observer.diagnostics?.evidenceProblem ?? tx("暂无实验记录"))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Language / 语言").font(.system(size: 12, weight: .semibold))
                Spacer()
                Picker("Language", selection: $uiLanguage.code) {
                    Text("中文").tag("zh")
                    Text("English").tag("en")
                }
                .pickerStyle(.segmented)
                .frame(width: 188)
                .labelsHidden()
                .accessibilityLabel("Language / 语言")
            }
            .padding(11)
            .background(ProductPalette.surface.opacity(0.66),
                        in: RoundedRectangle(cornerRadius: 12))
            Divider()
            Text(tx("关于 Mac MCP Gateway")).font(.system(size: 13, weight: .semibold))
            Text((uiLanguage.code == "en" ? "Version " : "版本 ") +
                     (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"))
                .font(.system(size: 12)).foregroundStyle(.secondary)
            Text(tx("关闭 App 会同时停止本机 Gateway 连接。"))
                .font(.system(size: 11.5)).foregroundStyle(.secondary)
            Divider()
            if observer.gateway?.profile == "live" {
            NavigationTile(title: tx("文件访问与工具设置"),
                           detail: tx("正式应用 Home 内读写 / Home 外只读，并安全重启当前 Core。"),
                           symbol: "slider.horizontal.3") {
                chosenAccessRole = "trusted"
                chosenFolder = FileManager.default.homeDirectoryForCurrentUser
                trustedAcknowledged = false
                page = .configuration
            }
            }
            Text(tx("修改生效前需要确认；不会重置身份认证、Tunnel 或现有其他设置。"))
                .font(.system(size: 10.5)).foregroundStyle(.secondary)
            Divider()
            Text(tx("高级诊断")).font(.system(size: 12, weight: .semibold))
            InfoPill(title: tx("本机端口"),
                     value: observer.gateway?.port.map(String.init) ?? "—", icon: "link")
            NavigationTile(title: tx("历史诊断记录"),
                           detail: tx("仅供排查历史问题，不代表当前权限"),
                           symbol: "clock.arrow.circlepath") {
                page = .history
                Task { await observer.loadHistoricalDiagnostics() }
            }
            Button(tx("复制终端启动命令"), action: clipboardCommand)
                .buttonStyle(.bordered)
        }
    }
    private var footer: some View {
        HStack {
            Label("检查于 \(lastChecked)", systemImage: "clock")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
            Spacer()
            Text(healthy ? tx("正在运行") : tx("未运行"))
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
            Button(tx("退出")) { NSApplication.shared.terminate(nil) }
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
        .padding(.horizontal, 17)
        .padding(.vertical, 9)
    }
}

// The welcome window belongs to the GUI target, not the shared CLI
// lifecycle controller. Both windows observe the same first-run state.
extension AppForegroundExitDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // The initial setup must be discoverable after double-clicking the
        // .app. Normal runs stay menu-bar-only; no second menu icon/Service.
        // Do not surprise an owner of an existing private live profile.
        Task { @MainActor in
            let wizard = FirstRunCoordinator.shared
            wizard.refresh()
            guard wizard.available && !wizard.configured else { return }
            let legacy = await Task.detached(priority: .utility) {
                (try? StatusProbe.read().profile) == "live"
            }.value
            guard !legacy else { return }
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 430, height: 530),
                styleMask: [.titled, .closable, .miniaturizable],
                backing: .buffered, defer: false)
            window.title = tx("欢迎使用 Mac MCP Gateway")
            window.contentView = NSHostingView(rootView: UnifiedGatewayMenu())
            window.center()
            window.isReleasedWhenClosed = false
            self.welcomeWindow = window
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        }
    }
}

@main
struct MacMCPUnifiedApp: App {
    // Service registration research is archived; not a product entrypoint.
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
                    .accessibilityLabel("Mac MCP Gateway")
            } else {
                Image(systemName: "point.3.connected.trianglepath.dotted")
            }
        }
        .menuBarExtraStyle(.window)
    }
}
