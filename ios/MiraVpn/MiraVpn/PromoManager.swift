import Foundation

actor PromoManager {
    static let shared = PromoManager()

    private let baseURL = "http://178.104.251.30/v1"
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        self.session = URLSession(configuration: config)
    }

    struct RedeemResult {
        let success: Bool
        let reason: String?
        let days: Int
    }

    func redeem(code: String) async -> RedeemResult {
        let url = URL(string: "\(baseURL)/promo/redeem")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let email = UserDefaults.standard.string(forKey: "email") ?? ""
        let body: [String: Any] = ["code": code, "email": email]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                return RedeemResult(success: false, reason: "Server error", days: 0)
            }

            let result = try JSONDecoder().decode(PromoRedeemResponse.self, from: data)
            if result.success {
                UserDefaults.standard.set(true, forKey: "is_paid")
                UserDefaults.standard.set(result.accessUntil, forKey: "sub_expires")
                return RedeemResult(success: true, reason: nil, days: 30)
            } else {
                return RedeemResult(success: false, reason: result.reason, days: 0)
            }
        } catch {
            return RedeemResult(success: false, reason: error.localizedDescription, days: 0)
        }
    }
}
