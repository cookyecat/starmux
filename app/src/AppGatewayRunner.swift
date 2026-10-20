import Foundation
import AppKit
import SwiftUI

// Phase3-F3 · The GUI is an alternative *foreground owner* of the existing
// CLI. It NEVER calls kill(2) on a discovered PID and never owns a service
// started by Terminal/launchd. All real MCP execution remains in DC/Core.
@MainActor
final class AppGatewayRunner: ObservableObject {
    static let shared = AppGatewayRunner()
    enum Phase: Equatable {
        case idle, starting, running, stopping
    }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var problem: String?
    private var child: Process?
    private var ownedLog: FileHandle?

    private init() {}

    var ownsGateway: Bool {
        child?.isRunning == true && (phase == .running || phase == .starting)
    }

    private func installedCLI() -> URL? {
        let bundled = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/runtime/cli/mac-mcp-gateway").path
        for path in [bundled, "/opt/homebrew/bin/mac-mcp-gateway", "/usr/local/bin/mac-mcp-gateway"] {
            if FileManager.default.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }
        return nil
    }

    // Also used by a bounded isolated-mode acceptance probe. A production
    // start always uses the shared CLI's existing profile and port 8793.
    func start(isolatedPort: Int? = nil, cliOverride: URL? = nil) async {
        guard phase == .idle, child == nil else { return }
        phase = .starting
        problem = nil
        do {
            if let isolatedPort {
                guard (1024...65535).contains(isolatedPort), isolatedPort != 8793 else {
                    throw NSError(domain: "F3", code: 4,
                        userInfo: [NSLocalizedDescriptionKey:"INVALID_ISOLATED_PORT"])
                }
            } else {
                // Fresh, authoritative check immediately before launch.
                let status = try await Task.detached(priority: .utility) {
                    try StatusProbe.read()
                }.result.get()
                guard status.state == .stopped else {
                    throw NSError(domain: "F3", code: 1,
                        userInfo: [NSLocalizedDescriptionKey:
                            "全局唯一 Gateway Core 已运行或端口占用，拒绝重复启动"])
                }
            }
            // Overrides are limited to ephemeral isolation probes; never
            // allow a caller to substitute a production executable.
            guard cliOverride == nil || isolatedPort != nil else {
                throw NSError(domain: "F3", code: 9,
                    userInfo: [NSLocalizedDescriptionKey: "PRODUCTION_CLI_OVERRIDE_REFUSED"])
            }
            guard let url = cliOverride ?? installedCLI() else {
                throw NSError(domain: "F3", code: 2,
                    userInfo: [NSLocalizedDescriptionKey:
                        "未安装 mac-mcp-gateway CLI；请先完成 CLI 安装"])
            }
            let folder = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/Mac-MCP-Gateway")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let log = folder.appendingPathComponent("app-foreground.log")
            if !FileManager.default.fileExists(atPath: log.path) {
                guard FileManager.default.createFile(atPath: log.path,
                    contents: Data(), attributes: [.posixPermissions: 0o600]) else {
                    throw NSError(domain: "F3", code: 6,
                        userInfo: [NSLocalizedDescriptionKey:"APP_LOG_CREATION_FAILED"])
                }
            }
            let attrs = try FileManager.default.attributesOfItem(atPath: log.path)
            guard (attrs[.type] as? FileAttributeType) == .typeRegular,
                  (attrs[.ownerAccountID] as? NSNumber)?.intValue == Int(getuid()),
                  let permissions = attrs[.posixPermissions] as? NSNumber,
                  permissions.intValue & 0o077 == 0 else {
                throw NSError(domain: "F3", code: 7,
                    userInfo: [NSLocalizedDescriptionKey:"APP_LOG_UNTRUSTED"])
            }
            let output = try FileHandle(forWritingTo: log)
            try output.seekToEnd()
            let runner = Process()
            runner.executableURL = url
            runner.arguments = ["run", "--profile", "auto",
                "--app-parent-pid", String(getpid())]
            if let isolatedPort {
                runner.arguments! += ["--port", String(isolatedPort)]
            }
            runner.environment = [
                "HOME": NSHomeDirectory(), "USER": NSUserName(),
                "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                "LANG": "C"
            ]
            runner.standardInput = FileHandle.nullDevice
            runner.standardOutput = output
            runner.standardError = output
            runner.terminationHandler = { [weak self, weak runner] _ in
                Task { @MainActor in
                    guard let self, self.child === runner else { return }
                    self.child = nil
                    try? self.ownedLog?.close()
                    self.ownedLog = nil
                    if self.phase != .stopping {
                        self.problem = "由 App 启动的 Gateway 已退出，请检查本机私有运行日志"
                    }
                    self.phase = .idle
                }
            }
            try runner.run()
            child = runner
            ownedLog = output
            // Core may need time for the true Desktop Commander handshake;
            // lack of ready status is not permission to start a second Core.
            var ready = false
            for _ in 0..<22 {
                guard runner.isRunning else { break }
                if let isolatedPort {
                    if let url = URL(string: "http://127.0.0.1:\(isolatedPort)/healthz"),
                       let (data, response) = try? await URLSession.shared.data(from: url),
                       (response as? HTTPURLResponse)?.statusCode == 200,
                       let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       body["status"] as? String == "ok" {
                        ready = true
                        break
                    }
                } else {
                    let status = try? await Task.detached(priority: .utility) {
                        try StatusProbe.read()
                    }.value
                    if status?.health == "ok", status?.state == .externalForeground {
                        ready = true
                        break
                    }
                }
                try? await Task.sleep(for: .milliseconds(350))
            }
            if ready && runner.isRunning {
                phase = .running
            } else {
                if runner.isRunning { runner.terminate() }
                problem = "启动后未确认 Gateway 就绪；已尝试停止本 App 的子进程"
                phase = .stopping
            }
        } catch {
            problem = error.localizedDescription
            if child == nil {
                try? ownedLog?.close()
                ownedLog = nil
                phase = .idle
            }
        }
    }

    // CLI and App are equal controllers of the single authenticated Core.
    // No PID discovered by lsof is signaled by this UI.
    func stopGlobal(port: Int? = nil, cliOverride: URL? = nil) async -> Bool {
        guard phase != .starting && phase != .stopping else {
            problem = "Gateway 正在处理生命周期操作，请稍后重试"
            return false
        }
        let resolvedPort = port ?? (try? StatusProbe.read().port) ?? 8793
        guard (cliOverride == nil || resolvedPort != 8793),
              let cli = cliOverride ?? installedCLI() else {
            problem = "未找到受信任的 Gateway CLI，拒绝声称已停止"
            return false
        }
        guard (1024...65535).contains(resolvedPort) else {
            problem = "INVALID_GATEWAY_PORT"
            return false
        }
        phase = .stopping
        problem = nil
        let outcome = await Task.detached(priority: .userInitiated) {
            let process = Process()
            process.executableURL = cli
            process.arguments = ["stop", "--profile", "auto", "--port", String(resolvedPort)]
            process.environment = [
                "HOME": NSHomeDirectory(), "USER": NSUserName(),
                "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                "LANG": "C"
            ]
            process.standardInput = FileHandle.nullDevice
            let output = Pipe()
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                // Timeout the helper, not the Gateway Core PID.
                let bounded = Task.detached(priority: .utility) {
                    process.waitUntilExit()
                    return process.terminationStatus
                }
                let code = await withTaskGroup(of: Int32.self) { group in
                    group.addTask { await bounded.value }
                    group.addTask {
                        try? await Task.sleep(for: .seconds(15))
                        if process.isRunning { process.terminate() }
                        return 99
                    }
                    let first = await group.next() ?? 99
                    group.cancelAll()
                    return first
                }
                let data = output.fileHandleForReading.readDataToEndOfFile()
                return code == 0
                    && (String(data: data, encoding: .utf8) ?? "").contains("\"GATEWAY_CORE\"")
            } catch {
                return false
            }
        }.value
        if outcome {
            // The CLI confirms the Core and port have stopped. Ensure the
            // App-owned CLI child has also exited before a new App start.
            for _ in 0..<20 where child?.isRunning == true {
                try? await Task.sleep(for: .milliseconds(120))
            }
            if child?.isRunning == true {
                problem = "Core 已停止，但 App 启动者尚未退出，稍后重试"
                phase = .stopping
                return false
            }
            child = nil
            try? ownedLog?.close()
            ownedLog = nil
            phase = .idle
            problem = nil
        } else {
            phase = child?.isRunning == true ? .running : .idle
            problem = "未能验证唯一 Gateway Core 已停止，操作已拒绝"
        }
        return outcome
    }

    func stop() {
        // Used only by the isolated (non-8793) smoke probe.
        guard let runner = child, runner.isRunning else { return }
        phase = .stopping
        runner.terminate()
    }

}

final class AppForegroundExitDelegate: NSObject, NSApplicationDelegate {
    var welcomeWindow: NSWindow?
    private var stopVerified = false
    private var stopInProgress = false
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if stopVerified { return .terminateNow }
        if stopInProgress { return .terminateCancel }
        stopInProgress = true
        Task { @MainActor in
            let stopped = await AppGatewayRunner.shared.stopGlobal()
            self.stopInProgress = false
            if stopped {
                self.stopVerified = true
                sender.terminate(nil)
            } else {
                NSApp.activate(ignoringOtherApps: true)
            }
        }
        return .terminateCancel
    }
}
