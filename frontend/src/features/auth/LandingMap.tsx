import type { CSSProperties, ReactNode } from "react";
import type { DeviceIcon } from "../../api/types";
import { useI18n } from "../../i18n";
import { deviceGlyphSvg, iconSvg } from "../../ui/icons";

/*
 * The landing's illustration: a small imaginary town drawn like the app's basemap, with the
 * same white device pins, a person, a place with its dashed circle, and (on wide screens) what
 * Oukilé does, written next to the pin that shows it.
 *
 * The SVG and the pins share one stage with a fixed 16:10 ratio, so percentages line up.
 */

// City blocks between streets, filled with a few buildings each (seeded, so always the same).
const COLS = [-40, 110, 260, 410, 560, 710, 860, 1010, 1160, 1310, 1460, 1610];
const ROWS = [-60, 80, 220, 360, 500, 640, 780, 920, 1060];

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const BUILDINGS: string = (() => {
  const rnd = seeded(7);
  let d = "";
  for (let i = 0; i < COLS.length - 1; i++) {
    for (let j = 0; j < ROWS.length - 1; j++) {
      const x0 = COLS[i] + 14;
      const y0 = ROWS[j] + 14;
      const w = COLS[i + 1] - COLS[i] - 28;
      const h = ROWS[j + 1] - ROWS[j] - 28;
      // Two rows of two to three buildings along the streets, leaving a courtyard.
      for (const top of [true, false]) {
        let x = x0;
        while (x < x0 + w - 24) {
          const bw = Math.min(x0 + w - x, 26 + rnd() * 34);
          const bh = 30 + rnd() * 18;
          const y = top ? y0 : y0 + h - bh;
          if (rnd() > 0.18) d += `M${x.toFixed(0)} ${y.toFixed(0)}h${(bw - 4).toFixed(0)}v${bh.toFixed(0)}h-${(bw - 4).toFixed(0)}z`;
          x += bw;
        }
      }
    }
  }
  return d;
})();

const STREETS =
  COLS.map((x) => `M${x} -200V1200`).join("") + ROWS.map((y) => `M-200 ${y}H1800`).join("");

function MapArt() {
  return (
    <svg className="lm-svg" viewBox="0 0 1600 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect className="lm-land" width="1600" height="1000" />
      <g transform="rotate(-9 800 500)">
        <path className="lm-building" d={BUILDINGS} />
      </g>
      <path
        className="lm-park"
        d="M170 640c80-55 250-50 330 15s70 205-60 245-290-10-305-110 0-105 35-150zM1235 70c90-40 225-25 250 60s-40 140-135 135-150-60-140-115 10-65 25-80zM1035 770l150-24 14 92-150 24z"
      />
      <ellipse className="lm-water" cx="330" cy="770" rx="78" ry="40" transform="rotate(-12 330 770)" />
      <path className="lm-river" d="M960 1060C1080 930 1240 905 1390 868S1580 770 1680 712" />
      <g transform="rotate(-9 800 500)">
        <path className="lm-street-case" d={STREETS} />
        <path className="lm-street" d={STREETS} />
      </g>
      <path className="lm-major-case" d="M-40 470C420 430 900 470 1640 330M700-40C760 300 900 640 1010 1040" />
      <path className="lm-major" d="M-40 470C420 430 900 470 1640 330M700-40C760 300 900 640 1010 1040" />
      {/* Where the person walked from: the history trail. */}
      <path className="lm-trail" d="M600 850C690 828 752 806 795 772S868 724 912 720" />
    </svg>
  );
}

type Side = "top" | "right" | "bottom" | "left";

function Spot({
  x,
  y,
  delay,
  side,
  callout,
  zone = false,
  children,
}: {
  x: number;
  y: number;
  delay: number;
  side?: Side;
  callout?: { title: string; body: string };
  /** A place: a dashed circle, with the callout outside it. */
  zone?: boolean;
  children: ReactNode;
}) {
  const style = { "--x": `${x}%`, "--y": `${y}%`, "--d": `${delay}ms` } as CSSProperties;
  return (
    <div className={`lm-spot${zone ? " lm-zone" : ""}`} style={style}>
      {children}
      {callout && (
        <div className={`lm-callout lm-callout-${side ?? "right"}`}>
          <strong>{callout.title}</strong>
          <span>{callout.body}</span>
        </div>
      )}
    </div>
  );
}

function DevicePin({ icon, online = false, className = "" }: { icon: DeviceIcon; online?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`lm-pin lm-pin-device${online ? " is-online" : ""} ${className}`}
      dangerouslySetInnerHTML={{ __html: deviceGlyphSvg(icon, 30) }}
    />
  );
}

export function LandingMap() {
  const { t } = useI18n();
  return (
    <div className="landing-map">
      <div className="lm-stage">
        <MapArt />

        <Spot x={77} y={68} delay={520} side="bottom" callout={{ title: t("me.zones"), body: t("landing.places.body") }} zone>
          <span className="lm-zone-label" aria-hidden="true">
            {t("landing.home")}
          </span>
        </Spot>
        <Spot x={74.5} y={63} delay={600}>
          <DevicePin icon="tag" />
        </Spot>

        <Spot x={55.5} y={19} delay={120}>
          <DevicePin icon="laptop" online />
        </Spot>
        <Spot
          x={63}
          y={30}
          delay={220}
          side="right"
          callout={{ title: t("landing.devices.title"), body: t("landing.devices.body") }}
        >
          <DevicePin icon="watch" online />
        </Spot>

        <Spot x={86} y={39} delay={340} side="bottom" callout={{ title: t("actions.playSound"), body: t("landing.sound.body") }}>
          <span className="lm-waves" aria-hidden="true">
            <svg viewBox="0 0 120 60" width="120" height="60">
              <path d="M30 18a18 18 0 000 24M20 10a30 30 0 000 40M90 18a18 18 0 010 24M100 10a30 30 0 010 40" />
            </svg>
          </span>
          <DevicePin icon="phone" online />
        </Spot>

        <Spot x={57} y={72} delay={440} side="top" callout={{ title: t("landing.people.title"), body: t("landing.people.body") }}>
          <span className="lm-ping" aria-hidden="true" />
          <span className="lm-pin lm-pin-person" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg("person", 22) }} />
        </Spot>
      </div>
    </div>
  );
}
