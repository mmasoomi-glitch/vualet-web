# COPY AUDIT — 2026-09-07

**Test:** Section 2 of the Terms commits that Mira is *designed* not to fabricate — a design intent, not a guarantee. Any published sentence asserting as **fact** something the Terms only commit to as **intent** is a finding. "Designed to X" is honest. "Never does X" needs evidence. "0 invented facts, ever" is a claim.

**Pages examined:** `src/app/legal/terms/page.tsx`, `src/app/mira/page.tsx`, `src/app/mira/live/page.tsx`, `src/app/mira/plans/page.tsx`, `src/app/mira/_components/WhatsAppStandin.tsx`, `src/app/page.tsx`

**Excluded (already investigated and disapproved):** encryption-at-rest sentence, VPN preview claims, grounding-check-as-fact framing.

**Total findings: 4**

---

## Finding 1

- **File:** `src/app/mira/page.tsx`, line 146
- **Sentence:** `"Photographic memory · zero hallucination · held to the letter"`
- **Why it overclaims:** "Zero hallucination" asserts a factual outcome — that Mira never hallucinates — where the Terms only commit to a design standard (she's *designed* not to fabricate). A design commitment is a process guarantee; "zero hallucination" is a results guarantee. A customer reading this could reasonably rely on it as an absolute performance claim and be wrong if an edge case slips through.
- **Replacement:** `"Photographic memory · built not to hallucinate · held to the letter"`
- **Severity:** **HIGH** — "zero" is an absolute number that a customer could rely on and be misled by.

---

## Finding 2

- **File:** `src/app/mira/page.tsx`, line 76 (inside SVG textPath)
- **Sentence:** `"CERTIFIED · CANNOT FABRICATE · CERTIFIED · CANNOT FABRICATE · "`
- **Why it overclaims:** "Cannot fabricate" states an absolute capability as fact — as if Mira is physically incapable of producing an invented answer. The Terms commit to a *design standard* (she is designed not to fabricate), not physical impossibility. "Certified" compounds the claim by implying third-party verification or a formal guarantee. This reads as a product specification, not a design intent.
- **Replacement:** `"DESIGNED · NOT TO FABRICATE · DESIGNED · NOT TO FABRICATE · "`
- **Severity:** **HIGH** — "cannot" is an absolute capability claim with no evidence base. The Terms say nothing about certification or physical impossibility.

---

## Finding 3

- **File:** `src/app/mira/page.tsx`, line 79
- **Sentence:** `"no invented facts"`
- **Why it overclaims:** This is a label under the Mira seal. Like Finding 2, it asserts the outcome (no facts are ever invented) rather than the process (she is designed not to invent). It appears alongside the "CERTIFIED" text, reinforcing the read-as-fact reading.
- **Replacement:** `"designed not to invent"`
- **Severity:** **MEDIUM** — short label, but still an absolute outcome claim presented as a feature spec rather than a design commitment.

---

## Finding 4

- **File:** `src/app/mira/page.tsx`, line 92
- **Sentence:** `"Most assistants are confident. Mira is correct."`
- **Why it overclaims:** "Mira is correct" is presented as a comparative factual claim about Mira's output quality — an absolute that the Terms do not support. Section 2 commits to a *design* to not fabricate; Section 3 explicitly says correctness depends on user inputs. Claiming Mira *is* correct implies a guarantee of correctness that Section 3 of the Terms directly disclaims.
- **Replacement:** `"Most assistants are confident. Mira is grounded."`
- **Severity:** **HIGH** — this is a direct factual assertion of output quality ("correct") that a customer could rely on. The Terms' Section 3 says correctness is not guaranteed.

---

## Compliance assessment

None of the four findings rise to the level of a legal/compliance problem rather than tone or taste. "Zero hallucination," "cannot fabricate," "no invented facts," and "Mira is correct" are all marketing hyperbole — they read as aspirational product claims, not as contractual guarantees. The Terms themselves contain an "as is" / no-warranty clause (Section 6) that would shield against reasonable reliance on any of these phrases, and the surrounding copy on each page (the grounding-check description, the honest "I don't know" framing, the future-tense honesty on /mira/live) provides context that a reasonable reader would understand as aspirational positioning. That said, Finding 1 and Finding 2 ("zero hallucination" and "cannot fabricate") sit closest to the line — they are the two absolute-number claims, and if Mira is ever held to a regulatory standard that treats "zero" or "cannot" as a warranty, they'd need to go first. The rest ("no invented facts" label, "Mira is correct") are comfortably in marketing-speak territory.
