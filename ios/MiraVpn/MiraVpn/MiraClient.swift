import Foundation

enum MiraClientError: LocalizedError {
    case networkError(String)
    case serverError(String)
    case invalidResponse
    case noServers

    var errorDescription: String? {
        switch self {
        case .networkError(let msg):  return "Could not reach Mira servers. \(msg)"
        case .serverError(let msg):   return "Server error: \(msg)"
        case .invalidResponse:        return "Invalid server response"
        case .noServers:              return "No servers available"
        }
    }
}

struct TunnelResponse: Codable {
    let ip: String
    let serverEndpoint: String
    let serverPublicKey: String
    let config: String
    let node: String?
    let serverIp: String?
    let transport: TransportInfo?
    let obfuscation: ObfuscationParams?

    enum CodingKeys: String, CodingKey {
        case ip
        case serverEndpoint  = "server_endpoint"
        case serverPublicKey = "server_public_key"
        case config
        case node
        case serverIp        = "server_ip"
        case transport
        case obfuscation
    }
}

struct TransportInfo: Codable {
    let modes: [ModeInfo]?
    let primaryPort: Int?
    let fallbackPorts: [Int]?
    let tcpPort: Int?

    enum CodingKeys: String, CodingKey {
        case modes
        case primaryPort   = "primary_port"
        case fallbackPorts = "fallback_ports"
        case tcpPort       = "tcp_port"
    }
}

struct ModeInfo: Codable {
    let mode: String
    let ports: [Int]?
    let protocolType: String?

    enum CodingKeys: String, CodingKey {
        case mode
        case ports
        case protocolType = "protocol"
    }
}

struct ObfuscationParams: Codable {
    let jc: Int?; let jmin: Int?; let jmax: Int?
    let s1: Int?; let s2: Int?; let s3: Int?; let s4: Int?
    let h1: Int?; let h2: Int?; let h3: Int?; let h4: Int?

    enum CodingKeys: String, CodingKey {
        case jc = "Jc"; case jmin = "Jmin"; case jmax = "Jmax"
        case s1 = "S1"; case s2 = "S2"; case s3 = "S3"; case s4 = "S4"
        case h1 = "H1"; case h2 = "H2"; case h3 = "H3"; case h4 = "H4"
    }
}

struct SubscriptionStatus: Codable {
    let hasActive: Bool
    let tier: String?
    let expiresAt: String?
    let source: String?

    enum CodingKeys: String, CodingKey {
        case hasActive  = "has_active"
        case tier
        case expiresAt  = "expires_at"
        case source
    }
}

struct PromoRedeemResponse: Codable {
    let success: Bool
    let reason: String?
    let accessUntil: String?

    enum CodingKeys: String, CodingKey {
        case success
        case reason
        case accessUntil = "access_until"
    }
}

actor MiraClient {
    static let shared = MiraClient()

    private let baseURL = "http://178.104.251.30/v1"
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        self.session = URLSession(configuration: config)
    }

    func issueTunnel(publicKey: String, tier: String) async throws -> TunnelResponse {
        let url = URL(string: "\(baseURL)/tunnel/issue-direct")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["public_key": publicKey, "tier": tier]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                throw MiraClientError.serverError("HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)")
            }
            return try JSONDecoder().decode(TunnelResponse.self, from: data)
        } catch let error as MiraClientError {
            throw error
        } catch {
            throw MiraClientError.networkError(error.localizedDescription)
        }
    }

    func removePeer(publicKey: String) async throws {
        let url = URL(string: "\(baseURL)/tunnel/remove")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["public_key": publicKey]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await session.data(for: request)
    }

    func checkSubscription(email: String) async throws -> SubscriptionStatus {
        let escaped = email.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let url = URL(string: "\(baseURL)/subscription/check?email=\(escaped)")!
        let (data, _) = try await session.data(from: url)
        return try JSONDecoder().decode(SubscriptionStatus.self, from: data)
    }
}
