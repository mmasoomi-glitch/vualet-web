import SwiftUI

struct ContentView: View {
    @EnvironmentObject var viewModel: ViewModel

    var body: some View {
        ZStack {
            // Background
            LinearGradient(
                colors: [Color(hex: "FFF8F0"), Color(hex: "FEFAF6")],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                // ─── Header ───
                VStack(spacing: 8) {
                    // Logo
                    ZStack {
                        RoundedRectangle(cornerRadius: 14)
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color(hex: "F8A5A0"),
                                        Color(hex: "C7B8F0"),
                                        Color(hex: "6366F1")
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 56, height: 56)
                        Text("M")
                            .font(.system(size: 32, weight: .bold, design: .serif))
                            .foregroundColor(.white)
                    }
                    .padding(.bottom, 4)

                    Text("Mira VPN")
                        .font(.system(size: 24, weight: .medium, design: .serif))
                        .foregroundColor(Color(hex: "2A1F2D"))

                    Text("Tap Connect. Tap Disconnect. Done.")
                        .font(.system(size: 13))
                        .foregroundColor(Color(hex: "524A55"))
                }
                .padding(.top, 40)
                .padding(.bottom, 32)

                Spacer()

                // ─── Status ───
                VStack(spacing: 12) {
                    // State indicator
                    HStack(spacing: 8) {
                        Circle()
                            .fill(stateColor)
                            .frame(width: 10, height: 10)
                        Text(viewModel.statusText)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Color(hex: "2A1F2D"))
                    }

                    // Server info
                    if let info = viewModel.serverInfo {
                        Text(info)
                            .font(.system(size: 13))
                            .foregroundColor(Color(hex: "524A55"))
                    }

                    // Latency
                    if viewModel.connectionState == .connected && viewModel.rtt > 0 {
                        Text("Latency: \(viewModel.rtt)ms")
                            .font(.system(size: 13))
                            .foregroundColor(Color(hex: "8C8190"))
                    }
                }
                .padding(.bottom, 24)

                Spacer()

                // ─── Connect Button ───
                Button(action: {
                    viewModel.toggleConnection()
                }) {
                    Text(buttonText)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(buttonBackground)
                        .clipShape(Capsule())
                }
                .disabled(viewModel.connectionState == .connecting || viewModel.connectionState == .disconnecting)
                .padding(.horizontal, 40)
                .padding(.bottom, 16)

                // ─── Promo code link ───
                Button("Promo Code") {
                    viewModel.showPromoSheet = true
                }
                .font(.system(size: 13))
                .foregroundColor(Color(hex: "F8A5A0"))
                .padding(.bottom, 8)

                // ─── Subscription / Pricing ───
                if !viewModel.isPaid {
                    Button(action: {
                        viewModel.showPurchaseSheet = true
                    }) {
                        Text("Upgrade to Premium — $9.99/mo")
                            .font(.system(size: 12))
                            .foregroundColor(Color(hex: "6366F1"))
                    }
                    .padding(.bottom, 8)
                } else {
                    Text("Premium Active")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color(hex: "4EC9B0"))
                        .padding(.bottom, 8)
                }

                Spacer().frame(height: 8)
            }

            // ─── Promo code sheet ───
            if viewModel.showPromoSheet {
                PromoSheet(viewModel: viewModel)
            }

            // ─── Purchase sheet ───
            if viewModel.showPurchaseSheet {
                PurchaseSheet(viewModel: viewModel)
            }
        }
    }

    private var stateColor: Color {
        switch viewModel.connectionState {
        case .disconnected: return Color(hex: "8C8190")
        case .connecting:   return Color(hex: "F8C54A")
        case .connected:    return Color(hex: "4EC9B0")
        case .disconnecting: return Color(hex: "8C8190")
        case .error:        return Color(hex: "E68A85")
        }
    }

    private var buttonText: String {
        switch viewModel.connectionState {
        case .disconnected:  return "Connect"
        case .connecting:    return "Connecting…"
        case .connected:     return "Disconnect"
        case .disconnecting: return "Disconnecting…"
        case .error:         return "Retry"
        }
    }

    private var buttonBackground: some View {
        Group {
            if viewModel.connectionState == .connected {
                Color(hex: "1A1525")
            } else if viewModel.connectionState == .error {
                Color(hex: "E68A85")
            } else {
                LinearGradient(
                    colors: [Color(hex: "F8A5A0"), Color(hex: "C7B8F0"), Color(hex: "6366F1")],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
        }
    }
}

// ─── Promo Code Sheet ───
struct PromoSheet: View {
    @ObservedObject var viewModel: ViewModel
    @State private var code = ""
    @State private var loading = false
    @State private var message = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("Activate Promo Code")
                .font(.system(size: 18, weight: .semibold, design: .serif))
                .foregroundColor(Color(hex: "2A1F2D"))

            TextField("MIRA-XXXXXXXXXXXX", text: $code)
                .textInputAutocapitalization(.characters)
                .disableAutocorrection(true)
                .padding()
                .background(Color.white)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color(hex: "E8E0EA"), lineWidth: 1)
                )

            if !message.isEmpty {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundColor(message.hasPrefix("✓") ? Color(hex: "4EC9B0") : Color(hex: "E68A85"))
            }

            HStack(spacing: 12) {
                Button("Cancel") {
                    viewModel.showPromoSheet = false
                }
                .foregroundColor(Color(hex: "524A55"))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Color(hex: "F2EAF0"))
                .clipShape(Capsule())

                Button("Redeem") {
                    redeemCode()
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    LinearGradient(
                        colors: [Color(hex: "F8A5A0"), Color(hex: "6366F1")],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .clipShape(Capsule())
                .disabled(loading || code.isEmpty)
            }
        }
        .padding(24)
        .background(Color(hex: "FFF8F0"))
        .cornerRadius(24)
        .shadow(color: Color.black.opacity(0.1), radius: 20, y: 10)
        .padding(32)
    }

    private func redeemCode() {
        loading = true
        message = ""
        Task {
            let result = await PromoManager.shared.redeem(code: code.uppercased())
            await MainActor.run {
                loading = false
                if result.success {
                    message = "✓ Activated! \(result.days) days of premium"
                    viewModel.checkSubscriptionStatus()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        viewModel.showPromoSheet = false
                    }
                } else {
                    message = result.reason ?? "Invalid code"
                }
            }
        }
    }
}

// ─── Purchase Sheet ───
struct PurchaseSheet: View {
    @ObservedObject var viewModel: ViewModel
    @State private var loading = false
    @State private var message = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("Mira VPN Premium")
                .font(.system(size: 20, weight: .semibold, design: .serif))
                .foregroundColor(Color(hex: "2A1F2D"))

            VStack(spacing: 8) {
                FeatureRow(text: "5 Mbps (10x faster)")
                FeatureRow(text: "No advertisements")
                FeatureRow(text: "50 GB/month data")
                FeatureRow(text: "3 devices")
                FeatureRow(text: "Priority support")
            }
            .padding(.vertical, 8)

            Text("$9.99/month")
                .font(.system(size: 22, weight: .medium, design: .serif))
                .foregroundColor(Color(hex: "6366F1"))

            if !message.isEmpty {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundColor(Color(hex: "E68A85"))
            }

            HStack(spacing: 12) {
                Button("Cancel") {
                    viewModel.showPurchaseSheet = false
                }
                .foregroundColor(Color(hex: "524A55"))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Color(hex: "F2EAF0"))
                .clipShape(Capsule())

                Button("Subscribe") {
                    purchase()
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    LinearGradient(
                        colors: [Color(hex: "F8A5A0"), Color(hex: "6366F1")],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .clipShape(Capsule())
                .disabled(loading)
            }
        }
        .padding(24)
        .background(Color(hex: "FFF8F0"))
        .cornerRadius(24)
        .shadow(color: Color.black.opacity(0.1), radius: 20, y: 10)
        .padding(32)
    }

    private func purchase() {
        loading = true
        message = ""
        Task {
            do {
                let success = try await StoreManager.shared.purchase()
                await MainActor.run {
                    loading = false
                    if success {
                        viewModel.checkSubscriptionStatus()
                        viewModel.showPurchaseSheet = false
                    } else {
                        message = "Purchase cancelled"
                    }
                }
            } catch {
                await MainActor.run {
                    loading = false
                    message = error.localizedDescription
                }
            }
        }
    }
}

struct FeatureRow: View {
    let text: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(Color(hex: "4EC9B0"))
                .font(.system(size: 14))
            Text(text)
                .font(.system(size: 14))
                .foregroundColor(Color(hex: "2A1F2D"))
            Spacer()
        }
    }
}

// ─── Color extension ───
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:  (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:  (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
