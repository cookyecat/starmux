import Foundation
import AppKit
import ServiceManagement

// Native product F3-C control entry, running inside the signed canonical
// CFBundleExecutable. UI entry is unchanged; no service registrations on
// ordinary App launch. This is not a public network or MCP control API.
enum CanonicalServiceControl {
    static let label = "dev.macmcpgateway.ownerapp.agent"
    static let plist = label + ".plist"

    static func statusName(_ value: SMAppService.Status) -> String {
        switch value {
        case .enabled: return "enabled"
        case .notRegistered: return "notRegistered"
        case .requiresApproval: return "requiresApproval"
        case .notFound: return "notFound"
        @unknown default: return "unknown"
        }
    }

    // Local signing preflight, not a substitute for launchd residency.
    // This gate avoids registering an ad-hoc bundle known to be rejected
    // by macOS 26's launch constraints. It never edits signing or TCC.
    static func codeSignatureHasTeam(_ path: URL) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
        process.arguments = ["-dv", "--verbose=4", path.path]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
        } catch {
            return false
        }
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0,
              let text = String(data: output, encoding: .utf8),
              !text.contains("Signature=adhoc"),
              !text.contains("TeamIdentifier=not set"),
              let team = text.components(separatedBy: .newlines)
                 .first(where: { $0.hasPrefix("TeamIdentifier=") }),
              team.count > "TeamIdentifier=".count else {
            return false
        }
        return true
    }

    static func serviceSigningPreflight() -> Bool {
        let app = Bundle.main.bundleURL
        let agent = app.appendingPathComponent("Contents/MacOS/CanonicalServiceAgent")
        return codeSignatureHasTeam(app) && codeSignatureHasTeam(agent)
    }

    static func handleIfRequested() {
        let args = Array(CommandLine.arguments.dropFirst())
        guard let command = args.first, command.hasPrefix("--f3-") else {
            return
        }
        // Keep all ServiceManagement operations within the actual signed
        // main App process identity. Never spawn a helper to register itself.
        let service = SMAppService.agent(plistName: plist)
        let main = SMAppService.mainApp
        switch args {
        case ["--f3-service-status"]:
            print("F3_CANONICAL_SERVICE_STATUS " + statusName(service.status))
            exit(0)
        case ["--f3-service-signing-readiness"]:
            let ready = serviceSigningPreflight()
            print(ready ? "F3_SERVICE_TEAM_SIGNING_PRESENT_LAUNCHD_STILL_UNVERIFIED"
                        : "F3_SERVICE_SIGNING_IDENTITY_REQUIRED")
            exit(ready ? 0 : 5)
        case ["--f3-login-status"]:
            print("F3_CANONICAL_LOGIN_STATUS " + statusName(main.status))
            exit(0)
        case ["--f3-service-register", "--owner-approved-login-item"]:
            guard serviceSigningPreflight() else {
                fputs("F3_SERVICE_SIGNING_IDENTITY_REQUIRED: sign the App and Agent with an appropriate trusted Apple signing identity before registering.\n", stderr)
                exit(5)
            }
            guard service.status != .enabled else {
                print("F3_SERVICE_ALREADY_REGISTERED_VERIFY_LAUNCHD_RESIDENCY")
                exit(0)
            }
            // Registering is deliberately distinct from taking production
            // 8793: the bundled Agent itself has no production activation
            // capability until the separately approved cutover is built.
            do {
                try service.register()
                let after = statusName(service.status)
                print("F3_CANONICAL_REGISTER " + after + " VERIFY_LAUNCHD_RESIDENCY_SEPARATELY")
                exit(after == "enabled" || after == "requiresApproval" ? 0 : 4)
            } catch {
                fputs("F3_SERVICE_REGISTER_FAILED: \(error.localizedDescription)\n", stderr)
                exit(4)
            }
        case ["--f3-service-unregister", "--owner-approved-login-item"]:
            do {
                try service.unregister()
                print("F3_CANONICAL_UNREGISTER " + statusName(service.status))
                exit(0)
            } catch {
                fputs("F3_SERVICE_UNREGISTER_FAILED: \(error.localizedDescription)\n", stderr)
                exit(4)
            }
        case ["--f3-login-enable", "--owner-approved-login-item"]:
            do {
                try main.register()
                print("F3_CANONICAL_LOGIN_REGISTER " + statusName(main.status))
                exit(0)
            } catch {
                fputs("F3_LOGIN_REGISTER_FAILED: \(error.localizedDescription)\n", stderr)
                exit(4)
            }
        case ["--f3-login-disable", "--owner-approved-login-item"]:
            do {
                try main.unregister()
                print("F3_CANONICAL_LOGIN_UNREGISTER " + statusName(main.status))
                exit(0)
            } catch {
                fputs("F3_LOGIN_UNREGISTER_FAILED: \(error.localizedDescription)\n", stderr)
                exit(4)
            }
        default:
            fputs("F3_SERVICE_COMMAND_UNSUPPORTED\n", stderr)
            exit(2)
        }
    }
}
