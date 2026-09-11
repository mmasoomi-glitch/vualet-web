# -*- coding: utf-8 -*-
"""Remove the third-party signup advertisement from the WhatsApp gateway.

BINARY MODE. This file previously had 2,145 line endings silently converted by a
text-mode round trip; never open it as text. Anchors are ASCII-only so the em
dash and emoji in the removed string never have to be matched or retyped.
"""
import hashlib
import io
import os
import shutil

G = r"C:\Ballerina-Motasadea-V1\apps\engine\whatsapp-gateway-v2.mjs"

with io.open(G, "rb") as fh:
    src = fh.read()

before_sha = hashlib.sha256(src).hexdigest()
crlf_before = src.count(b"\r\n")
eol = b"\r\n" if crlf_before else b"\n"

START = b"    if (gate.reason === 'onboarding_required') {"
assert src.count(START) == 1, "start anchor found %d times" % src.count(START)
start = src.index(START)

# The branch ends at the gate's own `return;` and closing brace.
END = eol.join([b"    }", b"    return;", b"  }"]) + eol
tail = src.find(END, start)
assert tail != -1, "could not find the end of the !gate.allowed block"
end = tail + len(END)

REPLACEMENT = eol.join([
    b"    // THIRD PARTIES GET SILENCE, NOT AN ADVERTISEMENT.",
    b"    //",
    b"    // What stood here sent \"Hi! I'm Mira - a private AI assistant. To get",
    b"    // started, sign up at mira.vualet.com and link your WhatsApp\" to every",
    b"    // sender who was not a paired tenant. The customer's own mother, doctor",
    b"    // and employer are not tenants, so every message they sent to this",
    b"    // number received a signup pitch - and there was NO RATE LIMIT on this",
    b"    // branch, so five messages produced five identical pitches into the",
    b"    // customer's personal relationships.",
    b"    //",
    b"    // Jury ruling (kimi-k3, 2026-09-02): remove immediately - \"there is no",
    b"    // version of this worth keeping\". Silence is now the default for anyone",
    b"    // who is not the customer. The away-mode hook ABOVE this gate still",
    b"    // answers when the customer has explicitly switched away mode on, and",
    b"    // it is already rate-limited per contact by auto_answer_window_minutes.",
    b"    return;",
    b"  }",
]) + eol

out = src[:start] + REPLACEMENT + src[end:]

backup = G + ".bak-advert"
if not os.path.exists(backup):
    shutil.copy2(G, backup)

with io.open(G, "wb") as fh:
    fh.write(out)

print("backup        : %s" % backup)
print("before sha256 : %s" % before_sha[:16])
print("after  sha256 : %s" % hashlib.sha256(out).hexdigest()[:16])
print("CRLF before %d, after %d (must match)" % (crlf_before, out.count(b"\r\n")))
print("bytes %d -> %d" % (len(src), len(out)))
print("advertisement string still present: %s" % (b"sign up at mira.vualet.com" in out))
print("confirmCorrelationId redirect call gone: %s" % (b"redirect_${Date.now()}" not in out))
