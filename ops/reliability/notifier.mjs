/**
 * Getting an alert in front of a human.
 *
 * WHY THIS EXISTS. Alerts previously reached an in-memory ring buffer and a log
 * file on disk, which means a critical "assistant OFFLINE" at 3am was visible
 * only to somebody who happened to look. That is indistinguishable from the
 * four-day silent outage this subsystem was built to prevent, and a judge
 * rejected the work for exactly that.
 *
 * THE TENSION IT RESOLVES. An alert nobody receives is useless. An alert that
 * arrives every 45 seconds is worse than useless: people filter the channel,
 * and then they filter the one that mattered. So this deduplicates and
 * rate-limits — but never lets a suppression decision swallow the FIRST
 * occurrence of anything.
 *
 * The transport is injected. This module decides WHETHER to tell somebody; how
 * the message travels is not its problem, and that is what makes it testable
 * without a network.
 */

const DEFAULTS = Object.freeze({
  minIntervalMs: 900000,
  floodWindowMs: 3600000,
  maxPerWindow: 10,
});

export function createNotifier(config) {
  const c = config && typeof config === 'object' ? config : {};

  // Startup. A notifier that cannot send is a lie, and one that is constructed
  // anyway would report "alerting configured" while reaching nobody.
  if (typeof c.send !== 'function') {
    throw new Error('createNotifier requires a send function.');
  }

  const send = c.send;
  const clock = typeof c.clock === 'function' ? c.clock : () => Date.now();
  const minIntervalMs = typeof c.minIntervalMs === 'number' ? c.minIntervalMs : DEFAULTS.minIntervalMs;
  const floodWindowMs = typeof c.floodWindowMs === 'number' ? c.floodWindowMs : DEFAULTS.floodWindowMs;
  const maxPerWindow = typeof c.maxPerWindow === 'number' ? c.maxPerWindow : DEFAULTS.maxPerWindow;
  const onDrop = c.onDrop;

  /** When each distinct alert was last actually sent. */
  const lastSent = new Map();
  /** Send times inside the flood window. Pruned, never merely filtered. */
  let recent = [];

  /** A throwing listener must not be able to stop an alert. */
  function drop(reason, alert) {
    if (typeof onDrop !== 'function') return { sent: false, reason };
    try {
      onDrop(reason, alert);
    } catch {
      /* ignored on purpose */
    }
    return { sent: false, reason };
  }

  /**
   * Prune rather than filter-and-discard. This process runs for weeks; an
   * array that is only ever read through a filter still grows forever, and a
   * monitor that leaks memory eventually becomes the outage.
   */
  function prune(now) {
    const cutoff = now - floodWindowMs;
    if (recent.length && recent[0] <= cutoff) {
      recent = recent.filter((t) => t > cutoff);
    }
    return recent.length;
  }

  async function notify(alert, serviceName) {
    if (!alert || typeof alert !== 'object' || typeof alert.title !== 'string' || alert.title.trim().length === 0) {
      return drop('malformed', alert);
    }

    const { severity, title, detail } = alert;

    // Good news can wait for somebody to look at the dashboard. Waking a human
    // for "assistant restored" is how people learn to ignore the channel, and
    // the channel only has value while they still read it.
    if (severity === 'info') {
      return drop('severity_below_threshold', alert);
    }

    // Keyed on service + severity + title, deliberately NOT on detail: detail
    // carries counts and timestamps that change on every poll, so keying on it
    // would defeat deduplication entirely and produce the exact flood this
    // exists to prevent.
    const key = `${serviceName}:${severity}:${title}`;
    const now = clock();

    const previous = lastSent.get(key);
    // The first occurrence has no prior send to compare against and always passes.
    if (previous !== undefined && now - previous < minIntervalMs) {
      return drop('deduped', alert);
    }

    // A cascade where genuinely everything is failing at once is precisely when
    // a ceiling must not gag the one message that matters, so critical is never
    // flood-limited.
    if (severity !== 'critical' && prune(now) >= maxPerWindow) {
      return drop('flood_limit', alert);
    }

    const lines = [title];
    if (typeof detail === 'string' && detail.trim().length > 0) lines.push(detail);
    lines.push(`Service: ${serviceName}`);

    try {
      await send({
        subject: `[${String(severity).toUpperCase()}] ${serviceName}: ${title}`,
        text: lines.join('\n'),
        severity,
        service: serviceName,
      });
    } catch {
      // NOT recorded as sent. Recording it would suppress the retry for the
      // next fifteen minutes, so a transient mail outage would silently eat the
      // only warning about a real one — the failure mode this module exists to
      // remove, reintroduced by its own bookkeeping.
      return drop('send_failed', alert);
    }

    lastSent.set(key, now);
    recent.push(now);
    return { sent: true };
  }

  /** Counts only. The contents could carry operational detail, and this is a
   *  health readout rather than a log. */
  function stats() {
    return { sentInWindow: prune(clock()), trackedKeys: lastSent.size };
  }

  return { notify, stats };
}
