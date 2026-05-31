type LogoProps = {
  glyph?: string;
  size?: number;
  className?: string;
  title?: string;
};

export function Logo({
  glyph = "V",
  size = 32,
  className,
  title = "Vualet",
}: LogoProps) {
  const radius = size * 0.28;
  const fontSize = size * 0.58;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={title}
    >
      <rect
        x={0}
        y={0}
        width={size}
        height={size}
        rx={radius}
        ry={radius}
        fill="var(--color-vualet-indigo)"
      />
      <text
        x="50%"
        y="54%"
        dominantBaseline="middle"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight={700}
        fontSize={fontSize}
        fill="#FFFFFF"
      >
        {glyph}
      </text>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`font-display text-xl font-semibold tracking-tight ${className ?? ""}`}
      style={{ fontFamily: "var(--font-display)" }}
    >
      Vualet
    </span>
  );
}
