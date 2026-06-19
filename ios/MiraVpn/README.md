# Mira VPN — iOS Client

## Prerequisites
- **Xcode 15.4+** (Swift 5.10+, iOS 17+ SDK)
- **Apple Developer account** ($99/year)
- **WireGuardKit** (added via SPM)

## Project Setup

### Step 1: Create the Xcode project
1. Open Xcode → File → New → Project
2. Select **App** under iOS
3. Product Name: `MiraVpn`
4. Bundle Identifier: `com.vualet.mira`
5. Interface: **SwiftUI**
6. Language: **Swift**
7. Save to `ios/MiraVpn/`

### Step 2: Add the Packet Tunnel extension
1. File → New → Target
2. Select **Network Extension** under iOS
3. Product Name: `MiraVpnPacketTunnel`
4. Bundle Identifier: `com.vualet.mira.PacketTunnel`
5. Provider Type: **Packet Tunnel**
6. Finish

### Step 3: Add WireGuardKit via SPM
1. File → Add Package Dependencies
2. Enter URL: `https://git.zx2c4.com/wireguard-apple`
3. Add `WireGuardKit` to **MiraVpnPacketTunnel** target only
4. The main app uses CryptoKit (built-in) — do NOT add WireGuardKit to the main app target

### Step 4: Build WireGuardGoBridge
WireGuardKit requires the Go bridge to be built. This is a known SPM limitation.

1. File → New → Target
2. Select **External Build System** under Other
3. Product Name: `WireGuardGoBridgeiOS`
4. Build Tool: `/usr/bin/make`
5. Directory: `${BUILD_DIR%Build/*}SourcePackages/checkouts/wireguard-apple/Sources/WireGuardKitGo`
6. In Build Settings: set `SDKROOT` to `iphoneos`

Then for the **MiraVpnPacketTunnel** target:
- Build Phases → Dependencies → Add `WireGuardGoBridgeiOS`
- Build Phases → Link Binary With Libraries → Add `WireGuardKit`

### Step 5: Configure capabilities
1. Select the `MiraVpn` target → Signing & Capabilities
2. Add capability: **Network Extensions** (check Packet Tunnel)
3. Add capability: **In-App Purchase**
4. Select the `MiraVpnPacketTunnel` target → Signing & Capabilities
5. Add capability: **Network Extensions** (Packet Tunnel should be checked)

### Step 6: Configure App Groups
1. Add capability: **App Groups** to both targets
2. App Group: `group.com.vualet.mira`

### Step 7: Copy source files
Replace the generated files with the source files from this directory:
- Main app: `MiraVpn/` folder → drag all `.swift` files into the MiraVpn group in Xcode
- Tunnel extension: `MiraVpnPacketTunnel/` folder → `PacketTunnelProvider.swift` replaces the generated one

### Step 8: Configure App Store Connect
1. Create the subscription product in App Store Connect:
   - Product ID: `mira_premium_monthly`
   - Price: $9.99/month
   - Subscription Group: Mira VPN Premium

### Step 9: Build
```bash
xcodebuild -project MiraVpn.xcodeproj \
  -scheme MiraVpn \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/MiraVpn.xcarchive \
  archive
```
Or in Xcode: Product → Archive

## Architecture

```
MiraVpn (main app)
├── SwiftUI ContentView — Connect button, status, promo sheet, purchase sheet
├── ViewModel — manages connection state with @Published vars
├── TunnelManager — wraps NETunnelProviderManager
├── MiraClient — HTTP client for /v1/tunnel/issue-direct
├── SmartRouter — parallel TCP probes to all servers, returns fastest
├── StoreManager — StoreKit 2 subscriptions (async/await)
├── PromoManager — promo code redemption via /v1/promo/redeem
├── KeychainHelper — stores WireGuard private key in iOS Keychain
└── Models — PromoRedeemResponse + WireGuardKeyGenerator (CryptoKit Curve25519)

MiraVpnPacketTunnel (network extension — separate process)
├── PacketTunnelProvider extends NEPacketTunnelProvider
├── Reads wg-quick config string from providerConfiguration["config"]
├── Uses WireGuardKit's WireGuardAdapter to manage the WireGuard connection
└── Sets up NEPacketTunnelNetworkSettings (routes, DNS, MTU)
```

## Key design decisions

1. **WireGuardKit (official)** — iOS uses the official `wireguard-apple` package via SPM, not AmneziaWG. AmneziaWG is Android-only. iOS relies on port rotation + TCP fallback (wstunnel port 8443) for censorship resilience.

2. **StoreKit 2** — Modern async/await API. `Product.purchase()` returns `PurchaseResult` with `.success(.verified(transaction))`. Transaction verification is automatic. `Transaction.currentEntitlements` checks for active subscription.

3. **NEPacketTunnelProvider** — The tunnel runs in a separate sandboxed process (the network extension). The main app sends the WireGuard config via `providerConfiguration["config"]` when starting the tunnel.

4. **Keychain storage** — The WireGuard private key is stored in the iOS Keychain (hardware-backed on devices with Secure Enclave), not in UserDefaults.

5. **CryptoKit for key generation** — The main app generates WireGuard keypairs using Apple's CryptoKit (`Curve25519.KeyAgreement.PrivateKey`), which is built into iOS. These are real Curve25519 key pairs — unlike the Android stub which uses random bytes.

6. **Promo code path** — Users can redeem promo codes without going through App Store billing. Useful for beta testers and the crypto payment path.

7. **No "VPN" in App Store listing** — Use "private connection" instead. Apple's review team will test the VPN functionality.

## App Store listing guidelines
- **Category**: Tools
- **Subcategory**: VPN
- **Description**: "Mira VPN — AI-assisted private connection. Tap Connect. Tap Disconnect. Done."
- **Do NOT use terms**: bypass, censorship, firewall, evade, circumvent
- **Privacy policy URL**: https://vualet.com/privacy
- **Support URL**: https://vualet.com/support

## iOS vs Android differences

| Feature         | iOS                              | Android                          |
|-----------------|----------------------------------|----------------------------------|
| VPN library     | WireGuardKit (official Apple)    | AmneziaWG (obfuscated fork)      |
| Transport       | Standard WireGuard               | UDP + obfuscated + TCP fallback  |
| Payment         | StoreKit 2 (App Store)           | Google Play Billing              |
| Key storage     | Keychain (hardware-backed)       | SharedPreferences                |
| Key generation  | CryptoKit Curve25519 (real keys) | SecureRandom bytes (stub)        |
| Tunnel API      | NEPacketTunnelProvider           | VpnService                       |
| App Group       | group.com.vualet.mira            | (not needed)                     |
| Bundle ID       | com.vualet.mira                  | com.vualet.mira                  |
| Tunnel Bundle   | com.vualet.mira.PacketTunnel     | (part of main app)               |

## Files

| File | Purpose |
|------|---------|
| `MiraVpn/MiraVpnApp.swift` | @main entry, StoreKit + tunnel listeners |
| `MiraVpn/ContentView.swift` | Main UI: Connect button, status, promo/purchase sheets |
| `MiraVpn/ViewModel.swift` | State management: connect/disconnect, subscription check |
| `MiraVpn/TunnelManager.swift` | NETunnelProviderManager wrapper |
| `MiraVpn/MiraClient.swift` | HTTP client for /v1/tunnel/issue-direct |
| `MiraVpn/SmartRouter.swift` | TCP probe servers, pick fastest RTT |
| `MiraVpn/StoreManager.swift` | StoreKit 2 subscriptions |
| `MiraVpn/PromoManager.swift` | Promo code redemption |
| `MiraVpn/KeychainHelper.swift` | Keychain wrapper for WireGuard keys |
| `MiraVpn/Models.swift` | Data models + WireGuard key generation via CryptoKit |
| `MiraVpn/Info.plist` | App config, ITSAppUsesNonExemptEncryption=false |
| `MiraVpn/PrivacyInfo.xcprivacy` | Privacy manifest (CA92.1, C617.1) |
| `MiraVpnPacketTunnel/PacketTunnelProvider.swift` | NEPacketTunnelProvider + WireGuardAdapter |
| `MiraVpnPacketTunnel/Info.plist` | Tunnel extension config |
