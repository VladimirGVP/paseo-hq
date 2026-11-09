import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  ScrollView,
  SettingsAction,
  SettingsInput,
  SettingsSelect,
  SettingsSwitch,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  EMPTY_BOARD,
  MEMBER_KINDS,
  MEMBER_KIND_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  memberTaskCounts,
  newId,
  nextTaskStatus,
  taskColumns,
  teamConnectRpc,
  teamDisconnectRpc,
  teamSaveRpc,
  teamStateRpc,
  teamSyncRpc,
  type MemberKind,
  type TaskStatus,
  type TeamBoard,
  type TeamMember,
  type TeamRepo,
  type TeamTask,
} from "../shared/team";
import { workersListRpc, type WorkerInfo } from "../shared/contracts";

interface LiveAgent {
  id: string;
  title?: string | null;
  name?: string | null;
  status?: string | null;
  workspaceId?: string | null;
}

interface TeamStateData {
  connected: boolean;
  repo: TeamRepo | null;
  board: TeamBoard;
  error: string | null;
  syncedAt: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
  root: string;
}

const EMPTY_STATE: TeamStateData = {
  connected: false,
  repo: null,
  board: { ...EMPTY_BOARD },
  error: null,
  syncedAt: null,
};

function nowIso(): string {
  return new Date().toISOString();
}

function statusColorFor(status: string | null | undefined): string {
  if (status === "running") return "#10b981";
  if (status === "error" || status === "failed") return "#ef4444";
  if (status === "needs_input" || status === "waiting") return "#f59e0b";
  return "#94a3b8";
}

function memberStatusText(
  member: TeamMember,
  agentsByHost: Record<string, LiveAgent[]>,
  connectedHosts: Set<string>,
  selfServerId: string,
): { text: string; color: string } {
  if (member.kind === "human") return { text: "человек", color: "#94a3b8" };
  if (member.kind === "container") return { text: "контейнер", color: "#94a3b8" };
  const serverId = member.hostServerId || selfServerId;
  if (member.hostServerId && !connectedHosts.has(serverId)) {
    return { text: "хост не подключён", color: "#f59e0b" };
  }
  const agents = agentsByHost[serverId] ?? [];
  const bound = member.agentId ? agents.find((a) => a.id === member.agentId) : null;
  if (bound) return { text: bound.status || "idle", color: statusColorFor(bound.status) };
  const running = agents.filter((a) => a.status === "running").length;
  return running
    ? { text: `${running} в работе`, color: "#10b981" }
    : { text: "свободен", color: "#94a3b8" };
}

function taskPrompt(task: TeamTask): string {
  return [task.title, task.description].filter(Boolean).join("\n\n");
}

function emptyMember(): TeamMember {
  return {
    id: "",
    kind: "human",
    name: "",
    role: "",
    avatar: "🙂",
    hostServerId: null,
    agentId: null,
    provider: null,
    cwd: null,
    container: null,
    cgroupPath: null,
    activityPath: null,
    updatedAt: "",
  };
}

function emptyTask(): TeamTask {
  return {
    id: "",
    title: "",
    description: "",
    status: "backlog",
    assigneeId: null,
    projectId: null,
    priority: 0,
    createdAt: nowIso(),
    updatedAt: "",
    hostServerId: null,
    agentId: null,
    workspaceId: null,
    externalUrl: null,
    personal: false,
    ownerId: null,
  };
}

export function TeamSurface({ theme, layout, host, navigation }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const stateRpc = useRpc(teamStateRpc);
  const syncRpc = useRpc(teamSyncRpc);
  const saveRpc = useRpc(teamSaveRpc);
  const connectRpc = useRpc(teamConnectRpc);
  const disconnectRpc = useRpc(teamDisconnectRpc);
  const workersRpc = useRpc(workersListRpc);

  const [state, setState] = useState<TeamStateData>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"team" | "tasks">("team");
  const [hidePersonal, setHidePersonal] = useState(false);
  const [connectUrl, setConnectUrl] = useState("");
  const [connectBranch, setConnectBranch] = useState("main");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [agentsByHost, setAgentsByHost] = useState<Record<string, LiveAgent[]>>({});
  const [connectedHosts, setConnectedHosts] = useState<Set<string>>(new Set());
  const [selfServerId, setSelfServerId] = useState(host.id);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [memberDraft, setMemberDraft] = useState<TeamMember | null | undefined>(undefined);
  const [taskDraft, setTaskDraft] = useState<TeamTask | null | undefined>(undefined);

  const c = theme.colors;

  const loadLive = useCallback(async () => {
    try {
      const directory = await paseo.hosts.list();
      const hosts = new Set<string>();
      const map: Record<string, LiveAgent[]> = {};
      hosts.add(directory.self.serverId);
      setSelfServerId(directory.self.serverId);
      map[directory.self.serverId] = ((await paseo.agents.list({})).entries ?? []).map((e) => e.agent as LiveAgent);
      for (const remote of directory.hosts ?? []) {
        if (!remote.serverId || !remote.enabled) continue;
        if (remote.status === "offline" || remote.status === "error" || remote.status === "disabled") continue;
        try {
          const api = await paseo.hosts.client(remote.serverId);
          map[remote.serverId] = ((await api.agents.list({})).entries ?? []).map((e) => e.agent as LiveAgent);
          hosts.add(remote.serverId);
        } catch {
          // хост временно недоступен
        }
      }
      setAgentsByHost(map);
      setConnectedHosts(hosts);
      try {
        const listed = await workersRpc({});
        setWorkers(listed.workers ?? []);
      } catch {
        // список контейнеров не критичен
      }
    } catch {
      // статусы не критичны для работы доски
    }
  }, [paseo, workersRpc]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await paseo.projects.list({});
      setProjects(
        (res.projects ?? []).map((p) => ({
          id: p.projectId,
          name: p.projectDisplayName || p.projectCustomName || p.projectRootPath.split("/").pop() || "Проект",
          root: p.projectRootPath,
        })),
      );
    } catch {
      // без проектов задача запустится в каталоге члена команды
    }
  }, [paseo]);

  const load = useCallback(
    async (sync: boolean) => {
      setLoading(true);
      try {
        const res = (await stateRpc({})) as TeamStateData;
        setState(res);
        if (res.connected && sync) {
          const pulled = await syncRpc({});
          if (pulled.ok) setState((prev) => ({ ...prev, board: pulled.board, error: null }));
          else if (pulled.error) toast.error(pulled.error);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "не удалось прочитать команду");
      } finally {
        setLoading(false);
      }
    },
    [stateRpc, syncRpc, toast],
  );

  useEffect(() => {
    void load(true);
    void loadLive();
    void loadProjects();
    const timer = setInterval(() => void loadLive(), 15000);
    return () => clearInterval(timer);
  }, [load, loadLive, loadProjects]);

  const persist = useCallback(
    async (next: TeamBoard, removedTaskIds: string[] = [], removedMemberIds: string[] = []): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await saveRpc({ board: next, removedTaskIds, removedMemberIds });
        if (res.ok) {
          setState((prev) => ({ ...prev, board: res.board, error: null }));
          return true;
        }
        toast.error(res.error || "не удалось сохранить доску");
        return false;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "нет связи с сервером штаба");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [saveRpc, toast],
  );

  const handleSync = async () => {
    setBusy(true);
    try {
      const res = await syncRpc({});
      if (res.ok) {
        setState((prev) => ({ ...prev, board: res.board, error: null }));
        toast.show("Доска обновлена", { variant: "success" });
      } else {
        toast.error(res.error || "не удалось обновить доску");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = async () => {
    const url = connectUrl.trim();
    if (!url) {
      setConnectError("укажите ссылку на репозиторий");
      return;
    }
    setBusy(true);
    setConnectError(null);
    try {
      const res = await connectRpc({ url, branch: connectBranch.trim() || "main" });
      if (res.ok && res.repo) {
        setState({ connected: true, repo: res.repo, board: res.board, error: null, syncedAt: nowIso() });
        toast.show("Репозиторий команды подключён", { variant: "success" });
      } else {
        setConnectError(res.error || "не удалось подключить репозиторий");
        setState((prev) => ({ ...prev, repo: res.repo }));
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "не удалось подключить репозиторий");
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await disconnectRpc({});
      setState(EMPTY_STATE);
      toast.show("Репозиторий отключён");
    } finally {
      setBusy(false);
    }
  };

  const saveMember = async (member: TeamMember) => {
    const next = { ...member, updatedAt: nowIso() };
    const board: TeamBoard = {
      ...state.board,
      members: state.board.members.some((m) => m.id === next.id)
        ? state.board.members.map((m) => (m.id === next.id ? next : m))
        : [...state.board.members, next],
    };
    if (await persist(board)) setMemberDraft(undefined);
  };

  const removeMember = async (member: TeamMember) => {
    const board: TeamBoard = {
      ...state.board,
      members: state.board.members.filter((m) => m.id !== member.id),
      tasks: state.board.tasks.map((t) => (t.assigneeId === member.id ? { ...t, assigneeId: null } : t)),
    };
    if (await persist(board, [], [member.id])) setMemberDraft(undefined);
  };

  const addWorkerMember = async (worker: WorkerInfo) => {
    await saveMember({
      id: newId("mem"),
      kind: "container",
      name: worker.name,
      role: worker.role || "",
      avatar: worker.avatar || "🧑‍💻",
      hostServerId: null,
      agentId: null,
      provider: null,
      cwd: null,
      container: worker.container,
      cgroupPath: null,
      activityPath: null,
      updatedAt: nowIso(),
    });
  };

  const saveTask = async (task: TeamTask) => {
    const next = { ...task, updatedAt: nowIso() };
    const board: TeamBoard = {
      ...state.board,
      tasks: state.board.tasks.some((t) => t.id === next.id)
        ? state.board.tasks.map((t) => (t.id === next.id ? next : t))
        : [...state.board.tasks, next],
    };
    if (await persist(board)) setTaskDraft(undefined);
  };

  const removeTask = async (task: TeamTask) => {
    await persist({ ...state.board, tasks: state.board.tasks.filter((t) => t.id !== task.id) }, [task.id], []);
  };

  const moveTask = async (task: TeamTask) => {
    await saveTask({ ...task, status: nextTaskStatus(task.status) });
  };

  const dispatch = async (task: TeamTask) => {
    const member = state.board.members.find((m) => m.id === task.assigneeId);
    if (!member) {
      toast.error("сначала назначьте исполнителя");
      return;
    }
    if (member.kind === "human") {
      toast.error("это человек, задача не запускается агентом");
      return;
    }
    if (!member.provider) {
      toast.error("укажите провайдера у члена команды, например codex/gpt-6.1-terra");
      return;
    }
    const project = projects.find((p) => p.id === task.projectId);
    const cwd = member.cwd || project?.root;
    if (!cwd) {
      toast.error("укажите рабочий каталог у члена команды или выберите проект");
      return;
    }
    setBusy(true);
    try {
      const api =
        member.hostServerId && member.hostServerId !== host.id
          ? await paseo.hosts.client(member.hostServerId)
          : paseo;
      const handle = await api.agents.create({
        config: { provider: member.provider },
        cwd,
        prompt: taskPrompt(task),
        title: task.title,
        labels: { "hq-task": task.id, "hq-member": member.id },
      });
      const next: TeamTask = {
        ...task,
        status: "doing",
        hostServerId: member.hostServerId ?? host.id,
        agentId: handle.id,
        workspaceId: handle.workspaceId ?? null,
        updatedAt: nowIso(),
      };
      const board: TeamBoard = {
        ...state.board,
        tasks: state.board.tasks.map((t) => (t.id === next.id ? next : t)),
      };
      if (await persist(board)) {
        toast.show("Задача запущена агентом", { variant: "success" });
        void loadLive();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "не удалось запустить агента");
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo(() => {
    const tasks = hidePersonal ? state.board.tasks.filter((t) => !t.personal) : state.board.tasks;
    return taskColumns({ ...state.board, tasks });
  }, [state.board, hidePersonal]);
  const counts = useMemo(() => memberTaskCounts(state.board), [state.board]);
  const memberOptions = useMemo(
    () => [
      { label: "Без исполнителя", value: "" },
      ...state.board.members.map((m) => ({ label: `${m.avatar} ${m.name}`, value: m.id })),
    ],
    [state.board.members],
  );

  const availableWorkers = useMemo(
    () => workers.filter((w) => !state.board.members.some((m) => m.kind === "container" && m.container === w.container)),
    [workers, state.board.members],
  );

  const renderConnect = () => (
    <View style={{ gap: 14, maxWidth: 620 }}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: c.foreground, fontSize: 16, fontWeight: "700" }}>
          Подключите репозиторий команды
        </Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 19 }}>
          Члены команды и задачи хранятся в git-репозитории в файле hq.json. Пока репозиторий не подключён,
          доска не работает. Подойдёт пустой или уже существующий репозиторий, к которому у сервера есть доступ.
        </Text>
      </View>
      <SettingsInput label="Репозиторий" placeholder="github.com/you/team или git@..." onChangeText={setConnectUrl} />
      <SettingsInput label="Ветка" initialValue={connectBranch} onChangeText={setConnectBranch} />
      {connectError ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{connectError}</Text> : null}
      <SettingsAction
        label="Подключение"
        hint="Репозиторий клонируется в служебную папку штаба"
        actionLabel={busy ? "Подключаем..." : "Подключить"}
        disabled={busy}
        onPress={() => void handleConnect()}
      />
    </View>
  );

  const renderMemberCard = (member: TeamMember) => {
    const status = memberStatusText(member, agentsByHost, connectedHosts, selfServerId);
    const assigned = counts[member.id] ?? 0;
    const worker =
      member.kind === "container" && member.container
        ? workers.find((w) => w.container === member.container)
        : undefined;
    return (
      <View
        key={member.id}
        style={{
          width: layout.compact ? "100%" : "48.5%",
          minWidth: 300,
          backgroundColor: c.surface1,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: c.border,
          padding: 14,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 26 }}>{member.avatar}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 15, fontWeight: "700" }}>
              {member.name}
            </Text>
            <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>
              {member.role || MEMBER_KIND_LABELS[member.kind]}
            </Text>
          </View>
          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 6,
              backgroundColor: `${status.color}18`,
            }}
          >
            <Text style={{ color: status.color, fontSize: 11, fontWeight: "600" }}>{status.text}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>{MEMBER_KIND_LABELS[member.kind]}</Text>
          {member.provider ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>{member.provider}</Text>
          ) : null}
          <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
            {assigned ? `${assigned} задач в работе` : "задач нет"}
          </Text>
          {worker?.stats.available ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
              CPU {worker.stats.cpu === null ? "..." : `${worker.stats.cpu.toFixed(0)}%`} · {worker.status}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMemberDraft(member)}
            style={({ pressed }) => ({
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 7,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: pressed ? c.surface2 : undefined,
            })}
          >
            <Text style={{ color: c.foreground, fontSize: 12 }}>Изменить</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void removeMember(member)}
            style={({ pressed }) => ({
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 7,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: pressed ? c.surface2 : undefined,
            })}
          >
            <Text style={{ color: c.statusDanger, fontSize: 12 }}>Убрать</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderTaskCard = (task: TeamTask) => {
    const member = state.board.members.find((m) => m.id === task.assigneeId);
    const project = projects.find((p) => p.id === task.projectId);
    const canDispatch = Boolean(member && member.kind !== "human");
    return (
      <View
        key={task.id}
        style={{
          backgroundColor: c.surface1,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: c.border,
          padding: 10,
          gap: 7,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {task.personal ? <Icon name="Lock" size={12} color={c.foregroundMuted} /> : null}
          <Text style={{ color: c.foreground, fontSize: 13.5, fontWeight: "600", flexShrink: 1 }}>{task.title}</Text>
        </View>
        {task.description ? (
          <Text numberOfLines={2} style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
            {task.description}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {member ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
              {member.avatar} {member.name}
            </Text>
          ) : (
            <Text style={{ color: c.statusWarning, fontSize: 11 }}>без исполнителя</Text>
          )}
          {project ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{project.name}</Text> : null}
          {task.priority > 0 ? (
            <Text style={{ color: c.accent, fontSize: 11 }}>{"!".repeat(task.priority)}</Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void moveTask(task)}
            style={({ pressed }) => ({
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: 6,
              backgroundColor: c.surface2,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: c.foreground, fontSize: 11 }}>
              → {TASK_STATUS_LABELS[nextTaskStatus(task.status)]}
            </Text>
          </Pressable>
          {canDispatch && !task.agentId ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void dispatch(task)}
              style={({ pressed }) => ({
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: 6,
                backgroundColor: c.accent,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "600" }}>Запустить</Text>
            </Pressable>
          ) : null}
          {task.agentId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const serverId = task.hostServerId || host.id;
                if (navigation?.openAgent) navigation.openAgent({ agentId: task.agentId!, serverId });
                else toast.show(`Агент ${task.agentId}`);
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: 6,
                backgroundColor: c.surface2,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: c.foreground, fontSize: 11 }}>Открыть чат</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void removeTask(task)}
            style={({ pressed }) => ({
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: 6,
              backgroundColor: c.surface2,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: c.statusDanger, fontSize: 11 }}>Удалить</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderBoard = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
      {TASK_STATUSES.map((status) => (
        <View
          key={status}
          style={{
            width: layout.compact ? 260 : 280,
            gap: 8,
            backgroundColor: c.surface2,
            borderRadius: 11,
            borderWidth: 1,
            borderColor: c.border,
            padding: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: c.foreground, fontSize: 12.5, fontWeight: "700" }}>{TASK_STATUS_LABELS[status]}</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{columns[status].length}</Text>
          </View>
          <ScrollView style={{ maxHeight: layout.compact ? 420 : 520 }} contentContainerStyle={{ gap: 8 }}>
            {columns[status].length === 0 ? (
              <Text style={{ color: c.foregroundMuted, fontSize: 11.5, paddingVertical: 6 }}>пусто</Text>
            ) : (
              columns[status].map(renderTaskCard)
            )}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 260 }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: "#10b98120",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="Users" size={20} color="#10b981" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.foreground, fontSize: 18, fontWeight: "700" }}>Команда и задачи</Text>
              <Text style={{ color: c.foregroundMuted, fontSize: 12.5, marginTop: 1 }}>
                {state.connected
                  ? `${state.repo?.url ?? ""} · ${state.repo?.branch ?? ""}`
                  : "репозиторий команды не подключён"}
              </Text>
            </View>
          </View>
          {state.connected ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void handleSync()}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 8,
                backgroundColor: c.surface2,
                borderWidth: 1,
                borderColor: c.border,
                opacity: pressed || busy ? 0.7 : 1,
              })}
            >
              <Icon name="RefreshCw" size={14} color={c.foreground} />
              <Text style={{ color: c.foreground, fontSize: 13 }}>Синхронизировать</Text>
            </Pressable>
          ) : null}
        </View>

        {state.connected ? (
          <View
            style={{
              flexDirection: "row",
              alignSelf: "flex-start",
              padding: 4,
              borderRadius: 10,
              backgroundColor: c.surface2,
              borderWidth: 1,
              borderColor: c.border,
              gap: 4,
            }}
          >
            {(
              [
                ["team", "Команда"],
                ["tasks", "Задачи"],
              ] as const
            ).map(([id, label]) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                onPress={() => setTab(id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 7,
                  backgroundColor: tab === id ? c.surface1 : undefined,
                }}
              >
                <Text
                  style={{
                    color: tab === id ? c.foreground : c.foregroundMuted,
                    fontSize: 12.5,
                    fontWeight: "600",
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {state.error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{state.error}</Text> : null}

        {!state.connected ? (
          renderConnect()
        ) : loading ? (
          <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Читаем доску...</Text>
        ) : tab === "team" ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "700" }}>
                {state.board.members.length} в команде
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMemberDraft(null)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 8,
                  backgroundColor: c.accent,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Icon name="Plus" size={15} color="#FFFFFF" />
                <Text style={{ color: "#FFFFFF", fontSize: 12.5, fontWeight: "600" }}>Добавить</Text>
              </Pressable>
            </View>
            {state.board.members.length === 0 ? (
              <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>
                Пока никого. Добавьте себя и того, с кем работаете.
              </Text>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {state.board.members.map(renderMemberCard)}
              </View>
            )}

            {availableWorkers.length > 0 ? (
              <View style={{ gap: 8, paddingTop: 4 }}>
                <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "700" }}>
                  Контейнеры с монитора, ещё не в команде
                </Text>
                {availableWorkers.map((w) => (
                  <View
                    key={w.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: 9,
                      backgroundColor: c.surface2,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text style={{ fontSize: 16 }}>{w.avatar}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13.5, fontWeight: "600" }}>
                        {w.name}
                      </Text>
                      <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
                        {w.container} · {w.role || "контейнер"}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void addWorkerMember(w)}
                      style={({ pressed }) => ({
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 7,
                        backgroundColor: c.accent,
                        opacity: pressed || busy ? 0.8 : 1,
                      })}
                    >
                      <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>В команду</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={{ gap: 6, paddingTop: 8 }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
                Задач всего: {state.board.tasks.length}, в работе:{" "}
                {state.board.tasks.filter((t) => t.status === "doing").length}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void handleDisconnect()}>
                <Text style={{ color: c.statusDanger, fontSize: 11.5 }}>Отключить репозиторий</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "700" }}>
                {state.board.tasks.length} задач
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setHidePersonal((v) => !v)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: hidePersonal ? c.surface2 : undefined,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Icon name="Lock" size={13} color={hidePersonal ? c.accent : c.foregroundMuted} />
                  <Text style={{ color: hidePersonal ? c.accent : c.foregroundMuted, fontSize: 12 }}>
                    Скрыть личные
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setTaskDraft(null)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 8,
                    backgroundColor: c.accent,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Icon name="Plus" size={15} color="#FFFFFF" />
                  <Text style={{ color: "#FFFFFF", fontSize: 12.5, fontWeight: "600" }}>Задача</Text>
                </Pressable>
              </View>
            </View>
            {renderBoard()}
          </View>
        )}
      </ScrollView>

      <MemberModal
        draft={memberDraft}
        theme={theme}
        workers={workers}
        hosts={[
          { label: "Текущий хост", value: "" },
          ...Array.from(connectedHosts)
            .filter((id) => id !== host.id)
            .map((id) => ({ label: id, value: id })),
        ]}
        onClose={() => setMemberDraft(undefined)}
        onSave={(member) => void saveMember(member)}
        onRemove={(member) => void removeMember(member)}
      />

      <TaskModal
        draft={taskDraft}
        theme={theme}
        members={state.board.members}
        memberOptions={memberOptions}
        projectOptions={[
          { label: "Без проекта", value: "" },
          ...projects.map((p) => ({ label: p.name, value: p.id })),
        ]}
        onClose={() => setTaskDraft(undefined)}
        onSave={(task) => void saveTask(task)}
      />
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  theme,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  theme: PluginTheme;
}) {
  const c = theme.colors;
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderRadius: 9,
          backgroundColor: c.surface2,
          borderWidth: 1,
          borderColor: c.border,
          color: c.foreground,
          fontSize: 13,
        }}
      />
    </View>
  );
}

function MemberModal({
  draft,
  theme,
  workers,
  hosts,
  onClose,
  onSave,
  onRemove,
}: {
  draft: TeamMember | null | undefined;
  theme: PluginTheme;
  workers: WorkerInfo[];
  hosts: { label: string; value: string }[];
  onClose: () => void;
  onSave: (member: TeamMember) => void;
  onRemove: (member: TeamMember) => void;
}) {
  const c = theme.colors;
  const open = draft !== undefined;
  const [form, setForm] = useState<TeamMember>(() => emptyMember());

  useEffect(() => {
    setForm(draft ? { ...draft } : emptyMember());
  }, [draft]);

  const update = (patch: Partial<TeamMember>) => setForm((prev) => ({ ...prev, ...patch }));
  const valid = form.name.trim().length > 0;

  return (
    <Modal title={draft ? "Член команды" : "Новый член команды"} open={open} onOpenChange={(value) => !value && onClose()}>
      <Modal.Content>
        <View style={{ gap: 14 }}>
          <Field label="Имя" value={form.name} onChangeText={(name) => update({ name })} theme={theme} />
          <Field
            label="Роль"
            value={form.role}
            onChangeText={(role) => update({ role })}
            placeholder="Разработчик, дизайнер..."
            theme={theme}
          />
          <Field
            label="Аватар"
            value={form.avatar}
            onChangeText={(avatar) => update({ avatar })}
            placeholder="🙂"
            theme={theme}
          />
          <SettingsSelect
            label="Вид"
            value={form.kind}
            options={MEMBER_KINDS.map((kind) => ({ label: MEMBER_KIND_LABELS[kind], value: kind }))}
            onValueChange={(kind) => update({ kind })}
          />
          {form.kind === "paseo" ? (
            <>
              <SettingsSelect
                label="Хост Paseo"
                value={form.hostServerId ?? ""}
                options={hosts}
                onValueChange={(value) => update({ hostServerId: value || null })}
              />
              <Field
                label="Провайдер и модель"
                value={form.provider ?? ""}
                onChangeText={(value) => update({ provider: value.trim() || null })}
                placeholder="codex/gpt-6.1-terra"
                theme={theme}
              />
              <Field
                label="Рабочий каталог"
                value={form.cwd ?? ""}
                onChangeText={(value) => update({ cwd: value.trim() || null })}
                placeholder="/home/agent/repos/vps-agent"
                theme={theme}
              />
            </>
          ) : null}
          {form.kind === "container" ? (
            <SettingsSelect
              label="Контейнер"
              hint="Контейнеры берутся из монитора workers.json — достаточно выбрать по названию"
              value={form.container ?? ""}
              options={[
                { label: "Выберите контейнер", value: "" },
                ...workers.map((w) => ({ label: `${w.avatar} ${w.name} · ${w.container}`, value: w.container })),
              ]}
              onValueChange={(value) => {
                const worker = workers.find((w) => w.container === value);
                update({
                  container: value || null,
                  ...(worker
                    ? {
                        name: form.name.trim() ? form.name : worker.name,
                        role: form.role.trim() ? form.role : worker.role,
                        avatar: form.avatar !== "🙂" ? form.avatar : worker.avatar,
                      }
                    : {}),
                });
              }}
            />
          ) : null}
          {!valid ? <Text style={{ color: c.statusWarning, fontSize: 12 }}>Укажите имя.</Text> : null}
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "flex-end", paddingTop: 4 }}>
            {draft ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onRemove(form)}
                style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: c.border }}
              >
                <Text style={{ color: c.statusDanger, fontSize: 13 }}>Убрать</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={!valid}
              onPress={() => valid && onSave({ ...form, id: form.id || newId("mem"), name: form.name.trim() })}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 9,
                borderRadius: 8,
                backgroundColor: c.accent,
                opacity: valid ? 1 : 0.5,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600" }}>Сохранить</Text>
            </Pressable>
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}

function TaskModal({
  draft,
  theme,
  members,
  memberOptions,
  projectOptions,
  onClose,
  onSave,
}: {
  draft: TeamTask | null | undefined;
  theme: PluginTheme;
  members: TeamMember[];
  memberOptions: { label: string; value: string }[];
  projectOptions: { label: string; value: string }[];
  onClose: () => void;
  onSave: (task: TeamTask) => void;
}) {
  const c = theme.colors;
  const open = draft !== undefined;
  const [form, setForm] = useState<TeamTask>(() => emptyTask());
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    const base = draft ? { ...draft } : emptyTask();
    setForm(base);
    setTitle(base.title);
    setDescription(base.description);
  }, [draft]);

  const update = (patch: Partial<TeamTask>) => setForm((prev) => ({ ...prev, ...patch }));
  const assignee = members.find((m) => m.id === form.assigneeId);
  const valid = title.trim().length > 0;

  return (
    <Modal title={draft ? "Задача" : "Новая задача"} open={open} onOpenChange={(value) => !value && onClose()}>
      <Modal.Content>
        <View style={{ gap: 14 }}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Что нужно сделать"
            placeholderTextColor={c.foregroundMuted}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderRadius: 9,
              backgroundColor: c.surface2,
              borderWidth: 1,
              borderColor: c.border,
              color: c.foreground,
              fontSize: 14,
            }}
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Описание, детали, ссылки"
            placeholderTextColor={c.foregroundMuted}
            multiline
            style={{
              minHeight: 80,
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderRadius: 9,
              backgroundColor: c.surface2,
              borderWidth: 1,
              borderColor: c.border,
              color: c.foreground,
              fontSize: 13,
            }}
          />
          <SettingsSelect
            label="Исполнитель"
            value={form.assigneeId ?? ""}
            options={memberOptions}
            onValueChange={(value) => update({ assigneeId: value || null })}
          />
          <SettingsSelect
            label="Проект"
            value={form.projectId ?? ""}
            options={projectOptions}
            onValueChange={(value) => update({ projectId: value || null })}
          />
          <SettingsSelect
            label="Статус"
            value={form.status}
            options={TASK_STATUSES.map((status) => ({ label: TASK_STATUS_LABELS[status], value: status }))}
            onValueChange={(value) => update({ status: value })}
          />
          <SettingsSelect
            label="Приоритет"
            value={String(form.priority)}
            options={[
              { label: "Обычный", value: "0" },
              { label: "Важный", value: "1" },
              { label: "Срочный", value: "2" },
            ]}
            onValueChange={(value) => update({ priority: Number(value) || 0 })}
          />
          <SettingsSwitch
            label="Личная задача"
            hint="Видна только в моей ленте, не для общей команды"
            value={form.personal}
            onValueChange={(value) => update({ personal: value })}
          />
          {assignee && assignee.kind === "paseo" && !assignee.provider ? (
            <Text style={{ color: c.statusWarning, fontSize: 12 }}>
              У исполнителя не указан провайдер - задача сохранится, но запуск будет недоступен.
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "flex-end", paddingTop: 4 }}>
            <Pressable
              accessibilityRole="button"
              disabled={!valid}
              onPress={() =>
                valid && onSave({ ...form, title: title.trim(), description, id: form.id || newId("task") })
              }
              style={{
                paddingHorizontal: 16,
                paddingVertical: 9,
                borderRadius: 8,
                backgroundColor: c.accent,
                opacity: valid ? 1 : 0.5,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600" }}>Сохранить</Text>
            </Pressable>
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
