import Foundation
import NetworkExtension

class TunnelManager: ObservableObject {
    static let shared = TunnelManager()

    private var tunnelManager: NETunnelProviderManager?
    @Published var tunnelStatus: NEVPNStatus = .invalid

    private init() {}

    func loadTunnel() async {
        await withCheckedContinuation { continuation in
            NETunnelProviderManager.loadAllFromPreferences { managers, error in
                guard error == nil else {
                    continuation.resume()
                    return
                }
                self.tunnelManager = managers?.first
                if let manager = self.tunnelManager {
                    self.tunnelStatus = manager.connection.status
                }
                continuation.resume()
            }
        }
    }

    func startTunnel(config: String) async throws {
        let manager = try await getOrCreateTunnelManager()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = "com.vualet.mira.PacketTunnel"
        proto.serverAddress = "Mira VPN"
        proto.providerConfiguration = ["config": config]
        proto.disconnectOnSleep = false

        manager.protocolConfiguration = proto
        manager.localizedDescription = "Mira VPN"
        manager.isEnabled = true

        try await manager.saveToPreferences()
        try await manager.loadFromPreferences()
        try manager.connection.startVPNTunnel()
    }

    func stopTunnel() async {
        guard let manager = tunnelManager else { return }
        manager.connection.stopVPNTunnel()
    }

    func startListening() async {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(tunnelStatusChanged),
            name: .NEVPNStatusDidChange,
            object: nil
        )
    }

    @objc private func tunnelStatusChanged() {
        guard let manager = tunnelManager else { return }
        tunnelStatus = manager.connection.status
    }

    private func getOrCreateTunnelManager() async throws -> NETunnelProviderManager {
        if let manager = tunnelManager {
            return manager
        }
        let manager = NETunnelProviderManager()
        tunnelManager = manager
        return manager
    }
}
