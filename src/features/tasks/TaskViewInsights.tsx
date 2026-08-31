import { t } from "../../i18n";

export type TaskInsightView = "inbox" | "today" | "upcoming" | "completed";

export interface TaskInsightItem {
  completed: boolean;
  dueAt: string | null;
  id: string;
  projectLabel: string | null;
  scheduledAt: string | null;
  title: string;
}

export type TaskViewDataStatus = "loading" | "ready" | "error";

export interface TaskViewInsightsProps {
  items: readonly TaskInsightItem[];
  status: TaskViewDataStatus;
  view: TaskInsightView;
}

function getTaskMoment(item: TaskInsightItem): string | null {
  return item.dueAt ?? item.scheduledAt;
}

function getDatedItems(items: readonly TaskInsightItem[]): TaskInsightItem[] {
  return [...items]
    .filter((item) => getTaskMoment(item) !== null)
    .sort((left, right) => (getTaskMoment(left) ?? "").localeCompare(getTaskMoment(right) ?? ""));
}

function getInsightTitle(view: TaskInsightView): string {
  switch (view) {
    case "inbox":
      return t("tasks.insights.inbox.title");
    case "today":
    case "upcoming":
      return t("tasks.insights.schedule.title");
    case "completed":
      return t("tasks.insights.completed.title");
  }
}

function formatTaskMoment(value: string): string {
  return new Intl.DateTimeFormat(navigator.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function TaskViewInsights({ items, status, view }: TaskViewInsightsProps) {
  const title = getInsightTitle(view);

  return (
    <aside aria-labelledby="task-view-insights-heading" className="task-view-insights">
      <h2 id="task-view-insights-heading">{title}</h2>
      {status === "loading" ? (
        <p className="task-view-insights__status" role="status">
          {t("tasks.loading")}
        </p>
      ) : null}
      {status === "error" ? (
        <p className="task-view-insights__status" role="status">
          {t("tasks.insights.unavailable")}
        </p>
      ) : null}
      {status === "ready" && items.length === 0 ? (
        <p className="task-view-insights__status" role="status">
          {t("tasks.insights.empty")}
        </p>
      ) : null}
      {status === "ready" && items.length > 0 && view === "inbox" ? (
        <dl className="task-view-insights__metrics">
          <div>
            <dt>{t("tasks.insights.total")}</dt>
            <dd>{items.length}</dd>
          </div>
          <div>
            <dt>{t("tasks.insights.dated")}</dt>
            <dd>{getDatedItems(items).length}</dd>
          </div>
          <div>
            <dt>{t("tasks.insights.projectLinks")}</dt>
            <dd>{items.filter((item) => item.projectLabel !== null).length}</dd>
          </div>
        </dl>
      ) : null}
      {status === "ready" && items.length > 0 && (view === "today" || view === "upcoming") ? (
        <>
          <p className="task-view-insights__count">
            {t("tasks.insights.open")} {items.filter((item) => !item.completed).length}
          </p>
          <ul aria-label={title} className="task-view-insights__timeline">
            {getDatedItems(items).map((item) => {
              const moment = getTaskMoment(item);

              if (moment === null) {
                return null;
              }

              return (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <time dateTime={moment}>{formatTaskMoment(moment)}</time>
                  {item.projectLabel !== null ? <span>{item.projectLabel}</span> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {status === "ready" && items.length > 0 && view === "completed" ? (
        <>
          <p className="task-view-insights__count">
            {t("tasks.insights.total")} {items.filter((item) => item.completed).length}
          </p>
          <div className="task-view-insights__projects">
            <span>{t("tasks.insights.projects")}</span>
            <ul>
              {[
                ...new Set(
                  items.flatMap((item) => (item.projectLabel === null ? [] : [item.projectLabel])),
                ),
              ].map((projectLabel) => (
                <li key={projectLabel}>{projectLabel}</li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </aside>
  );
}

export default TaskViewInsights;
