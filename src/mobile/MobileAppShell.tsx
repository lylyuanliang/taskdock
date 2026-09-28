import { ArrowLeft, Inbox, ListTodo, Settings, SunMedium } from "lucide-react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { t, type TranslationKey } from "../i18n";
import {
  getMobileBackRoute,
  mobilePrimaryRoutes,
  transitionMobileRoute,
  type MobilePrimaryRoute,
  type MobileRoute,
} from "./mobileRoutes";
import "./mobileShell.css";

interface MobileAppShellProps {
  activeRoute: MobileRoute;
  hasUnsavedChanges: boolean;
  onBack: () => void;
  onRouteChange: (route: MobileRoute) => void;
  previousRoute?: MobileRoute;
  children?: ReactNode;
}

const navigationItems: readonly {
  icon: LucideIcon;
  label: TranslationKey;
  route: MobilePrimaryRoute;
}[] = [
  { icon: SunMedium, label: "navigation.today", route: "today" },
  { icon: Inbox, label: "navigation.inbox", route: "inbox" },
  { icon: ListTodo, label: "navigation.projects", route: "projects" },
  { icon: Settings, label: "navigation.settings", route: "settings" },
];

function getRouteTitle(route: MobileRoute): string {
  switch (route) {
    case "today":
      return t("navigation.today");
    case "inbox":
      return t("navigation.inbox");
    case "projects":
      return t("navigation.projects");
    case "settings":
      return t("settings.title");
    case "taskEditor":
      return t("task.edit");
    case "syncSettings":
      return t("settings.sync");
    case "conflicts":
      return t("settings.conflicts");
  }
}

export default function MobileAppShell({
  activeRoute,
  children,
  hasUnsavedChanges,
  onBack,
  onRouteChange,
  previousRoute,
}: MobileAppShellProps) {
  const [blockedAction, setBlockedAction] = useState<"back" | MobileRoute | null>(null);
  const [internalPreviousRoute, setInternalPreviousRoute] = useState<MobileRoute>("inbox");
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  const onBackRef = useRef(onBack);
  const lastRouteRef = useRef<MobileRoute>(activeRoute);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
    onBackRef.current = onBack;
  }, [hasUnsavedChanges, onBack]);

  useEffect(() => {
    if (activeRoute !== lastRouteRef.current) {
      lastRouteRef.current = activeRoute;
      setBlockedAction(null);
    }
  }, [activeRoute]);

  useEffect(() => {
    function handleSystemBack(event: Event) {
      event.preventDefault();
      if (hasUnsavedChangesRef.current) {
        setBlockedAction("back");
      } else {
        onBackRef.current();
      }
    }

    window.addEventListener("popstate", handleSystemBack);
    window.addEventListener("android-back", handleSystemBack);

    return () => {
      window.removeEventListener("popstate", handleSystemBack);
      window.removeEventListener("android-back", handleSystemBack);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !/Android/i.test(navigator.userAgent)) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void onBackButtonPress(() => {
      if (!active) return;
      const event = new Event("android-back");
      window.dispatchEvent(event);
    }).then((listener) => {
      const cleanup = () => {
        void listener.unregister();
      };
      if (active) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  function requestBack() {
    if (hasUnsavedChanges) {
      setBlockedAction("back");
      return;
    }

    onBack();
  }

  function requestRoute(requestedRoute: MobileRoute) {
    const nextRoute = transitionMobileRoute(
      activeRoute,
      requestedRoute,
      previousRoute ?? internalPreviousRoute,
    );

    if (nextRoute === activeRoute) {
      return;
    }

    if (hasUnsavedChanges) {
      setBlockedAction(nextRoute);
      return;
    }

    if (nextRoute === "taskEditor" && previousRoute === undefined) {
      setInternalPreviousRoute(activeRoute);
    }
    onRouteChange(nextRoute);
  }

  function discardAndLeave() {
    const action = blockedAction;

    setBlockedAction(null);
    if (action === "back") {
      onBack();
      return;
    }

    if (action !== null) {
      onRouteChange(action);
    }
  }

  const isPrimaryRoute = mobilePrimaryRoutes.includes(activeRoute as MobilePrimaryRoute);
  const backRoute = getMobileBackRoute(activeRoute, previousRoute ?? internalPreviousRoute);

  return (
    <div className="mobile-shell" data-state="default" data-testid="mobile-app-shell">
      <header className="mobile-shell__header">
        {!isPrimaryRoute ? (
          <button
            aria-label={t("mobile.back")}
            className="mobile-shell__back"
            onClick={requestBack}
            title={t("settings.backToMain")}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={18} />
          </button>
        ) : null}
        <div className="mobile-shell__heading">
          <span className="mobile-shell__eyebrow">{t("app.title")}</span>
          <h1>{getRouteTitle(activeRoute)}</h1>
        </div>
        <span className="mobile-shell__route" data-route={activeRoute}>
          {activeRoute === "syncSettings"
            ? t("mobile.route.webdav")
            : backRoute === "syncSettings"
              ? t("mobile.route.sync")
              : t("mobile.route.local")}
        </span>
      </header>

      {blockedAction !== null ? (
        <div className="mobile-shell__unsaved" data-testid="mobile-unsaved-warning" role="alert">
          <p>{t("mobile.unsavedChanges")}</p>
          <button onClick={discardAndLeave} type="button">
            {t("mobile.discardChanges")}
          </button>
        </div>
      ) : null}

      <main className="mobile-shell__content" data-route={activeRoute} data-state="default">
        {children ?? (
          <section aria-labelledby="mobile-route-heading" className="mobile-shell__slot">
            <p className="mobile-shell__slot-label">{t("app.subtitle")}</p>
            <h2 id="mobile-route-heading">{getRouteTitle(activeRoute)}</h2>
          </section>
        )}
      </main>

      <nav aria-label={t("navigation.primary")} className="mobile-shell__navigation">
        {navigationItems.map(({ icon: Icon, label, route }) => {
          const isActive = activeRoute === route;

          return (
            <button
              aria-current={isActive ? "page" : undefined}
              aria-label={t(label)}
              className={`mobile-shell__navigation-item${isActive ? " mobile-shell__navigation-item--active" : ""}`}
              key={route}
              onClick={() => requestRoute(route)}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
              <span>{t(label)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
