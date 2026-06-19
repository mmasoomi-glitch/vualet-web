import SwiftUI

@main
struct MiraVpnApp: App {
    @StateObject private var viewModel = ViewModel()

    init() {
        // Start listening for StoreKit transaction updates
        Task.detached {
            await StoreManager.shared.listenForTransactions()
        }
        // Start listening for tunnel status changes
        Task.detached {
            await TunnelManager.shared.startListening()
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(viewModel)
                .preferredColorScheme(.light)
        }
    }
}
