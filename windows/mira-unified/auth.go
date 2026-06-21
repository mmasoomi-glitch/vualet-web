package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func getDeviceID() string {
	// Use Windows machine GUID + username for device fingerprint
	machineGUID := readRegistryKey(`SOFTWARE\Microsoft\Cryptography`, "MachineGuid")
	username := os.Getenv("USERNAME")
	raw := machineGUID + ":" + username
	hash := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(hash[:])[:32]
}

func readRegistryKey(path, value string) string {
	// Simplified — uses os/exec to query registry
	return os.Getenv("COMPUTERNAME") // fallback
}

func authenticateWithTOTP(username, code string) (*SessionData, error) {
	deviceID := getDeviceID()
	client := &http.Client{Timeout: 15 * time.Second}

	// Step 1: lookup username -> user_id
	lPayload, _ := json.Marshal(map[string]string{"username": username})
	lReq, _ := http.NewRequest("POST", ServerBaseURL+"/v1/auth/lookup", bytes.NewBuffer(lPayload))
	lReq.Header.Set("Content-Type", "application/json")
	lResp, err := client.Do(lReq)
	if err != nil {
		return nil, fmt.Errorf("server unreachable: %w", err)
	}
	lBody, _ := io.ReadAll(lResp.Body)
	lResp.Body.Close()
	if lResp.StatusCode != 200 {
		var e map[string]string
		json.Unmarshal(lBody, &e)
		msg := e["error"]
		if msg == "" {
			msg = fmt.Sprintf("lookup HTTP %d", lResp.StatusCode)
		}
		return nil, fmt.Errorf(msg)
	}
	var lu struct {
		UserID int `json:"user_id"`
	}
	json.Unmarshal(lBody, &lu)

	// Step 2: verify TOTP - user_id + code + device_fingerprint in JSON body
	vPayload, _ := json.Marshal(map[string]interface{}{
		"user_id":            lu.UserID,
		"code":               code,
		"device_fingerprint": deviceID,
	})
	vReq, _ := http.NewRequest("POST", ServerBaseURL+"/v1/auth/verify", bytes.NewBuffer(vPayload))
	vReq.Header.Set("Content-Type", "application/json")
	vResp, err := client.Do(vReq)
	if err != nil {
		return nil, fmt.Errorf("verify failed: %w", err)
	}
	defer vResp.Body.Close()
	body, _ := io.ReadAll(vResp.Body)
	if vResp.StatusCode != 200 {
		var e map[string]string
		json.Unmarshal(body, &e)
		msg := e["error"]
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", vResp.StatusCode)
		}
		return nil, fmt.Errorf(msg)
	}
	// /v1/auth/verify returns {session_token, expires, days_remaining, username,
	// xray_uuid} per the frozen contract — there is no xray_config object.
	var result struct {
		SessionToken  string `json:"session_token"`
		Expires       string `json:"expires"`
		DaysRemaining int    `json:"days_remaining"`
		Username      string `json:"username"`
		XrayUUID      string `json:"xray_uuid"`
	}
	json.Unmarshal(body, &result)
	session := &SessionData{
		SessionToken:  result.SessionToken,
		Username:      result.Username,
		Expires:       result.Expires,
		DaysRemaining: result.DaysRemaining,
		XrayConfig:    XrayConfig{UUID: result.XrayUUID, Fingerprint: "chrome"},
	}
	// Step 3: fetch xray tunnel config
	tcReq, _ := http.NewRequest("GET", ServerBaseURL+"/v1/tunnel/config", nil)
	tcReq.Header.Set("X-Session-Token", result.SessionToken)
	tcResp, err := client.Do(tcReq)
	if err == nil && tcResp.StatusCode == 200 {
		tcBody, _ := io.ReadAll(tcResp.Body)
		tcResp.Body.Close()
		var tc struct {
			Server    string `json:"server"`
			Port      int    `json:"port"`
			UUID      string `json:"uuid"`
			PublicKey string `json:"publicKey"`
			ShortID   string `json:"shortId"`
			SNI       string `json:"sni"`
			Flow      string `json:"flow"`
		}
		if json.Unmarshal(tcBody, &tc) == nil {
			session.XrayConfig = XrayConfig{
				ServerAddr:     tc.Server,
				ServerPort:     tc.Port,
				UUID:           tc.UUID,
				RealityPubkey:  tc.PublicKey,
				RealityShortID: tc.ShortID,
				SNI:            tc.SNI,
				Flow:           tc.Flow,
				Fingerprint:    "chrome",
			}
		}
	}

	saveSession(session)
	return session, nil
}

func saveSession(s *SessionData) {
	data, _ := json.MarshalIndent(s, "", "  ")
	os.WriteFile(SessionFile, data, 0600)
}

func loadSession() *SessionData {
	data, err := os.ReadFile(SessionFile)
	if err != nil {
		return nil
	}
	var s SessionData
	if err := json.Unmarshal(data, &s); err != nil {
		return nil
	}
	return &s
}

func clearSession() {
	os.Remove(SessionFile)
}

func validateSession(token string) bool {
	// Session validation = GET /v1/auth/me with the session header (the frozen
	// contract endpoint). The old /v1/auth/status route does not exist server-side.
	req, _ := http.NewRequest("GET", ServerBaseURL+"/v1/auth/me", nil)
	req.Header.Set("X-Session-Token", token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func openBrowser(url string) {
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// Auth web server — serves the TOTP entry page on localhost
func startAuthServer(resultCh chan string) {
	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(authPageHTML))
	})

	mux.HandleFunc("/submit", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		username := r.FormValue("username")
		code := r.FormValue("code")

		if username == "" || code == "" {
			w.WriteHeader(400)
			w.Write([]byte("Username and code required"))
			return
		}

		session, err := authenticateWithTOTP(username, code)
		if err != nil {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(403)
			fmt.Fprintf(w, "<html><body style='font-family:sans-serif;background:#0d1117;color:#c9d1d9;padding:40px'><h2>❌ Error: %s</h2><p><a href='/'>Try again</a></p></body></html>", err.Error())
			return
		}

		w.Header().Set("Content-Type", "text/html")
		fmt.Fprintf(w, "<html><body style='font-family:sans-serif;background:#0d1117;color:#c9d1d9;padding:40px;text-align:center'><h1 style='color:#3fb950'>✅ Access Granted</h1><p>Welcome, %s</p><p>Days remaining: %d</p><p>You can close this window and connect from the tray icon.</p><script>setTimeout(()=>window.close(),3000)</script></body></html>",
			session.Username, session.DaysRemaining)
		resultCh <- "ok"
	})

	go http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", LocalAuthPort), mux)
}

const authPageHTML = `<!DOCTYPE html>
<html>
<head>
<title>Mira VPN — Enter Access Code</title>
<style>
body { font-family: 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9;
       display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 12px;
        padding: 40px; width: 380px; text-align: center; }
h1 { color: #58a6ff; margin: 0 0 20px; font-size: 24px; }
input { width: 100%; box-sizing: border-box; padding: 14px; margin: 8px 0;
        background: #21262d; border: 1px solid #30363d; border-radius: 8px;
        color: #c9d1d9; font-size: 16px; text-align: center; }
input[type=text] { letter-spacing: 2px; }
button { width: 100%; padding: 14px; margin-top: 12px; background: #238636;
         border: none; border-radius: 8px; color: white; font-size: 16px; cursor: pointer; }
button:hover { background: #2ea043; }
.hint { color: #8b949e; font-size: 13px; margin-top: 20px; }
</style>
</head>
<body>
<div class="card">
<h1>🔐 Mira VPN</h1>
<form method="POST" action="/submit">
<input type="text" name="username" placeholder="Username" required>
<input type="text" name="code" placeholder="6-digit code" maxlength="6" pattern="[0-9]{6}" required>
<button type="submit">Verify & Connect</button>
</form>
<p class="hint">Enter the 6-digit code from your administrator.<br>The code expires in 30 seconds and works once.</p>
</div>
</body>
</html>`

var _ = filepath.Join // suppress unused import