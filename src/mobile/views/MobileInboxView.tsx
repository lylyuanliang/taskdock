import type { TaskDto } from "../../features/tasks/taskTypes";
import { t } from "../../i18n";
import MobileTodayView from "./MobileTodayView";

interface MobileInboxViewProps {
  tasks: readonly TaskDto[];
  isLoading: boolean;
  errorMessageKey: string | null;
  onOpenTask: (task: TaskDto) => void;
  onToggleCompleted: (task: TaskDto) => void;
  onCreateTask: () => void;
}

export default function MobileInboxView(props: MobileInboxViewProps) {
  return (
    <MobileTodayView
      completedTasks={[]}
      errorMessageKey={props.errorMessageKey}
      isLoading={props.isLoading}
      onCreateTask={props.onCreateTask}
      onOpenTask={props.onOpenTask}
      onToggleCompleted={props.onToggleCompleted}
      tasks={props.tasks}
      viewLabel={t("tasks.inbox")}
    />
  );
}
