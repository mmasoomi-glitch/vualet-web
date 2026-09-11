// Mira Help — service worker.
//
// This extension holds no page access, injects no content script, reads no tab,
// and talks to exactly one origin: https://mira.vualet.com
//
// Manifest V3 service workers are EPHEMERAL — Chrome terminates them when idle
// and restarts them on demand. So there is no module-scope mutable state here,
// nothing that assumes the worker stays alive, and no attempt to keep it alive.
// The next person to touch this file will be tempted to add a keepalive; don't.
//
// Its entire job: make clicking the toolbar icon open the side panel.

if (typeof chrome !== "undefined" && chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    // Logged rather than swallowed. A silent catch here means the icon quietly
    // stops opening the panel and nothing anywhere says why.
    .catch((err) => console.error("[Mira Help] setPanelBehavior failed:", err));
}
