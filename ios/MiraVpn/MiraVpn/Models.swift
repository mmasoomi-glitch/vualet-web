import Foundation
import CryptoKit

// PromoRedeemResponse — used by PromoManager
struct PromoRedeemResponse: Codable {
    let success: Bool
    let reason: String?
    let accessUntil: String?

    enum CodingKeys: String, CodingKey {
        case success
        case reason
        case accessUntil = "access_until"
    }
}

// WireGuard key generation using CryptoKit (Curve25519 — real elliptic curve keys)
// The main app does NOT link WireGuardKit directly; it uses CryptoKit which is built into iOS.
// The PacketTunnel extension uses WireGuardKit's WireGuardAdapter.
struct WireGuardKeyGenerator {
    static func generateKeypair() -> (privateKey: String, publicKey: String) {
        let privateKey = Curve25519.KeyAgreement.PrivateKey()
        let privateKeyBytes = privateKey.rawRepresentation
        let publicKeyBytes = privateKey.publicKey.rawRepresentation

        // WireGuard keys are base64-encoded 32-byte values (44 chars with padding)
        let privateKeyBase64 = privateKeyBytes.base64EncodedString()
        let publicKeyBase64 = publicKeyBytes.base64EncodedString()

        return (privateKeyBase64, publicKeyBase64)
    }
}
