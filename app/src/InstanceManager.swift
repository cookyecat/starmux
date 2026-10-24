import SwiftUI
import AppKit

@MainActor private func it(_ chinese: String, _ english: String) -> String { AppLanguage.shared.code == "zh" ? chinese : english }

@MainActor
final class InstanceManagerWindow {
    static let shared = InstanceManagerWindow()
    private var window: NSWindow?
    func show() {
        if window == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 980, height: 700), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            w.title = "Mac MCP Gateway"; w.contentView = NSHostingView(rootView: InstanceManagerView())
            w.minSize = NSSize(width: 820, height: 580); w.isReleasedWhenClosed = false; w.center(); window = w
        }
        NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil)
    }
}
struct InstanceMenu: View {
    @ObservedObject private var model = InstanceController.shared
    @ObservedObject private var language = AppLanguage.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Mac MCP Gateway").font(.headline); Spacer()
                Text("\(model.instances.filter { $0.running }.count) " + it("运行中", "running")).foregroundStyle(.secondary)
            }
            ForEach(model.instances.filter { !$0.archived }) { instance in
                HStack {
                    Circle().fill(instance.running ? Color.green : Color.gray).frame(width: 7, height: 7)
                    VStack(alignment: .leading) {
                        Text(instance.name)
                        Text(instance.configState == "pending" ? it("有待应用变更", "Changes pending") : instance.phase).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(instance.running ? it("停止", "Stop") : it("启动", "Start")) {
                        Task { if instance.running { await model.perform(["stop", "--instance", instance.id]) } else { await model.start(instance) } }
                    }.disabled(model.busy)
                }
            }
            if let issue = model.issue { Text(issue).font(.caption).foregroundStyle(.red).lineLimit(3) }
            Button(it("管理实例…", "Manage instances…")) { InstanceManagerWindow.shared.show() }.buttonStyle(.borderedProminent)
            Divider()
            Text(it("退出仅停止本次 App 启动的实例", "Quitting stops only instances started by this App session")).font(.caption).foregroundStyle(.secondary)
            HStack {
                Picker("Language", selection: $language.code) { Text("English").tag("en"); Text("中文").tag("zh") }.labelsHidden().frame(width: 110)
                Spacer(); Button(it("退出", "Quit")) { NSApp.terminate(nil) }
            }
        }.padding(16).frame(width: 380)
        .task { while !Task.isCancelled { await model.refresh(); try? await Task.sleep(nanoseconds: 2_000_000_000) } }
    }
}
struct InstanceManagerView: View {
    @ObservedObject private var model = InstanceController.shared
    @ObservedObject private var language = AppLanguage.shared
    @State private var create = false
    @State private var showArchived = false
    @State private var computer = false
    @State private var migration = ""
    @State private var migrationSource = "setup"
    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                Text(it("实例", "Instances")).font(.title2.bold())
                List(selection: $model.selectedId) {
                    ForEach(model.instances.filter { showArchived || !$0.archived }) { i in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack { Circle().fill(i.running ? Color.green : Color.gray).frame(width: 6, height: 6); Text(i.name); if i.id == model.defaultInstanceId { Image(systemName: "star.fill").font(.caption).foregroundStyle(.orange) } }
                            Text(i.archived ? it("已归档", "Archived") : i.configState == "pending" ? it("有待应用变更", "Changes pending") : i.phase).font(.caption).foregroundStyle(.secondary)
                        }.tag(i.id)
                    }
                }
                Toggle(it("显示归档", "Show archived"), isOn: $showArchived).font(.caption)
                Button(it("＋ 新建 / 导入", "+ Create / Import")) { create = true }
                Button(it("发现旧配置", "Discover legacy configuration")) { Task { if let data = await model.perform(["instance", "migrate"]) { migration = String(decoding: data, as: UTF8.self) } } }
                Button(it("此电脑", "This computer")) { computer = true }
            }.padding().frame(minWidth: 200, idealWidth: 230, maxWidth: 280)
            VStack(alignment: .leading, spacing: 12) {
                if let issue = model.issue { HStack { Text(issue).font(.callout).foregroundStyle(.red).textSelection(.enabled); Spacer(); Button("×") { model.issue = nil } }.padding(10).background(Color.red.opacity(0.07)) }
                if let selected = model.instances.first(where: { $0.id == model.selectedId }) { InstanceDetail(instance: selected).id(selected.id) }
                else { Spacer(); Text(it("创建一个实例，或导入已有配置", "Create an instance or import a configuration")).font(.title2); Button(it("开始设置", "Get started")) { create = true }; Spacer() }
            }.padding(20).frame(minWidth: 540, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .sheet(isPresented: $create) { InstanceCreateSheet() }
        .sheet(isPresented: $computer) {
            VStack(alignment: .leading, spacing: 18) {
                Text(it("此电脑的权限", "Permissions on this computer")).font(.title2)
                Text(it("所有实例共享此电脑的 OS 账户、Home 和系统授权。实例配置不会创建独立桌面或系统账户。", "Instances share this computer's OS account, Home and system permissions. An instance does not create a separate desktop or account."))
                Button(it("打开系统隐私设置", "Open system privacy settings")) { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy")!) }
                Button(it("完成", "Done")) { computer = false }
            }.padding(24).frame(width: 500)
        }
        .sheet(isPresented: Binding(get: { !migration.isEmpty }, set: { if !$0 { migration = "" } })) {
            VStack(alignment: .leading, spacing: 12) {
                Text(it("迁移预览", "Migration preview")).font(.title2)
                ScrollView { Text(migration).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                Picker(it("来源", "Source"), selection: $migrationSource) { Text("setup").tag("setup"); Text("live").tag("live") }
                Text(it("切换将停止使用旧状态的实例，并停用对应旧自启动。原文件保留。", "Switching stops legacy instances using these stores and disables their old automatic starts. Original files are retained."))
                HStack {
                    Button(it("取消", "Cancel")) { migration = "" }
                    Button(it("确认迁移", "Migrate")) { Task { if await model.perform(["instance", "migrate", migrationSource, "--confirm"]) != nil { migration = "" } } }.disabled(model.busy)
                }
            }.padding(24).frame(width: 650, height: 470)
        }
        .task { while !Task.isCancelled { await model.refresh(); try? await Task.sleep(nanoseconds: 2_000_000_000) } }
    }
}

private struct InstanceCreateSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var model = InstanceController.shared
    @State private var name = ""
    @State private var project = ""
    @State private var file = ""
    @State private var role = "restricted"
    @State private var linked = false
    @State private var approved = false
    private func choose(directory: Bool) -> String? {
        let panel = NSOpenPanel(); panel.canChooseDirectories = directory; panel.canChooseFiles = !directory; panel.allowsMultipleSelection = false
        return panel.runModal() == .OK ? panel.url?.path : nil
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(it("创建实例", "Create an instance")).font(.title2.bold())
            TextField(it("实例名称", "Instance name"), text: $name)
            if file.isEmpty {
                HStack { TextField(it("工作目录", "Work directory"), text: $project); Button(it("选择…", "Choose…")) { project = choose(directory: true) ?? project } }
                Picker(it("能力", "Capability"), selection: $role) { Text(it("只读工作区", "Read-only workspace")).tag("restricted"); Text(it("可信开发", "Trusted developer")).tag("trusted") }.pickerStyle(.segmented)
                Text(it("自动建议可用端口。保存后可在配置中修改。", "An available port is suggested automatically and can be edited after saving.")).font(.caption).foregroundStyle(.secondary)
            } else {
                Text(file).font(.caption).textSelection(.enabled)
                Toggle(it("绑定原文件（高级）", "Bind original file (advanced)"), isOn: $linked)
                Text(linked ? it("原文件是唯一来源；修改后需要应用。", "The original file remains the source; changes require apply.") : it("保存托管副本；之后修改原文件不会影响实例。", "A managed copy is saved; future edits to the original will not affect this instance.")).font(.caption)
            }
            if role == "trusted" || !file.isEmpty {
                Toggle(it("我确认配置中的可信开发权限可运行本机工具和 Shell", "I approve trusted developer capabilities, if selected in this configuration"), isOn: $approved)
            }
            if let issue = model.issue { Text(issue).foregroundStyle(.red).font(.caption).textSelection(.enabled) }
            HStack {
                Button(it("导入文件…", "Import file…")) { file = choose(directory: false) ?? file }
                Spacer(); Button(it("取消", "Cancel")) { dismiss() }
                Button(it("保存实例", "Save instance")) {
                    Task {
                        var args = file.isEmpty ? ["instance", "create", name, "--project", project, "--access-role", role] : ["instance", "import", file, "--name", name] + (linked ? ["--link"] : [])
                        if approved { args += ["--approve-trusted-developer"] }
                        if await model.perform(args) != nil { dismiss() }
                    }
                }.buttonStyle(.borderedProminent).disabled(model.busy || name.isEmpty || (file.isEmpty && project.isEmpty) || (role == "trusted" && !approved))
            }
        }.padding(24).frame(width: 580)
    }
}

private struct InstanceDetail: View {
    let instance: ManagedInstance
    @ObservedObject private var model = InstanceController.shared
    @State private var tab = 0
    @State private var raw = ""
    @State private var revision = ""
    @State private var project = ""
    @State private var port = ""
    @State private var role = "restricted"
    @State private var connection = "local"
    @State private var approved = false
    @State private var originalRole = "restricted"
    @State private var originalWriteScope = "unrestricted"
    @State private var originalMode = "read-only"
    @State private var advanced = false
    @State private var diff = ""
    @State private var logs = ""
    @State private var access = ""
    @State private var newName = ""
    @State private var keyName = ""
    @State private var accessMode = "ingress"
    @State private var revokeId = ""
    @State private var confirmArchive = false
    private var target: [String] { ["--instance", instance.id] }
    private func load() async {
        if let data = await model.perform(["config", "show"] + target), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            raw = object["text"] as? String ?? ""; revision = object["revision"] as? String ?? ""
            guard let config = object["config"] as? [String: Any] else { advanced = true; return }
            project = config["projectRoot"] as? String ?? ""; port = String(config["port"] as? Int ?? 18893)
            originalMode = config["mode"] as? String ?? "read-only"
            originalWriteScope = config["writeScope"] as? String ?? "unrestricted"
            role = config["accessRole"] as? String ?? "restricted"; originalRole = role; connection = config["connection"] as? String ?? "local"
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(instance.name).font(.largeTitle.bold())
                    Text(instance.phase + " · " + instance.configState).foregroundStyle(.secondary)
                    if let runtime = instance.runtime {
                        Text(runtime.launcher == "app" ? it("由 App 启动 · 退出所属 App 时停止", "Started by App · stops when its App quits") : it("由 CLI 启动 · 终端退出时停止", "Started by CLI · stops with its terminal")).font(.caption)
                    }
                }
                Spacer()
                Button(instance.running ? it("停止", "Stop") : it("启动", "Start")) { Task { if instance.running { await model.perform(["stop"] + target) } else { await model.start(instance) } } }.disabled(model.busy || instance.archived)
            }
            if let endpoint = instance.endpoint { HStack { Text(endpoint).font(.system(.callout, design: .monospaced)); Button(it("复制", "Copy")) { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(endpoint, forType: .string) } } }
            if let problem = instance.configProblem { Text(problem).foregroundStyle(.orange).font(.caption).textSelection(.enabled) }
            Picker("", selection: $tab) { Text(it("概览", "Overview")).tag(0); Text(it("配置", "Configuration")).tag(1); Text(it("连接与访问", "Connections & access")).tag(2); Text(it("日志与诊断", "Logs & diagnostics")).tag(3) }.pickerStyle(.segmented)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if tab == 0 { overview }
                    else if tab == 1 { configuration }
                    else if tab == 2 { connections }
                    else { diagnostics }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
            }
        }
        .task { newName = instance.name; await load() }
        .sheet(isPresented: Binding(get: { !diff.isEmpty }, set: { if !$0 { diff = "" } })) {
            VStack(alignment: .leading, spacing: 12) {
                Text(it("应用配置变更", "Apply configuration changes")).font(.title2)
                ScrollView { Text(diff).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                Text(it("重启会断开此实例现有的 MCP 会话，其他实例不受影响。", "Restarting disconnects this instance's MCP sessions. Other instances are unaffected."))
                HStack { Button(it("取消", "Cancel")) { diff = "" }; Button(it("应用并重启", "Apply and restart")) { Task { if await model.perform(["config", "apply"] + target + ["--revision", revision]) != nil { diff = ""; await load() } } }.disabled(model.busy) }
            }.padding(24).frame(width: 620, height: 420)
        }
        .confirmationDialog(it("停止并归档此实例？外部源文件将保留。", "Stop and archive this instance? External source files are retained."), isPresented: $confirmArchive) {
            Button(it("归档", "Archive")) { Task { await model.perform(["instance", "archive", instance.id]) } }
        }
    }
    private var overview: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(it("配置来源", "Configuration source")).font(.headline)
            Text(instance.source.kind == "linked" ? it("绑定外部文件", "Linked external file") : it("托管配置", "Managed configuration"))
            Text(instance.source.path).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            HStack {
                Button(it("打开配置", "Open configuration")) { NSWorkspace.shared.open(URL(fileURLWithPath: instance.source.path)) }
                Button(it("在 Finder 中显示", "Reveal in Finder")) { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: instance.source.path)]) }
            }
            Text(it("连接状态", "Connection status")).font(.headline)
            Text(instance.running ? it("本机服务已启动；远程连接尚未验证", "Local service started; remote connectivity has not been verified") : it("尚未运行", "Not running"))
            if let at = instance.lastToolCallAt { Text(it("最近工具调用：", "Last tool call: ") + at).font(.caption) }
            if let runtime = instance.runtime { Text(runtime.buildVersion + "\n" + runtime.coreProgram).font(.caption).textSelection(.enabled) }
            Divider()
            HStack { TextField(it("名称", "Name"), text: $newName); Button(it("改名", "Rename")) { Task { await model.perform(["instance", "rename", instance.id, newName]) } }; Button(it("复制实例", "Duplicate")) { Task { await model.perform(["instance", "copy", instance.id, newName + " copy"]) } } }
            HStack {
                Button(it("设为 CLI 默认实例", "Set as CLI default")) { Task { await model.perform(["instance", "default", instance.id]) } }
                Button(instance.archived ? it("恢复实例", "Restore") : it("归档实例", "Archive")) { if instance.archived { Task { await model.perform(["instance", "restore", instance.id]) } } else { confirmArchive = true } }
            }.disabled(model.busy)
        }
    }
    private var configuration: some View {
        VStack(alignment: .leading, spacing: 12) {
            LabeledContent(it("工作目录", "Work directory")) { TextField("", text: $project) }
            LabeledContent(it("本机端口", "Local port")) { TextField("", text: $port) }
            Picker(it("能力", "Capability"), selection: $role) { Text(it("只读工作区", "Read-only workspace")).tag("restricted"); Text(it("可信开发", "Trusted developer")).tag("trusted") }
            Picker(it("连接偏好", "Connection preference"), selection: $connection) { Text(it("仅本机", "Local only")).tag("local"); Text("HTTPS").tag("https"); Text("Tunnel").tag("tunnel") }
            if role == "trusted" && originalRole != role { Toggle(it("确认启用原生工具和 Shell", "Approve native tools and Shell"), isOn: $approved) }
            HStack {
                Button(it("保存配置", "Save configuration")) {
                    guard let number = Int(port) else { model.issue = "port: enter a valid integer"; return }
                    let patch: [String: Any] = ["projectRoot": project, "port": number, "accessRole": role, "mode": role == originalRole ? originalMode : (role == "trusted" ? "read-write" : "read-only"), "writeScope": role == originalRole ? originalWriteScope : (role == "trusted" ? "home-only" : "unrestricted"), "connection": connection]
                    Task { if let data = try? JSONSerialization.data(withJSONObject: patch), await model.perform(["config", "patch"] + target + ["--revision", revision] + (approved ? ["--approve-trusted-developer"] : []), input: data) != nil { await load() } }
                }.disabled(model.busy || (role == "trusted" && originalRole != role && !approved))
                Button(it("查看差异并应用…", "Review and apply…")) { Task { if let data = await model.perform(["config", "diff"] + target) { diff = String(decoding: data, as: UTF8.self); if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { revision = object["revision"] as? String ?? revision } } } }.disabled(model.busy)
                Button(it("重新载入", "Reload")) { Task { await load() } }
            }
            Text(it("保存不会重启。外部文件修改也需要明确应用。", "Saving does not restart. External edits also require explicit apply.")).font(.caption).foregroundStyle(.secondary)
            DisclosureGroup(it("高级：JSONC 源文件", "Advanced: JSONC source"), isExpanded: $advanced) {
                TextEditor(text: $raw).font(.system(.caption, design: .monospaced)).frame(height: 240).border(Color.gray.opacity(0.3))
                HStack {
                    Button(it("保存源文件", "Save source")) { Task { if await model.perform(["config", "save"] + target + ["--revision", revision], input: Data(raw.utf8)) != nil { await load() } } }
                    Button(it("恢复丢失的配置", "Recover missing config")) { Task { if await model.perform(["config", "recover"] + target) != nil { await load() } } }
                    Button(it("重新定位源文件…", "Relink source…")) { let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false; if panel.runModal() == .OK, let url = panel.url { Task { if await model.perform(["config", "relink"] + target + ["--file", url.path]) != nil { await load() } } } }
                    if instance.source.kind == "linked" { Button(it("转为托管副本", "Make managed copy")) { Task { if await model.perform(["config", "manage"] + target) != nil { await load() } } } }
                }.disabled(model.busy)
                Button(it("导出配置…", "Export configuration…")) { let panel = NSSavePanel(); panel.nameFieldStringValue = "gateway.jsonc"; if panel.runModal() == .OK, let url = panel.url { Task { await model.perform(["config", "export"] + target + ["--output", url.path]) } } }
            }
        }
    }
    private var connections: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(it("认证与网络路径分别配置。HTTPS/Tunnel 偏好不会自动部署远程服务。", "Authentication and network paths are configured separately. HTTPS/Tunnel preferences do not deploy remote services."))
            HStack {
                Button(it("查看访问状态", "Inspect access")) { Task { if let data = await model.perform(["access", "status"] + target) { access = String(decoding: data, as: UTF8.self) } } }
                if let endpoint = instance.endpoint, let url = URL(string: endpoint.replacingOccurrences(of: "/mcp", with: "/access")) { Link(it("打开访问管理", "Open access dashboard"), destination: url) }
            }
            HStack { TextField(it("客户端密钥名称", "Client key name"), text: $keyName); Button(it("创建密钥", "Create key")) { Task { if let data = await model.perform(["access", "create", keyName] + target) { access = String(decoding: data, as: UTF8.self) } } }.disabled(keyName.isEmpty) }
            Text(it("新密钥仅显示一次；撤销对后续请求立即生效。", "New keys are shown once. Revocation affects subsequent requests immediately.")).font(.caption)
            HStack { Picker(it("认证", "Authentication"), selection: $accessMode) { Text("Ingress").tag("ingress"); Text("API Key").tag("api-key"); Text("OAuth").tag("oauth") }; Button(it("应用认证方式", "Set authentication")) { Task { if let data = await model.perform(["access", "mode", accessMode] + target) { access = String(decoding: data, as: UTF8.self) } } } }
            HStack { TextField(it("待撤销的密钥 ID", "Key ID to revoke"), text: $revokeId); Button(it("撤销", "Revoke")) { Task { if let data = await model.perform(["access", "revoke", revokeId] + target) { access = String(decoding: data, as: UTF8.self) } } }.disabled(revokeId.isEmpty) }
            Text(access).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
        }.disabled(model.busy)
    }
    private var diagnostics: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Button(it("检查配置", "Check configuration")) { Task { if let data = await model.perform(["doctor"] + target) { logs = String(decoding: data, as: UTF8.self) } } }
                Button(it("读取日志", "Read logs")) { Task { if let data = await model.perform(["logs"] + target) { logs = String(decoding: data, as: UTF8.self) } } }
                Button(it("实际权限检查", "Check actual access")) { Task { if let data = await model.perform(["privacy"] + target) { logs = String(decoding: data, as: UTF8.self) } } }
            }.disabled(model.busy)
            Text(logs).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
        }
    }
}
