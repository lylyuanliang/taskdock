import {
  ArrowLeft,
  CircleAlert,
  Cloud,
  Info,
  Languages,
  Palette,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { t, type TranslationKey } from "../../i18n";

export type SettingsSection =
  "sync" | "initial" | "conflicts" | "account" | "security" | "theme" | "language" | "about";

interface SettingsNavigationProps {
  activeSection: SettingsSection;
  onBack: () => void;
  onSelect: (section: SettingsSection) => void;
}

type SettingsItem = {
  icon: LucideIcon;
  key: SettingsSection;
  label: TranslationKey;
};

const settingsItems: readonly SettingsItem[] = [
  { icon: Cloud, key: "sync", label: "settings.sync" },
  { icon: UserRound, key: "account", label: "settings.account" },
  { icon: ShieldCheck, key: "security", label: "settings.security" },
  { icon: Palette, key: "theme", label: "settings.theme" },
  { icon: Languages, key: "language", label: "settings.language" },
  { icon: Info, key: "about", label: "settings.about" },
];

export default function SettingsNavigation({
  activeSection,
  onBack,
  onSelect,
}: SettingsNavigationProps) {
  return (
    <aside aria-label={t("settings.navigation")} className="settings-navigation">
      <button className="settings-navigation__back" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={16} />
        <span>{t("settings.backToMain")}</span>
      </button>
      <div className="settings-navigation__heading">
        <p>{t("settings.eyebrow")}</p>
        <h1>{t("settings.title")}</h1>
      </div>
      <nav className="settings-navigation__items">
        {settingsItems.map((item) => {
          const Icon = item.icon;
          const disabled = item.key !== "sync";

          return (
            <button
              aria-current={activeSection === item.key ? "page" : undefined}
              className={`settings-navigation__item${activeSection === item.key ? " settings-navigation__item--active" : ""}`}
              disabled={disabled}
              key={item.key}
              onClick={() => onSelect(item.key)}
              type="button"
            >
              <Icon aria-hidden="true" size={16} />
              <span>{t(item.label)}</span>
              {disabled ? (
                <span className="settings-navigation__planned">{t("navigation.planned")}</span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="settings-navigation__secondary">
        <button
          className={`settings-navigation__item${activeSection === "initial" ? " settings-navigation__item--active" : ""}`}
          onClick={() => onSelect("initial")}
          type="button"
        >
          <Cloud aria-hidden="true" size={16} />
          <span>{t("settings.initialSync")}</span>
        </button>
        <button
          className={`settings-navigation__item${activeSection === "conflicts" ? " settings-navigation__item--active" : ""}`}
          onClick={() => onSelect("conflicts")}
          type="button"
        >
          <CircleAlert aria-hidden="true" size={16} />
          <span>{t("settings.conflicts")}</span>
        </button>
      </div>
    </aside>
  );
}
