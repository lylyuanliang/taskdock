import {
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  Inbox,
  ListTodo,
  Plus,
  CircleHelp,
  Settings,
  SunMedium,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { t, type TranslationKey } from "../../i18n";
import type { AppView } from "../tasks/taskTypes";

interface AppNavigationProps {
  activeView: AppView;
  onCreateTask: () => void;
  onViewChange: (view: AppView) => void;
}

type NavigationItem = {
  icon: LucideIcon;
  labelKey: TranslationKey;
  view: AppView;
};

const navigationItems: readonly NavigationItem[] = [
  { icon: SunMedium, labelKey: "navigation.today", view: "today" },
  { icon: Inbox, labelKey: "navigation.inbox", view: "inbox" },
  { icon: CalendarClock, labelKey: "navigation.upcoming", view: "upcoming" },
  { icon: CalendarDays, labelKey: "navigation.calendar", view: "calendar" },
  { icon: ListTodo, labelKey: "navigation.projects", view: "projects" },
  { icon: CheckCircle2, labelKey: "navigation.completed", view: "completed" },
];

function AppNavigation({ activeView, onCreateTask, onViewChange }: AppNavigationProps) {
  return (
    <nav
      aria-label={t("navigation.primary")}
      className="navigation-rail"
      data-testid="navigation-rail"
    >
      <div className="navigation-rail__brand">
        <span aria-hidden="true" className="navigation-rail__brand-mark">
          <ListTodo size={18} />
        </span>
        <span className="navigation-rail__brand-copy">
          <strong>{t("app.title")}</strong>
          <span>{t("app.subtitle")}</span>
        </span>
      </div>
      <button
        className="navigation-rail__create"
        onClick={onCreateTask}
        title={t("task.add")}
        type="button"
      >
        <Plus aria-hidden="true" size={16} />
        <span className="navigation-rail__create-label">{t("task.add")}</span>
      </button>
      <div className="navigation-rail__items">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);

          return (
            <button
              aria-current={activeView === item.view ? "page" : undefined}
              aria-label={label}
              className={`navigation-rail__item${activeView === item.view ? " navigation-rail__item--active" : ""}`}
              data-navigation-item={item.view}
              key={item.view}
              onClick={() => onViewChange(item.view)}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
              <span className="navigation-rail__item-label">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="navigation-rail__footer">
        <button
          aria-disabled="true"
          className="navigation-rail__item navigation-rail__item--planned"
          disabled
          title={t("navigation.planned")}
          type="button"
        >
          <Settings aria-hidden="true" size={18} />
          <span className="navigation-rail__item-label">{t("navigation.settings")}</span>
        </button>
        <button
          aria-disabled="true"
          className="navigation-rail__item navigation-rail__item--planned"
          disabled
          title={t("navigation.planned")}
          type="button"
        >
          <CircleHelp aria-hidden="true" size={18} />
          <span className="navigation-rail__item-label">{t("navigation.support")}</span>
        </button>
      </div>
    </nav>
  );
}

export default AppNavigation;
