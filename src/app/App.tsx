import { useEffect, useEffectEvent, useReducer, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { FolderKanban, Search } from "lucide-react";
import "../App.css";
import { createProject, listProjects } from "../api/projects";
import { completeTask, listInbox, listTasks, updateTask } from "../api/tasks";
import {
  getSyncConfig,
  getSyncStatus,
  listSyncConflicts,
  resolveSyncConflict,
  saveSyncConfig,
  syncNow,
  testSyncConnection,
  type SaveSyncConfigInput,
  type SyncConfigDto,
  type SyncConflictDecision,
  type SyncConflictDto,
  type SyncStateDto,
  type SyncStrategy,
  type TestSyncConnectionInput,
} from "../api/sync";
import MonthCalendar from "../features/calendar/MonthCalendar";
import {
  calendarQueryReducer,
  initialCalendarQueryState,
} from "../features/calendar/calendarQueryState";
import AppNavigation from "../features/navigation/AppNavigation";
import ProjectList from "../features/projects/ProjectList";
import ProjectTaskBoard from "../features/projects/ProjectTaskBoard";
import SearchDialog from "../features/search/SearchDialog";
import SettingsWorkspace from "../features/settings/SettingsWorkspace";
import MobileAppShell from "../mobile/MobileAppShell";
import { getMobileBackRoute, type MobileRoute } from "../mobile/mobileRoutes";
import MobileConflictView from "../mobile/views/MobileConflictView";
import MobileInboxView from "../mobile/views/MobileInboxView";
import MobileProjectsView from "../mobile/views/MobileProjectsView";
import MobileSyncSettingsView from "../mobile/views/MobileSyncSettingsView";
import MobileTaskEditorView from "../mobile/views/MobileTaskEditorView";
import MobileTodayView from "../mobile/views/MobileTodayView";
import { isMobileTodayTask } from "../mobile/mobileTaskFilters";
import { initialSearchQueryState, searchQueryReducer } from "../features/search/searchQueryState";
import type { ProjectDto } from "../features/projects/projectTypes";
import TaskEditor from "../features/tasks/TaskEditor";
import TaskList from "../features/tasks/TaskList";
import TaskSummaryList from "../features/tasks/TaskSummaryList";
import TaskViewInsights, {
  type TaskInsightItem,
  type TaskViewDataStatus,
} from "../features/tasks/TaskViewInsights";
import {
  initialSummaryQueryState,
  summaryQueryReducer,
  type SummaryView,
} from "../features/tasks/summaryQueryState";
import {
  getCommandErrorMessageKey,
  type AppView,
  type TaskDto,
  type TaskSummaryDto,
} from "../features/tasks/taskTypes";
import { isTranslationKey, t } from "../i18n";

function translateErrorMessage(messageKey: string): string {
  return isTranslationKey(messageKey) ? t(messageKey) : t("errors.unknown");
}

function getViewTitle(view: AppView): string {
  switch (view) {
    case "inbox":
      return t("tasks.inbox");
    case "today":
      return t("navigation.today");
    case "upcoming":
      return t("navigation.upcoming");
    case "completed":
      return t("navigation.completed");
    case "projects":
      return t("projects.title");
    case "calendar":
      return t("calendar.title");
  }
}

interface MutationErrorState {
  messageKey: string;
  requestId: number;
  view: AppView;
}

interface TaskMutation {
  id: string;
  requestId: number;
  view: AppView;
}

interface ProjectTaskState {
  errorMessageKey: string | null;
  isLoading: boolean;
  tasks: TaskSummaryDto[];
}

interface ProjectTaskLoadRequest {
  projectId: string;
  requestId: number;
}

const emptyMobileSyncState: SyncStateDto = {
  baselineSnapshotId: null,
  conflicts: 0,
  lastErrorCode: null,
  lastSyncedAt: null,
  pendingDownload: 0,
  pendingUpload: 0,
  status: "unconfigured",
};

interface InboxLoadRequest {
  promise: Promise<TaskDto[]>;
  requestId: number;
}

type InboxLoadState =
  | { requestId: number; status: "loading" }
  | { requestId: number; status: "ready"; tasks: TaskDto[] }
  | { errorMessageKey: string; requestId: number; status: "error" };

interface MobileTodayState {
  completedTasks: TaskDto[];
  errorMessageKey: string | null;
  isLoading: boolean;
  tasks: TaskDto[];
}

function currentLocalMonth(): string {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function isSummaryView(view: AppView): view is SummaryView {
  return view === "today" || view === "upcoming" || view === "completed";
}

function toInboxInsightItem(task: TaskDto): TaskInsightItem {
  return {
    completed: task.completedAt !== null,
    dueAt: task.dueAt,
    id: task.id,
    projectLabel: task.projectId === null ? null : t("task.project.assigned"),
    scheduledAt: task.scheduledAt,
    title: task.title,
  };
}

function toSummaryInsightItem(task: TaskSummaryDto): TaskInsightItem {
  return {
    completed: task.completed,
    dueAt: task.dueAt,
    id: task.id,
    projectLabel: task.projectName,
    scheduledAt: task.scheduledAt,
    title: task.title,
  };
}

function toMobileCompletedTask(task: TaskSummaryDto): TaskDto {
  const completedAt = new Date().toISOString();

  return {
    completedAt: task.completed ? completedAt : null,
    createdAt: completedAt,
    dueAt: task.dueAt,
    id: task.id,
    note: "",
    parentId: null,
    priority: task.priority,
    projectId: null,
    recurrence: null,
    revision: 0,
    scheduledAt: task.scheduledAt,
    title: task.title,
    updatedAt: completedAt,
  };
}

function isAndroidRuntime(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

function App() {
  const [editingTask, setEditingTask] = useState<TaskDto | null>(null);
  const [editorRefreshVersion, setEditorRefreshVersion] = useState(0);
  const [inboxLoadState, setInboxLoadState] = useState<InboxLoadState>({
    requestId: 0,
    status: "loading",
  });
  const [mutationErrorState, setMutationErrorState] = useState<MutationErrorState | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [pendingTaskIds, setPendingTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const [projectTaskState, setProjectTaskState] = useState<ProjectTaskState>({
    errorMessageKey: null,
    isLoading: false,
    tasks: [],
  });
  const [isProjectListLoading, setIsProjectListLoading] = useState(false);
  const [projectListErrorMessageKey, setProjectListErrorMessageKey] = useState<string | null>(null);
  const [projectListRequestId, setProjectListRequestId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectTaskLoadRequest, setProjectTaskLoadRequest] =
    useState<ProjectTaskLoadRequest | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(currentLocalMonth);
  const [activeView, setActiveView] = useState<AppView>("inbox");
  const [mobileRoute, setMobileRoute] = useState<MobileRoute>("today");
  const [mobileHasUnsavedChanges, setMobileHasUnsavedChanges] = useState(false);
  const [mobileSyncConfig, setMobileSyncConfig] = useState<SyncConfigDto | null>(null);
  const [mobileSyncConflicts, setMobileSyncConflicts] = useState<SyncConflictDto[]>([]);
  const [mobileSyncState, setMobileSyncState] = useState<SyncStateDto>(emptyMobileSyncState);
  const [mobileSyncLoading, setMobileSyncLoading] = useState(false);
  const [mobileSyncSaving, setMobileSyncSaving] = useState(false);
  const [mobileOnline, setMobileOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [mobileTodayRefreshVersion, setMobileTodayRefreshVersion] = useState(0);
  const [mobileTodayState, setMobileTodayState] = useState<MobileTodayState>({
    completedTasks: [],
    errorMessageKey: null,
    isLoading: false,
    tasks: [],
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [calendarQueryState, dispatchCalendarQuery] = useReducer(
    calendarQueryReducer,
    initialCalendarQueryState,
  );
  const [summaryQueryState, dispatchSummaryQuery] = useReducer(
    summaryQueryReducer,
    initialSummaryQueryState,
  );
  const [searchQueryState, dispatchSearchQuery] = useReducer(
    searchQueryReducer,
    initialSearchQueryState,
  );
  const activeViewRef = useRef<AppView>(activeView);
  const calendarMonthRef = useRef(calendarMonth);
  const calendarRequestIdRef = useRef(0);
  const inboxLoadRequestRef = useRef<InboxLoadRequest | null>(null);
  const inboxRequestIdRef = useRef(0);
  const mutationRequestIdRef = useRef(0);
  const pendingTaskIdsRef = useRef(new Set<string>());
  const projectListRequestIdRef = useRef(0);
  const projectTaskRequestIdRef = useRef(0);
  const selectedProjectIdRef = useRef<string | null>(null);
  const summaryRequestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const mobilePreviousRouteRef = useRef<MobileRoute>("today");

  useEffect(() => {
    if (!isAndroidRuntime()) {
      return;
    }

    function handleOnlineStateChange() {
      setMobileOnline(navigator.onLine);
    }

    window.addEventListener("online", handleOnlineStateChange);
    window.addEventListener("offline", handleOnlineStateChange);

    return () => {
      window.removeEventListener("online", handleOnlineStateChange);
      window.removeEventListener("offline", handleOnlineStateChange);
    };
  }, []);

  useEffect(() => {
    if (activeView !== "inbox" || inboxLoadState.status !== "loading") {
      return;
    }

    let isCurrent = true;
    const { requestId } = inboxLoadState;
    const loadRequest =
      inboxLoadRequestRef.current?.requestId === requestId
        ? inboxLoadRequestRef.current
        : { promise: listInbox(), requestId };

    inboxLoadRequestRef.current = loadRequest;

    void loadRequest.promise
      .then((tasks) => {
        if (isCurrent && inboxRequestIdRef.current === requestId) {
          setInboxLoadState({ requestId, status: "ready", tasks: tasks ?? [] });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent && inboxRequestIdRef.current === requestId) {
          setInboxLoadState({
            errorMessageKey: getCommandErrorMessageKey(error),
            requestId,
            status: "error",
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [activeView, inboxLoadState]);

  useEffect(() => {
    const summaryLoadState = summaryQueryState.loadState;

    if (!summaryLoadState || summaryLoadState.status !== "loading") {
      return;
    }

    let isCurrent = true;
    const { requestId, view } = summaryLoadState;

    async function loadTasks() {
      try {
        const tasks = await listTasks({ kind: view });
        if (isCurrent) {
          dispatchSummaryQuery({ requestId, tasks, type: "requestResolved" });
        }
      } catch (error: unknown) {
        if (isCurrent) {
          dispatchSummaryQuery({
            errorMessageKey: getCommandErrorMessageKey(error),
            requestId,
            type: "requestRejected",
          });
        }
      }
    }

    void loadTasks();

    return () => {
      isCurrent = false;
    };
  }, [summaryQueryState.loadState]);

  useEffect(() => {
    if (activeView !== "projects" || projectListRequestId === null) {
      return;
    }

    let isCurrent = true;

    async function loadProjects() {
      try {
        const activeProjects = await listProjects();
        if (isCurrent) {
          setProjects(activeProjects);

          const currentSelectedProjectId = selectedProjectIdRef.current;
          if (currentSelectedProjectId === null && activeProjects.length > 0) {
            const firstProject = activeProjects[0];
            selectedProjectIdRef.current = firstProject.id;
            setSelectedProjectId(firstProject.id);
            startProjectTaskLoad(firstProject.id);
          }
          if (
            currentSelectedProjectId !== null &&
            !activeProjects.some((project) => project.id === currentSelectedProjectId)
          ) {
            selectedProjectIdRef.current = null;
            setSelectedProjectId(null);
            setProjectTaskLoadRequest(null);
            setProjectTaskState({ errorMessageKey: null, isLoading: false, tasks: [] });
          }
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setProjectListErrorMessageKey(getCommandErrorMessageKey(error));
        }
      } finally {
        if (isCurrent) {
          setIsProjectListLoading(false);
        }
      }
    }

    void loadProjects();

    return () => {
      isCurrent = false;
    };
  }, [activeView, projectListRequestId]);

  useEffect(() => {
    if (
      activeView !== "projects" ||
      projectTaskLoadRequest === null ||
      projectTaskLoadRequest.projectId !== selectedProjectId
    ) {
      return;
    }

    let isCurrent = true;
    const { projectId, requestId } = projectTaskLoadRequest;

    async function loadProjectTasks() {
      try {
        const tasks = await listTasks({ kind: "project", projectId });
        if (isCurrent && projectTaskRequestIdRef.current === requestId) {
          setProjectTaskState({ errorMessageKey: null, isLoading: false, tasks: tasks ?? [] });
        }
      } catch (error: unknown) {
        if (isCurrent && projectTaskRequestIdRef.current === requestId) {
          setProjectTaskState({
            errorMessageKey: getCommandErrorMessageKey(error),
            isLoading: false,
            tasks: [],
          });
        }
      }
    }

    void loadProjectTasks();

    return () => {
      isCurrent = false;
    };
  }, [activeView, projectTaskLoadRequest, selectedProjectId]);

  useEffect(() => {
    const calendarLoadState = calendarQueryState.loadState;

    if (calendarQueryState.activeView !== "calendar" || calendarLoadState?.status !== "loading") {
      return;
    }

    const { month, requestId } = calendarLoadState;

    async function loadCalendarTasks() {
      try {
        const tasks = await listTasks({ kind: "calendar", month });
        dispatchCalendarQuery({ requestId, tasks, type: "calendarRequestResolved" });
      } catch (error: unknown) {
        dispatchCalendarQuery({
          errorMessageKey: getCommandErrorMessageKey(error),
          requestId,
          type: "calendarRequestRejected",
        });
      }
    }

    void loadCalendarTasks();
  }, [calendarQueryState]);

  useEffect(() => {
    function handleGlobalSearchShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatchSearchQuery({ type: "opened" });
      }
    }

    document.addEventListener("keydown", handleGlobalSearchShortcut);

    return () => {
      document.removeEventListener("keydown", handleGlobalSearchShortcut);
    };
  }, []);

  useEffect(() => {
    if (!isAndroidRuntime() || (mobileRoute !== "syncSettings" && mobileRoute !== "conflicts")) {
      return;
    }

    let active = true;
    void Promise.all([getSyncConfig(), getSyncStatus(), listSyncConflicts()])
      .then(([config, syncState, conflicts]) => {
        if (!active) {
          return;
        }

        setMobileSyncConfig(config);
        setMobileSyncState(syncState);
        setMobileSyncConflicts(conflicts);
      })
      .catch((error: unknown) => {
        if (active) {
          setMobileSyncState((current) => ({ ...current, status: "retryPending" }));
          console.error("Unable to load mobile sync state", error);
        }
      })
      .finally(() => {
        if (active) {
          setMobileSyncLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [mobileRoute]);

  useEffect(() => {
    if (!isAndroidRuntime() || mobileRoute !== "today") {
      return;
    }

    let active = true;
    const loadingRequestId = window.setTimeout(() => {
      if (active) {
        setMobileTodayState((current) => ({ ...current, isLoading: true }));
      }
    }, 0);
    let updateRequestId: number | null = null;

    if (inboxLoadState.status === "ready") {
      const tasks = inboxLoadState.tasks.filter(
        (task) => task.parentId === null && isMobileTodayTask(task),
      );
      updateRequestId = window.setTimeout(() => {
        if (active) {
          setMobileTodayState((current) => ({
            ...current,
            errorMessageKey: null,
            isLoading: false,
            tasks,
          }));
        }
      }, 0);
    } else if (inboxLoadState.status === "error") {
      updateRequestId = window.setTimeout(() => {
        if (active) {
          setMobileTodayState({
            completedTasks: [],
            errorMessageKey: inboxLoadState.errorMessageKey,
            isLoading: false,
            tasks: [],
          });
        }
      }, 0);
    }

    void listTasks({ kind: "quickPanelToday" })
      .then((summaries) => {
        if (active) {
          setMobileTodayState((current) => ({
            ...current,
            completedTasks: summaries
              .filter((summary) => summary.completed)
              .map(toMobileCompletedTask),
          }));
        }
      })
      .catch(() => {
        // Open tasks remain usable if the completed-today summary is unavailable.
      });

    return () => {
      active = false;
      window.clearTimeout(loadingRequestId);
      if (updateRequestId !== null) {
        window.clearTimeout(updateRequestId);
      }
    };
  }, [inboxLoadState, mobileRoute, mobileTodayRefreshVersion]);

  useEffect(() => {
    if (!isAndroidRuntime() || mobileRoute !== "projects") return;
    let active = true;
    setIsProjectListLoading(true);
    void listProjects()
      .then((activeProjects) => {
        if (!active) return [];
        setProjects(activeProjects);
        const projectId = selectedProjectIdRef.current ?? activeProjects[0]?.id ?? null;
        selectedProjectIdRef.current = projectId;
        setSelectedProjectId(projectId);
        if (!projectId) return [];
        setProjectTaskState((current) => ({ ...current, isLoading: true }));
        return listTasks({ kind: "project", projectId });
      })
      .then((tasks) => {
        if (active) setProjectTaskState({ errorMessageKey: null, isLoading: false, tasks });
      })
      .catch((error: unknown) => {
        if (active) setProjectListErrorMessageKey(getCommandErrorMessageKey(error));
      })
      .finally(() => {
        if (active) setIsProjectListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mobileRoute]);

  useEffect(() => {
    if (
      !searchQueryState.isOpen ||
      !searchQueryState.query ||
      searchQueryState.loadState.status !== "idle"
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const requestId = searchRequestIdRef.current + 1;

      searchRequestIdRef.current = requestId;
      dispatchSearchQuery({
        query: searchQueryState.query,
        requestId,
        type: "requestStarted",
      });
    }, 200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchQueryState.isOpen, searchQueryState.loadState.status, searchQueryState.query]);

  useEffect(() => {
    const { loadState } = searchQueryState;

    if (!searchQueryState.isOpen || loadState.status !== "loading") {
      return;
    }

    let isCurrent = true;
    const { query, requestId } = loadState;

    async function loadSearchTasks() {
      try {
        const tasks = await listTasks({ kind: "search", query });

        if (isCurrent) {
          dispatchSearchQuery({ query, requestId, tasks, type: "requestResolved" });
        }
      } catch (error: unknown) {
        if (isCurrent) {
          dispatchSearchQuery({
            errorMessageKey: getCommandErrorMessageKey(error),
            query,
            requestId,
            type: "requestRejected",
          });
        }
      }
    }

    void loadSearchTasks();

    return () => {
      isCurrent = false;
    };
  }, [searchQueryState]);

  function startSummaryLoad(view: SummaryView) {
    const requestId = summaryRequestIdRef.current + 1;

    summaryRequestIdRef.current = requestId;
    setActiveView(view);
    dispatchSummaryQuery({ requestId, type: "viewSelected", view });
  }

  function startInboxLoad() {
    const requestId = inboxRequestIdRef.current + 1;

    inboxRequestIdRef.current = requestId;
    setInboxLoadState({ requestId, status: "loading" });
  }

  function startCalendarLoad(month: string) {
    const requestId = calendarRequestIdRef.current + 1;

    calendarRequestIdRef.current = requestId;
    calendarMonthRef.current = month;
    dispatchCalendarQuery({ month, requestId, type: "calendarLoadStarted" });
  }

  function startProjectListLoad() {
    const requestId = projectListRequestIdRef.current + 1;

    projectListRequestIdRef.current = requestId;
    setIsProjectListLoading(true);
    setProjectListErrorMessageKey(null);
    setProjectListRequestId(requestId);
  }

  function startProjectTaskLoad(projectId: string) {
    const requestId = projectTaskRequestIdRef.current + 1;

    projectTaskRequestIdRef.current = requestId;
    setProjectTaskState({ errorMessageKey: null, isLoading: true, tasks: [] });
    setProjectTaskLoadRequest({ projectId, requestId });
  }

  function refreshView(view: AppView) {
    if (view === "inbox") {
      startInboxLoad();
      return;
    }

    if (view === "projects") {
      if (selectedProjectIdRef.current !== null) {
        startProjectTaskLoad(selectedProjectIdRef.current);
      }

      return;
    }

    if (view === "calendar") {
      startCalendarLoad(calendarMonthRef.current);
      return;
    }

    startSummaryLoad(view);
  }

  const refreshCurrentView = useEffectEvent(() => {
    refreshView(activeViewRef.current);
  });

  const refreshAfterTaskMutation = useEffectEvent(() => {
    refreshCurrentView();
    setEditorRefreshVersion((current) => current + 1);
  });

  function updatePendingTask(id: string, isPending: boolean) {
    if (isPending) {
      pendingTaskIdsRef.current.add(id);
    } else {
      pendingTaskIdsRef.current.delete(id);
    }

    setPendingTaskIds(new Set(pendingTaskIdsRef.current));
  }

  function handleViewChange(view: AppView) {
    activeViewRef.current = view;
    dispatchCalendarQuery({ type: "viewChanged", view });

    if (view === "inbox") {
      summaryRequestIdRef.current += 1;
      setActiveView(view);
      startInboxLoad();
      dispatchSummaryQuery({
        requestId: summaryRequestIdRef.current,
        type: "viewSelected",
        view,
      });
      return;
    }

    if (view === "projects") {
      setActiveView(view);
      dispatchSummaryQuery({
        requestId: summaryRequestIdRef.current,
        type: "viewSelected",
        view,
      });
      startProjectListLoad();
      if (selectedProjectIdRef.current !== null) {
        startProjectTaskLoad(selectedProjectIdRef.current);
      }
      return;
    }

    if (view === "calendar") {
      setActiveView(view);
      startCalendarLoad(calendarMonth);
      return;
    }

    startSummaryLoad(view);
  }

  function handleCalendarMonthChange(month: string) {
    setCalendarMonth(month);
    startCalendarLoad(month);
  }

  function handleSearchOpened() {
    dispatchSearchQuery({ type: "opened" });
  }

  function handleSearchClosed() {
    dispatchSearchQuery({ type: "closed" });
  }

  function handleSearchInputChanged(input: string) {
    dispatchSearchQuery({ input, type: "inputChanged" });
  }

  function handleTaskSaved() {
    refreshView("inbox");
    setEditingTask(null);
    setIsEditorOpen(false);
  }

  function handleNavigationNewTask() {
    if (activeViewRef.current !== "inbox") {
      handleViewChange("inbox");
    }

    setEditingTask(null);
    setIsEditorOpen(true);
  }

  function handleMobileRouteChange(route: MobileRoute) {
    setMobileHasUnsavedChanges(false);
    setMobileRoute((currentRoute) => {
      if (route === "taskEditor" && currentRoute !== "taskEditor") {
        mobilePreviousRouteRef.current = currentRoute;
      }

      return route;
    });
  }

  function handleMobileBack() {
    setMobileHasUnsavedChanges(false);
    setMobileRoute((currentRoute) =>
      getMobileBackRoute(currentRoute, mobilePreviousRouteRef.current),
    );
  }

  function handleMobileEditorSaved() {
    setMobileHasUnsavedChanges(false);
    handleMobileBack();
    setMobileTodayRefreshVersion((current) => current + 1);
  }

  function handleMobileEditorCancelled() {
    setMobileHasUnsavedChanges(false);
    handleMobileBack();
  }

  function handleMobileProjectSelect(projectId: string) {
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    setProjectTaskState((current) => ({ ...current, isLoading: true }));
    void listTasks({ kind: "project", projectId })
      .then((tasks) => setProjectTaskState({ errorMessageKey: null, isLoading: false, tasks }))
      .catch((error: unknown) =>
        setProjectTaskState({
          errorMessageKey: getCommandErrorMessageKey(error),
          isLoading: false,
          tasks: [],
        }),
      );
  }

  async function handleMobileCreateProject(name: string): Promise<ProjectDto> {
    const project = await createProject(name);
    setProjects((current) =>
      current.some((item) => item.id === project.id) ? current : [...current, project],
    );
    return project;
  }

  async function handleMobileToggleCompleted(task: TaskDto): Promise<void> {
    if (pendingTaskIdsRef.current.has(task.id)) {
      return;
    }

    updatePendingTask(task.id, true);
    try {
      if (task.completedAt === null) {
        await completeTask(task.id);
      } else {
        await updateTask(task.id, { completedAt: null });
      }
      setMobileTodayRefreshVersion((current) => current + 1);
    } catch (error: unknown) {
      setMobileTodayState((current) => ({
        ...current,
        errorMessageKey: getCommandErrorMessageKey(error),
      }));
    } finally {
      updatePendingTask(task.id, false);
    }
  }

  async function handleMobileSaveSync(input: SaveSyncConfigInput): Promise<void> {
    setMobileSyncSaving(true);
    try {
      const saved = await saveSyncConfig(input);
      setMobileSyncConfig(saved);
      setMobileSyncState((current) => ({
        ...current,
        status: saved.paused ? "paused" : current.status,
      }));
    } finally {
      setMobileSyncSaving(false);
    }
  }

  async function handleMobileSyncNow(strategy?: SyncStrategy): Promise<void> {
    const result = await syncNow(strategy);
    setMobileSyncState((current) => ({ ...current, ...result }));
    setMobileSyncConflicts(await listSyncConflicts());
  }

  async function handleMobileResolveConflict(
    conflict: SyncConflictDto,
    decision: SyncConflictDecision,
  ): Promise<void> {
    await resolveSyncConflict(conflict.entityId, conflict.entityKind, conflict.fieldName, decision);
    setMobileSyncConflicts((current) =>
      current.filter(
        (item) => item.entityId !== conflict.entityId || item.fieldName !== conflict.fieldName,
      ),
    );
    setMobileSyncState((current) => ({
      ...current,
      conflicts: Math.max(0, current.conflicts - 1),
    }));
  }

  function handleEditTask(task: TaskDto) {
    setEditingTask(task);
    setIsEditorOpen(true);
  }

  function handleProjectSelect(projectId: string) {
    if (projectId === selectedProjectId) {
      return;
    }

    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    startProjectTaskLoad(projectId);
  }

  function handleProjectCreated(project: ProjectDto) {
    setProjects((current) => [...current, project]);
  }

  function handleProjectRenamed(project: ProjectDto) {
    setProjects((current) =>
      current.map((currentProject) =>
        currentProject.id === project.id ? project : currentProject,
      ),
    );
  }

  function handleProjectArchived(projectId: string) {
    setProjects((current) => current.filter((project) => project.id !== projectId));
    if (selectedProjectIdRef.current === projectId) {
      selectedProjectIdRef.current = null;
      setSelectedProjectId(null);
      setProjectTaskLoadRequest(null);
      setProjectTaskState({ errorMessageKey: null, isLoading: false, tasks: [] });
    }
  }

  async function handleToggleCompleted(id: string, completed: boolean) {
    if (pendingTaskIdsRef.current.has(id)) {
      return;
    }

    const mutation: TaskMutation = {
      id,
      requestId: mutationRequestIdRef.current + 1,
      view: activeViewRef.current,
    };

    mutationRequestIdRef.current = mutation.requestId;
    updatePendingTask(id, true);
    setMutationErrorState((current) => (current?.view === mutation.view ? null : current));

    try {
      if (completed) {
        await updateTask(id, { completedAt: null });
      } else {
        await completeTask(id);
      }

      if (mutation.view === "projects") {
        const projectId = selectedProjectIdRef.current;

        if (projectId !== null) {
          startProjectTaskLoad(projectId);
        }

        return;
      }

      refreshView(activeViewRef.current);
    } catch (error: unknown) {
      if (
        activeViewRef.current === mutation.view &&
        mutationRequestIdRef.current === mutation.requestId
      ) {
        setMutationErrorState({
          messageKey: getCommandErrorMessageKey(error),
          requestId: mutation.requestId,
          view: mutation.view,
        });
      }
    } finally {
      updatePendingTask(mutation.id, false);
    }
  }

  useEffect(() => {
    let isCurrent = true;
    let unlisten: (() => void) | null = null;

    void listen("task://mutated", () => {
      if (isCurrent) {
        refreshAfterTaskMutation();
      }
    })
      .then((registeredUnlisten) => {
        if (!isCurrent) {
          registeredUnlisten();
          return;
        }

        unlisten = registeredUnlisten;
        refreshAfterTaskMutation();
      })
      .catch((error: unknown) => {
        console.error("Unable to subscribe to task mutation events", error);
      });

    return () => {
      isCurrent = false;
      unlisten?.();
    };
  }, []);

  const summaryLoadState = summaryQueryState.loadState;
  const calendarLoadState = calendarQueryState.loadState;
  const calendarErrorMessageKey =
    calendarLoadState?.status === "error" ? calendarLoadState.errorMessageKey : null;
  const calendarTasks = calendarLoadState?.status === "ready" ? calendarLoadState.tasks : [];
  const isCalendarLoading =
    calendarQueryState.activeView === "calendar" && calendarLoadState?.status === "loading";
  const isSummaryLoading = isSummaryView(activeView) && summaryLoadState?.status === "loading";
  const summaryErrorMessageKey =
    summaryLoadState?.status === "error" ? summaryLoadState.errorMessageKey : null;
  const summaryTasks = summaryLoadState?.status === "ready" ? summaryLoadState.tasks : [];
  const inboxTasks = inboxLoadState.status === "ready" ? (inboxLoadState.tasks ?? []) : [];
  const inboxStatus: TaskViewDataStatus = inboxLoadState.status;
  const summaryStatus: TaskViewDataStatus =
    summaryLoadState?.status === "loading"
      ? "loading"
      : summaryLoadState?.status === "error"
        ? "error"
        : "ready";

  const mobileContent: ReactNode =
    mobileRoute === "taskEditor" ? (
      <MobileTaskEditorView
        key={editingTask?.id ?? "new-mobile-task"}
        mode={editingTask ? "edit" : "create"}
        onCancelled={handleMobileEditorCancelled}
        onDirtyChange={setMobileHasUnsavedChanges}
        onSaved={handleMobileEditorSaved}
        taskId={editingTask?.id ?? null}
      />
    ) : mobileRoute === "syncSettings" ? (
      <MobileSyncSettingsView
        config={mobileSyncConfig}
        isLoading={mobileSyncLoading}
        isOnline={mobileOnline}
        isSaving={mobileSyncSaving}
        onReviewConflicts={() => setMobileRoute("conflicts")}
        onSave={handleMobileSaveSync}
        onSyncNow={handleMobileSyncNow}
        onTestConnection={(input: TestSyncConnectionInput) => testSyncConnection(input)}
        state={mobileSyncState}
      />
    ) : mobileRoute === "conflicts" ? (
      <MobileConflictView
        conflicts={mobileSyncConflicts}
        onBack={handleMobileBack}
        onResolve={handleMobileResolveConflict}
      />
    ) : mobileRoute === "projects" ? (
      <MobileProjectsView
        errorMessageKey={projectListErrorMessageKey ?? projectTaskState.errorMessageKey}
        isLoading={isProjectListLoading || projectTaskState.isLoading}
        onCreateProject={handleMobileCreateProject}
        onSelectProject={handleMobileProjectSelect}
        projects={projects}
        selectedProjectId={selectedProjectId}
        tasks={projectTaskState.tasks}
      />
    ) : mobileRoute === "inbox" ? (
      <MobileInboxView
        errorMessageKey={inboxLoadState.status === "error" ? inboxLoadState.errorMessageKey : null}
        isLoading={inboxLoadState.status === "loading"}
        onCreateTask={() => {
          setEditingTask(null);
          setMobileRoute("taskEditor");
        }}
        onOpenTask={(task) => {
          setEditingTask(task);
          setMobileRoute("taskEditor");
        }}
        onToggleCompleted={(task) => void handleMobileToggleCompleted(task)}
        tasks={inboxTasks}
      />
    ) : mobileRoute === "settings" ? (
      <section className="mobile-shell__slot" data-state="default">
        <p className="mobile-shell__slot-label">{t("settings.title")}</p>
        <h2>{t("settings.title")}</h2>
        <button
          className="mobile-shell__settings-link"
          onClick={() => setMobileRoute("syncSettings")}
          type="button"
        >
          {t("settings.sync")}
        </button>
      </section>
    ) : (
      <MobileTodayView
        completedTasks={mobileTodayState.completedTasks}
        errorMessageKey={mobileTodayState.errorMessageKey}
        isLoading={mobileTodayState.isLoading}
        onCreateTask={() => {
          setEditingTask(null);
          setMobileRoute("taskEditor");
        }}
        onOpenTask={(task) => {
          setEditingTask(task);
          setMobileRoute("taskEditor");
        }}
        onToggleCompleted={(task) => void handleMobileToggleCompleted(task)}
        tasks={mobileTodayState.tasks}
      />
    );

  if (isAndroidRuntime()) {
    return (
      <MobileAppShell
        activeRoute={mobileRoute}
        hasUnsavedChanges={mobileHasUnsavedChanges}
        onBack={handleMobileBack}
        onRouteChange={handleMobileRouteChange}
        previousRoute={mobilePreviousRouteRef.current}
      >
        {mobileContent}
      </MobileAppShell>
    );
  }

  if (isSettingsOpen) {
    return (
      <div className="settings-shell" data-testid="settings-shell">
        <SettingsWorkspace onBack={() => setIsSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <AppNavigation
        activeView={activeView}
        onCreateTask={handleNavigationNewTask}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onViewChange={handleViewChange}
      />
      <div className="app-workspace">
        <header
          aria-label={t("workspace.label")}
          className="workspace-bar"
          data-testid="workspace-bar"
        >
          <button
            aria-label={t("search.open")}
            className="workspace-bar__search"
            onClick={handleSearchOpened}
            title={t("search.open")}
            type="button"
          >
            <Search aria-hidden="true" size={16} />
            <span>{t("search.input")}</span>
          </button>
          <span className="workspace-bar__title">{t("app.title")}</span>
          <span aria-hidden="true" className="workspace-bar__spacer" />
        </header>
        <main
          aria-labelledby={activeView === "projects" ? "project-list-heading" : "task-view-heading"}
          className={`workspace-canvas task-view task-view--${activeView}`}
          data-testid="task-view"
        >
          {activeView !== "projects" ? (
            <header className="task-view__header">
              <div>
                <p className="task-view__eyebrow">{getViewTitle(activeView)}</p>
                <h1 id="task-view-heading">{getViewTitle(activeView)}</h1>
              </div>
            </header>
          ) : null}
          {activeView === "inbox" && isEditorOpen ? (
            <TaskEditor
              editorRefreshVersion={editorRefreshVersion}
              key={editingTask?.id ?? "new-task"}
              onSaved={handleTaskSaved}
              task={editingTask ?? undefined}
            />
          ) : null}
          {mutationErrorState?.view === activeView ? (
            <p className="task-ledger__error" role="alert">
              {translateErrorMessage(mutationErrorState.messageKey)}
            </p>
          ) : null}
          {activeView === "inbox" ? (
            <div className="task-view__layout">
              <section aria-label={t("tasks.ledger")} className="task-view__ledger">
                <TaskList
                  errorMessageKey={
                    inboxLoadState.status === "error" ? inboxLoadState.errorMessageKey : null
                  }
                  isLoading={inboxLoadState.status === "loading"}
                  onEdit={handleEditTask}
                  onToggleCompleted={(task) =>
                    void handleToggleCompleted(task.id, task.completedAt !== null)
                  }
                  pendingTaskIds={pendingTaskIds}
                  tasks={inboxTasks}
                />
              </section>
              <TaskViewInsights
                items={inboxTasks.map(toInboxInsightItem)}
                status={inboxStatus}
                view="inbox"
              />
            </div>
          ) : null}
          {activeView === "projects" ? (
            <>
              <ProjectList
                isLoading={isProjectListLoading}
                listErrorMessageKey={projectListErrorMessageKey}
                onProjectArchived={handleProjectArchived}
                onProjectCreated={handleProjectCreated}
                onProjectRenamed={handleProjectRenamed}
                onSelect={handleProjectSelect}
                projects={projects}
                selectedProjectId={selectedProjectId}
              />
              {selectedProject ? (
                <section aria-labelledby="project-tasks-heading" className="project-task-summary">
                  <header className="project-task-summary__header">
                    <p className="project-task-summary__eyebrow">
                      <FolderKanban aria-hidden="true" size={14} />
                      {t("projects.title")}
                    </p>
                    <h2 id="project-tasks-heading">{selectedProject.name}</h2>
                  </header>
                  {projectTaskState.errorMessageKey ? (
                    <p className="task-list__error" role="alert">
                      {translateErrorMessage(projectTaskState.errorMessageKey)}
                    </p>
                  ) : null}
                  {projectTaskState.isLoading ? (
                    <p className="task-list__status" role="status">
                      {t("tasks.loading")}
                    </p>
                  ) : null}
                  {!projectTaskState.isLoading && !projectTaskState.errorMessageKey ? (
                    <ProjectTaskBoard
                      onAddTask={handleNavigationNewTask}
                      onToggleCompleted={(id, completed) =>
                        void handleToggleCompleted(id, completed)
                      }
                      pendingTaskIds={pendingTaskIds}
                      tasks={projectTaskState.tasks}
                    />
                  ) : null}
                </section>
              ) : (
                <section className="project-task-summary project-task-summary--empty">
                  <p>{t("projects.selectPrompt")}</p>
                </section>
              )}
            </>
          ) : null}
          {activeView === "calendar" ? (
            <MonthCalendar
              errorMessage={
                calendarErrorMessageKey ? translateErrorMessage(calendarErrorMessageKey) : null
              }
              isLoading={isCalendarLoading}
              month={calendarMonth}
              onMonthChange={handleCalendarMonthChange}
              tasks={calendarTasks}
            />
          ) : null}
          {isSummaryView(activeView) ? (
            <div className="task-view__layout">
              <section aria-label={t("tasks.ledger")} className="task-view__ledger">
                {summaryErrorMessageKey ? (
                  <p className="task-ledger__error" role="alert">
                    {translateErrorMessage(summaryErrorMessageKey)}
                  </p>
                ) : null}
                {isSummaryLoading ? (
                  <p className="task-ledger__status" role="status">
                    {t("tasks.loading")}
                  </p>
                ) : null}
                {!isSummaryLoading && !summaryErrorMessageKey ? (
                  <TaskSummaryList
                    onToggleCompleted={(id, completed) => void handleToggleCompleted(id, completed)}
                    pendingTaskIds={pendingTaskIds}
                    tasks={summaryTasks}
                  />
                ) : null}
              </section>
              <TaskViewInsights
                items={summaryTasks.map(toSummaryInsightItem)}
                status={summaryStatus}
                view={activeView}
              />
            </div>
          ) : null}
        </main>
      </div>
      <SearchDialog
        isOpen={searchQueryState.isOpen}
        onClose={handleSearchClosed}
        onInputChange={handleSearchInputChanged}
        state={searchQueryState}
      />
    </div>
  );
}

export default App;
