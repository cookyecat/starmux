import AppKit

final class AppForegroundExitDelegate: NSObject, NSApplicationDelegate {
    var welcomeWindow: NSWindow?
    private var stopVerified = false
    private var stopInProgress = false
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if stopVerified { return .terminateNow }
        if stopInProgress { return .terminateCancel }
        stopInProgress = true
        Task { @MainActor in
            let managedStopped = await InstanceController.shared.stopOwned()
            let stopped = managedStopped
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
