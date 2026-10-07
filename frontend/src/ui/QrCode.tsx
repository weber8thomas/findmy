import { useMemo } from "react";
import { encode } from "uqr";

/** A QR code drawn as one SVG path (no canvas, no inline HTML: fine with the CSP). */
export function QrCode({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: "L", border: 0 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: qr.size, path: d };
  }, [value]);
  const quiet = 4; // white margin the scanners need, in modules
  return (
    <svg
      className="qr"
      viewBox={`${-quiet} ${-quiet} ${size + 2 * quiet} ${size + 2 * quiet}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-testid={testId}
    >
      <rect x={-quiet} y={-quiet} width={size + 2 * quiet} height={size + 2 * quiet} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
