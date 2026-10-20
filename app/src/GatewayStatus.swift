import Foundation

// Shared read-only Gateway status model. Never infer process ownership from
// a busy port alone. The existing operator CLI is the authoritative classifier.
enum RuntimeKind: String, Codable {
    case externalForeground = "foreground-external"
    case serviceRunning = "service-running"
    case serviceDegraded = "service-degraded"
    case stopped
    case unknownListener = "unknown-listener"
    case unavailable

    var label: String {
        switch self {
        case .externalForeground: return "前台运行 · 由终端管理"
        case .serviceRunning: return "后台服务运行"
        case .serviceDegraded: return "后台服务异常"
        case .stopped: return "已停止"
        case .unknownListener: return "未知监听者 · 禁止接管"
        case .unavailable: return "状态不可用"
        }
    }
    var icon: String {
        switch self {
        case .externalForeground: return "terminal"
        case .serviceRunning: return "checkmark.circle.fill"
        case .serviceDegraded: return "exclamationmark.triangle.fill"
        case .stopped: return "pause.circle"
        case .unknownListener: return "questionmark.shield"
        case .unavailable: return "wifi.exclamationmark"
        }
    }
}

struct OperatorStatus: Decodable {
    let event: String?
    let profile: String?
    let installed: Bool?
    let registered: Bool?
    let port: Int?
    let health: String?
    let writeScope: String?
    let executionMode: String?
    let listenerPid: Int?
    let loginAutostart: String?
}
struct SafeSnapshot: Encodable {
    let state: RuntimeKind
    let port: Int?
    let pid: Int?
    let health: String
    let launchdRegistered: Bool
    let autostart: String
    let profile: String
    let checkedAt: String
    let readOnlyPreview: Bool
    let writeScope: String?
}
enum GatewayClassifier {
    static func classify(_ s: OperatorStatus) -> RuntimeKind {
        // Original private live profile is fixed to 8793; newly onboarded
        // owners may have a different localhost port from their 0600 config.
        let valid = s.profile == "live" ? s.port == 8793 :
                    s.profile == "setup" && (s.port.map { (1024...65535).contains($0) } ?? false)
        guard s.event == "GATEWAY_STATUS", valid else { return .unavailable }
        let registered = s.registered == true
        switch s.executionMode {
        case "foreground":
            return !registered && s.health == "ok" && s.listenerPid != nil
                ? .externalForeground : .unknownListener
        case "service-healthy":
            return registered && s.health == "ok"
                ? .serviceRunning : .unknownListener
        case "service-unhealthy":
            return registered ? .serviceDegraded : .unknownListener
        case "stopped":
            return !registered ? .stopped : .unknownListener
        default: return .unknownListener
        }
    }
    static func parse(_ json: String) throws -> SafeSnapshot {
        let s = try JSONDecoder().decode(OperatorStatus.self, from: Data(json.utf8))
        return SafeSnapshot(state: classify(s), port: s.port, pid: s.listenerPid,
            health: s.health ?? "unavailable", launchdRegistered: s.registered == true,
            autostart: s.loginAutostart ?? "unknown", profile: s.profile ?? "unknown",
            checkedAt: ISO8601DateFormatter().string(from: Date()),
            readOnlyPreview: true,writeScope: s.writeScope)
    }
}

enum StatusProbe {
    enum Failure: Error { case cliUnavailable, timeout, invalidResult, failed }
    static func read() throws -> SafeSnapshot {
        let bundled = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/runtime/cli/mac-mcp-gateway").path
        let choices = [bundled, "/opt/homebrew/bin/mac-mcp-gateway",
                       "/usr/local/bin/mac-mcp-gateway"]
        guard let cli = choices.first(where: FileManager.default.isExecutableFile(atPath:))
            else { throw Failure.cliUnavailable }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: cli)
        // CLI defaults to a human-readable status. The native observer needs the
        // explicit machine-readable contract, not formatted terminal output.
        process.arguments = ["status", "--json", "--profile", "auto"]
        process.environment = ["HOME": NSHomeDirectory(),
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "LANG": "C"]
        let out = Pipe()
        process.standardOutput = out
        process.standardError = FileHandle.nullDevice
        let finished = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in finished.signal() }
        try process.run()
        if finished.wait(timeout: .now() + 8) == .timedOut {
            process.terminate()
            throw Failure.timeout
        }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0 else { throw Failure.failed }
        guard data.count < 8192,
              let text = String(data: data, encoding: .utf8),
              let line = text.split(separator: "\n").last
            else { throw Failure.invalidResult }
        return try GatewayClassifier.parse(String(line))
    }
}

enum StatusSelfTest {
    static func run() throws {
        func test(_ mode: String, _ registered: Bool, _ health: String,
                  _ pid: Int?, _ expected: RuntimeKind, port: Int = 8793) throws {
            var record: [String: Any] = [
                "event": "GATEWAY_STATUS", "profile": "live",
                "executionMode": mode, "registered": registered,
                "port": port, "health": health, "loginAutostart": "disabled"]
            if let pid { record["listenerPid"] = pid }
            let data = try JSONSerialization.data(withJSONObject: record)
            let snap = try GatewayClassifier.parse(String(decoding: data, as: UTF8.self))
            guard snap.state == expected && snap.readOnlyPreview else {
                throw StatusProbe.Failure.invalidResult
            }
        }
        try test("foreground", false, "ok", 9914, .externalForeground)
        try test("service-healthy", true, "ok", 99, .serviceRunning)
        try test("service-unhealthy", true, "unreachable", 99, .serviceDegraded)
        try test("stopped", false, "not-running", nil, .stopped)
        try test("unknown-listener", false, "ok", 99, .unknownListener)
        try test("foreground", true, "ok", 99, .unknownListener)
        try test("foreground", false, "unreachable", 99, .unknownListener)
        try test("foreground", false, "ok", 9914, .unavailable, port: 9999)
        let setup: [String: Any] = ["event":"GATEWAY_STATUS",
            "profile":"setup","executionMode":"stopped",
            "registered":false,"port":18893,"health":"not-running"]
        let data = try JSONSerialization.data(withJSONObject: setup)
        let firstRun = try GatewayClassifier.parse(String(decoding: data, as: UTF8.self))
        guard firstRun.state == .stopped && firstRun.port == 18893 else {
            throw StatusProbe.Failure.invalidResult
        }
    }
}
