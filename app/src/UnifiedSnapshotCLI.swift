import Foundation

struct UnifiedCLISnapshot: Encodable {
    let schemaVersion: Int
    let operationMode: String
    let product: SafeSnapshot
    let diagnostics: NativeDiagnosticSnapshot
    let connections: GatewayConnectionSnapshot
}

@main
struct UnifiedSnapshotCLI {
    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())
        do {
            switch args {
            case ["--selftest"]:
                try await InstanceController.selfTest()
                try StatusSelfTest.run()
                try NativeDiagnosticSelfTest.run()
                try ConnectionDiagnosticsSelfTest.run()
                try CurrentPermissionProbeSelfTest.run()
                print("PHASE3_UNIFIED_OPERATOR_CONNECTIONS_AND_DIAGNOSTIC_SELFTEST_PASS")
            case let values where values.count == 2 && values[0] == "--f3-isolated-smoke":
                guard let port = Int(values[1]), (1024...65535).contains(port),
                      port != 8793 else {
                    fputs("F3_SMOKE_INVALID_PORT\n", stderr)
                    exit(2)
                }
                // The same owned-process controller used by the real menu.
                // Isolated probe never registers launchd or uses production 8793.
                let runner = AppGatewayRunner.shared
                await runner.start(isolatedPort: port)
                guard runner.ownsGateway else {
                    fputs("F3_SMOKE_APP_START_FAILED\n", stderr)
                    exit(5)
                }
                print("F3_ISOLATED_APP_OWNED_CORE_READY port=\(port)")
                runner.stop()
                try? await Task.sleep(for: .seconds(1))
                print("F3_ISOLATED_APP_OWNED_CORE_STOP_REQUESTED")
            case let values where values.count == 3 &&
                  values[0] == "--f3-two-entrypoint-smoke":
                guard let port = Int(values[1]), (1024...65535).contains(port),
                      port != 8793, values[2].hasPrefix("/"),
                      FileManager.default.isExecutableFile(atPath: values[2]) else {
                    fputs("F3_TWO_ENTRYPOINT_SMOKE_INVALID_INPUT\n", stderr)
                    exit(2)
                }
                let runner = AppGatewayRunner.shared
                let cli = URL(fileURLWithPath: values[2])
                await runner.start(isolatedPort: port, cliOverride: cli)
                guard runner.ownsGateway else {
                    fputs("F3_TWO_ENTRYPOINT_APP_START_FAILED\n", stderr)
                    exit(5)
                }
                print("F3_TWO_ENTRYPOINT_SWIFT_APP_CORE_READY port=\(port)")
                let stopped = await runner.stopGlobal(port: port, cliOverride: cli)
                guard stopped else {
                    fputs("F3_TWO_ENTRYPOINT_SWIFT_GLOBAL_STOP_FAILED\n", stderr)
                    exit(6)
                }
                print("F3_TWO_ENTRYPOINT_SWIFT_GLOBAL_STOP_PASS")
            case let values where values.count == 3 &&
                  values[0] == "--f3-external-cli-stop-smoke":
                guard let port = Int(values[1]), (1024...65535).contains(port),
                      port != 8793, values[2].hasPrefix("/"),
                      FileManager.default.isExecutableFile(atPath: values[2]) else {
                    fputs("F3_EXTERNAL_STOP_SMOKE_INVALID_INPUT\n", stderr)
                    exit(2)
                }
                let stopped = await AppGatewayRunner.shared.stopGlobal(
                    port: port, cliOverride: URL(fileURLWithPath: values[2]))
                guard stopped else {
                    fputs("F3_EXTERNAL_CLI_SWIFT_STOP_FAILED\n", stderr)
                    exit(6)
                }
                print("F3_EXTERNAL_CLI_SWIFT_GLOBAL_STOP_PASS")
            case ["--snapshot"]:
                let state = try StatusProbe.read()
                let diagnostic = NativeDiagnosticProbe.read()
                let connection = await ConnectionDiagnostics.read()
                let output = UnifiedCLISnapshot(schemaVersion: 1,
                    operationMode: "read-only", product: state, diagnostics: diagnostic,
                    connections: connection)
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.sortedKeys]
                print(String(decoding: try encoder.encode(output), as: UTF8.self))
            default:
                fputs("Usage: UnifiedSnapshotCLI --selftest | --snapshot\n", stderr)
                exit(2)
            }
        } catch {
            fputs("PHASE3_UNIFIED_DIAGNOSTICS_CLI_ERROR \(error)\n", stderr)
            exit(3)
        }
    }
}
