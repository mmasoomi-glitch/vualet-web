package main

import (
    "crypto/rand"
    "encoding/base64"
    "golang.org/x/crypto/curve25519"
)

func GeneratePrivateKey() (string, error) {
    var priv [32]byte
    if _, err := rand.Read(priv[:]); err != nil { return "", err }
    priv[0] &= 248; priv[31] &= 127; priv[31] |= 64
    return base64.StdEncoding.EncodeToString(priv[:]), nil
}

func DerivePublicKey(privB64 string) (string, error) {
    privBytes, err := base64.StdEncoding.DecodeString(privB64)
    if err != nil || len(privBytes) != 32 { return "", err }
    var priv, pub [32]byte
    copy(priv[:], privBytes)
    curve25519.ScalarBaseMult(&pub, &priv)
    return base64.StdEncoding.EncodeToString(pub[:]), nil
}
