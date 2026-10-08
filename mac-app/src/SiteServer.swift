import Foundation
import Network

/**
 * TVN Full: serves the TVN site from inside the app, to this Mac only. The two lookups that need TVN's own
 * server (adding a YouTube channel or a podcast) are passed on to https://tvn.lol.
 */
final class SiteServer {
  /** A fixed address keeps the site's saved channels and settings between launches; the rest are fallbacks. */
  static let ports: [UInt16] = Array(47173...47180)
  static let upstream = "https://tvn.lol"
  private static var running: SiteServer?

  private let root: URL
  private let listener: NWListener
  private let queue = DispatchQueue(label: "lol.tvn.site", attributes: .concurrent)

  /** Starts serving `root`; the address to load, or nil if no port could be used. */
  static func start(root: URL) -> URL? {
    for port in ports {
      guard let server = try? SiteServer(root: root, port: port), server.ready() else { continue }
      running = server
      return URL(string: "http://127.0.0.1:\(port)/")
    }
    return nil
  }

  private init(root: URL, port: UInt16) throws {
    let parameters = NWParameters.tcp
    parameters.requiredInterfaceType = .loopback
    parameters.allowLocalEndpointReuse = true
    listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: port)!)
    self.root = root.standardizedFileURL
  }

  private func ready() -> Bool {
    let settled = DispatchSemaphore(value: 0)
    var ok = false
    listener.stateUpdateHandler = { state in
      switch state {
      case .ready:
        ok = true
        settled.signal()
      case .failed, .cancelled:
        settled.signal()
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
    listener.start(queue: queue)
    _ = settled.wait(timeout: .now() + 3)
    listener.stateUpdateHandler = nil
    if !ok { listener.cancel() }
    return ok
  }

  private func accept(_ connection: NWConnection) {
    connection.start(queue: queue)
    read(connection, Data())
  }

  private func read(_ connection: NWConnection, _ received: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
      guard let self else { return }
      var head = received
      if let data { head.append(data) }
      if let end = head.range(of: Data("\r\n\r\n".utf8)) {
        self.respond(connection, String(decoding: head[..<end.lowerBound], as: UTF8.self))
      } else if error != nil || complete || head.count > 65536 {
        connection.cancel()
      } else {
        self.read(connection, head)
      }
    }
  }

  private func respond(_ connection: NWConnection, _ head: String) {
    let parts = (head.split(separator: "\r\n").first ?? "").split(separator: " ")
    guard parts.count >= 2 else { return send(connection, 400, "text/plain", Data("Bad request".utf8)) }
    let method = String(parts[0])
    let target = String(parts[1])
    guard method == "GET" || method == "HEAD" else { return send(connection, 405, "text/plain", Data("Not allowed".utf8)) }
    let path = String(target.split(separator: "?", maxSplits: 1).first ?? "/")
    if path.hasPrefix("/api/") { return proxy(connection, target, head: method == "HEAD") }
    let (body, type) = file(path)
    send(connection, 200, type, body, head: method == "HEAD")
  }

  /** The file the path names inside the site, or the site's index for any other address, as on tvn.lol. */
  private func file(_ path: String) -> (Data, String) {
    let decoded = path.removingPercentEncoding ?? path
    let relative = decoded == "/" ? "index.html" : String(decoded.drop(while: { $0 == "/" }))
    let wanted = root.appendingPathComponent(relative).standardizedFileURL
    var isFolder: ObjCBool = false
    if wanted.path.hasPrefix(root.path + "/"),
      FileManager.default.fileExists(atPath: wanted.path, isDirectory: &isFolder), !isFolder.boolValue,
      let data = try? Data(contentsOf: wanted)
    {
      return (data, SiteServer.type(of: wanted.pathExtension))
    }
    let index = root.appendingPathComponent("index.html")
    return ((try? Data(contentsOf: index)) ?? Data(), "text/html; charset=utf-8")
  }

  private func proxy(_ connection: NWConnection, _ target: String, head: Bool) {
    guard let url = URL(string: SiteServer.upstream + target) else {
      return send(connection, 400, "text/plain", Data("Bad request".utf8))
    }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
      guard let self else { return }
      guard let response = response as? HTTPURLResponse, let data else {
        let failure = Data(#"{"error":"TVN could not be reached. Check the internet connection."}"#.utf8)
        return self.send(connection, 502, "application/json", failure, head: head)
      }
      let type = response.value(forHTTPHeaderField: "Content-Type") ?? "application/json"
      self.send(connection, response.statusCode, type, data, head: head)
    }.resume()
  }

  private func send(_ connection: NWConnection, _ status: Int, _ type: String, _ body: Data, head: Bool = false) {
    let reason = HTTPURLResponse.localizedString(forStatusCode: status).capitalized
    var response = Data()
    response.append(Data("HTTP/1.1 \(status) \(reason)\r\n".utf8))
    response.append(Data("Content-Type: \(type)\r\nContent-Length: \(body.count)\r\n".utf8))
    response.append(Data("Cache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n".utf8))
    if !head { response.append(body) }
    connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
  }

  private static func type(of ext: String) -> String {
    switch ext.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "map": return "application/json; charset=utf-8"
    case "webmanifest": return "application/manifest+json"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "gif": return "image/gif"
    case "ico": return "image/x-icon"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    case "ttf": return "font/ttf"
    case "txt": return "text/plain; charset=utf-8"
    case "mp3": return "audio/mpeg"
    case "mp4": return "video/mp4"
    default: return "application/octet-stream"
    }
  }
}
