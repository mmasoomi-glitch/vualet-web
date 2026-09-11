// Linear onboarding progress: Sign up → Choose plan → Payment.
// `current` is 1-based.
const STEPS = ["Sign up", "Choose plan", "Payment"];

export function Stepper({ current }: { current: number }) {
  return (
    <ol
      aria-label="Checkout progress"
      style={{
        listStyle: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 0,
        margin: "0 auto 30px",
        maxWidth: 460,
      }}
    >
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} aria-current={active ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span
                aria-hidden="true"
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  fontSize: 13,
                  fontWeight: 600,
                  color: active || done ? "#fff" : "var(--mira-slate)",
                  background: active || done ? "var(--mira-gradient-presence, var(--mira-grad-presence))" : "var(--mira-fog)",
                }}
              >
                {done ? "✓" : n}
              </span>
              <span
                className="mira-step-label"
                style={{
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--mira-ink)" : "var(--mira-slate)",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
              {/* The tick and the number are decoration; this is the part a
                  screen reader can actually use. Without it the stepper
                  announced as "tick, Sign up, tick, Choose plan, 3, Payment". */}
              <span className="mira-sr-only">
                {done ? "Completed" : active ? "Current step" : "Not started"}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span style={{ width: 24, height: 1, background: "var(--mira-fog)" }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
