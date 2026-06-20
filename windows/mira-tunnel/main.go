package main

/*
#include <stdlib.h>
*/
import "C"
import (
	"encoding/json"
	"sync"
	"unsafe"
)

var (
	mu        sync.Mutex
	tunnel    *Tunnel
	lastError string
)

//export mira_start
func mira_start(configPtr *C.char) C.int {
	mu.Lock(); defer mu.Unlock()
	if tunnel != nil { tunnel.Stop(); tunnel = nil }
	t, err := NewTunnel(C.GoString(configPtr))
	if err != nil { lastError = "config: " + err.Error(); return -1 }
	if err := t.Start(); err != nil { lastError = err.Error(); return -2 }
	lastError = ""; tunnel = t; return 0
}

//export mira_stop
func mira_stop() C.int {
	mu.Lock(); defer mu.Unlock()
	if tunnel == nil { return 0 }
	tunnel.Stop(); tunnel = nil; return 0
}

//export mira_stats
func mira_stats() *C.char {
	mu.Lock(); defer mu.Unlock()
	if tunnel == nil { return C.CString(`{"connected":false}`) }
	d, _ := json.Marshal(tunnel.Stats())
	return C.CString(string(d))
}

//export mira_status
func mira_status() *C.char {
	mu.Lock(); defer mu.Unlock()
	if tunnel == nil { return C.CString(`{"connected":false}`) }
	d, _ := json.Marshal(tunnel.Status())
	return C.CString(string(d))
}

//export mira_genkey
func mira_genkey() *C.char {
	priv, _ := GeneratePrivateKey()
	return C.CString(priv)
}

//export mira_pubkey
func mira_pubkey(privPtr *C.char) *C.char {
	pub, _ := DerivePublicKey(C.GoString(privPtr))
	return C.CString(pub)
}

//export mira_last_error
func mira_last_error() *C.char {
	mu.Lock(); defer mu.Unlock()
	return C.CString(lastError)
}

//export mira_free
func mira_free(ptr *C.char) { C.free(unsafe.Pointer(ptr)) }

func main() { select {} }
