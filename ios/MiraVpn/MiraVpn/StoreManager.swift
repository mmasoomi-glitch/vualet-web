import Foundation
import StoreKit

actor StoreManager {
    static let shared = StoreManager()

    private let productID = "mira_premium_monthly"
    private var products: [Product] = []

    private init() {}

    /// Load available products from App Store
    func loadProducts() async throws {
        products = try await Product.products(for: [productID])
    }

    /// Check if the user has an active subscription
    func checkEntitlement() async -> Bool {
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result {
                if transaction.productID == productID {
                    if let expires = transaction.expirationDate {
                        return expires > Date()
                    }
                    return true
                }
            }
        }
        return false
    }

    /// Purchase the premium subscription
    func purchase() async throws -> Bool {
        if products.isEmpty {
            try await loadProducts()
        }
        guard let product = products.first else {
            throw StoreError.productNotFound
        }
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            switch verification {
            case .verified(let transaction):
                await transaction.finish()
                return true
            case .unverified:
                return false
            }
        case .userCancelled:
            return false
        case .pending:
            return false
        @unknown default:
            return false
        }
    }

    /// Listen for transaction updates (renewals, cancellations, etc.)
    func listenForTransactions() async {
        for await result in Transaction.updates {
            if case .verified(let transaction) = result {
                await transaction.finish()
            }
        }
    }

    enum StoreError: Error {
        case productNotFound
    }
}
