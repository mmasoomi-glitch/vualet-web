/* Private WhatsApp self-chat + stand-in marketing section.
   Two things it sells: (1) she's a private line inside your OWN WhatsApp
   (a "message yourself" thread, every bubble on the right); (2) she can
   stand in for you. Honest by construction: the stand-in scenario is
   visibly badged "Example", and the stats are capability figures, not
   usage/customer counts. Pure CSS phone (no image). Server component —
   no client hooks, safe to import into the server page. Styling lives in
   mira-theme.css under .mira-root .msa-*. */

/* Read receipt — WhatsApp-style double tick, coloured "read" (aether). */
function Ticks() {
  return (
    <svg className="msa-ticks" width="15" height="10" viewBox="0 0 17 11" fill="none" aria-hidden>
      <path d="M1 6.2 4 9.4 10.5 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 6.2 9.5 9.4 16 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tick({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

/* Voice-note waveform — static bars, heights chosen to look spoken, not generated. */
const WAVE = [5, 9, 14, 7, 11, 16, 8, 6, 12, 15, 9, 5, 10, 13, 7, 11, 6, 4];

export default function WhatsAppStandin() {
  return (
    <section className="msa" id="private" aria-labelledby="msa-h">
      <div className="mha-wrap">
        <span className="mha-eyebrow">Yours alone</span>
        <h2 id="msa-h" className="display msa-h2">
          Private by nature. <span className="grad">A stand-in when you need one.</span>
        </h2>
        <p className="msa-sub">
          No new app, no group thread, no third party listening in &mdash; just a private line to Mira, who can also answer in your voice when you can&rsquo;t.
        </p>

        {/* ---- A. Private self-chat: phone + copy ---- */}
        <div className="msa-privacy">
          {/* CSS phone — a "message yourself" thread; every bubble on the right */}
          <div className="msa-phone" role="img" aria-label="A private WhatsApp self-chat: the user's own message-yourself thread with Mira. A voice note, a question about a client promise, and Mira's exact recall — every message on the sender's side.">
            <span className="msa-notch" aria-hidden></span>
            <div className="msa-screen">
              <div className="msa-bar">
                <span className="msa-back" aria-hidden>&#8249;</span>
                <span className="msa-av" aria-hidden>Y</span>
                <span className="msa-id">
                  <span className="n">You <span className="msa-self">(you)</span></span>
                  <span className="s">Message yourself &middot; +971 5&bull;&bull; &bull;&bull;&bull;14</span>
                </span>
                <span className="msa-dots" aria-hidden>&#8942;</span>
              </div>
              <div className="msa-thread">
                <span className="msa-day" aria-hidden>Today</span>
                <span className="msa-locknote" aria-hidden>
                  <span className="msa-lock">&#128274;</span> A private line &mdash; just you and Mira
                </span>

                {/* user: voice note */}
                <div className="msa-b you">
                  <div className="msa-voice">
                    <span className="msa-play" aria-hidden>&#9654;</span>
                    <span className="msa-wave" aria-hidden>
                      {WAVE.map((h, i) => (
                        <i key={i} style={{ height: `${h}px` }} />
                      ))}
                    </span>
                    <span className="msa-vtime">0:14</span>
                  </div>
                  <div className="msa-meta">
                    <span aria-hidden>&#127908;</span> 09:07 <Ticks />
                  </div>
                </div>

                {/* user: text */}
                <div className="msa-b you">
                  Remind me what I promised the client.
                  <div className="msa-meta">09:07 <Ticks /></div>
                </div>

                {/* Mira: reply — still on the right, tagged so it reads as hers */}
                <div className="msa-reply">
                  <span className="msa-tag">Mira</span>
                  <div className="msa-b mira">
                    The revised quote by Thursday &mdash; AED 42,000, locked. You sent me that note on Tuesday.
                    <div className="msa-meta">09:07 <Ticks /></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* copy beside the phone */}
          <div className="msa-copy">
            <h3 className="display msa-h3">She lives in your chat. Just yours.</h3>
            <ul className="msa-list">
              <li><span className="msa-ck"><Tick /></span> No new app &mdash; she&rsquo;s in the chat you already use. Telegram today, WhatsApp soon.</li>
              <li><span className="msa-ck"><Tick /></span> No third party in the thread. It&rsquo;s a private line to her.</li>
              <li><span className="msa-ck"><Tick /></span> She reads only what you send her &mdash; never listens to anything else.</li>
            </ul>
          </div>
        </div>

        {/* ---- B. Stand-in capability (framed as "she can", with a badged Example) ---- */}
        <div className="msa-standin">
          <div className="msa-cap">
            <span className="msa-num">She can be you</span>
            <h3 className="display msa-h3">Cover, in your own voice.</h3>
            <p>
              She learns how you write and how you speak, then answers as you &mdash; in text or as a voice note &mdash; so nothing stalls while you&rsquo;re away. You decide when she stands in.
            </p>
            <span className="msa-capfoot"><Tick size={14} /> A capability you switch on, not an autopilot you lose sight of</span>
          </div>

          <figure className="msa-eg">
            <figcaption className="msa-eg-badge">Example</figcaption>
            <p className="msa-eg-body">
              An accountant is on holiday. Her clients still message &mdash; and still get answered, in her wording, on her hours off. Anything that genuinely needs her is flagged and set aside for when she&rsquo;s back.
            </p>
            <p className="msa-eg-note">Illustrative scenario &mdash; not a customer account.</p>
          </figure>
        </div>

        {/* ---- C. Honest capability stats (true by design, no usage/customer counts) ---- */}
        <div className="msa-stats">
          <div className="msa-stat">
            <span className="msa-fig mha-serif">1,000,000</span>
            <span className="msa-lab">free tokens, every month</span>
          </div>
          <div className="msa-stat">
            <span className="msa-fig mha-serif">0</span>
            <span className="msa-lab">invented facts, ever</span>
          </div>
          <div className="msa-stat">
            <span className="msa-fig mha-serif">Voice</span>
            <span className="msa-lab">in many languages</span>
          </div>
          <div className="msa-stat">
            <span className="msa-fig mha-serif">Everything</span>
            <span className="msa-lab">she remembers, kept exact</span>
          </div>
        </div>
      </div>
    </section>
  );
}
