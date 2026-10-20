import Foundation
import AppKit
import SwiftUI
import Darwin

// User-facing setup uses the SAME locked Node onboarding validator as the CLI.
// Never edits TCC/FDA, installs Node, opens a public port or runs arbitrary shell.
@MainActor
final class FirstRunCoordinator: ObservableObject {
    static let shared = FirstRunCoordinator()
    @Published private(set) var configured = false
    @Published private(set) var busy = false
    @Published private(set) var problem: String?

    @Published private(set) var liveBusy = false
    @Published private(set) var liveProblem: String?
    @Published private(set) var liveSaved = false

    private var liveSettingsURL: URL {
        Bundle.main.bundleURL.appendingPathComponent(
            "Contents/Resources/runtime/core/bin/live-home-settings.mjs")
    }
    // Only applies the explicit, owner-approved Home-write policy to the
    // existing live profile; does not create a second onboarding profile.
    func applyLiveHomeScope() async -> Bool {
        guard !liveBusy, available,
              FileManager.default.fileExists(atPath: liveSettingsURL.path) else {
            liveProblem = "安装不完整或正在执行设置操作"
            return false
        }
        liveBusy = true
        liveProblem = nil
        liveSaved = false
        defer { liveBusy = false }
        let runner = nodeURL
        let script = liveSettingsURL
        let result = await Task.detached(priority: .userInitiated) {
            Self.runLiveSettingsProcess(runner: runner, script: script)
        }.value
        if let code = result {
            switch code {
            case "LIVE_CORE_MUST_BE_STOPPED", "LIVE_CORE_CHANGED_DURING_SAVE":
                liveProblem = "Core 未完成停止；没有修改已有设置"
            case "LIVE_HOME_SCOPE_EXTRA_EXECUTORS_UNSAFE":
                liveProblem = "存在未受同一文件沙箱限制的附加上游或 Git 执行器，拒绝启用"
            case "LIVE_PLIST_UNTRUSTED", "LIVE_PROFILE_UNRECOGNIZED":
                liveProblem = "现有启动配置未通过安全验证，没有覆盖"
            default:
                liveProblem = "未能安全保存现有 Core 配置（\(code)）"
            }
            return false
        }
        liveSaved = true
        return true
    }

    nonisolated private static func runLiveSettingsProcess(
        runner: URL, script: URL
    ) -> String? {
        let process = Process()
        process.executableURL = runner
        process.arguments = [script.path, "--apply", "--confirm-home-write-scope"]
        process.environment = ["HOME":NSHomeDirectory(),
                               "PATH":"/usr/bin:/bin","LANG":"C"]
        process.standardInput = FileHandle.nullDevice
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            let done = DispatchSemaphore(value: 0)
            process.terminationHandler = { _ in done.signal() }
            try process.run()
            if done.wait(timeout: .now() + 22) == .timedOut {
                if process.isRunning { process.terminate() }
                _ = done.wait(timeout: .now() + 2)
                return "LIVE_APPLY_TIMEOUT"
            }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            guard data.count < 2048,
                  let json = try? JSONSerialization.jsonObject(with: data)
                    as? [String: String] else { return "LIVE_APPLY_UNAVAILABLE" }
            if process.terminationStatus == 0 &&
               json["event"] == "LIVE_HOME_SCOPE_APPLIED" &&
               json["writeScope"] == "home-only" { return nil }
            let code = json["code"] ?? "LIVE_APPLY_FAILED"
            return code.range(of: #"^[A-Z0-9_]+$"#,
                              options: .regularExpression) != nil
                ? code : "LIVE_APPLY_FAILED"
        } catch { return "LIVE_APPLY_UNAVAILABLE" }
    }

    private var configURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/mac-mcp-gateway/onboarding-v1.json")
    }
    private var nodeURL: URL {
        Bundle.main.bundleURL.appendingPathComponent(
            "Contents/Resources/runtime/bin/node")
    }
    private var setupURL: URL {
        Bundle.main.bundleURL.appendingPathComponent(
            "Contents/Resources/runtime/core/bin/setup-wizard.mjs")
    }
    var available: Bool {
        FileManager.default.isExecutableFile(atPath: nodeURL.path) &&
        FileManager.default.fileExists(atPath: setupURL.path)
    }

    // This check is not proof the profile is valid; Core startup validates
    // the owner-only file through the JS loader. It prevents overwriting it.
    func refresh() {
        let p = configURL.path
        var st = stat()
        guard lstat(p, &st) == 0 else {
            configured = false
            return
        }
        configured = st.st_uid == getuid() &&
            (st.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG) &&
            (st.st_mode & 0o077) == 0 && st.st_nlink == 1 && st.st_size < 8192
    }

    func save(project: URL, connection: String, accessRole: String,
              trustedAcknowledged: Bool) async -> Bool {
        guard !busy else { return false }
        busy = true
        problem = nil
        defer { busy = false }
        guard !configured, available, ["tunnel","https"].contains(connection),
              ["restricted","trusted"].contains(accessRole) else {
            problem = "安装组件不完整，或已有设置。请检查安装。"
            return false
        }
        if accessRole == "trusted" && !trustedAcknowledged {
            problem = "启用前请确认 Home 内可写、Home 外只读沙箱的适用范围及 Shell 风险。"
            return false
        }
        let selection = project.standardizedFileURL
        var info: ObjCBool = false
        guard selection.isFileURL,
              FileManager.default.fileExists(atPath: selection.path, isDirectory: &info),
              info.boolValue,
              !selection.path.contains("\0") else {
            problem = "请选择一个已经存在的工作文件夹。"
            return false
        }
        if accessRole == "restricted" &&
           selection.path == FileManager.default.homeDirectoryForCurrentUser.path {
            problem = "不能把整个 Home 目录作为工作区。请选择 Developer 下的具体项目文件夹。"
            return false
        }
        let runner = nodeURL
        let script = setupURL
        let target = selection.path
        let home = NSHomeDirectory()
        // A separate task prevents a slow setup check from blocking the menu.
        // Only the bundled Node and bundled, source-verified wizard can run.
        // Suppress all file paths and stdout/stderr in diagnostics.
        let result = await Task.detached(priority: .userInitiated) {
            Self.runSetupProcess(runner: runner, script: script,
                                 target: target, home: home, connection: connection,
                                 accessRole: accessRole)
        }.value
        refresh()
        if let code = result {
            switch code {
            case "SETUP_ROOT_SYMLINK_DENIED":
                problem = "所选文件夹是快捷方式，请选择实际文件夹。"
            case "SETUP_ROOT_TOO_BROAD":
                problem = "目录范围过大。请选具体项目文件夹，不能选整个 Home 或磁盘根目录。"
            case "SETUP_ROOT_MUST_BE_CANONICAL":
                problem = "该路径经过系统别名或符号链接，请选择实际文件夹。"
            case "SETUP_TRUSTED_DEVELOPER_APPROVAL_REQUIRED":
                problem = "请先确认受 Home 内写入限制的原生 Desktop Commander 开发权限。"
            case "SETUP_ACCESS_ROLE_MISMATCH", "SETUP_ACCESS_ROLE_INVALID":
                problem = "访问模式选择不一致。请重新确认权限档位。"
            case "SETUP_EXISTING_CONFIG_PROTECTED":
                problem = "检测到已有设置。为保护原配置，没有覆盖它。"
            case "SETUP_CONFIG_DIRECTORY_UNSAFE", "SETUP_CONFIG_FILE_UNSAFE":
                problem = "设置文件的访问权限不安全，请在高级诊断中检查。"
            default:
                problem = "设置没有保存成功。请确认文件夹可访问并重试。"
            }
            return false
        }
        if !configured {
            problem = "无法验证已保存的设置。请检查磁盘和文件权限。"
            return false
        }
        return true
    }

    nonisolated private static func runSetupProcess(
        runner: URL, script: URL, target: String, home: String,
        connection: String, accessRole: String
    ) -> String? {
        let process = Process()
        process.executableURL = runner
        process.arguments = [script.path, "--project", target,
                             "--access-role", accessRole,
                             "--connection", connection, "--port", "18893", "--app-json"] +
            (accessRole == "trusted" ? ["--approve-trusted-developer"] : [])
        process.environment = ["HOME":home,"PATH":"/usr/bin:/bin","LANG":"C"]
        process.standardInput = FileHandle.nullDevice
        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        do {
            let done = DispatchSemaphore(value: 0)
            process.terminationHandler = { _ in done.signal() }
            try process.run()
            if done.wait(timeout: .now() + 20) == .timedOut {
                if process.isRunning { process.terminate() }
                _ = done.wait(timeout: .now() + 2)
                return "SETUP_TIMEOUT"
            }
            let data = stdout.fileHandleForReading.readDataToEndOfFile()
            guard data.count < 2048,
                  let value = try? JSONSerialization.jsonObject(with: data)
                    as? [String: String] else { return "SETUP_UNAVAILABLE" }
            if process.terminationStatus == 0 && value["event"] == "SETUP_SAVE_OK" {
                return nil
            }
            let code = value["code"] ?? "SETUP_UNAVAILABLE"
            return code.range(of: #"^SETUP_[A-Z0-9_]+$"#,
                              options: .regularExpression) != nil
                ? code : "SETUP_UNAVAILABLE"
        } catch {
            return "SETUP_UNAVAILABLE"
        }
    }
}
