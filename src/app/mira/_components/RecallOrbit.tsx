"use client";

// Signature "thinking" animation (jury verdict #49 — Recall Orbit).
// Memory-points orbit inward and shimmer as she consults what she already knows,
// then resolve — encoding grounding-before-answering (she checks, she doesn't guess).
// Pure CSS, 60fps, scales from a 28px chat indicator to a hero moment.
// Respects prefers-reduced-motion (falls back to a calm static ring).

const DOTS = 6;

export default function RecallOrbit({
  size = 30,
  label = "Recalling",
}: {
  size?: number;
  label?: string;
}) {
  const r = size * 0.36; // orbit radius
  const dot = Math.max(2.5, size * 0.11);
  const uid = `ro${size}`;

  return (
    <span
      role="status"
      aria-label={label}
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span className={`${uid}-spin`} style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: DOTS }).map((_, i) => {
          const a = (i / DOTS) * Math.PI * 2;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          // alternate the two brand accents
          const c = i % 2 === 0 ? "var(--mira-rose, #B54A45)" : "var(--mira-aether, #3538A8)";
          return (
            <span
              key={i}
              className={`${uid}-dot`}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: dot,
                height: dot,
                marginLeft: -dot / 2,
                marginTop: -dot / 2,
                borderRadius: "50%",
                background: c,
                transform: `translate(${x}px, ${y}px)`,
                animationDelay: `${(i / DOTS) * -1.4}s`,
              }}
            />
          );
        })}
      </span>
      {/* grounded core — the answer she's resolving to */}
      <span
        className={`${uid}-core`}
        style={{
          width: Math.max(3, size * 0.14),
          height: Math.max(3, size * 0.14),
          borderRadius: "50%",
          background: "var(--mira-ink, #2A1F2D)",
        }}
      />

      <style>{`
        @keyframes ${uid}-spin { to { transform: rotate(360deg); } }
        @keyframes ${uid}-pulse {
          0%,100% { opacity: .35; transform: translate(var(--tx,0),var(--ty,0)) scale(.7); }
          50%     { opacity: 1;   transform: translate(var(--tx,0),var(--ty,0)) scale(1.05); }
        }
        @keyframes ${uid}-core {
          0%,100% { opacity: .55; transform: scale(.85); }
          50%     { opacity: 1;   transform: scale(1.15); }
        }
        .${uid}-spin { animation: ${uid}-spin 3.2s linear infinite; }
        .${uid}-dot  { animation: ${uid}-pulse 1.4s ease-in-out infinite; }
        .${uid}-core { animation: ${uid}-core 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .${uid}-spin, .${uid}-dot, .${uid}-core { animation: none; }
          .${uid}-dot { opacity: .6; }
        }
      `}</style>
    </span>
  );
}
