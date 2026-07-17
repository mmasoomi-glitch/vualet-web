import Link from "next/link";
import WhatsAppStandin from "./_components/WhatsAppStandin";

/* Design A — "Recall Ledger". Ported faithfully from the approved mock.
   Styling lives in mira-theme.css (scoped .mira-root .mha-*); the layout already
   provides the .mira-root wrapper, brand fonts, sticky MiraNav and MiraBot. */

function Check({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

export default function MiraPage() {
  return (
    <div className="mha-page">
      <main>
        {/* HERO */}
        <section className="mha-hero">
          <img className="mha-hero-orb" src="/brand/motif-orb.png" alt="" aria-hidden width={620} height={620} />
          <div className="mha-wrap mha-hero-grid">
            <div>
              <span className="mha-eyebrow mha-rise mha-d1">Perfect recall · Zero fabrication</span>
              <h1 className="display mha-rise mha-d2">
                She remembers everything.<br />
                <span className="grad">She can&rsquo;t make anything up.</span>
              </h1>
              <p className="mha-lede mha-rise mha-d3">
                Mira is the assistant with photographic memory and zero hallucination &mdash; <b>not less, none.</b> She&rsquo;d sooner tell you &ldquo;I don&rsquo;t know&rdquo; than invent an answer you&rsquo;ll regret trusting.
              </p>
              <div className="mha-cta-row mha-rise mha-d4">
                <Link className="mha-btn mha-btn-primary" href="/mira/signup">Join the waitlist <span className="mha-arw">&rarr;</span></Link>
                <a className="mha-btn mha-btn-ghost" href="#proof">See the difference</a>
              </div>
              <p className="mha-micro mha-rise mha-d4">Opening in waves &middot; <span className="mha-g">no spam, no fabricated hype</span></p>
            </div>

            {/* SIGNATURE: recall ledger */}
            <div className="mha-recall-stage mha-rise mha-d3">
              <div className="mha-float-tag">RECALL &middot; <b>100% verbatim</b></div>
              <div className="mha-recall" role="img" aria-label="Verified recall: three timestamped facts Mira recalled exactly, each marked verified, and one honest 'I don't know' entry marked no-guess.">
                <div className="mha-recall-top">
                  <span className="mha-t">Verified recall</span>
                  <span className="mha-live">Kept exact</span>
                </div>
                <div className="mha-entry">
                  <div className="mha-entry-meta"><span className="mha-idx">#0142</span> · logged 14 Nov 2025, 09:12</div>
                  <div className="mha-q">&ldquo;Remind me what the client&rsquo;s cutoff was.&rdquo;</div>
                  <div className="mha-a">The 3rd &mdash; not the 5th. You corrected it yourself.</div>
                  <span className="mha-stamp mha-ok"><span className="mha-ck"><Check size={13} /></span> Verified verbatim</span>
                </div>
                <div className="mha-entry">
                  <div className="mha-entry-meta"><span className="mha-idx">#0143</span> · logged 02 Feb 2026, 16:40</div>
                  <div className="mha-q">&ldquo;What did I set the budget cap at?&rdquo;</div>
                  <div className="mha-a">AED 42,000 &mdash; you sent it to me on the 2nd.</div>
                  <span className="mha-stamp mha-ok"><span className="mha-ck"><Check size={13} /></span> Verified verbatim</span>
                </div>
                <div className="mha-entry">
                  <div className="mha-entry-meta"><span className="mha-idx">#0144</span> · asked just now</div>
                  <div className="mha-q">&ldquo;What&rsquo;s their new office address?&rdquo;</div>
                  <div className="mha-a">I don&rsquo;t have that. You never told me.</div>
                  <span className="mha-stamp mha-no">No guess &middot; nothing invented</span>
                </div>
                <div className="mha-seal" aria-hidden>
                  <svg viewBox="0 0 132 132">
                    <path id="mha-sc" d="M66,66 m-50,0 a50,50 0 1,1 100,0 a50,50 0 1,1 -100,0" fill="none" />
                    <text fontFamily="'IBM Plex Mono', ui-monospace, monospace" fontSize="8.2" letterSpacing="2.4" fill="#B54A45">
                      <textPath href="#mha-sc" startOffset="0">CERTIFIED · CANNOT FABRICATE · CERTIFIED · CANNOT FABRICATE · </textPath>
                    </text>
                  </svg>
                  <div className="mha-core"><span className="mha-big">Mira</span><span className="mha-sm">no invented facts</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TWO PROMISES */}
        <section className="mha-promises">
          <img className="mha-mesh" src="/brand/texture-mesh.png" alt="" aria-hidden width={1600} height={500} />
          <div className="mha-wrap">
            <div className="mha-sec-head">
              <span className="mha-eyebrow">Two promises, held literally</span>
              <h2 className="display">Most assistants are confident. Mira is <span className="grad">correct.</span></h2>
              <p>Everyone else fights hallucination after the fact &mdash; a filter here, a warning there. Mira&rsquo;s architecture doesn&rsquo;t leave the room for it. Two things follow, and we mean both to the letter.</p>
            </div>
            <div className="mha-two">
              <div className="mha-promise">
                <span className="mha-num">PROMISE 01</span>
                <h3>Photographic memory</h3>
                <p>Everything you tell her stays exactly as you said it. Months later she gives it back word-for-word, with the day you said it &mdash; not a paraphrase, not a vibe.</p>
                <div className="mha-line"></div>
                <span className="mha-foot"><Check size={14} /> Nothing decays, nothing drifts</span>
              </div>
              <div className="mha-promise">
                <span className="mha-num">PROMISE 02</span>
                <h3>Zero hallucination</h3>
                <p>Not tuned down. Not &ldquo;reduced by 40%.&rdquo; None. When she doesn&rsquo;t know, she tells you she doesn&rsquo;t know &mdash; which is the one thing you can&rsquo;t afford to have faked.</p>
                <div className="mha-line"></div>
                <span className="mha-foot"><Check size={14} /> If it isn&rsquo;t known, it isn&rsquo;t said</span>
              </div>
            </div>
          </div>
        </section>

        {/* PROOF */}
        <section className="mha-proof" id="proof">
          <div className="mha-wrap">
            <div className="mha-proof-head">
              <div className="mha-sec-head">
                <span className="mha-eyebrow">The tell is what happens at the edge</span>
                <h2 className="display">Anyone sounds smart until they don&rsquo;t know.</h2>
                <p>Ask a question the assistant has no answer to. That single moment separates a tool you can trust from one you have to double-check.</p>
              </div>
              <img className="mha-proof-fig" src="/brand/hero-memory.png" alt="Mira's memory, illustrated as a calm field of remembered detail" width={336} height={336} />
            </div>
            <div className="mha-versus">
              <div className="mha-card mha-other">
                <span className="mha-lbl">A typical assistant</span>
                <p className="mha-said">&ldquo;Their office is at <s>Level 12, Emaar Square, Downtown Dubai</s>.&rdquo;</p>
                <div className="mha-verdict">&rarr; Plausible. Confident. Completely made up.</div>
              </div>
              <div className="mha-card mha-mira">
                <span className="mha-lbl">Mira</span>
                <p className="mha-said">&ldquo;I don&rsquo;t have their address &mdash; you&rsquo;ve never given it to me. Send it once and I&rsquo;ll keep it exactly.&rdquo;</p>
                <div className="mha-verdict"><Check size={14} /> True, and it stays true.</div>
              </div>
            </div>
          </div>
        </section>

        {/* PRIVATE LINE + STAND-IN */}
        <WhatsAppStandin />

        {/* FULL-WIDTH BRAND BAND */}
        <section className="mha-band" aria-hidden>
          <img src="/brand/banner-wide.png" alt="" width={1600} height={300} />
          <div className="mha-band-cap"><span>Photographic memory &middot; zero hallucination &middot; held to the letter</span></div>
        </section>

        {/* QUIET CAPABILITIES */}
        <section className="mha-quiet" id="more">
          <div className="mha-wrap">
            <span className="mha-eyebrow">And, more quietly</span>
            <div className="mha-three">
              <div className="mha-qitem">
                <img className="mha-qthumb" src="/brand/card-voice.png" alt="" aria-hidden width={600} height={400} />
                <h4>Voice notes, where you already are</h4>
                <p>Talk to her on WhatsApp or Telegram. Ramble a voice note; she keeps every word of it exact.</p>
              </div>
              <div className="mha-qitem">
                <img className="mha-qthumb" src="/brand/card-memory.png" alt="" aria-hidden width={600} height={400} />
                <h4>A knowledge base you load</h4>
                <p>Hand her your documents and notes. She holds them verbatim and never quietly rewrites what you gave her.</p>
              </div>
              <div className="mha-qitem">
                <img className="mha-qthumb" src="/brand/proof-precision.png" alt="" aria-hidden width={600} height={400} />
                <h4>She builds small things<span className="mha-beta">Beta</span></h4>
                <p>Ask for a quick tool or a small automation and she&rsquo;ll put it together. Early, honest about its limits.</p>
              </div>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="mha-final">
          <div className="mha-wrap">
            <div className="mha-final-inner">
              <h2>Remembers everything.<br />Invents nothing.</h2>
              <p>Get early access to the assistant you don&rsquo;t have to fact-check. We open the waitlist in waves.</p>
              <Link className="mha-btn mha-btn-onlight" href="/mira/signup">Join the waitlist &rarr;</Link>
              <p className="mha-microlight">One email. No fabricated urgency.</p>
            </div>
          </div>
        </section>
      </main>

      {/* INVESTOR */}
      <section className="mha-investor">
        <div className="mha-wrap">
          <span className="mha-eyebrow">Backing</span>
          <h3>Backed by Satellite Electronic Trading</h3>
          <p>A Dubai technology company backing Mira to build AI that would rather say &ldquo;I don&rsquo;t know&rdquo; than guess.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mha-footer">
        <div className="mha-wrap">
          <div className="mha-foot-row">
            <Link className="mha-foot-brand" href="/mira" aria-label="Mira home">Mira</Link>
            <nav className="mha-foot-links" aria-label="Footer">
              <a href="#proof">The difference</a>
              <a href="#more">What she does</a>
              <Link href="/mira/signup">Waitlist</Link>
              <Link href="/legal/privacy">Privacy</Link>
            </nav>
          </div>
          <p className="mha-foot-legal">Mira by Primaion. Photographic memory, zero hallucination &mdash; claims we hold ourselves to.</p>
        </div>
      </footer>
    </div>
  );
}
