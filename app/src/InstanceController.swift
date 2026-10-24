import Foundation
import SwiftUI

struct ManagedInstance: Decodable, Identifiable {
    struct Source: Decodable { let kind: String; let path: String }
    struct Runtime: Decodable {
        let runId: String; let pid: Int; let launcher: String; let appParentPid: Int?
        let phase: String; let port: Int?; let coreProgram: String; let buildVersion: String
    }
    let instanceId: String; var id: String { instanceId }
    let name: String; let archived: Bool; let source: Source
    let phase: String; let configState: String; let configProblem: String?; let runtimeProblem: String?
    let runtime: Runtime?; let port: Int?; let configuredPort: Int?; let revision: String?
    let connectionState: String; let requiredAccess: String; let lastToolCallAt: String?
    var running: Bool { phase == "running" || phase == "starting" }
    var endpoint: String? { guard running, let port else { return nil }; return "http://127.0.0.1:\(port)/mcp" }
}
struct InstanceList: Decodable {
    let schemaVersion: Int; let defaultInstanceId: String?; let instances: [ManagedInstance]
    static func decode(_ data: Data) throws -> InstanceList {
        let result = try JSONDecoder().decode(Self.self, from: data)
        guard result.schemaVersion == 1 else { throw NSError(domain: "Gateway", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported instance protocol version"]) }
        return result
    }
}

@MainActor
final class InstanceController: ObservableObject {
    static let shared = InstanceController()
    @Published var instances: [ManagedInstance] = []
    @Published var defaultInstanceId: String?
    @Published var issue: String?
    @Published var busy = false
    @Published var selectedId: String?
    private var children: [String: Process] = [:]
    private var pipes: [String: Pipe] = [:]
    private var refreshing = false

    nonisolated static func cliURL() throws -> URL {
        let bundled = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/runtime/cli/mac-mcp-gateway").path
        for file in [bundled, "/opt/homebrew/bin/mac-mcp-gateway", "/usr/local/bin/mac-mcp-gateway"] {
            if FileManager.default.isExecutableFile(atPath: file) { return URL(fileURLWithPath: file) }
        }
        throw NSError(domain: "Gateway", code: 1, userInfo: [NSLocalizedDescriptionKey: "Gateway CLI is missing. Install the CLI or use the bundled App."])
    }
    nonisolated static func environment() -> [String: String] {
        ["HOME": NSHomeDirectory(), "USER": NSUserName(), "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "LANG": "en_US.UTF-8"]
    }
    nonisolated static func execute(_ args: [String], input: Data? = nil) throws -> Data {
        let process = Process(); process.executableURL = try cliURL()
        process.arguments = args + (args.contains("--json") ? [] : ["--json"])
        process.environment = environment()
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
        let stdin = Pipe(); process.standardInput = input == nil ? FileHandle.nullDevice : stdin
        try process.run()
        let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 80, execute: timeout)
        if let input {
            DispatchQueue.global().async {
                try? stdin.fileHandleForWriting.write(contentsOf: input)
                try? stdin.fileHandleForWriting.close()
            }
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit(); timeout.cancel()
        guard process.terminationStatus == 0 else {
            let error = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw NSError(domain: "Gateway", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: error ?? String(decoding: data, as: UTF8.self)])
        }
        return data
    }
    func refresh() async {
        guard !refreshing else { return }; refreshing = true; defer { refreshing = false }
        do {
            let data = try await Task.detached { try Self.execute(["instance", "list", "--archived"]) }.value
            let listing = try InstanceList.decode(data)
            instances = listing.instances; defaultInstanceId = listing.defaultInstanceId
            if selectedId == nil { selectedId = listing.defaultInstanceId ?? instances.first?.id }
        } catch { issue = error.localizedDescription }
    }
    @discardableResult func perform(_ args: [String], input: Data? = nil) async -> Data? {
        guard !busy else { return nil }; busy = true; issue = nil; defer { busy = false }
        do {
            let result = try await Task.detached { try Self.execute(args, input: input) }.value
            await refresh(); return result
        } catch { issue = error.localizedDescription; await refresh(); return nil }
    }
    func start(_ instance: ManagedInstance) async {
        guard !busy, children[instance.id] == nil else { return }
        do {
            let child = Process(); child.executableURL = try Self.cliURL()
            child.arguments = ["run", "--instance", instance.id, "--app-parent-pid", String(getpid()), "--json"]
            child.environment = Self.environment(); child.standardInput = FileHandle.nullDevice
            let pipe = Pipe(); child.standardOutput = pipe; child.standardError = pipe
            // Drain lifecycle output throughout the run; Core logs have their own instance file.
            pipe.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
            children[instance.id] = child; pipes[instance.id] = pipe
            child.terminationHandler = { [weak self, weak child] _ in
                Task { @MainActor in
                    guard let self, self.children[instance.id] === child else { return }
                    self.children.removeValue(forKey: instance.id)
                    self.pipes.removeValue(forKey: instance.id)?.fileHandleForReading.readabilityHandler = nil
                    if child?.terminationStatus != 0 { self.issue = "Instance stopped unexpectedly. Check its logs and configuration." }
                    await self.refresh()
                }
            }
            try child.run()
            issue = nil
        } catch { children.removeValue(forKey: instance.id); pipes.removeValue(forKey: instance.id); issue = error.localizedDescription }
        await refresh()
    }
    func stopOwned() async -> Bool {
        let owned = Array(children.values)
        for child in owned where child.isRunning { child.terminate() }
        for _ in 0..<200 {
            if owned.allSatisfy({ !$0.isRunning }) { return true }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        issue = "Some App-owned instances have not stopped. Retry quitting after checking their logs."
        return false
    }
    static func selfTest() throws {
        let raw = Data(#"{"schemaVersion":1,"defaultInstanceId":null,"instances":[]}"#.utf8)
        guard try InstanceList.decode(raw).instances.isEmpty else { throw NSError(domain: "InstanceSelfTest", code: 1) }
        let invalid = Data(#"{"schemaVersion":2,"defaultInstanceId":null,"instances":[]}"#.utf8)
        do { _ = try InstanceList.decode(invalid); throw NSError(domain: "InstanceSelfTest", code: 2) }
        catch let error as NSError where error.domain == "Gateway" { }
    }
}
