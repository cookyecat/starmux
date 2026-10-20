import Foundation
import Darwin

// Phase 3-C: read-only status and historical evidence from fixed research IDs.
// This file never registers/unregisters an Agent or performs a protected read.
struct NativeServiceDiagnostic: Codable {
    let id: String
    let installed: Bool
    let codeSignature: String  // verified / drift / missing
    let registration: String   // from native ServiceManagement Host
    let execution: String      // from separate launchd query
    let agentPid: Int?
}
struct ProtectedReadEvidence: Codable {
    let observedAt: String
    let ageSeconds: Int
    let protectedState: String
    let applicationPolicyState: String
    let controlsPassed: Bool
    let toolCount: Int?
}
struct NativeDiagnosticSnapshot: Codable {
    let schemaVersion: Int
    let snapshotAt: String
    let readOnly: Bool
    let serviceStatusQueriedNow: Bool
    let evidenceIsHistorical: Bool
    let services: [NativeServiceDiagnostic]
    let recentEvidence: [ProtectedReadEvidence]
    let evidenceProblem: String?
    let currentFDA: String
}

struct ResearchAppIdentity {
    let id: String
    let name: String
    let host: String
    let cdhash: String
    let nativePrefix: String
    let launchdLabel: String

    static let known: [ResearchAppIdentity] = [
        ResearchAppIdentity(id: "persistent",
            name: "Mac MCP Gateway Phase3 Persistent Research.app",
            host: "PersistentServiceHost",
            cdhash: "ae40d27eedb7a85887760e2625fabc87aac3617e",
            nativePrefix: "PHASE3_PERSISTENT_SMAPP_STATUS ",
            launchdLabel: "dev.macmcpgateway.phase3.persistentresearch.agent"),
        ResearchAppIdentity(id: "tcc-read",
            name: "Mac MCP Gateway Phase3 TCC Read Research.app",
            host: "TCCReadServiceHost",
            cdhash: "d9be3598315514aa89135229919f1ba6680e326b",
            nativePrefix: "PHASE3_TCC_READ_SMAPP_STATUS ",
            launchdLabel: "dev.macmcpgateway.phase3.tccreadresearch.agent")
    ]
}

enum NativeDiagnosticProbe {
    private static let validSMStates: Set<String> = [
        "enabled", "notRegistered", "requiresApproval", "notFound"
    ]
    static func parseRegistration(_ message: String, prefix: String) -> String {
        let lines = message.split(whereSeparator: \.isNewline)
        guard lines.count == 1, lines[0].hasPrefix(prefix) else { return "unavailable" }
        let value = String(lines[0].dropFirst(prefix.count))
        return validSMStates.contains(value) ? value : "unavailable"
    }
    static func parseLaunchd(_ output: String) -> (String, Int?) {
        let lines = output.split(separator: "\n")
        let running = lines.contains { $0.trimmingCharacters(in: .whitespaces) == "state = running" }
        let pattern = try! NSRegularExpression(pattern: #"(?m)^\s*pid = ([0-9]+)\s*$"#)
        let match = pattern.firstMatch(in: output, range: NSRange(output.startIndex..<output.endIndex, in: output))
        let pid = match.flatMap { m in
            Range(m.range(at: 1), in: output).flatMap { Int(output[$0]) }
        }
        return running && pid != nil ? ("running", pid) : ("idle", nil)
    }
    // Exact executable paths, fixed argv, no shell and bounded output/timeout.
    private static func execute(_ executable: String, _ args: [String],
                                timeout: Double = 6) -> (Int32, String)? {
        guard FileManager.default.isExecutableFile(atPath: executable) else { return nil }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = args
        process.environment = ["HOME": NSHomeDirectory(), "PATH": "/usr/bin:/bin", "LANG": "C"]
        process.standardInput = FileHandle.nullDevice
        let out = Pipe()
        process.standardOutput = out
        process.standardError = out
        let done = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in done.signal() }
        do {
            try process.run()
            if done.wait(timeout: .now() + timeout) == .timedOut {
                process.terminate()
                _ = done.wait(timeout: .now() + 2)
                return nil
            }
            let data = out.fileHandleForReading.readDataToEndOfFile()
            guard data.count < 65536 else { return nil }
            return (process.terminationStatus, String(decoding: data, as: UTF8.self))
        } catch { return nil }
    }
    private static func inspect(_ identity: ResearchAppIdentity) -> NativeServiceDiagnostic {
        let app = NSHomeDirectory() + "/Applications/" + identity.name
        var st = stat()
        guard lstat(app, &st) == 0 else {
            return NativeServiceDiagnostic(id: identity.id, installed: false,
                codeSignature: "missing", registration: "unavailable",
                execution: "absent", agentPid: nil)
        }
        guard (st.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR), st.st_uid == getuid(),
              let verified = execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], timeout: 12),
              verified.0 == 0,
              let metadata = execute("/usr/bin/codesign", ["-dv", "--verbose=4", app]),
              metadata.0 == 0,
              metadata.1.split(whereSeparator: \.isNewline).contains(where: {
                  String($0) == "CDHash=" + identity.cdhash
              })
        else {
            return NativeServiceDiagnostic(id: identity.id, installed: true,
                codeSignature: "drift", registration: "unavailable",
                execution: "unknown", agentPid: nil)
        }
        let host = app + "/Contents/MacOS/" + identity.host
        let reg: String
        if let response = execute(host, ["--status"]), response.0 == 0 {
            reg = parseRegistration(response.1, prefix: identity.nativePrefix)
        } else { reg = "unavailable" }
        if reg != "enabled" {
            let execution = reg == "notRegistered" || reg == "notFound" ? "absent" : "unknown"
            return NativeServiceDiagnostic(id: identity.id, installed: true,
                codeSignature: "verified", registration: reg,
                execution: execution, agentPid: nil)
        }
        let raw = execute("/bin/launchctl", ["print", "gui/\(getuid())/\(identity.launchdLabel)"])
        let running = raw != nil && raw!.0 == 0 ? parseLaunchd(raw!.1) : ("unknown", nil)
        return NativeServiceDiagnostic(id: identity.id, installed: true,
            codeSignature: "verified", registration: reg,
            execution: running.0, agentPid: running.1)
    }

    private struct EvidenceRecord: Decodable {
        let schemaVersion: Int
        let appIdentity: String
        let experiment: String
        let result: String
        let protectedReadState: String
        let policyNegativeState: String
        let mcpInitialized: Bool
        let health: Bool
        let fixtureRead: Bool
        let writeRejected: Bool
        let childGroupExited: Bool
        let noProtectedContentsStored: Bool
        let toolCount: Int?
    }
    static func classifyEvidence(_ bytes: Data, time: Date, now: Date) -> ProtectedReadEvidence? {
        guard let e = try? JSONDecoder().decode(EvidenceRecord.self, from: bytes),
              e.schemaVersion == 1,
              e.appIdentity == "dev.macmcpgateway.phase3.tccreadresearch",
              e.experiment == "phase3-b-real-mcp-fda-ab",
              e.noProtectedContentsStored, e.result == "COMPLETED",
              ["READ_OK", "OS_DENIED", "APP_POLICY_DENIED", "TOOL_ERROR", "INCONCLUSIVE"].contains(e.protectedReadState),
              ["READ_OK", "OS_DENIED", "APP_POLICY_DENIED", "TOOL_ERROR", "INCONCLUSIVE"].contains(e.policyNegativeState)
        else { return nil }
        let elapsed = now.timeIntervalSince(time)
        guard elapsed >= -300 && elapsed < 365 * 86400 else { return nil }
        let controls = e.mcpInitialized && e.health && e.fixtureRead &&
            e.writeRejected && e.childGroupExited && e.toolCount == 27 &&
            e.policyNegativeState == "APP_POLICY_DENIED"
        return ProtectedReadEvidence(observedAt: ISO8601DateFormatter().string(from: time),
            ageSeconds: max(0, Int(elapsed)), protectedState: e.protectedReadState,
            applicationPolicyState: e.policyNegativeState,
            controlsPassed: controls, toolCount: e.toolCount)
    }
    private static func owned(_ path: String, kind: mode_t, permissions: mode_t) -> Bool {
        var st = stat()
        return lstat(path, &st) == 0 && st.st_uid == getuid() &&
               (st.st_mode & mode_t(S_IFMT)) == kind &&
               (st.st_mode & 0o777) == permissions
    }
    static func historicalEvidence(now: Date = Date()) -> ([ProtectedReadEvidence], String?) {
        let root = NSHomeDirectory() + "/Library/Application Support/MacMCP-Phase3-TCC"
        guard owned(root, kind: mode_t(S_IFDIR), permissions: 0o700) else {
            return ([], "私有证据目录不可用或权限校验失败")
        }
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: root) else {
            return ([], "历史证据目录不可读取")
        }
        let pattern = try! NSRegularExpression(pattern: #"^tcc-read-agent-[0-9]+-[0-9]+\.json$"#)
        var evidence: [(Date, ProtectedReadEvidence)] = []
        for name in names.sorted().prefix(256) {
            guard pattern.firstMatch(in: name, range: NSRange(name.startIndex..<name.endIndex, in: name)) != nil else { continue }
            let path = root + "/" + name
            guard owned(path, kind: mode_t(S_IFREG), permissions: 0o600) else { continue }
            var st = stat()
            guard lstat(path, &st) == 0 && st.st_size > 0 && st.st_size <= 8192 else { continue }
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { continue }
            let time = Date(timeIntervalSince1970: TimeInterval(st.st_mtimespec.tv_sec))
            if let e = classifyEvidence(data, time: time, now: now) { evidence.append((time, e)) }
        }
        return (evidence.sorted { $0.0 > $1.0 }.prefix(3).map { $0.1 }, nil)
    }
    static func read() -> NativeDiagnosticSnapshot {
        let now = Date()
        let (evidence, problem) = historicalEvidence(now: now)
        return NativeDiagnosticSnapshot(schemaVersion: 1,
            snapshotAt: ISO8601DateFormatter().string(from: now),
            readOnly: true, serviceStatusQueriedNow: true,
            evidenceIsHistorical: true,
            services: ResearchAppIdentity.known.map { inspect($0) },
            recentEvidence: evidence, evidenceProblem: problem,
            currentFDA: "unknown-not-tested")
    }
}

enum NativeDiagnosticSelfTest {
    enum Failure: Error { case unexpected }
    static func run() throws {
        func check(_ result: Bool) throws { if !result { throw Failure.unexpected } }
        try check(NativeDiagnosticProbe.parseRegistration(
            "PHASE3_TCC_READ_SMAPP_STATUS notRegistered\n",
            prefix: "PHASE3_TCC_READ_SMAPP_STATUS ") == "notRegistered")
        try check(NativeDiagnosticProbe.parseRegistration(
            "PHASE3_TCC_READ_SMAPP_STATUS enabled\nextra\n",
            prefix: "PHASE3_TCC_READ_SMAPP_STATUS ") == "unavailable")
        try check(NativeDiagnosticProbe.parseLaunchd("state = running\npid = 123\n").0 == "running")
        try check(NativeDiagnosticProbe.parseLaunchd("state = waiting\n").0 == "idle")
        let fixture = """
        {"schemaVersion":1,"appIdentity":"dev.macmcpgateway.phase3.tccreadresearch",
        "experiment":"phase3-b-real-mcp-fda-ab","result":"COMPLETED",
        "protectedReadState":"READ_OK","policyNegativeState":"APP_POLICY_DENIED",
        "mcpInitialized":true,"health":true,"fixtureRead":true,"writeRejected":true,
        "childGroupExited":true,"noProtectedContentsStored":true,"toolCount":27}
        """
        let now = Date()
        guard let record = NativeDiagnosticProbe.classifyEvidence(
            Data(fixture.utf8), time: now, now: now) else { throw Failure.unexpected }
        try check(record.controlsPassed && record.protectedState == "READ_OK")
        let forged = fixture.replacingOccurrences(of: "tccreadresearch", with: "other")
        try check(NativeDiagnosticProbe.classifyEvidence(
            Data(forged.utf8), time: now, now: now) == nil)
        let weak = fixture.replacingOccurrences(of: "\"writeRejected\":true",
                                                  with: "\"writeRejected\":false")
        try check(NativeDiagnosticProbe.classifyEvidence(
            Data(weak.utf8), time: now, now: now)?.controlsPassed == false)
        try check(NativeDiagnosticProbe.read().currentFDA == "unknown-not-tested")
    }
}
