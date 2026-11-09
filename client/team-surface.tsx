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
  boardSaveRpc,
  boardStateRpc,
  boardSyncRpc,
  boardsConnectRpc,
  boardsDisconnectRpc,
  boardsListRpc,
  type BoardSummary,
  type MemberKind,
  type TaskStatus,
  type TeamBoard,
  type TeamMember,
  type TeamTask,
} from "../shared/team";
import { workersListRpc, type WorkerInfo } from "../shared/contracts";

interface ProjectOption {
  id: string;
  name: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyMember(): TeamMember {
  return { id: "", kind: "human", name: "", role: "", avatar: "🙂", container: null, updatedAt: "" };
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
    externalUrl: null,
    personal: false,
    ownerId: null,
  };
}

export function TeamSurface({ theme, layout }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const listRpc = useRpc(boardsListRpc);
  const connectRpc = useRpc(boardsConnectRpc);
  const disconnectRpc = useRpc(boardsDisconnectRpc);
  const stateRpc = useRpc(boardStateRpc);
  const syncRpc = useRpc(boardSyncRpc);
  const saveRpc = useRpc(boardSaveRpc);
  const workersRpc = useRpc(workersListRpc);

  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [board, setBoard] = useState<TeamBoard>({ ...EMPTY_BOARD });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"team" | "tasks">("team");
  const [addingBoard, setAddingBoard] = useState(false);
  const [connectUrl, setConnectUrl] = useState("");
  const [connectBranch, setConnectBranch] = useState("main");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [hidePersonal, setHidePersonal] = useState(false);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [memberDraft, setMemberDraft] = useState<TeamMember | null | undefined>(undefined);
  const [taskDraft, setTaskDraft] = useState<TeamTask | null | undefined>(undefined);

  const c = theme.colors;

  const loadBoard = useCallback(
    async (id: string) => {
      try {
        const res = await stateRpc({ boardId: id });
        setBoard(res.board);
        setError(res.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "не удалось прочитать доску");
      }
    },
    [stateRpc],
  );

  const loadBoards = useCallback(
    async (selectId?: string) => {
      setLoading(true);
      try {
        const res = await listRpc({});
        setBoards(res.boards);
        const id = selectId ?? (res.boards[0]?.id ?? "");
        setCurrentId(id);
        if (id) await loadBoard(id);
        else setBoard({ ...EMPTY_BOARD });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "не удалось прочитать доски");
      } finally {
        setLoading(false);
      }
    },
    [listRpc, loadBoard, toast],
  );

  const loadWorkers = useCallback(async () => {
    try {
      const res = await workersRpc({});
      setWorkers(res.workers ?? []);
    } catch {
      // контейнеры не критичны
    }
  }, [workersRpc]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await paseo.projects.list({});
      setProjects(
        (res.projects ?? []).map((p) => ({
          id: p.projectId,
          name: p.projectDisplayName || p.projectCustomName || p.projectRootPath.split("/").pop() || "Проект",
        })),
      );
    } catch {
      // без проектов тоже можно
    }
  }, [paseo]);

  useEffect(() => {
    void loadBoards();
    void loadWorkers();
    void loadProjects();
    const timer = setInterval(() => void loadWorkers(), 15000);
    return () => clearInterval(timer);
  }, [loadBoards, loadWorkers, loadProjects]);

  const persist = useCallback(
    async (next: TeamBoard, removedTaskIds: string[] = [], removedMemberIds: string[] = []): Promise<boolean> => {
      if (!currentId) {
        toast.error("сначала подключите доску");
        return false;
      }
      setBusy(true);
      try {
        const res = await saveRpc({ boardId: currentId, board: next, removedTaskIds, removedMemberIds });
        if (res.ok) {
          setBoard(res.board);
          setError(null);
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
    [currentId, saveRpc, toast],
  );

  const handleSync = async () => {
    if (!currentId) return;
    setBusy(true);
    try {
      const res = await syncRpc({ boardId: currentId });
      if (res.ok) {
        setBoard(res.board);
        setError(null);
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
      if (res.ok && res.board) {
        setBoards((prev) => [...prev.filter((b) => b.id !== res.board!.id), res.board!]);
        setCurrentId(res.board.id);
        await loadBoard(res.board.id);
        setAddingBoard(false);
        setConnectUrl("");
        toast.show("Доска подключена", { variant: "success" });
      } else {
        setConnectError(res.error || "не удалось подключить репозиторий");
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "не удалось подключить репозиторий");
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    setBusy(true);
    try {
      await disconnectRpc({ boardId: id });
      await loadBoards();
      toast.show("Доска отключена");
    } finally {
      setBusy(false);
    }
  };

  const saveMember = async (member: TeamMember) => {
    const next = { ...member, updatedAt: nowIso() };
    const nextBoard: TeamBoard = {
      ...board,
      members: board.members.some((m) => m.id === next.id)
        ? board.members.map((m) => (m.id === next.id ? next : m))
        : [...board.members, next],
    };
    if (await persist(nextBoard)) setMemberDraft(undefined);
  };

  const removeMember = async (member: TeamMember) => {
    const nextBoard: TeamBoard = {
      ...board,
      members: board.members.filter((m) => m.id !== member.id),
      tasks: board.tasks.map((t) => (t.assigneeId === member.id ? { ...t, assigneeId: null } : t)),
    };
    if (await persist(nextBoard, [], [member.id])) setMemberDraft(undefined);
  };

  const addWorkerMember = async (worker: WorkerInfo) => {
    await saveMember({
      id: newId("mem"),
      kind: "container",
      name: worker.name,
      role: worker.role || "",
      avatar: worker.avatar || "🧑‍💻",
      container: worker.container,
      updatedAt: nowIso(),
    });
  };

  const saveTask = async (task: TeamTask) => {
    const next = { ...task, updatedAt: nowIso() };
    const nextBoard: TeamBoard = {
      ...board,
      tasks: board.tasks.some((t) => t.id === next.id)
        ? board.tasks.map((t) => (t.id === next.id ? next : t))
        : [...board.tasks, next],
    };
    if (await persist(nextBoard)) setTaskDraft(undefined);
  };

  const removeTask = async (task: TeamTask) => {
    await persist({ ...board, tasks: board.tasks.filter((t) => t.id !== task.id) }, [task.id], []);
  };

  const moveTask = async (task: TeamTask) => {
    await saveTask({ ...task, status: nextTaskStatus(task.status) });
  };

  const columns = useMemo(() => {
    const tasks = hidePersonal ? board.tasks.filter((t) => !t.personal) : board.tasks;
    return taskColumns({ ...board, tasks });
  }, [board, hidePersonal]);

  const counts = useMemo(() => memberTaskCounts(board), [board]);

  const memberOptions = useMemo(
    () => [
      { label: "Без исполнителя", value: "" },
      ...board.members.map((m) => ({ label: `${m.avatar} ${m.name}`, value: m.id })),
    ],
    [board.members],
  );

  const availableWorkers = useMemo(
    () => workers.filter((w) => !board.members.some((m) => m.kind === "container" && m.container === w.container)),
    [workers, board.members],
  );

  const renderConnect = () => (
    <View style={{ gap: 14, maxWidth: 620 }}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: c.foreground, fontSize: 16, fontWeight: "700" }}>Подключите доску</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 19 }}>
          Команда и задачи хранятся в git-репозитории в файле hq.json. Одна доска — один репозиторий.
          Можно подключить несколько досок и переключаться между ними.
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
    const assigned = counts[member.id] ?? 0;
    const worker = member.kind === "container" && member.container
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
          <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: c.surface2 }}>
            <Text style={{ color: c.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
              {MEMBER_KIND_LABELS[member.kind]}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
    const member = board.members.find((m) => m.id === task.assigneeId);
    const project = projects.find((p) => p.id === task.projectId);
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
                {boards.length === 0 ? "доски не подключены" : `${boards.length} досок`}
              </Text>
            </View>
          </View>
          {currentId ? (
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

        {boards.length > 0 ? (
          <View style={{ gap: 8 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {boards.map((b) => (
                <Pressable
                  key={b.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setCurrentId(b.id);
                    void loadBoard(b.id);
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 9,
                    borderWidth: 1,
                    borderColor: b.id === currentId ? c.accent : c.border,
                    backgroundColor: b.id === currentId ? `${c.accent}18` : c.surface2,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ color: b.id === currentId ? c.accent : c.foreground, fontSize: 13, fontWeight: "600" }}>
                    {b.name}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => setAddingBoard(true)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 9,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderStyle: "dashed",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="Plus" size={14} color={c.foregroundMuted} />
                <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Доска</Text>
              </Pressable>
            </ScrollView>
          </View>
        ) : null}

        {addingBoard ? (
          renderConnect()
        ) : boards.length === 0 ? (
          renderConnect()
        ) : null}

        {error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{error}</Text> : null}

        {!currentId ? (
          <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Подключите доску, чтобы начать.</Text>
        ) : loading ? (
          <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Читаем доску...</Text>
        ) : (
          <>
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

            {tab === "team" ? (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "700" }}>
                    {board.members.length} в команде
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

                {board.members.length === 0 ? (
                  <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>
                    Пока никого. Добавьте себя и того, с кем работаете.
                  </Text>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                    {board.members.map(renderMemberCard)}
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

                <Pressable accessibilityRole="button" onPress={() => void handleDisconnect(currentId)}>
                  <Text style={{ color: c.statusDanger, fontSize: 11.5 }}>Отключить эту доску</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "700" }}>
                    {board.tasks.length} задач
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
          </>
        )}
      </ScrollView>

      <MemberModal
        draft={memberDraft}
        theme={theme}
        workers={workers}
        onClose={() => setMemberDraft(undefined)}
        onSave={(member) => void saveMember(member)}
        onRemove={(member) => void removeMember(member)}
      />

      <TaskModal
        draft={taskDraft}
        theme={theme}
        members={board.members}
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
  onClose,
  onSave,
  onRemove,
}: {
  draft: TeamMember | null | undefined;
  theme: PluginTheme;
  workers: WorkerInfo[];
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
          <Field label="Аватар" value={form.avatar} onChangeText={(avatar) => update({ avatar })} placeholder="🙂" theme={theme} />
          <SettingsSelect
            label="Вид"
            value={form.kind}
            options={MEMBER_KINDS.map((kind) => ({ label: MEMBER_KIND_LABELS[kind], value: kind }))}
            onValueChange={(kind) => update({ kind })}
          />
          {form.kind === "container" ? (
            <SettingsSelect
              label="Контейнер"
              hint="Берётся из монитора workers.json — достаточно названия"
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
