import Foundation
import SwiftUI
import NetworkExtension

@MainActor
class ViewModel: ObservableObject {
    @Published var connectionState: ConnectionState = .disconnected
    @Published var statusText: String = "Disconnected"
    @Published var serverInfo: String? = nil
    @Published var rtt: Int = 0
    @Published var isPaid: Bool = false
    @Published var showPromoSheet: Bool = false
    @Published var showPurchaseSheet: Bool = false
    @Published var errorMessage: String? = nil

    private var tunnelManager = TunnelManager.shared

    enum ConnectionState {
        case disconnected
        case connecting
        case connected
        case disconnecting
        case error
    }

    init() {
        checkSubscriptionStatus()
        Task {
            await tunnelManager.loadTunnel()
            let status = tunnelManager.tunnelStatus
            if status == .connected || status == .connecting {
                connectionState = .connected
                statusText = "Connected"
                if let serverIp = UserDefaults.standard.string(forKey: "server_ip") {
                    serverInfo = "Server: \(serverIp)"
                }
            }
        }
    }

    func toggleConnection() {
        switch connectionState {
        case .disconnected, .error:
            connect()
        case .connected:
            disconnect()
        default:
            break
        }
    }

    func connect() {
        connectionState = .connecting
        statusText = "Probing servers…"
        errorMessage = nil

        Task {
            // 1. SmartRouter: find fastest server
            let server = await SmartRouter.shared.findFastestServer()
            guard let server = server else {
                connectionState = .error
                statusText = "No servers reachable"
                errorMessage = "Could not reach Mira servers. Check your internet connection."
                return
            }

            statusText = "Connecting to \(server.name)…"
            serverInfo = "Server: \(server.ip)"
            rtt = Int(server.rtt)

            // 2. Get or generate keypair
            var privateKey = KeychainHelper.shared.load(key: "wg_private_key") ?? ""
            var publicKey = KeychainHelper.shared.load(key: "wg_public_key") ?? ""

            if privateKey.isEmpty {
                let keypair = WireGuardKeyGenerator.generateKeypair()
                privateKey = keypair.privateKey
                publicKey = keypair.publicKey
                KeychainHelper.shared.save(key: "wg_private_key", value: privateKey)
                KeychainHelper.shared.save(key: "wg_public_key", value: publicKey)
            }

            // 3. Issue tunnel from API
            do {
                let tier = isPaid ? "paid" : "free"
                let response = try await MiraClient.shared.issueTunnel(
                    publicKey: publicKey,
                    tier: tier
                )

                // Save server info
                UserDefaults.standard.set(response.serverIp ?? response.serverEndpoint.split(separator: ":").first.map(String.init), forKey: "server_ip")

                // 4. Build the WireGuard config (replace private key placeholder)
                let config = response.config.replacingOccurrences(of: "FILL_ME", with: privateKey)

                // 5. Start the tunnel via TunnelManager
                statusText = "Starting tunnel…"
                try await tunnelManager.startTunnel(config: config)

                connectionState = .connected
                statusText = "Connected"
                rtt = Int(server.rtt)

                UserDefaults.standard.set(response.serverIp, forKey: "connected_server_ip")

            } catch let error as MiraClientError {
                connectionState = .error
                statusText = "Connection failed"
                errorMessage = error.errorDescription
            } catch {
                connectionState = .error
                statusText = "Connection failed"
                errorMessage = error.localizedDescription
            }
        }
    }

    func disconnect() {
        connectionState = .disconnecting
        statusText = "Disconnecting…"

        Task {
            await tunnelManager.stopTunnel()

            let publicKey = KeychainHelper.shared.load(key: "wg_public_key") ?? ""
            if !publicKey.isEmpty {
                try? await MiraClient.shared.removePeer(publicKey: publicKey)
            }

            connectionState = .disconnected
            statusText = "Disconnected"
            rtt = 0
            serverInfo = nil
        }
    }

    func checkSubscriptionStatus() {
        Task {
            let hasActive = await StoreManager.shared.checkEntitlement()
            isPaid = hasActive

            let email = UserDefaults.standard.string(forKey: "email") ?? ""
            if !email.isEmpty {
                let apiStatus = try? await MiraClient.shared.checkSubscription(email: email)
                if let apiStatus = apiStatus, apiStatus.hasActive {
                    isPaid = true
                }
            }
        }
    }
}
