import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "/mira/live" },
  title: "Mira Live Voice — in preparation",
  description:
    "Live, interruptible voice conversation with Mira is not available yet. What works today is voice notes in WhatsApp: send one, she hears it and replies.",
};

/**
 * /mira/live — a page about something that does not exist yet.
 *
 * EVERY CLAIM HERE IS IN THE FUTURE TENSE ON PURPOSE, and there is not a single
 * number on the page. A judge ruled on this route specifically: a figure on a
 * page a paying customer reads has to be measured in production or be a
 * commitment the business has signed, and "target" or "illustrative" does not
 * make an unmeasured number honest. The first draft carried a metrics strip
 * ("under 180ms end-to-end", "99.7% uptime target", "infinite memory recall")
 * and a simulated console the visitor could type into. None of it was measured
 * and none of it shipped.
 *
 * THE CTA IS NOT A WAITLIST, and must not be labelled as one. There is no Live
 * Voice waitlist: /mira/start is the real WhatsApp onboarding wizard, and
 * /signup is the Vualet corporate private-alpha list for a different product,
 * which even tells Mira visitors to go elsewhere. So the button says what it
 * actually does — it sets Mira up on WhatsApp today.
 */
export default function MiraLiveVoicePage() {
  return (
    <div className="mha-page">
      <main id="mira-main">
        {/* HERO */}
        <section className="mha-hero">
          <img className="mha-hero-orb" src="/brand/motif-orb.jpg" alt="" aria-hidden width={620} height={620} fetchPriority="high" />
          <div className="mha-wrap mha-hero-grid">
            <div>
              <span className="mha-eyebrow mha-rise mha-d1">In preparation &middot; not available yet</span>
              <h1 className="display mha-rise mha-d2">
                One day she will<br />
                <span className="grad">talk back in real time.</span>
              </h1>
              <p className="mha-lede mha-rise mha-d3">
                <b>Live voice is not something you can use today.</b> We are building it: a conversation
                you can interrupt, where she keeps listening while she is still speaking. What already
                works is quieter and real &mdash; send Mira a voice note in WhatsApp and she answers it.
              </p>
              <div className="mha-cta-row mha-rise mha-d4">
                <Link className="mha-btn mha-btn-primary" href="/mira/start">
                  Set her up on WhatsApp <span className="mha-arw">&rarr;</span>
                </Link>
                <Link className="mha-btn mha-btn-ghost" href="/mira">
                  What she does today
                </Link>
              </div>
              <p className="mha-micro mha-rise mha-d4">
                This sets up Mira on WhatsApp, where voice notes work now &middot;{" "}
                <span className="mha-g">free plan, no card</span>
              </p>
            </div>

            {/* WHERE VOICE ACTUALLY STANDS */}
            <div className="mha-rise mha-d3">
              <div className="mha-recall">
                <div className="mha-recall-top">
                  <span className="mha-t">Voice, honestly</span>
                  <span className="mha-live" style={{ color: "var(--mira-rose-ink)" }}>
                    Two different things
                  </span>
                </div>
                <div className="mha-entry">
                  <div className="mha-entry-meta">
                    <span className="mha-idx"># Now</span> &middot; voice notes
                  </div>
                  <div className="mha-q">
                    You record a voice note in WhatsApp and send it. She hears it, understands it, and
                    replies &mdash; in writing, or in a voice note of her own. You take turns, the way
                    WhatsApp works.
                  </div>
                  <span className="mha-stamp mha-ok">Working today</span>
                </div>
                <div className="mha-entry">
                  <div className="mha-entry-meta">
                    <span className="mha-idx"># Next</span> &middot; live voice
                  </div>
                  <div className="mha-q">
                    An open line instead of turns: you speak, she speaks, and either of you can cut in.
                    This is the part that does not exist yet.
                  </div>
                  <span className="mha-stamp mha-no" style={{ borderColor: "var(--mira-rose)" }}>
                    Being built &middot; no date
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* WHAT WE ARE AIMING AT */}
        <section className="mha-promises">
          <img className="mha-mesh" src="/brand/texture-mesh.jpg" alt="" aria-hidden width={1600} height={500} />
          <div className="mha-wrap">
            <div className="mha-sec-head">
              <span className="mha-eyebrow">What we are aiming at</span>
              <h2 className="display">
                Not a faster voice note.<br />
                <span className="grad">An actual conversation.</span>
              </h2>
              <p>
                These are intentions, not features you can buy. We would rather write them down and be
                held to them than describe them as though they had already shipped.
              </p>
            </div>
            <div className="mha-two">
              <div className="mha-promise">
                <span className="mha-num">INTENTION 01</span>
                <h3>She listens while she speaks</h3>
                <p>
                  Turn-taking is what makes talking to an assistant feel like operating a machine. The
                  aim is that you can cut in halfway through her sentence, change your mind, or correct
                  a name, and she simply follows &mdash; without a wake word and without waiting for a
                  beep.
                </p>
                <div className="mha-line" />
                <span className="mha-foot">Designed in from the start, not bolted on later</span>
              </div>
              <div className="mha-promise">
                <span className="mha-num">INTENTION 02</span>
                <h3>Fast enough to stop noticing it</h3>
                <p>
                  Speed is the hard part of real-time voice, and it is the part we are least willing to
                  put a number on before it is running. When there is a figure worth quoting it will be
                  one we measured, not one we hoped for.
                </p>
                <div className="mha-line" />
                <span className="mha-foot">No published figure until there is a real one</span>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mha-final">
          <div className="mha-wrap">
            <div className="mha-final-inner">
              <h2>Live voice isn&rsquo;t ready. She is.</h2>
              <p>
                Set Mira up on WhatsApp now and you will already be there when live voice arrives &mdash;
                with everything you have told her in the meantime still in place.
              </p>
              <Link className="mha-btn mha-btn-onlight" href="/mira/start">
                Set her up on WhatsApp &rarr;
              </Link>
              <p className="mha-microlight">
                This is the normal Mira setup, not a signup for live voice. No card.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="mha-footer">
        <div className="mha-wrap">
          <div className="mha-foot-row">
            <Link className="mha-foot-brand" href="/mira" aria-label="Mira home">
              Mira
            </Link>
            <nav className="mha-foot-links" aria-label="Footer">
              <Link href="/mira">Home</Link>
              <Link href="/mira/plans">Plans</Link>
              <Link href="/legal/privacy">Privacy</Link>
            </nav>
          </div>
          <p className="mha-foot-legal">
            Mira, a Veridian product &mdash; from Vualet Trading (a sole proprietorship). Live voice is
            in preparation and is not part of any plan you can buy today.
          </p>
        </div>
      </footer>
    </div>
  );
}
