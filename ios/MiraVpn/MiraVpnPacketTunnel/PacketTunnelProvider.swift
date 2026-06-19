import NetworkExtension
import WireGuardKit
import os.log

class PacketTunnelProvider: NEPacketTunnelProvider {

    private lazy var adapter: WireGuardAdapter = {
        return WireGuardAdapter(with: self) { logLevel, message in
            os_log("%{public}@",
                   log: OSLog(subsystem: "com.vualet.mira", category: "tunnel"),
                   type: logLevel.osLogType,
                   message)
        }
    }()

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        guard let providerConfig = self.protocolConfiguration as? NETunnelProviderProtocol,
              let configString = providerConfig.providerConfiguration?["config"] as? String else {
            completionHandler(PacketTunnelProviderError.invalidConfig)
            return
        }

        // Parse wg-quick config string into TunnelConfiguration
        guard let tunnelConfig = try? TunnelConfiguration(fromWgQuickConfig: configString) else {
            completionHandler(PacketTunnelProviderError.invalidConfig)
            return
        }

        // Derive tunnel address from config (first Interface Address)
        let tunnelAddress = tunnelConfig.interface.addresses.first?.address ?? "10.66.66.2"

        // Configure network settings
        let networkSettings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: tunnelAddress)
        networkSettings.ipv4Settings = NEIPv4Settings(
            addresses: [tunnelAddress],
            subnetMasks: ["255.255.255.0"]
        )
        networkSettings.ipv4Settings?.includedRoutes = [NEIPv4Route.default()]
        networkSettings.dnsSettings = NEDNSSettings(
            servers: tunnelConfig.interface.dns.map { $0.stringRepresentation }
        )
        networkSettings.mtu = NSNumber(value: tunnelConfig.interface.mtu ?? 1420)

        // Start the WireGuard adapter
        adapter.start(tunnelConfiguration: tunnelConfig) { adapterError in
            guard let adapterError = adapterError else {
                // Adapter started — now apply network settings
                self.setTunnelNetworkSettings(networkSettings) { error in
                    completionHandler(error)
                }
                return
            }

            switch adapterError {
            case .cannotLocateTunnelFileDescriptor:
                completionHandler(PacketTunnelProviderError.couldNotDetermineFileDescriptor)
            case .dnsResolution:
                completionHandler(PacketTunnelProviderError.dnsResolutionFailure)
            case .setNetworkSettings:
                completionHandler(PacketTunnelProviderError.couldNotSetNetworkSettings)
            case .startWireGuardBackend:
                completionHandler(PacketTunnelProviderError.couldNotStartBackend)
            case .invalidState:
                completionHandler(PacketTunnelProviderError.invalidState)
            }
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        adapter.stop { _ in
            completionHandler()
        }
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        if let message = String(data: messageData, encoding: .utf8) {
            switch message {
            case "getStats":
                let stats: [String: Any] = ["connected": true]
                if let data = try? JSONSerialization.data(withJSONObject: stats) {
                    completionHandler?(data)
                    return
                }
            default:
                break
            }
        }
        completionHandler?(nil)
    }

    enum PacketTunnelProviderError: Error {
        case invalidConfig
        case couldNotDetermineFileDescriptor
        case dnsResolutionFailure
        case couldNotSetNetworkSettings
        case couldNotStartBackend
        case invalidState
    }
}

// MARK: - WireGuardLogLevel → OSLogType
extension WireGuardLogLevel {
    var osLogType: OSLogType {
        switch self {
        case .verbose: return .debug
        case .error:   return .error
        }
    }
}
