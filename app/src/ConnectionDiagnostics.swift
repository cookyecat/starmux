import Foundation

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
                                 body: Data? = nil, port: Int) async -> Data? {
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

    // The instance menu observes anonymous events without issuing MCP tool calls.
    static func readActivity(port: Int) async -> RecentToolActivity? {
        guard (1024...65535).contains(port) else { return nil }
        return classifyActivity(await readData(path: "/activity.json", port: port))
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
