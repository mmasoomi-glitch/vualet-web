import Foundation
import Network

actor SmartRouter {
    static let shared = SmartRouter()

    private let serverPool: [ServerCandidate] = [
        ServerCandidate(ip: "178.104.251.30", name: "Nuremberg"),
        // ServerCandidate(ip: "178.104.251.31", name: "Falkenstein"),  // uncomment when provisioned
    ]

    struct ServerCandidate {
        let ip: String
        let name: String
    }

    struct ServerResult {
        let ip: String
        let name: String
        let rtt: Double  // milliseconds
        let reachable: Bool
    }

    /// Probe all servers in parallel, return the fastest
    func findFastestServer() async -> ServerResult? {
        await withTaskGroup(of: ServerResult?.self) { group in
            for candidate in serverPool {
                group.addTask {
                    await self.probeServer(candidate)
                }
            }
            var results: [ServerResult] = []
            for await result in group {
                if let r = result, r.reachable {
                    results.append(r)
                }
            }
            return results.min(by: { $0.rtt < $1.rtt })
        }
    }

    private func probeServer(_ candidate: ServerCandidate) async -> ServerResult? {
        // TCP connect to port 443 (nginx, always open)
        let rtt = await tcpConnect(ip: candidate.ip, port: 443, timeoutMs: 2000)
        if rtt > 0 {
            return ServerResult(ip: candidate.ip, name: candidate.name, rtt: rtt, reachable: true)
        }

        // Fallback: port 80
        let rtt80 = await tcpConnect(ip: candidate.ip, port: 80, timeoutMs: 2000)
        if rtt80 > 0 {
            return ServerResult(ip: candidate.ip, name: candidate.name, rtt: rtt80 + 20, reachable: true)
        }

        // Fallback: port 8443 (wstunnel)
        let rtt8443 = await tcpConnect(ip: candidate.ip, port: 8443, timeoutMs: 2000)
        if rtt8443 > 0 {
            return ServerResult(ip: candidate.ip, name: candidate.name, rtt: rtt8443 + 40, reachable: true)
        }

        return ServerResult(ip: candidate.ip, name: candidate.name, rtt: 0, reachable: false)
    }

    private func tcpConnect(ip: String, port: Int, timeoutMs: Int) async -> Double {
        await withCheckedContinuation { continuation in
            let start = Date()
            let host = NWEndpoint.Host(ip)
            let port = NWEndpoint.Port(integerLiteral: UInt16(port))
            let connection = NWConnection(host: host, port: port, using: .tcp)
            var resumed = false

            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if !resumed {
                        resumed = true
                        let elapsed = Date().timeIntervalSince(start) * 1000
                        connection.cancel()
                        continuation.resume(returning: elapsed)
                    }
                case .failed:
                    if !resumed {
                        resumed = true
                        connection.cancel()
                        continuation.resume(returning: -1.0)
                    }
                case .cancelled:
                    if !resumed {
                        resumed = true
                        continuation.resume(returning: -1.0)
                    }
                default:
                    break
                }
            }

            DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
                if !resumed {
                    resumed = true
                    connection.cancel()
                    continuation.resume(returning: -1.0)
                }
            }

            connection.start(queue: .global())
        }
    }
}
