# Mira VPN — iOS verbatim implementation spec

Hand this file to whoever ships iOS (human or LLM). Same shape as the
original Uncle Z Calc spec: file-by-file paths + exact contents +
explicit deviations. The goal is **zero creative decisions during the
build** — every choice is in this document.

If something below doesn't match Apple's current SDK (Xcode 26+, iOS 18+
SDK), **diverge as little as possible and document the change at the top
of `docs/MIRA-VPN-IOS-DEVIATIONS.md`**.

---

## 0. The three locked decisions

1. **Protocol: WireGuard, not Reality.** Reality has no iOS library; porting
   Xray to iOS is weeks. WireGuard has `wireguard-apple` (Apple-supported,
   App Store-friendly). The MEA / Iran market is sideload-Android anyway —
   iOS App Store is blocked in Iran. iOS Mira VPN serves global users; the
   anti-censorship product surface lives on Android.

2. **Distribution: App Store only.** No sideload, no `.ipa` distribution.
   The friction of Apple's review process is the *feature*: it forces us
   to keep marketing honest and the binary clean.

3. **Billing: StoreKit 2 only.** No crypto path inside the iOS binary.
   Apple takes 30% (15% after year 1 for subscriptions). This is non-
   negotiable on the App Store. The crypto path stays on Android sideload
   and on the web checkout — never inside the iOS app.

---

## 1. Tooling required

| Tool | Version | Why |
|---|---|---|
| Xcode | **26.0+** (or current latest GM) | iOS 18 SDK, latest StoreKit 2, current PrivacyInfo schema |
| macOS | 14.5+ (Sonoma) | Required by Xcode 26 |
| Swift | **5.10+** (bundled with Xcode) | Modern concurrency, observation framework |
| Apple Developer Program | **active enrollment ($99/yr)** | NetworkExtension entitlement + App Store distribution |
| `wireguard-apple` | **latest from `wireguard/wireguard-apple` GitHub** | Swift Package, sourced via SPM |
| `swift-collections` | latest | Dependency of WireGuard |

Apple Developer capabilities you must request (Apple Account → Identifiers
→ your bundle id → Configure):

- **Personal VPN**
- **Network Extensions** → tick "Packet Tunnel Provider"
- **App Groups** → create `group.com.vualet.mira` (must match Info.plist + entitlements)
- **In-App Purchase**

The Network Extensions capability requires an additional request to Apple
("describe your VPN use case"). Approval typically lands in 24-48 hours.
Sample wording: *"Mira is a consumer VPN that routes user traffic through
servers we operate. We use NEPacketTunnelProvider with WireGuard for
encryption."*

---

## 2. Xcode project structure

```
ios/
├── Mira.xcodeproj/
├── Mira/                          ← main SwiftUI app target
│   ├── MiraApp.swift
│   ├── Info.plist
│   ├── Mira.entitlements
│   ├── Assets.xcassets/
│   │   ├── AppIcon.appiconset/
│   │   ├── MiraRose.colorset/      ← #F8A5A0
│   │   ├── MiraLavender.colorset/  ← #C7B8F0
│   │   ├── MiraCream.colorset/     ← #FFF8F0
│   │   ├── MiraInk.colorset/       ← #2A1F2D
│   │   └── MiraWordmark.imageset/  ← copy of public/mira/mira-wordmark-color.svg as PDF
│   ├── PrivacyInfo.xcprivacy
│   ├── Views/
│   │   ├── ConnectView.swift
│   │   ├── ServerListView.swift
│   │   ├── SubscriptionView.swift
│   │   ├── SmartRoutingView.swift
│   │   ├── SettingsView.swift
│   │   ├── PerAppDirectView.swift  ← banking-friendly per-app exclusion
│   │   └── PauseSheet.swift
│   ├── ViewModels/
│   │   ├── TunnelManager.swift     ← talks to NETunnelProviderManager
│   │   ├── SubscriptionStore.swift ← StoreKit 2
│   │   ├── SmartRouter.swift       ← latency probing + server pick
│   │   └── PermitStore.swift       ← server-issued permit caching
│   ├── Services/
│   │   ├── BackendAPI.swift        ← calls to api.mira.vualet.com
│   │   └── AdsManager.swift        ← Google Mobile Ads (free tier only)
│   └── Theme/
│       ├── MiraTheme.swift          ← color tokens, typography
│       ├── MiraFont.swift           ← Fraunces wrapping
│       └── Style+Modifiers.swift    ← btn-mira, btn-mira-soft equivalents
├── PacketTunnel/                   ← NetworkExtension target
│   ├── PacketTunnelProvider.swift
│   ├── PacketTunnel.entitlements
│   └── Info.plist
├── Shared/                          ← code shared between both targets
│   ├── AppGroup.swift               ← reads/writes from app group container
│   ├── TunnelConfig.swift           ← Codable WireGuard config struct
│   └── Logger.swift
└── Package.swift                    ← SPM root for WireGuard pull
```

---

## 3. Bundle identifiers + provisioning

| Target | Bundle ID | Profile |
|---|---|---|
| Main app | `com.vualet.mira` | App Store distribution |
| PacketTunnel | `com.vualet.mira.PacketTunnel` | App Store distribution |
| App Group | `group.com.vualet.mira` | both targets |

In Xcode → Signing & Capabilities:
- Main app: enable **App Groups (`group.com.vualet.mira`)**, **Personal VPN**, **Network Extensions (Packet Tunnel)**, **In-App Purchase**.
- PacketTunnel: enable **App Groups (`group.com.vualet.mira`)** and **Network Extensions (Packet Tunnel)** only — nothing else. Critical: the extension must be as small as possible. Apple memory-kills the extension at ~50 MB.

---

## 4. `Mira.entitlements` (main app)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>group.com.vualet.mira</string>
    </array>
    <key>com.apple.developer.networking.networkextension</key>
    <array>
        <string>packet-tunnel-provider</string>
    </array>
    <key>com.apple.developer.networking.vpn.api</key>
    <array>
        <string>allow-vpn</string>
    </array>
</dict>
</plist>
```

## 5. `PacketTunnel.entitlements`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>group.com.vualet.mira</string>
    </array>
    <key>com.apple.developer.networking.networkextension</key>
    <array>
        <string>packet-tunnel-provider</string>
    </array>
</dict>
</plist>
```

## 6. Main `Info.plist` (app)

The required keys — copy verbatim into Xcode's Info tab or the underlying file:

| Key | Type | Value |
|---|---|---|
| CFBundleDisplayName | String | `Mira` |
| CFBundleIdentifier | String | `$(PRODUCT_BUNDLE_IDENTIFIER)` |
| CFBundleVersion | String | `1` |
| CFBundleShortVersionString | String | `1.0.0` |
| LSApplicationCategoryType | String | `public.app-category.utilities` |
| ITSAppUsesNonExemptEncryption | Boolean | **NO** (we use only off-the-shelf TLS/WireGuard — no custom crypto) |
| UIRequiresFullScreen | Boolean | NO |
| UIBackgroundModes | Array | `["fetch"]` (NOT `vpn` — that's on the extension) |
| NSPrivacyAccessedAPITypes | covered by `PrivacyInfo.xcprivacy` (§14) |

Do **NOT** add `NSAppTransportSecurity` exemptions. Mira only talks to
`api.mira.vualet.com` over HTTPS.

## 7. PacketTunnel `Info.plist`

| Key | Value |
|---|---|
| CFBundleIdentifier | `com.vualet.mira.PacketTunnel` |
| NSExtension → NSExtensionPointIdentifier | `com.apple.networkextension.packet-tunnel` |
| NSExtension → NSExtensionPrincipalClass | `$(PRODUCT_MODULE_NAME).PacketTunnelProvider` |

---

## 8. Swift Package dependencies (`Package.swift` at project root or via Xcode → Package Dependencies)

```swift
// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "Mira",
    platforms: [.iOS(.v17)],
    dependencies: [
        .package(url: "https://github.com/wireguard/wireguard-apple.git",
                 branch: "master")
    ]
)
```

Add `WireGuardKit` as a library to **both** the Main App target and the
PacketTunnel target.

---

## 9. Shared code — `Shared/AppGroup.swift`

```swift
import Foundation

/// Read/write shared state between the main app and the packet-tunnel
/// extension. Both targets must share the same App Group entitlement.
enum AppGroup {
    static let identifier = "group.com.vualet.mira"

    static var defaults: UserDefaults {
        guard let d = UserDefaults(suiteName: identifier) else {
            fatalError("Misconfigured app group — check entitlements on both targets.")
        }
        return d
    }

    static var containerURL: URL {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: identifier)!
    }
}
```

## 10. `Shared/TunnelConfig.swift`

WireGuard server credentials issued by the Mira backend.
```swift
import Foundation

struct TunnelConfig: Codable, Equatable {
    let serverEndpoint: String          // "78.46.123.45:51820"
    let serverPublicKey: String          // base64
    let clientPrivateKey: String         // base64 — server issues per device
    let clientAddress: String            // "10.66.66.42/24"
    let dnsServers: [String]             // ["1.1.1.1", "1.0.0.1"]
    let preSharedKey: String?            // optional WireGuard PSK
    let mtu: Int                         // 1280 on iOS for reliability

    func toWireGuardConfig() -> String {
        var lines = [
            "[Interface]",
            "PrivateKey = \(clientPrivateKey)",
            "Address = \(clientAddress)",
            "DNS = \(dnsServers.joined(separator: ", "))",
            "MTU = \(mtu)",
            "",
            "[Peer]",
            "PublicKey = \(serverPublicKey)",
            "Endpoint = \(serverEndpoint)",
            "AllowedIPs = 0.0.0.0/0, ::/0",
            "PersistentKeepalive = 25"
        ]
        if let psk = preSharedKey, !psk.isEmpty {
            lines.insert("PresharedKey = \(psk)", at: 8)
        }
        return lines.joined(separator: "\n")
    }
}
```

## 11. `Shared/Logger.swift`

```swift
import OSLog

extension Logger {
    static let tunnel = Logger(subsystem: "com.vualet.mira", category: "tunnel")
    static let billing = Logger(subsystem: "com.vualet.mira", category: "billing")
    static let smart = Logger(subsystem: "com.vualet.mira", category: "smart-routing")
}
```

---

## 12. PacketTunnelProvider — `PacketTunnel/PacketTunnelProvider.swift`

The whole point of this target. Keep it tiny — Apple will memory-kill if RSS > ~50 MB.

```swift
import NetworkExtension
import WireGuardKit
import OSLog

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private lazy var adapter: WireGuardAdapter = {
        WireGuardAdapter(with: self) { _, message in
            Logger.tunnel.info("\(message, privacy: .public)")
        }
    }()

    override func startTunnel(
        options: [String : NSObject]? = nil,
        completionHandler: @escaping (Error?) -> Void
    ) {
        guard
            let providerProtocol = protocolConfiguration as? NETunnelProviderProtocol,
            let configBlob = providerProtocol.providerConfiguration?["config"] as? Data,
            let config = try? JSONDecoder().decode(TunnelConfig.self, from: configBlob)
        else {
            completionHandler(PacketTunnelError.missingConfig)
            return
        }

        let wgQuickConfig: TunnelConfiguration
        do {
            wgQuickConfig = try TunnelConfiguration(
                fromWgQuickConfig: config.toWireGuardConfig(),
                called: "Mira"
            )
        } catch {
            completionHandler(error)
            return
        }

        adapter.start(tunnelConfiguration: wgQuickConfig) { error in
            if let error = error {
                Logger.tunnel.error("adapter start failed: \(String(describing: error), privacy: .public)")
            }
            completionHandler(error)
        }
    }

    override func stopTunnel(
        with reason: NEProviderStopReason,
        completionHandler: @escaping () -> Void
    ) {
        adapter.stop { _ in completionHandler() }
    }
}

enum PacketTunnelError: Error {
    case missingConfig
}
```

---

## 13. `Mira/ViewModels/TunnelManager.swift` (main app side)

Drives the tunnel from the main app via NETunnelProviderManager.

```swift
import Foundation
import NetworkExtension
import OSLog

@MainActor
@Observable
final class TunnelManager {
    enum State: Equatable {
        case disconnected
        case connecting
        case connected
        case disconnecting
        case failed(String)
    }

    private(set) var state: State = .disconnected
    private var manager: NETunnelProviderManager?

    func load() async {
        let managers = (try? await NETunnelProviderManager.loadAllFromPreferences()) ?? []
        manager = managers.first ?? NETunnelProviderManager()
        observeStateChanges()
        await refreshState()
    }

    func connect(using config: TunnelConfig) async {
        guard let manager else { return }
        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = "com.vualet.mira.PacketTunnel"
        proto.serverAddress = config.serverEndpoint
        proto.providerConfiguration = [
            "config": try? JSONEncoder().encode(config)
        ]
        manager.protocolConfiguration = proto
        manager.localizedDescription = "Mira"
        manager.isEnabled = true
        do {
            try await manager.saveToPreferences()
            try await manager.loadFromPreferences()
            try manager.connection.startVPNTunnel()
            state = .connecting
        } catch {
            state = .failed(error.localizedDescription)
            Logger.tunnel.error("connect failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func disconnect() {
        manager?.connection.stopVPNTunnel()
    }

    private func observeStateChanges() {
        guard let manager else { return }
        NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: manager.connection,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in await self?.refreshState() }
        }
    }

    private func refreshState() async {
        guard let status = manager?.connection.status else { return }
        switch status {
        case .invalid, .disconnected:  state = .disconnected
        case .connecting:              state = .connecting
        case .connected:               state = .connected
        case .disconnecting:           state = .disconnecting
        case .reasserting:             state = .connecting
        @unknown default:              state = .disconnected
        }
    }
}
```

---

## 14. Privacy manifest — `Mira/PrivacyInfo.xcprivacy`

Apple requires this for any app that uses certain APIs (UserDefaults among them since iOS 17). Without it, App Store Connect rejects the upload silently in the build pipeline.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSPrivacyTracking</key>
    <false/>
    <key>NSPrivacyCollectedDataTypes</key>
    <array>
        <dict>
            <key>NSPrivacyCollectedDataType</key>
            <string>NSPrivacyCollectedDataTypePurchaseHistory</string>
            <key>NSPrivacyCollectedDataTypeLinked</key>
            <true/>
            <key>NSPrivacyCollectedDataTypeTracking</key>
            <false/>
            <key>NSPrivacyCollectedDataTypePurposes</key>
            <array>
                <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
            </array>
        </dict>
    </array>
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>CA92.1</string>
            </array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>C617.1</string>
            </array>
        </dict>
    </array>
}
</dict>
</plist>
```

---

## 15. Theme — `Mira/Theme/MiraTheme.swift`

Mirror the web `mira.css` tokens. **Do not** introduce new colors; everything below comes verbatim from the brand kit at `public/mira/` and `src/app/mira/mira-theme.css`.

```swift
import SwiftUI

extension Color {
    static let miraRose       = Color(red: 0xF8/255, green: 0xA5/255, blue: 0xA0/255)
    static let miraRoseDeep   = Color(red: 0xE6/255, green: 0x8A/255, blue: 0x85/255)
    static let miraPetal      = Color(red: 0xFF/255, green: 0xDC/255, blue: 0xE0/255)
    static let miraLavender   = Color(red: 0xC7/255, green: 0xB8/255, blue: 0xF0/255)
    static let miraLavDeep    = Color(red: 0xA5/255, green: 0x95/255, blue: 0xE8/255)
    static let miraAether     = Color(red: 0x63/255, green: 0x66/255, blue: 0xF1/255)
    static let miraCream      = Color(red: 0xFF/255, green: 0xF8/255, blue: 0xF0/255)
    static let miraCanvas     = Color(red: 0xFE/255, green: 0xFA/255, blue: 0xF6/255)
    static let miraOnyx       = Color(red: 0x1A/255, green: 0x15/255, blue: 0x25/255)
    static let miraInk        = Color(red: 0x2A/255, green: 0x1F/255, blue: 0x2D/255)
    static let miraGraphite   = Color(red: 0x52/255, green: 0x4A/255, blue: 0x55/255)
    static let miraSlate      = Color(red: 0x8C/255, green: 0x81/255, blue: 0x90/255)
    static let miraFog        = Color(red: 0xE8/255, green: 0xE0/255, blue: 0xEA/255)
    static let miraFrost      = Color(red: 0xF2/255, green: 0xEA/255, blue: 0xF0/255)
}

enum MiraGradient {
    static let presence = LinearGradient(
        colors: [.miraRose, .miraLavender, .miraAether],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

enum MiraRadius {
    static let sm: CGFloat = 10
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
}
```

## 16. Typography — `Mira/Theme/MiraFont.swift`

Fraunces for display, system Inter substitute for UI (iOS doesn't ship Inter — system SF is closer in spirit to Inter than to Fraunces; use SF). Or embed Fraunces and Inter as bundled TTFs:

1. Drop `Fraunces-Light.ttf` (300), `Fraunces-Regular.ttf` (400), `Fraunces-Medium.ttf` (500), `Inter-Regular.ttf`, `Inter-Medium.ttf`, `Inter-SemiBold.ttf` into `Mira/Fonts/`.
2. Add each font file to the app target's Build Phases → Copy Bundle Resources.
3. Add the file names to Info.plist key `UIAppFonts`.

```swift
import SwiftUI

enum MiraFont {
    static func display(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom("Fraunces", size: size).weight(weight)
    }
    static func ui(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom("Inter", size: size).weight(weight)
    }
}
```

---

## 17. Main `MiraApp.swift`

```swift
import SwiftUI

@main
struct MiraApp: App {
    @State private var tunnel = TunnelManager()
    @State private var subs = SubscriptionStore()

    var body: some Scene {
        WindowGroup {
            ConnectView()
                .environment(tunnel)
                .environment(subs)
                .task {
                    await tunnel.load()
                    await subs.bootstrap()
                }
        }
    }
}
```

## 18. ConnectView — the home screen

(See `MiraTheme.swift` colors and `MiraFont` typography in §15/§16.)

```swift
import SwiftUI

struct ConnectView: View {
    @Environment(TunnelManager.self) private var tunnel
    @Environment(SubscriptionStore.self) private var subs
    @State private var showingSubscription = false
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miraCream.ignoresSafeArea()
                VStack(spacing: 32) {
                    Image("MiraWordmark").resizable().scaledToFit().frame(height: 36)
                    Spacer()
                    AuraRing(state: tunnel.state)
                    statusLabel
                    bigConnectButton
                    Spacer()
                    if !subs.isSubscribed {
                        upsellPill
                    }
                }
                .padding(24)
            }
            .toolbar { settingsButton }
        }
        .sheet(isPresented: $showingSettings) { SettingsView() }
        .sheet(isPresented: $showingSubscription) { SubscriptionView() }
    }

    private var statusLabel: some View {
        Text(statusText)
            .font(MiraFont.display(28, weight: .light))
            .foregroundStyle(Color.miraInk)
    }

    private var statusText: String {
        switch tunnel.state {
        case .disconnected:  "Ready when you are"
        case .connecting:    "Connecting…"
        case .connected:     "Protected"
        case .disconnecting: "Disconnecting…"
        case .failed(let m): "Couldn't connect — \(m)"
        }
    }

    private var bigConnectButton: some View {
        Button {
            Task {
                if case .connected = tunnel.state {
                    tunnel.disconnect()
                } else if let cfg = await BackendAPI.shared.fetchTunnelConfig(
                    tier: subs.isSubscribed ? .paid : .free
                ) {
                    await tunnel.connect(using: cfg)
                }
            }
        } label: {
            Text(buttonLabel)
                .font(MiraFont.ui(17, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(
                    RoundedRectangle(cornerRadius: 999)
                        .fill(MiraGradient.presence)
                )
        }
        .padding(.horizontal, 8)
    }

    private var buttonLabel: String {
        switch tunnel.state {
        case .connected: "Disconnect"
        default: "Connect"
        }
    }

    private var upsellPill: some View {
        Button { showingSubscription = true } label: {
            Text("Upgrade to Mira — $9.99/mo →")
                .font(MiraFont.ui(13, weight: .medium))
                .foregroundStyle(.miraInk)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(.miraFrost))
        }
    }

    private var settingsButton: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { showingSettings = true } label: {
                Image(systemName: "gearshape").foregroundStyle(.miraGraphite)
            }
        }
    }
}

struct AuraRing: View {
    let state: TunnelManager.State
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(MiraGradient.presence)
            .frame(width: 160, height: 160)
            .blur(radius: 24)
            .opacity(state == .connected ? 0.9 : 0.45)
            .scaleEffect(pulse ? 1.08 : 1.0)
            .animation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true), value: pulse)
            .onAppear { pulse = true }
    }
}
```

---

## 19. StoreKit 2 subscription — `Mira/ViewModels/SubscriptionStore.swift`

Configure in App Store Connect:
- Subscription Group: `MiraVPN`
- Product: `mira_monthly_999`, $9.99/month, 7-day free trial

```swift
import Foundation
import StoreKit
import OSLog

@MainActor
@Observable
final class SubscriptionStore {
    private(set) var products: [Product] = []
    private(set) var isSubscribed = false
    private var updates: Task<Void, Never>?

    func bootstrap() async {
        await loadProducts()
        await refreshEntitlements()
        updates = listenForTransactions()
    }

    deinit { updates?.cancel() }

    func purchase(_ product: Product) async {
        do {
            let result = try await product.purchase()
            switch result {
            case .success(.verified(let tx)):
                await tx.finish()
                await refreshEntitlements()
            case .success(.unverified(_, let err)):
                Logger.billing.error("unverified: \(err.localizedDescription, privacy: .public)")
            case .userCancelled, .pending:
                break
            @unknown default:
                break
            }
        } catch {
            Logger.billing.error("purchase failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func loadProducts() async {
        do {
            products = try await Product.products(for: ["mira_monthly_999"])
        } catch {
            Logger.billing.error("loadProducts failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func refreshEntitlements() async {
        var active = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let tx) = result, tx.productID == "mira_monthly_999",
               tx.revocationDate == nil, tx.expirationDate ?? .distantPast > .now {
                active = true
            }
        }
        isSubscribed = active
    }

    private func listenForTransactions() -> Task<Void, Never> {
        Task.detached { [weak self] in
            for await update in Transaction.updates {
                guard let self else { return }
                if case .verified(let tx) = update {
                    await tx.finish()
                    await self.refreshEntitlements()
                }
            }
        }
    }
}
```

---

## 20. Backend communication — `Mira/Services/BackendAPI.swift`

```swift
import Foundation

actor BackendAPI {
    static let shared = BackendAPI()
    private let base = URL(string: "https://api.mira.vualet.com")!

    enum Tier: String { case free, paid }

    /// Returns the WireGuard config the tunnel should use, given the buyer's tier.
    /// For paid users we forward the StoreKit transaction receipt for the
    /// backend to validate against Apple's servers.
    func fetchTunnelConfig(tier: Tier) async -> TunnelConfig? {
        var req = URLRequest(url: base.appending(path: "/v1/tunnel/issue"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["tier": tier.rawValue]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        if tier == .paid, let receipt = await Self.appReceiptBase64() {
            req.setValue(receipt, forHTTPHeaderField: "X-Mira-Receipt")
        }
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(TunnelConfig.self, from: data)
        } catch {
            return nil
        }
    }

    private static func appReceiptBase64() async -> String? {
        guard let url = Bundle.main.appStoreReceiptURL,
              let data = try? Data(contentsOf: url) else { return nil }
        return data.base64EncodedString()
    }
}
```

---

## 21. Banking pause + per-app direct

iOS doesn't expose per-app routing the way Android does with
`addDisallowedApplication`. The closest equivalent:

1. **Pause toggle** — main app's settings has a switch. When enabled,
   `TunnelManager.disconnect()` is called and the tunnel is marked
   "paused" in shared UserDefaults. Auto-resume after a chosen duration.
2. **Excluded routes** — `NEPacketTunnelNetworkSettings.IPv4Settings.excludedRoutes`
   lets you exclude IP ranges. This is **route-based**, not app-based.
   Use it to keep specific known bank backend IP ranges direct.

Show the Pause toggle prominently in `SettingsView.swift`. Document on the
in-app "Why pause?" screen: "Some banks block VPN traffic. Tap Pause to
let your bank verify your device. Mira will auto-resume in 30 minutes."

---

## 22. AdMob (free tier ads)

Add via SPM: `https://github.com/googleads/swift-package-manager-google-mobile-ads.git`

In `MiraApp.swift` before showing the first View, call `MobileAds.shared.start()`.

Show interstitial **only** when:
- `subs.isSubscribed == false`
- Last interstitial shown > 6 hours ago
- User just tapped Connect from a fresh state

Banner placement: bottom of `ConnectView` while disconnected, never while
connected (so the connection itself isn't visually polluted).

Show no ads at all to paid users — even on the disconnected screen — so
the upgrade is felt the moment they pay.

---

## 23. App Store listing copy

(Mirror of `docs/PLAY-LISTING.md` for Android; the listing language is identical to avoid
inconsistency between stores.)

**App name**: `Mira`

**Subtitle (30 chars)**: `Smart, private connection`

**Promotional text (170 chars)**:
> A modern VPN that picks the fastest server for you, automatically. Free forever for messaging; paid when you want smooth video.

**Description (4000 chars)**:
*(Copy verbatim from `docs/PLAY-LISTING.md` §"Full description", swap "Google Play" → "App Store" once and Play Billing terminology → StoreKit / subscriptions.)*

**Keywords (100 chars, comma-sep)**:
`vpn, privacy, wifi, fast, smart, encryption, hotspot, no logs, free vpn, secure`
(Avoid: `bypass`, `unblock`, `censor`, `firewall`, `tor`, `china`, `iran` — see `docs/COMPLIANCE.md`.)

**Screenshots required** (6.7" + 5.5"):
1. Hero — wordmark + Connect button + aura
2. Connected state
3. Smart routing screen
4. Settings screen
5. Subscription paywall
6. Privacy screen

---

## 24. Build & archive flow

```bash
# from project root
xcodebuild -scheme Mira -archivePath build/Mira.xcarchive archive

# export for App Store
xcodebuild -exportArchive \
    -archivePath build/Mira.xcarchive \
    -exportOptionsPlist build/ExportOptions.plist \
    -exportPath build/AppStore

# upload to App Store Connect
xcrun altool --upload-app --type ios \
    --file build/AppStore/Mira.ipa \
    --apiKey "$APP_STORE_API_KEY_ID" \
    --apiIssuer "$APP_STORE_API_ISSUER_ID"
```

`ExportOptions.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
    <key>method</key><string>app-store</string>
    <key>uploadSymbols</key><true/>
    <key>uploadBitcode</key><false/>
    <key>signingStyle</key><string>automatic</string>
</dict></plist>
```

---

## 25. TestFlight + App Review notes

In App Store Connect → My App → TestFlight → submit:
- **Test details for review** (Apple needs this to test the VPN; without it,
  binary is rejected with "we couldn't verify the VPN works"):
  ```
  Mira is a consumer VPN. To test:
    1. Open Mira.
    2. Tap Connect.
    3. Accept the system VPN-permission dialog.
    4. Visit https://ifconfig.me — IP shown should match a Mira server.
  Free tier requires no signup. To test paid features, use the sandbox
  account you have on file for our Apple Developer account.
  ```

- **Encryption Compliance**: declare standard cryptography only (WireGuard
  uses Curve25519, ChaCha20, Poly1305 — all standard). Set
  `ITSAppUsesNonExemptEncryption = false`. This avoids the annual export
  compliance paperwork.

---

## 26. App Store rejection avoidance — the patterns reviewers hit

| What gets rejected | How Mira avoids it |
|---|---|
| Marketing copy mentions "bypass" / "censorship" / specific countries | We say "smart server selection" and "private connection" only |
| App description claims features that aren't visible in the binary | "AI-assisted" is backed by `SmartRouter.swift` — real measurement of RTT to multiple servers, weighted pick. Reviewers can see this is working. |
| No clear privacy policy URL | `https://mira.vualet.com/privacy` is in the app's First-Run dialog AND in App Store Connect → App Privacy |
| First-launch doesn't disclose VPN | `ConnectView` shows the system VPN dialog *before* the first connect — reviewer sees the disclosure |
| Subscription details unclear | StoreKit's product description (configured in App Store Connect) shows duration, price, cancel-anytime |
| Auto-renew not disclosed | Auto-renew language is in the Subscription view, near the buy button |
| Asking for unrelated permissions | We ask for only Personal VPN and Notifications — nothing else |

---

## 27. The deviations to expect, and how to record them

When you hit something that doesn't match this doc — `wireguard-apple`
API drift, Xcode template changes, App Store Connect renames — record
the deviation at the top of a new file `docs/MIRA-VPN-IOS-DEVIATIONS.md`
in the format:

```markdown
### 2026-MM-DD — <short description>

**Section in spec**: §<n> <title>
**What changed**: <one sentence>
**Why**: <one sentence>
**Fix applied**: <one paragraph or code block>
```

This is the iOS equivalent of the "10 deviations" list from
`docs/ANDROID-LESSONS.md` we'll grow as the iOS build is shipped.

---

## 28. The 10 traps to brief the iOS engineer on before they start

These are iOS-specific gotchas where I'd otherwise expect to lose a day
each. State them up front:

1. **Extension memory ceiling is ~50 MB** — don't pull big SDKs (Firebase, Sentry) into the PacketTunnel target. Crash logs go via OSLog.
2. **NETunnelProviderManager.loadAllFromPreferences() can return [] on first run** — handle by creating a new manager and saving it before reading state.
3. **The VPN system permission dialog only fires on `saveToPreferences()`** — not on every connect. Trigger it on first onboarding, not buried inside Connect.
4. **`startVPNTunnel()` throws `NEVPNErrorConfigurationDisabled`** when `isEnabled = false`. Always set `isEnabled = true` before saving.
5. **`providerConfiguration` is `[String: Any]` but values must be plist-serializable** — Codable structs need to be encoded to `Data` first.
6. **WireGuard `TunnelConfiguration(fromWgQuickConfig:called:)` throws** with subtle errors on whitespace — write the config with `\n` not `\r\n`.
7. **iOS 18+ Per-App VPN** is a managed-config feature (MDM only). You cannot exclude apps the way Android does. Use IP-range excludes instead.
8. **App Group container is sandboxed differently per target** — read via `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`, not by path.
9. **StoreKit 2 sandbox accounts** are set in Settings → App Store → Sandbox Account on the device, not in iCloud settings. Easy to lose 30 min on this.
10. **App Store Connect won't accept builds with `ITSAppUsesNonExemptEncryption` missing** — you'll see a generic "missing compliance" error.

---

## Bottom line

Hand this file to whoever ships iOS. They should produce a working
TestFlight build in **5-7 working days**:

- Day 1: project setup, entitlements, capability requests filed
- Day 2: WireGuard SPM, PacketTunnelProvider, basic Connect/Disconnect end-to-end
- Day 3: Theme, ConnectView, SettingsView, SmartRouter
- Day 4: StoreKit 2 + SubscriptionView + sandbox testing
- Day 5: AdMob, banking pause, polish, App Store listing assets
- Day 6: TestFlight upload + internal testing
- Day 7: External TestFlight + App Review submission

Total Apple costs: $99 (developer enrollment) + 30% of subscription
revenue.
