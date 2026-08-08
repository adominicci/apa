import AppKit
import Foundation
import WebKit

let loopbackHosts: Set<String> = ["127.0.0.1", "localhost", "::1"]
guard CommandLine.arguments.count == 2,
      let url = URL(string: CommandLine.arguments[1]),
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      components.scheme?.lowercased() == "http",
      let host = components.host?.lowercased(),
      loopbackHosts.contains(host) else {
  FileHandle.standardError.write(Data("usage: WKWebViewProofRunner.swift <url>\n".utf8))
  exit(64)
}
let hostDeadline: TimeInterval = url.lastPathComponent == "nativeManualProof.html" ? 300 : 45

final class ProofCoordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  private func diagnostic(_ message: String) {
    FileHandle.standardError.write(Data("[native-proof] \(message)\n".utf8))
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    diagnostic("navigation-start url=\(webView.url?.absoluteString ?? "nil")")
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    diagnostic("navigation-commit url=\(webView.url?.absoluteString ?? "nil")")
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    diagnostic("navigation-finish url=\(webView.url?.absoluteString ?? "nil")")
    webView.evaluateJavaScript(
      "JSON.stringify({readyState: document.readyState, status: document.querySelector('#proof-result')?.textContent ?? null, resources: performance.getEntriesByType('resource').map((entry) => ({name: entry.name, duration: entry.duration, transferSize: entry.transferSize}))})"
    ) { value, error in
      if let error = error {
        self.diagnostic("did-finish probe-error=\(error)")
      } else {
        self.diagnostic("did-finish probe=\(value as? String ?? "nil")")
      }
    }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    diagnostic("navigation-fail url=\(webView.url?.absoluteString ?? "nil") error=\(error)")
    fail("navigation failed: \(error)")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    diagnostic("navigation-provisional-fail url=\(webView.url?.absoluteString ?? "nil") error=\(error)")
    fail("provisional navigation failed: \(error)")
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    fail("web content process terminated at \(webView.url?.absoluteString ?? "nil")")
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == "tesinaDiagnostic" {
      if let body = message.body as? String {
        diagnostic("javascript \(body)")
      } else if JSONSerialization.isValidJSONObject(message.body),
                let data = try? JSONSerialization.data(withJSONObject: message.body, options: [.sortedKeys]),
                let output = String(data: data, encoding: .utf8) {
        diagnostic("javascript \(output)")
      } else {
        diagnostic("javascript non-json=\(message.body)")
      }
      return
    }
    guard JSONSerialization.isValidJSONObject(message.body),
          let data = try? JSONSerialization.data(withJSONObject: message.body, options: [.sortedKeys]),
          let output = String(data: data, encoding: .utf8) else {
      fail("proof returned a non-JSON result")
      return
    }
    print(output)
    fflush(stdout)
    let dictionary = message.body as? [String: Any]
    exit(dictionary?["passed"] as? Bool == true ? 0 : 1)
  }

  private func fail(_ message: String) {
    FileHandle.standardError.write(Data("{\"passed\":false,\"error\":\"\(message)\"}\n".utf8))
    exit(1)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.finishLaunching()

let coordinator = ProofCoordinator()
let configuration = WKWebViewConfiguration()
configuration.userContentController.add(coordinator, name: "tesinaProof")
configuration.userContentController.add(coordinator, name: "tesinaDiagnostic")
let diagnostics = WKUserScript(
  source: """
    const tesinaDiagnostic = (stage, detail = {}) => {
      window.webkit.messageHandlers.tesinaDiagnostic.postMessage({ stage, ...detail });
    };
    tesinaDiagnostic('document-start', { href: location.href, readyState: document.readyState });
    const resourceObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          const resources = node.matches('script[src],link[href]')
            ? [node]
            : [...node.querySelectorAll('script[src],link[href]')];
          for (const resource of resources) {
            const url = resource.src || resource.href;
            tesinaDiagnostic('resource-discovered', { tag: resource.tagName, url });
            resource.addEventListener('load', () => tesinaDiagnostic('resource-load', { tag: resource.tagName, url }));
            resource.addEventListener('error', () => tesinaDiagnostic('resource-error', { tag: resource.tagName, url }));
          }
        }
      }
    });
    resourceObserver.observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => {
      tesinaDiagnostic('dom-content-loaded', { readyState: document.readyState });
    });
    window.addEventListener('load', () => {
      tesinaDiagnostic('window-load', {
        readyState: document.readyState,
        resources: performance.getEntriesByType('resource').map((entry) => entry.name)
      });
    });
    window.addEventListener('error', (event) => {
      tesinaDiagnostic('window-error', {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno
      });
      window.webkit.messageHandlers.tesinaProof.postMessage({
        passed: false,
        engine: navigator.userAgent,
        checks: {},
        metrics: {},
        error: `window error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason && (event.reason.stack || event.reason.message || String(event.reason));
      tesinaDiagnostic('unhandled-rejection', { reason });
      window.webkit.messageHandlers.tesinaProof.postMessage({
        passed: false,
        engine: navigator.userAgent,
        checks: {},
        metrics: {},
        error: `unhandled rejection: ${reason}`
      });
    });
  """,
  injectionTime: .atDocumentStart,
  forMainFrameOnly: true
)
configuration.userContentController.addUserScript(diagnostics)
let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 900), configuration: configuration)
webView.navigationDelegate = coordinator

let window = NSWindow(
  contentRect: NSRect(x: 0, y: 0, width: 1200, height: 900),
  styleMask: [.titled, .closable, .resizable],
  backing: .buffered,
  defer: false
)
window.title = "Tesina Native Pagination Proof"
window.contentView = webView
window.orderFrontRegardless()
app.activate(ignoringOtherApps: true)
webView.load(URLRequest(url: url))

DispatchQueue.main.asyncAfter(deadline: .now() + hostDeadline) {
  FileHandle.standardError.write(Data("{\"passed\":false,\"error\":\"WKWebView proof timed out\"}\n".utf8))
  exit(124)
}

app.run()
