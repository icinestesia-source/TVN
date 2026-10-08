import AppKit
import WebKit

#if FULL
let home: URL = Bundle.main.resourceURL.flatMap { SiteServer.start(root: $0.appendingPathComponent("site")) } ?? URL(string: "https://tvn.lol/")!
#else
let home = URL(string: "https://tvn.lol/")!
#endif
let siteHosts: Set<String> = [home.host ?? "tvn.lol", "tvn.lol", "www.tvn.lol"]
let offlinePage = """
<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#c9d3dc;font:16px -apple-system,sans-serif">
<div style="text-align:center">TVN needs an internet connection.<br><br><a href="https://tvn.lol/" style="color:#e8c35a">TRY AGAIN</a></div></body>
"""

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var web: WKWebView!

  func applicationDidFinishLaunching(_ notification: Notification) {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.mediaTypesRequiringUserActionForPlayback = []
    config.allowsAirPlayForMediaPlayback = true
    config.preferences.isElementFullscreenEnabled = true
    config.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15"

    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.underPageBackgroundColor = .black

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 760),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "TVN"
    window.backgroundColor = .black
    window.collectionBehavior = [.fullScreenPrimary]
    window.contentView = web
    window.center()
    window.setFrameAutosaveName("TVN")
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(web)

    buildMenu()
    web.load(URLRequest(url: home))
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  // MARK: Menus

  func buildMenu() {
    let bar = NSMenu()

    let app = NSMenu()
    app.addItem(withTitle: "About TVN", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    app.addItem(.separator())
    app.addItem(withTitle: "Hide TVN", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let others = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    others.keyEquivalentModifierMask = [.command, .option]
    app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
    app.addItem(.separator())
    app.addItem(withTitle: "Quit TVN", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    bar.addItem(submenu: app, titled: "TVN")

    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    bar.addItem(submenu: edit, titled: "Edit")

    let view = NSMenu(title: "View")
    view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r").target = self
    let full = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    full.keyEquivalentModifierMask = [.command, .control]
    bar.addItem(submenu: view, titled: "View")

    let windows = NSMenu(title: "Window")
    windows.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windows.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    bar.addItem(submenu: windows, titled: "Window")
    NSApp.windowsMenu = windows

    NSApp.mainMenu = bar
  }

  @objc func reload() {
    if web.url?.host.map(siteHosts.contains) == true { web.reload() } else { web.load(URLRequest(url: home)) }
  }

  // MARK: Navigation

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload {
      decisionHandler(.download)
      return
    }
    guard let url = action.request.url, let scheme = url.scheme?.lowercased() else {
      decisionHandler(.cancel)
      return
    }
    let mainFrame = action.targetFrame?.isMainFrame ?? true
    let ownPage = ["blob", "about", "data"].contains(scheme) || ((scheme == "https" || scheme == "http") && siteHosts.contains(url.host ?? ""))
    if mainFrame && !ownPage || action.targetFrame == nil {
      if ["http", "https", "mailto"].contains(scheme) { NSWorkspace.shared.open(url) }
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    let failure = error as NSError
    if failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled { return }
    if failure.domain == "WebKitErrorDomain" && failure.code == 102 { return }
    webView.loadHTMLString(offlinePage, baseURL: nil)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    reload()
  }

  // MARK: Pickers, dialogs and new windows

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = !parameters.allowsDirectories
    panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
  }

  // MARK: Downloads (EXPORT files)

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
    panel.beginSheetModal(for: window) { result in
      guard result == .OK, let url = panel.url else {
        completionHandler(nil)
        return
      }
      try? FileManager.default.removeItem(at: url)
      completionHandler(url)
    }
  }
}

extension NSMenu {
  func addItem(submenu: NSMenu, titled title: String) {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.submenu = submenu
    addItem(item)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
