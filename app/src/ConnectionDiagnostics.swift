import Foundation

// This is an OBSERVER, not a discovery of authenticated remote client
// identities. The real Gateway currently does not provide client sessions
// or cryptographically authenticated caller metadata.
struct GatewayConnectionSnapshot: Codable {
    let checkedAt: String
    let tunnelRunning: Bool
    let tunnelState: String
    let tunnelPointsToLiveGateway: Bool
    let configuredClient: String   // Intended client from installed private Tunnel
    let remoteCallerIdentity: String // always "unverified" until a real auth protocol
    let upstreamName: String
    let upstreamState: String
    let upstreamToolCount: Int?
    let additionalUpstreams: [String]
    let source: String
    let directHttpsStatus: String
    let recentToolActivity: RecentToolActivity?
}
struct RecentToolActivity: Codable {
    let lastToolCallAt: String?
    let recent: [RecentToolEvent]
    let attribution: String
}
struct RecentToolEvent: Codable {
    let at: String
    let route: String
    let outcome: String
}

enum ConnectionDiagnostics {
    private static func readData(path: String, method: String = "GET",
                                 body: Data? = nil, port: Int = 8793) async -> Data? {
        guard (1024...65535).contains(port),
              let url = URL(string: "http://127.0.0.1:\(port)" + path),
              url.scheme == "http", url.host == "127.0.0.1",
              url.port == port, ["/dashboard.json","/mcp","/activity.json"].contains(path)
        else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        }
        do {
            let (bytes, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  bytes.count < 180000 else { return nil }
            return bytes
        } catch { return nil }
    }
    private static func rpc(_ method: String, _ params: [String: Any],
                            port: Int = 8793) async -> [String: Any]? {
        let body: [String: Any] = [
            "jsonrpc": "2.0", "id": 28, "method": method, "params": params
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let raw = await readData(path: "/mcp", method: "POST", body: data, port: port),
              let document = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              document["error"] == nil
        else { return nil }
        return document["result"] as? [String: Any]
    }

    // Accept a strongly bounded observer format only. It cannot prove a
    // caller's identity, even if the calling MCP client says "ChatGPT".
    static func classifyActivity(_ raw: Data?) -> RecentToolActivity? {
        guard let raw, raw.count < 8192,
              let dictionary = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              dictionary["schemaVersion"] as? Int == 1,
              dictionary["enabled"] as? Bool == true,
              dictionary["attribution"] as? String == "unverified",
              dictionary["scope"] as? String == "owner-local-memory",
              let records = dictionary["recent"] as? [[String: Any]],
              records.count <= 5 else { return nil }
        func valid(_ iso: String) -> Bool {
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return fractional.date(from: iso) != nil ||
                ISO8601DateFormatter().date(from: iso) != nil
        }
        let output: [RecentToolEvent] = records.compactMap { row in
            guard let time = row["at"] as? String, valid(time),
                  let route = row["route"] as? String, route.count <= 40,
                  route.range(of: #"^[a-z][a-z0-9_-]*$"#,
                      options: .regularExpression) != nil,
                  let result = row["outcome"] as? String,
                  ["complete","blocked","error"].contains(result)
            else { return nil }
            return RecentToolEvent(at: time, route: route, outcome: result)
        }
        guard output.count == records.count else { return nil }
        let last = dictionary["lastToolCallAt"] as? String
        guard last == nil || valid(last!) else { return nil }
        return RecentToolActivity(lastToolCallAt: last, recent: output,
                                  attribution: "unverified")
    }

    // Typed client-facing projection. Never report a configured Tunnel as an
    // authenticated, currently online ChatGPT session.
    static func classifyTunnel(status: String?, target: String?) -> (Bool, Bool) {
        (status == "running", target == "8793 · Project Workspace")
    }
    static func classifyHealth(_ result: [String: Any]?) -> (String, Int?, [String]) {
        guard let result, result["isError"] as? Bool != true,
              let content = result["content"] as? [[String: Any]],
              let first = content.first?["text"] as? String,
              let raw = first.data(using: .utf8),
              let health = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              health["status"] as? String == "ok",
              health["upstream"] as? String == "desktop-commander",
              let tools = health["tools"] as? Int, tools >= 0, tools <= 1000
        else { return ("unavailable", nil, []) }
        let routes = health["routes"] as? [[String: Any]] ?? []
        let extra = routes.compactMap { item -> String? in
            guard let id = item["id"] as? String, id != "desktop",
                  id.count <= 40, id.range(of: #"^[a-z][a-z0-9_-]*$"#,
                                            options: .regularExpression) != nil
            else { return nil }
            return id
        }
        return ("ready", tools, extra)
    }
    // The instance menu observes anonymous events without issuing MCP tool calls.
    static func readActivity(port: Int) async -> RecentToolActivity? {
        guard (1024...65535).contains(port) else { return nil }
        return classifyActivity(await readData(path: "/activity.json", port: port))
    }
    static func read(port: Int = 8793) async -> GatewayConnectionSnapshot {
        let stamp = ISO8601DateFormatter().string(from: Date())
        var state = "unknown"
        var target: String?
        var hasDashboard = false
        var additional: [String] = []
        var directHttpsStatus = "unknown"
        if let data = await readData(path: "/dashboard.json", port: port),
           let data = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let modules = data["modules"] as? [[String: Any]] {
            hasDashboard = true
            if let tunnel = modules.first(where: { ($0["id"] as? String) == "tunnel" }) {
                state = tunnel["status"] as? String ?? "unknown"
            }
            target = data["tunnelBackend"] as? String
            if let caddy = modules.first(where: { ($0["id"] as? String) == "caddy" }) {
                directHttpsStatus = caddy["status"] as? String ?? "unknown"
            }
            if let upstreams = data["configuredUpstreams"] as? [[String: Any]] {
                additional = upstreams.compactMap { item -> String? in
                    guard let id = item["id"] as? String,
                          id.count <= 40,
                          id.range(of: #"^[a-z][a-z0-9_-]*$"#,
                                   options: .regularExpression) != nil else { return nil }
                    return id
                }
            }
        }
        let tunnel = classifyTunnel(status: state, target: target)
        // Use real safe MCP health_check instead of deducing upstream availability
        // from static names, a busy port or old research reports.
        let initialized = await rpc("initialize", [
            "protocolVersion": "2025-06-18", "capabilities": [:],
            "clientInfo": ["name": "gateway-menu-self-check", "version": "0.2.1"]
        ], port: port)
        let health: (String, Int?, [String])
        if initialized?["serverInfo"] is [String: Any] {
            health = classifyHealth(await rpc("tools/call", [
                "name": "health_check", "arguments": [:]
            ], port: port))
        } else {
            health = ("unavailable", nil, [])
        }
        let routes = Array(Set(additional + health.2)).sorted()
        // Currently optional and unavailable on live 8793 until an independently
        // approved release. Never infer activity from the health_check above.
        let recent = classifyActivity(await readData(path: "/activity.json", port: port))
        return GatewayConnectionSnapshot(
            checkedAt: stamp,
            tunnelRunning: tunnel.0,
            tunnelState: state,
            tunnelPointsToLiveGateway: tunnel.1,
            configuredClient: tunnel.0 && tunnel.1 ? "ChatGPT" : "unknown",
            remoteCallerIdentity: "unverified",
            upstreamName: "Desktop Commander",
            upstreamState: health.0,
            upstreamToolCount: health.1,
            additionalUpstreams: routes,
            source: hasDashboard ? "local-dashboard+gateway-health-check" : "gateway-health-check-only",
            directHttpsStatus: directHttpsStatus,
            recentToolActivity: recent
        )
    }
}

enum ConnectionDiagnosticsSelfTest {
    enum Failure: Error { case assertion }
    static func run() throws {
        func check(_ condition: Bool) throws {
            if !condition { throw Failure.assertion }
        }
        let live = ConnectionDiagnostics.classifyTunnel(
            status: "running", target: "8793 · Project Workspace")
        try check(live.0 && live.1)
        let other = ConnectionDiagnostics.classifyTunnel(
            status: "running", target: "8792 · DC Standby")
        try check(other.0 && !other.1)
        let down = ConnectionDiagnostics.classifyTunnel(
            status: "stopped", target: "8793 · Project Workspace")
        try check(!down.0 && down.1)
        let text = """
        {"status":"ok","upstream":"desktop-commander","tools":25,
         "routes":[{"id":"desktop","toolCount":25},
                   {"id":"extra","toolCount":2}]}
        """
        let result: [String: Any] = ["content": [["type":"text","text":text]]]
        let health = ConnectionDiagnostics.classifyHealth(result)
        try check(health.0 == "ready" && health.1 == 25 &&
                  health.2 == ["extra"])
        let missing = ConnectionDiagnostics.classifyHealth(nil)
        try check(missing.0 == "unavailable" && missing.1 == nil)
        let spoofed: [String: Any] = ["content": [["text":"{\"status\":\"ok\",\"upstream\":\"other\",\"tools\":25}"]]]
        try check(ConnectionDiagnostics.classifyHealth(spoofed).0 == "unavailable")
        let payload = """
        {"schemaVersion":1,"enabled":true,"attribution":"unverified",
        "scope":"owner-local-memory","lastToolCallAt":"2026-10-17T08:30:00.000Z",
        "recent":[{"at":"2026-10-17T08:30:00.000Z","route":"desktop","outcome":"complete"}]}
        """
        guard let activity = ConnectionDiagnostics.classifyActivity(Data(payload.utf8))
        else { throw Failure.assertion }
        try check(activity.recent.count == 1 && activity.attribution == "unverified")
        try check(ConnectionDiagnostics.classifyActivity(Data(payload.replacingOccurrences(
            of: "unverified", with: "verified").utf8)) == nil)
        try check(ConnectionDiagnostics.classifyActivity(Data(payload.replacingOccurrences(
            of: "desktop", with: "path../secret").utf8)) == nil)

        // The UI displays at most five entries and rejects oversized or
        // malformed response batches, even if a server violates the contract.
        let five: [[String: String]] = (0..<5).map { index in
            ["at": "2026-10-17T08:30:0\(index).000Z",
             "route": index == 4 ? "gateway" : "desktop",
             "outcome": index == 2 ? "error" : (index == 3 ? "blocked" : "complete")]
        }
        var fixture: [String: Any] = [
            "schemaVersion": 1,
            "enabled": true,
            "attribution": "unverified",
            "scope": "owner-local-memory",
            "lastToolCallAt": "2026-10-17T08:30:04.000Z",
            "recent": five
        ]
        guard let fiveBytes = try? JSONSerialization.data(withJSONObject: fixture),
              let accepted = ConnectionDiagnostics.classifyActivity(fiveBytes)
        else { throw Failure.assertion }
        try check(accepted.recent.count == 5)
        try check(accepted.recent[2].outcome == "error")
        try check(accepted.recent[3].outcome == "blocked")
        try check(accepted.recent[4].route == "gateway")
        fixture["recent"] = five + [five[0]]
        let sixBytes = try JSONSerialization.data(withJSONObject: fixture)
        try check(ConnectionDiagnostics.classifyActivity(sixBytes) == nil)
    }
}


// Lightweight CURRENT capability evidence, gathered by the Core itself.
// The result says which directory handles the Core could open; it cannot
// establish the macOS FDA toggle value. No contents or filenames are read.
struct ProtectedDirectoryCheck: Codable {
    let id: String
    let label: String
    let state: String
}
struct CurrentPermissionSnapshot: Codable {
    let schemaVersion: Int
    let context: String
    let method: String
    let checkedAt: String
    let summary: String
    let checks: [ProtectedDirectoryCheck]

    var allowedCount: Int { checks.filter { $0.state == "READ_OK" }.count }
    var deniedCount: Int { checks.filter { $0.state == "OS_DENIED" }.count }
}
enum CurrentPermissionProbe {
    private static let knownIDs: Set<String> = [
        "cloudDocs","mobileSync","tcc","addressBook","faceTime","knowledge"
    ]
    private static let states: Set<String> = [
        "READ_OK","OS_DENIED","MISSING","INCONCLUSIVE"
    ]
    static func parse(_ data: Data) -> CurrentPermissionSnapshot? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        guard data.count < 8192,
              let status = try? JSONDecoder().decode(CurrentPermissionSnapshot.self, from: data),
              status.schemaVersion == 1,
              status.context == "gateway-process",
              status.method == "open-directory-without-reading-entries",
              status.checks.count == 6,
              Set(status.checks.map(\.id)) == knownIDs,
              status.checks.allSatisfy({ states.contains($0.state) && $0.label.count < 30 }),
              (fractional.date(from: status.checkedAt) != nil ||
               standard.date(from: status.checkedAt) != nil),
              ["verified","needs-attention","partial-or-unknown"].contains(status.summary)
        else { return nil }
        let expected = status.allowedCount == 6 ? "verified" :
                       status.deniedCount > 0 ? "needs-attention" : "partial-or-unknown"
        return expected == status.summary ? status : nil
    }
    static func read(port: Int) async -> CurrentPermissionSnapshot? {
        guard (1024...65535).contains(port),
              let url = URL(string: "http://127.0.0.1:\(port)/privacy/status") else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 5
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return parse(data)
        } catch { return nil }
    }
}

enum CurrentPermissionProbeSelfTest {
    enum Failure: Error { case unexpected }
    static func run() throws {
        let ids = ["cloudDocs","mobileSync","tcc","addressBook","faceTime","knowledge"]
        let good = CurrentPermissionSnapshot(schemaVersion: 1,
            context: "gateway-process",
            method: "open-directory-without-reading-entries",
            checkedAt: "2026-10-18T08:00:00.123Z",
            summary: "verified",
            checks: ids.map { ProtectedDirectoryCheck(id: $0, label: $0, state: "READ_OK") })
        let raw = try JSONEncoder().encode(good)
        guard CurrentPermissionProbe.parse(raw)?.allowedCount == 6 else {
            throw Failure.unexpected
        }
        let bad = CurrentPermissionSnapshot(schemaVersion: 1,
            context: "gateway-process",
            method: "open-directory-without-reading-entries",
            checkedAt: good.checkedAt,
            summary: "verified",
            checks: ids.map { ProtectedDirectoryCheck(id: $0, label: $0,
                state: $0 == "tcc" ? "OS_DENIED" : "READ_OK") })
        guard CurrentPermissionProbe.parse(try JSONEncoder().encode(bad)) == nil else {
            throw Failure.unexpected
        }
        let spoofed = CurrentPermissionSnapshot(schemaVersion: 1,
            context: "system-settings",
            method: good.method, checkedAt: good.checkedAt,
            summary: good.summary, checks: good.checks)
        guard CurrentPermissionProbe.parse(try JSONEncoder().encode(spoofed)) == nil else {
            throw Failure.unexpected
        }
    }
}
