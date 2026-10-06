import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import type { Battery } from "../api/types";
import { useI18n } from "../i18n";
import { Icon, type IconName } from "./icons";

export function PanelHeader({ title, back, right }: { title: ReactNode; back?: string; right?: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <header className="panel-header">
      {back && (
        <button className="btn-icon" onClick={() => navigate(back)} aria-label={t("common.back")} data-testid="back">
          ‹
        </button>
      )}
      <h2>{title}</h2>
      <div className="panel-header-right">{right}</div>
    </header>
  );
}

export function Section({ title, children, testId }: { title?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="section" data-testid={testId}>
      {title && <h3 className="section-title">{title}</h3>}
      <div className="card">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function BatteryBadge({ battery }: { battery: Battery | null }) {
  const { t } = useI18n();
  if (!battery || battery.level == null) return null;
  const pct = Math.round(battery.level * 100);
  const low = pct <= 20;
  return (
    <span className={`battery${low ? " low" : ""}`} title={t("devices.battery", { percent: pct })}>
      <span className="battery-body">
        <span className="battery-fill" style={{ width: `${Math.max(6, pct)}%` }} />
      </span>
      {pct}%{battery.charging ? " ⚡" : ""}
    </span>
  );
}

export function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  testId,
  href,
  tone,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  testId?: string;
  href?: string;
  tone?: "danger";
}) {
  const content = (
    <>
      <span className="action-icon">
        <Icon name={icon} size={22} />
      </span>
      <span>{label}</span>
    </>
  );
  if (href && !disabled)
    return (
      <a className="action" href={href} target="_blank" rel="noreferrer" data-testid={testId}>
        {content}
      </a>
    );
  return (
    <button className={`action${tone ? ` action-${tone}` : ""}`} onClick={onClick} disabled={disabled} title={title} data-testid={testId}>
      {content}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
    </label>
  );
}
