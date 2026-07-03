import Cocoa
import FinderSync

@objc(NovaSVNFinderSync)
final class NovaSVNFinderSync: FIFinderSync {
    private let actions: [(title: String, action: String)] = [
        ("打开工作副本", "open"),
        ("提交", "commit"),
        ("更新", "update"),
        ("Diff", "diff"),
        ("日志", "log"),
        ("撤销", "revert"),
        ("清理", "cleanup"),
        ("分支工作区", "branch-workspace"),
    ]

    override init() {
        super.init()
        FIFinderSyncController.default().directoryURLs = monitoredDirectories()
    }

    override var toolbarItemName: String {
        "NovaSVN"
    }

    override var toolbarItemToolTip: String {
        "NovaSVN"
    }

    override var toolbarItemImage: NSImage {
        NSImage(named: NSImage.Name("NSEveryone")) ?? NSImage()
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        guard menuKind == .contextualMenuForItems || menuKind == .contextualMenuForContainer else {
            return nil
        }

        let menu = NSMenu(title: "NovaSVN")
        for entry in actions {
            let item = NSMenuItem(
                title: "NovaSVN \(entry.title)",
                action: #selector(runAction(_:)),
                keyEquivalent: "",
            )
            item.target = self
            item.representedObject = entry.action
            menu.addItem(item)
        }
        return menu
    }

    @objc private func runAction(_ sender: NSMenuItem) {
        guard
            let action = sender.representedObject as? String,
            let targetURL = selectedTargetURL()
        else {
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [
            "-a",
            "NovaSVN",
            "--args",
            "--novasvn-action",
            action,
            "--novasvn-path",
            targetURL.path,
        ]
        try? process.run()
    }

    private func selectedTargetURL() -> URL? {
        let controller = FIFinderSyncController.default()
        if let selectedURL = controller.selectedItemURLs()?.first {
            return selectedURL
        }
        return controller.targetedURL()
    }

    private func monitoredDirectories() -> Set<URL> {
        var urls: Set<URL> = []
        let homeURL = FileManager.default.homeDirectoryForCurrentUser
        urls.insert(homeURL)
        urls.insert(URL(fileURLWithPath: "/Volumes", isDirectory: true))
        urls.insert(URL(fileURLWithPath: "/Users", isDirectory: true))
        return urls
    }
}
