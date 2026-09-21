import { CalendarClock, CheckCircle2, Plus } from "lucide-react";
import { t } from "../../i18n";
import type { TaskSummaryDto } from "../tasks/taskTypes";
import { groupProjectTasks } from "./projectTaskGroups";
import "./ProjectTaskBoard.css";

export type ProjectTaskGroup = "nextAction" | "doing" | "todo";

export interface ProjectTaskBoardProps {
  isLoading?: boolean;
  onAddTask?: () => void;
  onToggleCompleted?: (id: string, completed: boolean) => void;
  pendingTaskIds?: ReadonlySet<string>;
  tasks: readonly TaskSummaryDto[];
}

function groupLabel(group: ProjectTaskGroup): string {
  switch (group) {
    case "nextAction":
      return t("projects.board.nextAction");
    case "doing":
      return t("projects.board.doing");
    case "todo":
      return t("projects.board.todo");
  }
}

function formatTaskDate(task: TaskSummaryDto): string | null {
  const value = task.dueAt ?? task.scheduledAt;
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

function ProjectTaskBoard({
  isLoading = false,
  onAddTask,
  onToggleCompleted,
  pendingTaskIds = new Set(),
  tasks = [],
}: ProjectTaskBoardProps) {
  const groups = groupProjectTasks(tasks);
  const groupEntries: Array<[ProjectTaskGroup, TaskSummaryDto[]]> = [
    ["nextAction", groups.nextAction],
    ["doing", groups.doing],
    ["todo", groups.todo],
  ];

  return (
    <section
      aria-labelledby="project-task-board-heading"
      className="project-task-board"
      data-testid="project-task-board"
    >
      <header className="project-task-board__header">
        <div>
          <p className="project-task-board__eyebrow">{t("projects.board.eyebrow")}</p>
          <h3 id="project-task-board-heading">{t("projects.board.title")}</h3>
        </div>
        {onAddTask ? (
          <button
            aria-label={t("projects.board.addTask")}
            className="project-task-board__add"
            disabled={isLoading}
            onClick={onAddTask}
            title={t("projects.board.addTask")}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            <span>{t("task.add")}</span>
          </button>
        ) : null}
      </header>
      {!tasks.length && !isLoading ? (
        <p className="task-ledger__status" role="status">
          {t("tasks.view.empty")}
        </p>
      ) : null}
      <div className="project-task-board__columns">
        {groupEntries.map(([group, groupTasks]) => (
          <section
            aria-labelledby={`project-task-group-${group}`}
            className="project-task-board__column"
            data-testid={`project-task-column-${group}`}
            key={group}
          >
            <header className="project-task-board__column-header">
              <h4 id={`project-task-group-${group}`}>{groupLabel(group)}</h4>
              <span aria-label={`${groupLabel(group)} ${groupTasks.length}`}>
                {groupTasks.length}
              </span>
            </header>
            {groupTasks.length ? (
              <ul className="project-task-board__tasks">
                {groupTasks.map((task) => (
                  <li className="project-task-board__task" key={task.id}>
                    <div className="project-task-board__task-main">
                      {onToggleCompleted ? (
                        <button
                          aria-label={`${t("task.complete")} ${task.title}`}
                          className="project-task-board__complete"
                          disabled={pendingTaskIds.has(task.id)}
                          onClick={() => onToggleCompleted(task.id, task.completed)}
                          title={t("task.complete")}
                          type="button"
                        >
                          <CheckCircle2 aria-hidden="true" size={16} />
                        </button>
                      ) : null}
                      <strong title={task.title}>{task.title}</strong>
                    </div>
                    <div className="project-task-board__task-meta">
                      <span
                        className={`project-task-board__priority project-task-board__priority--${task.priority.toLowerCase()}`}
                      >
                        {t(
                          `task.priority.${task.priority.toLowerCase()}` as
                            "task.priority.low" | "task.priority.normal" | "task.priority.high",
                        )}
                      </span>
                      {formatTaskDate(task) ? (
                        <span className="project-task-board__date">
                          <CalendarClock aria-hidden="true" size={13} />
                          {formatTaskDate(task)}
                        </span>
                      ) : null}
                      {task.tags.length ? (
                        <span className="project-task-board__tags">
                          {task.tags.slice(0, 2).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="project-task-board__empty">{t("projects.board.empty")}</p>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

export default ProjectTaskBoard;
