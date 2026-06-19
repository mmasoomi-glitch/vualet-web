# Mira VPN — Client Specification

I have deployed a fully operational VPN backend at **Hetzner Nuremberg**. You are
to build production-grade VPN clients (Windows, Android, iOS, macOS) that connect to
this backend and deliver an experience comparable to NordVPN or Psiphon — no
external dependencies exposed to the user, one-click connect, baked-in TUN driver.

---

## 1. Server & API Specifications

### 1.1 WireGuard Endpoint (Primary Protocol)

```
Server Address : 178.104.251.30  (IPv4)
UDP Port       : 51820
Protocol       : WireGuard (Curve25519, ChaCha20-Poly1305)
Server Pubkey  : ByK5yGC96gYi0GZ/dIoyVBWZkLrCGyQH+XKtxS1UJhE=
DNS Servers    : 1.1.1.1, 1.0.0.1
MTU            : 1420
Client Subnet  : 10.66.66.0/24  (clients assigned .2–.254)
Keepalive      : 25 seconds
```

### 1.2 Tunnel Registration API

```
Base URL  : http://178.104.251.30/v1
Endpoint  : POST /tunnel/issue
Headers   : Content-Type: application/json
Response  : application/json
```

**Request**:
```json
{
  "public_key": "<client WireGuard public key, base64, 44 chars>",
  "tier": "free"
}
```

**Response (200 OK)**:
```json
{
  "ip": "10.66.66.2",
  "server_endpoint": "178.104.251.30:51820",
  "server_public_key": "ByK5yGC96gYi0GZ/dIoyVBWZkLrCGyQH+XKtxS1UJhE=",
  "config": "[Interface]\nPrivateKey = FILL_ME\nAddress = 10.66.66.2/32\nDNS = 1.1.1.1, 1.0.0.1\nMTU = 1420\n\n[Peer]\nPublicKey = ByK5yGC96gYi0GZ/dIoyVBWZkLrCGyQH+XKtxS1UJhE=\nEndpoint = 178.104.251.30:51820\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n"
}
```

**Response (400 Bad Request)**:
```json
{ "error": "public_key required" }
```

**Response (500 Internal Server Error)**:
```json
{ "error": "Command '...' returned non-zero exit status 1." }
```

---

## 2. Tunnel Specifications (Per-Platform)

### 2.1 Windows — WireGuard Kernel Driver

WireGuard ships a signed kernel driver via `wireguard-installer.exe`. The
recommended approach mirrors NordVPN: ship the WireGuard MSI as an embedded
resource, extract to `%LOCALAPPDATA%\Mira VPN\WireGuard\`, silently invoke
`msiexec /i wireguard.msi /quiet /norestart DO_NOT_LAUNCH=1`, then drive the
tunnel via `wireguard.exe /installtunnelservice`.

**Connection flow** (no UI, no user prompts beyond the mandatory Windows UAC):
1. App starts → checks `%LOCALAPPDATA%\Mira VPN\WireGuard\wireguard.exe`
2. Missing → extract MSI from embedded resource → `msiexec /i /quiet`
3. `wireguard.exe genkey` → private key
4. `wireguard.exe pubkey` → public key
5. `POST /v1/tunnel/issue {public_key, tier}` → receive config
6. Replace `FILL_ME` in config with private key
7. `wireguard.exe /installtunnelservice "<config-path>"`
8. `wireguard.exe /activate "MiraVPN"`
9. Tunnel is live; tray icon shows connected state

**Disconnection**:
`wireguard.exe /uninstalltunnelservice "MiraVPN"` removes the tunnel; the
peer stays registered on the server (pruned manually via `wg set wg0 peer <key> remove`).

### 2.2 Android — VpnService + WireGuard-Go or Xray Reality

Two valid approaches. The Uncle Z Calc project (separate repo: `mmasoomi-glitch/uncle-z-calc`)
uses VLESS+Reality via `libv2ray` AAR. This spec endorses **WireGuard** for new builds
because (a) WireGuard has a maintained Kotlin/Go library, (b) it passes Google Play review
without circumvention-policy risk, (c) lower battery drain.

Core requirements:
- Extend `VpnService`
- Use `VpnService.Builder.addRoute("0.0.0.0", 0)` to capture all traffic
- Use `Builder.addDisallowedApplication(packageName)` to exclude the app itself
  (prevents the traffic loopback bug)
- `Builder.addDnsServer("1.1.1.1")` and `"1.0.0.1"`
- `Builder.setSession("Mira VPN")`
- Foreground notification: `foregroundServiceType="specialUse"` with
  `PROPERTY_SPECIAL_USE_FGS_SUBTYPE="vpn"` in the manifest
- Permission `FOREGROUND_SERVICE_SPECIAL_USE` with **no** `maxSdkVersion` cap
  (capping at 34 silently kills the service on Android 15+)

### 2.3 iOS — NetworkExtension + WireGuard-Go (App Store Compliant)

- `NEPacketTunnelProvider` with `NETunnelProviderProtocol`
- Bundle ID: `com.vualet.mira.PacketTunnel`
- App Group: `group.com.vualet.mira`
- Use `WireGuardKit` from `https://github.com/wireguard/wireguard-apple` (Swift Package)
- `TunnelConfiguration(fromWgQuickConfig:called:)` parses the API response
- `PrivacyInfo.xcprivacy` must declare UserDefaults and FileTimestamp API usage
  reasons (`CA92.1`, `C617.1`)
- Encryption declaration: `ITSAppUsesNonExemptEncryption = false`
  (WireGuard uses only standard Curve25519 + ChaCha20-Poly1305)
- Category: `public.app-category.utilities`
- No "bypass", "censorship", "firewall" terms in the listing

### 2.4 macOS — Same as iOS, Adapted

- Use `NEPacketTunnelProvider` via `NetworkExtension` framework
- Bundle ID: `com.vualet.mira.macos.PacketTunnel`
- App Group: `group.com.vualet.mira.macos`
- System tray icon (similar to the Windows tray pattern)
- `NETunnelProviderManager` drive the tunnel
- Same `WireGuardKit` Swift Package, same Apple compliance posture

### 2.5 Linux — wg-quick + NetworkManager

- `apt install wireguard-tools` or equivalent
- Generate keypair with `wg genkey` / `wg pubkey`
- POST to the API, receive config, write to `/etc/wireguard/mira.conf`
- `wg-quick up mira`
- The config format the API returns is already `wg-quick` compatible

---

## 3. Payment Integration — NowPayments

### 3.1 API Credentials

| Var | Value |
|-----|-------|
| API Key | `J5SAFWA-8174JB1-HNKYGFG-HT5F869` |
| IPN Secret | (set in NowPayments dashboard — needed to verify webhooks) |
| Pricing | `$9.99` USD / month · `30 days` · `5 Mbps` · `50 GB` · `3 devices` |
| Free Tier | `500 kbps`, `2-hour` session reconnect, ad-supported, `1 device` |

### 3.2 Checkout Flow (Client-Side)

1. User selects "Mira VPN" subscription at `/vpn/checkout`
2. Client POSTs to `/api/vpn/checkout/crypto` with `{email, plan: "mira-vpn-monthly"}`
3. Response: `{redirectUrl: "https://nowpayments.io/payment/..."}`
4. Client redirects user to NowPayments hosted page
5. NowPayments processes crypto or card payment
6. Successful payment → IPN hits `/api/webhooks/nowpayments` (HMAC-SHA512 verified)
7. Backend mints a permit via the Mira VPN backend permit API
8. Permit is emailed to the user or displayed on the success page

### 3.3 NowPayments Supported Currencies

200+ coins including USDT-TRC20, BTC, ETH, LTC, XMR, and card (Visa/Mastercard).
The hosted page auto-detects the buyer's region and shows relevant options.

---

## 4. Brand Design System — `mira.css`

### 4.1 Color Tokens

| Token | Hex | Role |
|-------|-----|------|
| `--mira-rose` | `#F8A5A0` | Primary presence color |
| `--mira-rose-deep` | `#E68A85` | Active/hover states |
| `--mira-petal` | `#FFDCE0` | Soft backgrounds |
| `--mira-lavender` | `#C7B8F0` | Calm intelligence |
| `--mira-lavender-deep` | `#A595E8` | Focus states |
| `--aether` | `#6366F1` | AI core / family link |
| `--mira-cream` | `#FFF8F0` | Light-mode background |
| `--mira-canvas` | `#FEFAF6` | Card/surface background |
| `--mira-onyx` | `#1A1525` | Dark-mode background |
| `--mira-ink` | `#2A1F2D` | Primary text |
| `--mira-graphite` | `#524A55` | Secondary text |
| `--mira-slate` | `#8C8190` | Muted text |
| `--mira-fog` | `#E8E0EA` | Borders |
| `--mira-frost` | `#F2EAF0` | Soft surfaces |

### 4.2 Primary Gradient

```css
linear-gradient(135deg, #F8A5A0 0%, #C7B8F0 55%, #6366F1 100%)
```

### 4.3 Typography

| Role | Font | Weight |
|------|------|--------|
| Display / Headings | `Fraunces` (serif) | 300–400 |
| UI / Body | `Inter` (sans-serif) | 400–600 |
| Code / Technical | `JetBrains Mono` or `Consolas` | 400 |

### 4.4 Border Radii

| Size | Value |
|------|-------|
| Small | `10px` |
| Medium | `16px` |
| Large | `24px` |
| Pill / Full | `999px` |

### 4.5 Shadows

```css
/* Card */
--mira-shadow-sm: 0 1px 3px rgba(248,165,160,0.12);
/* Elevated card */
--mira-shadow-md: 0 4px 16px rgba(199,184,240,0.18), 0 2px 4px rgba(42,31,45,0.04);
/* Modal / overlay */
--mira-shadow-lg: 0 16px 48px rgba(199,184,240,0.25), 0 4px 12px rgba(42,31,45,0.08);
```

### 4.6 Motion

| Duration | Use |
|----------|-----|
| `300ms` | Button hovers, text transitions |
| `450ms` | Page transitions, card reveals |
| `2400ms` | Breathing aura animation (`mira-aura`) |

### 4.7 Button Styles (CSS Classes)

**Primary** (`.btn-mira`):
```css
.btn-mira {
  background: linear-gradient(135deg, #F8A5A0 0%, #C7B8F0 55%, #6366F1 100%);
  color: white;
  padding: 14px 28px;
  border-radius: 999px;  /* pill */
  font-weight: 500;
  transition: all 300ms ease;
  cursor: pointer;
  border: none;
}
```

**Secondary** (`.btn-mira-soft`):
```css
.btn-mira-soft {
  background: transparent;
  border: 2px solid #F8A5A0;
  color: #2A1F2D;
  padding: 14px 28px;
  border-radius: 999px;
  font-weight: 500;
}
```

---

## 5. Logo & Assets

### 5.1 Production Files (on the deployed server)

```
URL: http://178.104.251.30/mira/mira-logo-color.svg        — primary mark (rose-lavender-aether gradient)
URL: http://178.104.251.30/mira/mira-logo-white.svg        — white variant (for dark backgrounds)
URL: http://178.104.251.30/mira/mira-logo-mono.svg         — single-color (uses currentColor)
URL: http://178.104.251.30/mira/mira-wordmark-color.svg    — mark + "MIRA" text (primary branded)
URL: http://178.104.251.30/mira/mira-wordmark-white.svg    — mark + "MIRA" text (white, for dark)
URL: http://178.104.251.30/mira/mira-logo-color-512.png    — raster fallback (512px)
URL: http://178.104.251.30/mira/mira-logo-color-256.png    — raster fallback (256px)
```

**Local path on the Next.js web source**: `/public/mira/` — all the above files.
**GitHub repo**: `mmasoomi-glitch/vualet-web`, branch `feature/mira-vpn-storefront`.

### 5.2 Logo Concept

Mira's mark is a central warm presence radiating two concentric rings of
awareness (listening, alive). The outer ring breathes (CSS animation
`mira-breathe` with 2400ms cycle, opacity 0.55 → 0.85, scale 1.0 → 1.04).

This contrasts with the parent brand (Vualet): structural, circular.

---

## 6. Product Tiers (for UI copy)

| | Free | Paid |
|---|---|---|
| Price | $0 forever | $9.99 / month |
| Speed | 500 kbps per device | 5 Mbps per device |
| Session | 2 hours, then reconnect | unlimited |
| Volume | unlimited (speed-capped) | 50 GB / month |
| Devices | 1 | 3 |
| Ads | yes | no |
| Server | nearest only | smart routing engine |
| Banking Pause | yes | yes |
| Per-App Split Tunnel | yes | yes |

---

## 7. Supporting URLs

```
Landing Page    : http://178.104.251.30/vpn
Download Page   : http://178.104.251.30/vpn/get
Checkout        : http://178.104.251.30/vpn/checkout
Success Page    : http://178.104.251.30/vpn/checkout/success
Mother Brand    : http://178.104.251.30/vualet
Blog (30 posts) : http://178.104.251.30/blog
Privacy Policy  : coming soon at https://mira.vualet.com/privacy
Support         : Telegram — linked from all pages
```

## 8. Key Implementation Notes & Gotchas

1. **Traffic loop prevention:** On Android (and on any TUN-based VPN), you
   MUST exclude the app's own UID from the TUN (`Builder.addDisallowedApplication(packageName)`).
   Without this, the outbound connection from your own app to the server gets
   captured by your own tunnel and loops infinitely. Tested + confirmed this
   exactly once on Uncle Z Calc. The Windows WireGuard kernel driver handles
   this automatically because the tunnel is a kernel service, not a userspace
   proxy. iOS `NEPacketTunnelProvider` also handles it natively.
2. **Foreground service on Android 14+:** Use `foregroundServiceType="specialUse"`
   with `PROPERTY_SPECIAL_USE_FGS_SUBTYPE="vpn"`. Never cap `FOREGROUND_SERVICE_SPECIAL_USE`
   permission with `maxSdkVersion`. The 3-arg `startForeground()` call should use
   `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` gated on `UPSIDE_DOWN_CAKE`.
3. **WireGuard key format:** Public keys are 44-character base64 strings
   (not base64url — no `-` or `_`). The API checks nothing beyond "is it a
   valid WireGuard key that wg can add."
4. **Pause for banking:** Provide a global toggle + per-app exclusion list.
   On Android, map to `addDisallowedApplication(pkg)`. On iOS, keep an in-app
   flag that (a) disconnects the tunnel for a chosen duration or (b) adds the
   excluded IP ranges to the packet tunnel configuration.
5. **Rate limiting on the API:** The `/tunnel/issue` endpoint does NOT
   currently rate-limit. If you deploy at scale, add token-bucket or IP-based
   rate limiting at the nginx layer (limit_req_zone).

---

## 9. Reference Implementations

| Platform | Repo | Branch | Notes |
|---|---|---|---|
| Next.js web frontend | `mmasoomi-glitch/vualet-web` | `feature/mira-vpn-storefront` | Full storefront + Mira brand |
| Android (VLESS+Reality) | `mmasoomi-glitch/uncle-z-calc` | `main` | Calculator-disguised VPN — working, tested on device |
| Windows (WireGuard) | `mmasoomi-glitch/vualet-web` | same branch, `windows/MiraVpn/` | WPF tray app + PowerShell setup |
| Windows (PS1 installer) | `mmasoomi-glitch/vualet-web` | same branch, `windows/install-mira-vpn.ps1` | Single-click WireGuard tunnel setup |

---

## 10. Dev Quickstart

The web frontend is deployed on the Hetzner box at `/opt/mira-vpn/`. To deploy
a new build:

```bash
# On Windows (build machine):
cd vualet-web
npm run build                                    # Next.js 16 standalone output
tar czf deploy.tar.gz -C .next/standalone . && cp -r .next/static deploy/
scp deploy.tar.gz root@178.104.251.30:/root/     # requires SSH key

# On Hetzner (mira-vpn-01):
cd /opt/mira-vpn
rm -rf .next public node_modules server.js package.json
tar xzf /root/deploy.tar.gz
systemctl restart mira-web
```

The WireGuard API is at `/opt/mira-api/tunnel-api.py`, systemd unit `mira-api`.
To restart: `systemctl restart mira-api`.
