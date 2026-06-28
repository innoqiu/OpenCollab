import gsap from "gsap";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const DEFAULT_BOARD = { cols: 14, rows: 12 };
const DEFAULT_CATEGORY = { id: "general", label: "General", color: "#7d838f" };
const STATUS_LABELS = {
  undo: "Unclaimed",
  claimed: "Claimed",
  active: "Active",
  done: "Done"
};

function App() {
  const [status, setStatus] = useState(null);
  const [savedHash, setSavedHash] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [hoveredId, setHoveredId] = useState("");
  const [memberDraft, setMemberDraft] = useState({ displayName: "", signature: "", color: "#29d8d0" });
  const [meetingDraft, setMeetingDraft] = useState({ title: "", notes: "" });
  const [meetingFormOpen, setMeetingFormOpen] = useState(false);
  const [conflictFocus, setConflictFocus] = useState({ id: "", taskIds: [] });
  const [interdependenceDraft, setInterdependenceDraft] = useState(null);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState({
    title: "",
    category: "",
    state: "undo",
    related: "",
    summary: "",
    grid: null
  });
  const [toast, setToast] = useState({ tone: "idle", message: "Loading local task status..." });

  useEffect(() => {
    refreshStatus();
  }, []);

  const membersById = useMemo(() => {
    return new Map((status?.members ?? []).map((member) => [member.id, member]));
  }, [status]);

  const tasksById = useMemo(() => {
    return new Map((status?.tasks ?? []).map((task) => [task.id, task]));
  }, [status]);

  const currentActor = status ? membersById.get(status.workspace.currentActorId) ?? status.members[0] : null;
  const selectedTask = selectedId ? tasksById.get(selectedId) : null;
  const hoveredTask = hoveredId ? tasksById.get(hoveredId) : null;
  const board = status ? getBoard(status) : DEFAULT_BOARD;
  const conflicts = useMemo(() => (status ? analyzeConflicts(status) : []), [status]);
  const dirty = status ? stableHash(status) !== savedHash : false;

  async function refreshStatus() {
    setToast({ tone: "idle", message: "Reading opencollab/Task_Status.json..." });
    const next = normalizeStatus(await api("/api/status"));
    setStatus(next);
    setSavedHash(stableHash(next));
    setSelectedId((current) => current || next.tasks[0]?.id || "");
    setToast({ tone: "ok", message: "Refresh complete. Local JSON is rendered." });
  }

  async function syncStatus() {
    if (!status) return;
    const next = { ...status, conflicts };
    setToast({ tone: "idle", message: "Writing Task_Status.json..." });
    const result = await api("/api/status", { method: "PUT", body: { status: normalizeStatus(next) } });
    const saved = normalizeStatus(result.status);
    setStatus(saved);
    setSavedHash(stableHash(saved));
    setToast({ tone: "ok", message: "Sync complete. JSON file updated on disk." });
  }

  async function gitPull() {
    setToast({ tone: "idle", message: "Running git pull --ff-only..." });
    const result = await api("/api/git/pull", { method: "POST" });
    const pulled = normalizeStatus(result.status);
    setStatus(pulled);
    setSavedHash(stableHash(pulled));
    setToast({ tone: "ok", message: "Git pull finished and local JSON was reloaded." });
  }

  async function agentPush() {
    if (!status) return;
    const confirmed = window.confirm("/ocb push will review, commit, and push Task_Status.json through Git. Continue?");
    if (!confirmed) return;
    setToast({ tone: "idle", message: "Running agent push review..." });
    const result = await api("/api/git/push", { method: "POST", body: { status: normalizeStatus({ ...status, conflicts }) } });
    const pushed = normalizeStatus(result.status);
    setStatus(pushed);
    setSavedHash(stableHash(pushed));
    setToast({ tone: "ok", message: "Agent push endpoint completed. Check Git output if remote auth failed." });
  }

  function setCurrentActor(actorId) {
    if (!status || actorId === status.workspace.currentActorId) return;
    setStatus({
      ...status,
      workspace: {
        ...status.workspace,
        currentActorId: actorId
      }
    });
  }

  function confirmClaimReplacement(task) {
    if (!task?.claimantId || !currentActor || task.claimantId === currentActor.id) return true;
    const owner = membersById.get(task.claimantId);
    return window.confirm(
      `${task.id} is already claimed by ${owner?.displayName ?? task.claimantId}. Replace their claim with yours?`
    );
  }

  function updateTask(taskId, patch) {
    setStatus((current) => {
      if (!current) return current;
      return {
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                ...patch,
                updatedAt: new Date().toISOString()
              }
            : task
        )
      };
    });
  }

  function claimTask(task = selectedTask) {
    if (!task || !currentActor) return;
    if (!confirmClaimReplacement(task)) return;
    const progress = normalizeProgress(task.progress);
    updateTask(task.id, {
      claimantId: currentActor.id,
      state: stateFromProgress(progress, currentActor.id),
      progress
    });
  }

  function forfeitTask(task = selectedTask) {
    if (!task || !currentActor) return;
    const progress = normalizeProgress(task.progress);
    updateTask(task.id, {
      claimantId: null,
      state: stateFromProgress(progress, null),
      progress
    });
  }

  function setTaskProgress(nextProgress, task = selectedTask) {
    if (!task || !currentActor) return;
    const progress = normalizeProgress(nextProgress);
    const claimantId = task.claimantId || (progress > 0 ? currentActor.id : null);
    updateTask(task.id, {
      claimantId,
      progress,
      state: stateFromProgress(progress, claimantId)
    });
  }

  function deleteTask(task = selectedTask) {
    if (!status || !task) return;
    if (!window.confirm(`Delete ${task.id} from Task_Status.json?`)) return;
    setStatus((current) => {
      if (!current) return current;
      const tasks = current.tasks.filter((item) => item.id !== task.id);
      return {
        ...current,
        tasks,
        links: (current.links ?? []).filter((link) => link.source !== task.id && link.target !== task.id)
      };
    });
    setSelectedId("");
  }

  function moveTask(task, grid) {
    if (!task) return;
    updateTask(task.id, { grid });
  }

  function openTaskInterfaceForm(grid = null) {
    if (!status) return;
    const openGrid = grid ?? findOpenGrid(status.tasks, board);
    if (!openGrid) {
      setToast({ tone: "idle", message: "Task matrix is full. Move or delete a task before adding another one." });
      return;
    }
    setTaskDraft({
      title: "",
      category: selectedTask?.category ?? status.categories?.[0]?.id ?? DEFAULT_CATEGORY.id,
      state: "undo",
      related: selectedTask?.id ?? "",
      summary: "",
      grid: openGrid
    });
    setTaskFormOpen(true);
  }

  function addTaskInterface(event) {
    event.preventDefault();
    if (!status) return;
    const title = taskDraft.title.trim();
    if (!title) {
      setToast({ tone: "idle", message: "Add task needs a title." });
      return;
    }

    const id = nextTaskId(status.tasks, status.view?.taskIdPrefix);
    const category = taskDraft.category || selectedTask?.category || status.categories?.[0]?.id || DEFAULT_CATEGORY.id;
    const nextState = normalizeState(taskDraft.state || "undo");
    const progress = progressFromState(nextState);
    const relatedIds = taskDraft.related
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .filter((value) => status.tasks.some((task) => task.id === value));
    const now = new Date().toISOString();
    const draftGrid = taskDraft.grid ?? findOpenGrid(status.tasks, board);
    if (!draftGrid) {
      setToast({ tone: "idle", message: "Task matrix is full. Move or delete a task before adding another one." });
      return;
    }
    const safeGrid = taskAtGrid(status.tasks, draftGrid) ? findOpenGrid(status.tasks, board) : draftGrid;
    if (!safeGrid) {
      setToast({ tone: "idle", message: "That position is occupied and no open cell is available." });
      return;
    }
    const task = {
      id,
      title,
      category,
      state: nextState,
      claimantId: nextState === "undo" ? null : currentActor?.id ?? null,
      progress,
      grid: safeGrid,
      summary: taskDraft.summary.trim() || "Manual task interface created from the board.",
      touches: [],
      interfaces: {
        inputs: [],
        outputs: [],
        boundaryNotes: relatedIds.length
          ? [`Reference ${relatedIds.join(", ")} before finalizing this interface.`]
          : ["Define the boundary before someone claims this task."]
      },
      updatedAt: now
    };
    const links = relatedIds
      .filter(
        (target) =>
          !status.links.some(
            (link) =>
              (link.source === id && link.target === target) || (link.source === target && link.target === id)
          )
      )
      .map((target, index) => ({
        id: `ln-${Date.now()}-${index}`,
        source: id,
        target,
        kind: "boundary",
        info: `${id} shares a boundary with ${target}. Coordinate the new task summary, expected outputs, and any shared artifact before either side finalizes work.`,
        createdBy: currentActor?.id ?? status.workspace.currentActorId,
        createdAt: now
      }));
    setStatus({ ...status, tasks: [...status.tasks, task], links: [...status.links, ...links] });
    setSelectedId(id);
    setTaskFormOpen(false);
    setTaskDraft({ title: "", category: "", state: "undo", related: "", summary: "", grid: null });
    setToast({ tone: "ok", message: `${id} created locally. Sync when ready.` });
  }

  function handleTaskSelect(task) {
    if (selectedId === task.id) {
      setSelectedId("");
      return;
    }
    setSelectedId(task.id);
  }

  function requestInterdependence(sourceTask, targetTask, dropGrid) {
    if (!sourceTask || !targetTask) return;
    setSelectedId(sourceTask.id);
    setInterdependenceDraft({
      sourceId: sourceTask.id,
      targetId: targetTask.id,
      kind: "boundary",
      dropGrid,
      info: `${sourceTask.id} and ${targetTask.id} overlap in the task matrix. Describe what artifact, definition, or interface needs coordination.`
    });
  }

  function saveInterdependence(event) {
    event.preventDefault();
    if (!status || !interdependenceDraft) return;
    const now = new Date().toISOString();
    const { sourceId, targetId, kind, info } = interdependenceDraft;
    const actor = currentActor ?? status.members[0];
    const existingIndex = status.links.findIndex(
      (link) =>
        (link.source === sourceId && link.target === targetId) || (link.source === targetId && link.target === sourceId)
    );
    const link = {
      id: existingIndex >= 0 ? status.links[existingIndex].id : `ln-${Date.now()}`,
      source: sourceId,
      target: targetId,
      kind,
      info: info.trim(),
      createdBy: existingIndex >= 0 ? status.links[existingIndex].createdBy : actor.id,
      createdAt: existingIndex >= 0 ? status.links[existingIndex].createdAt : now,
      updatedAt: now
    };
    const links =
      existingIndex >= 0
        ? status.links.map((item, index) => (index === existingIndex ? { ...item, ...link } : item))
        : [...status.links, link];
    setStatus({ ...status, links });
    setInterdependenceDraft(null);
    setToast({ tone: "ok", message: `Interdependence added: ${sourceId} -> ${targetId}.` });
  }

  function updateMember(memberId, patch) {
    setStatus((current) => {
      if (!current) return current;
      return {
        ...current,
        members: current.members.map((member) => (member.id === memberId ? { ...member, ...patch } : member))
      };
    });
  }

  function deleteMember(memberId) {
    if (!status) return;
    const member = membersById.get(memberId);
    if (!member) return;
    if (!window.confirm(`Delete actor ${member.signature}? Their claimed tasks will become unclaimed.`)) return;
    const members = status.members.filter((item) => item.id !== memberId);
    const fallbackActor = members[0]?.id ?? "";
    setStatus({
      ...status,
      workspace: {
        ...status.workspace,
        currentActorId: status.workspace.currentActorId === memberId ? fallbackActor : status.workspace.currentActorId
      },
      members,
      tasks: status.tasks.map((task) =>
        task.claimantId === memberId
          ? {
              ...task,
              claimantId: null,
              state: stateFromProgress(task.progress, null),
              updatedAt: new Date().toISOString()
            }
          : task
      )
    });
  }

  function upsertMember(event) {
    event.preventDefault();
    if (!status || !memberDraft.displayName.trim() || !memberDraft.signature.trim()) return;
    const id = slug(memberDraft.signature);
    const color = /^#[0-9a-f]{6}$/i.test(memberDraft.color.trim()) ? memberDraft.color.trim() : "#29d8d0";
    const nextMember = {
      id,
      displayName: memberDraft.displayName.trim(),
      signature: memberDraft.signature.trim().slice(0, 4).toUpperCase(),
      color,
      role: id === "ai" || id === "agent" ? "agent" : "human",
      active: true
    };
    const exists = status.members.some((member) => member.id === id);
    const members = exists
      ? status.members.map((member) => (member.id === id ? { ...member, ...nextMember } : member))
      : [...status.members, nextMember];
    setStatus({ ...status, members });
    setMemberDraft({ displayName: "", signature: "", color: nextMember.color });
  }

  function addMeeting(event) {
    event.preventDefault();
    const title = meetingDraft.title.trim();
    const notes = meetingDraft.notes.trim();
    if (!status || !title) return;
    const actorId = status.workspace.currentActorId;
    const meeting = {
      id: `mtg-${Date.now()}`,
      title,
      taskIds: selectedTask ? [selectedTask.id] : [],
      notes: notes || `Meeting marker created from the visual panel${selectedTask ? ` for ${selectedTask.id}` : ""}.`,
      createdAt: new Date().toISOString()
    };
    setStatus({
      ...status,
      meetings: [meeting, ...(status.meetings ?? [])],
      timeline: [
        makeTimelineEvent({
          type: "meeting",
          actorId,
          taskIds: meeting.taskIds,
          title: meeting.title,
          details: meeting.notes,
          adds: ["meetings[]", "timeline[]"]
        }),
        ...status.timeline
      ]
    });
    setMeetingDraft({ title: "", notes: "" });
    setMeetingFormOpen(false);
  }

  function openMeetingDialog() {
    setMeetingDraft({ title: "", notes: "" });
    setMeetingFormOpen(true);
  }

  function focusConflict(conflict) {
    const taskIds = (conflict.taskIds ?? []).filter((id) => tasksById.has(id));
    setConflictFocus({ id: conflict.id, taskIds });
    setSelectedId("");
  }

  function clearBoardFocus() {
    setSelectedId("");
    setConflictFocus({ id: "", taskIds: [] });
  }

  if (!status) {
    return (
      <main className="boot-screen">
        <div className="boot-card">
          <span className="pixel-mark">OC</span>
          <h1>OpenCollab</h1>
          <p>{toast.message}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="oc-shell">
      <Header
        actor={currentActor}
        dirty={dirty}
        status={status}
        toast={toast}
        onAgentPush={agentPush}
        onGitPull={gitPull}
        onRefresh={refreshStatus}
        onSync={syncStatus}
      />

      <section className="oc-layout">
        <TimelinePanel membersById={membersById} status={status} onMeetingOpen={openMeetingDialog} />

        <PixelBoard
          board={board}
          currentActor={currentActor}
          focusTaskIds={conflictFocus.taskIds}
          hoveredTask={hoveredTask}
          membersById={membersById}
          selectedId={selectedId}
          status={status}
          taskDraft={taskDraft}
          taskFormOpen={taskFormOpen}
          onAddTask={openTaskInterfaceForm}
          onClaim={claimTask}
          onDraftChange={setTaskDraft}
          onDraftSubmit={addTaskInterface}
          onDraftCancel={() => setTaskFormOpen(false)}
          onDelete={deleteTask}
          onForfeit={forfeitTask}
          onHover={setHoveredId}
          onClearSelection={clearBoardFocus}
          onMove={moveTask}
          onRequestInterdependence={requestInterdependence}
          onSelect={(task) => {
            setConflictFocus({ id: "", taskIds: [] });
            handleTaskSelect(task);
          }}
        />

        <Inspector
          conflicts={conflicts}
          currentActor={currentActor}
          activeConflictId={conflictFocus.id}
          memberDraft={memberDraft}
          membersById={membersById}
          selectedTask={selectedTask}
          status={status}
          onClaim={claimTask}
          onDelete={deleteTask}
          onForfeit={forfeitTask}
          onConflictSelect={focusConflict}
          onActorChange={setCurrentActor}
          onMemberDelete={deleteMember}
          onMemberDraft={setMemberDraft}
          onMemberSubmit={upsertMember}
          onMemberUpdate={updateMember}
          onProgressChange={setTaskProgress}
        />
      </section>

      {meetingFormOpen && (
        <MeetingDialog
          draft={meetingDraft}
          selectedTask={selectedTask}
          onCancel={() => setMeetingFormOpen(false)}
          onChange={setMeetingDraft}
          onSubmit={addMeeting}
        />
      )}

      {interdependenceDraft && (
        <InterdependenceDialog
          draft={interdependenceDraft}
          membersById={membersById}
          tasksById={tasksById}
          onCancel={() => setInterdependenceDraft(null)}
          onChange={setInterdependenceDraft}
          onSubmit={saveInterdependence}
        />
      )}
    </main>
  );
}

function Header({ actor, dirty, status, toast, onAgentPush, onGitPull, onRefresh, onSync }) {
  return (
    <header className="oc-header">
      <div className="brand-block">
        <span className="pixel-mark">OC</span>
        <div>
          <h1>{status.workspace.name}</h1>
          <p>
            {status.workspace.repo} / {status.workspace.branch}
          </p>
        </div>
      </div>

      <div className="command-strip" aria-label="OpenCollab commands">
        <span>/ocb init</span>
        <span>/ocb pull</span>
        <span>/ocb push</span>
        <span>/ocb mtg</span>
      </div>

      <div className="header-actions">
        <div className={`save-indicator ${dirty ? "dirty" : "clean"}`}>{dirty ? "Local changes pending sync" : "Synced"}</div>
        <button type="button" onClick={onRefresh}>Refresh</button>
        <button type="button" onClick={onSync}>Sync</button>
        <button type="button" onClick={onGitPull}>Git Pull</button>
        <button type="button" onClick={onAgentPush}>Git Push</button>
        {actor && (
          <span className="actor-chip" style={{ "--chip": actor.color }}>
            {actor.signature}
          </span>
        )}
      </div>

      <div className={`toast ${toast.tone}`}>{toast.message}</div>
    </header>
  );
}

function TimelinePanel({ membersById, status, onMeetingOpen }) {
  const events = status.timeline.filter((event) => event.type === "update" || event.type === "meeting").slice(0, 14);
  const doneCount = status.tasks.filter((task) => normalizeProgress(task.progress) >= 100).length;
  const progress = averageProgress(status.tasks);
  const memberProgress = status.members.map((member) => {
    const tasks = status.tasks.filter((task) => task.claimantId === member.id);
    return {
      member,
      owned: tasks.length,
      average: averageProgress(tasks),
      done: tasks.filter((task) => normalizeProgress(task.progress) >= 100).length
    };
  });

  return (
    <aside className="timeline-panel">
      <div className="panel-title">
        <span>Timeline</span>
        <div className="timeline-title-actions">
          <b>{events.length}</b>
          <button aria-label="Add meeting note" className="timeline-add-button" type="button" onClick={onMeetingOpen}>
            +
          </button>
        </div>
      </div>
      <section className="progress-summary">
        <div>
          <span>Total progress</span>
          <b>{progress}%</b>
        </div>
        <i>
          <span style={{ width: `${progress}%` }} />
        </i>
        <p>{doneCount} done / {status.tasks.length} tasks</p>
      </section>
      <section className="member-progress">
        {memberProgress.map(({ member, owned, average, done }) => (
          <article key={member.id} style={{ "--member": member.color }}>
            <b>{member.signature}</b>
            <span>{average}% progress</span>
            <span>{done} done</span>
            <span>{owned} owned</span>
          </article>
        ))}
      </section>
      <div className="timeline-axis" aria-label="Update and meeting timeline">
        {events.map((event) => {
          const member = membersById.get(event.actorId);
          return (
            <article className={`timeline-node ${event.type}`} key={event.id} style={{ "--dot": member?.color ?? "#7a7f8c" }}>
              <span className="axis-dot" />
              <div className="axis-summary">
                <b>{event.type}</b>
                <span>{member?.signature ?? event.actorId}</span>
              </div>
              <div className="timeline-detail">
                <h3>{event.title}</h3>
                <p>{event.details}</p>
                <small>{new Date(event.createdAt).toLocaleString()}</small>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function PixelBoard({
  board,
  currentActor,
  focusTaskIds,
  hoveredTask,
  membersById,
  selectedId,
  status,
  taskDraft,
  taskFormOpen,
  onAddTask,
  onClaim,
  onDraftCancel,
  onDraftChange,
  onDraftSubmit,
  onDelete,
  onForfeit,
  onHover,
  onClearSelection,
  onMove,
  onRequestInterdependence,
  onSelect
}) {
  const boardRef = useRef(null);
  const dragRef = useRef(null);
  const [draggingId, setDraggingId] = useState("");
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [snapId, setSnapId] = useState("");
  const { cols, rows } = board;
  const focusIds = useMemo(() => new Set(focusTaskIds ?? []), [focusTaskIds]);
  const tasksById = useMemo(() => new Map(status.tasks.map((task) => [task.id, task])), [status.tasks]);
  const selectedTask = selectedId ? tasksById.get(selectedId) : null;
  const selectedRelations = selectedTask ? relatedTasks(selectedTask, status) : [];
  const selectedRelationIds = useMemo(
    () =>
      new Set(
        selectedRelations
          .map((item) => item.task)
          .filter((task) => task.claimantId && task.claimantId !== currentActor?.id)
          .map((task) => task.id)
      ),
    [currentActor?.id, selectedRelations]
  );
  const occupiedCells = useMemo(() => occupiedGridCells(status.tasks), [status.tasks]);
  const emptyCells = useMemo(() => {
    const cells = [];
    for (let y = 1; y <= rows; y += 1) {
      for (let x = 1; x <= cols; x += 1) {
        if (!occupiedCells.has(`${x}:${y}`)) cells.push({ x, y });
      }
    }
    return cells;
  }, [cols, occupiedCells, rows]);

  useLayoutEffect(() => {
    if (!boardRef.current) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        ".task-tile",
        { opacity: 0, scale: 0.62, y: 12, rotate: -3 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          rotate: 0,
          duration: 0.52,
          ease: "back.out(2)",
          stagger: 0.035,
          onComplete: () => gsap.set(".task-tile", { clearProps: "transform,rotate,opacity" })
        }
      );
    }, boardRef);
    return () => context.revert();
  }, [status.tasks.length]);

  useEffect(() => {
    if (!selectedId || !boardRef.current) return;
    const target = boardRef.current.querySelector(`[data-task-id="${selectedId}"]`);
    if (target) {
      gsap.fromTo(
        target,
        { scale: 0.92 },
        {
          scale: 1,
          duration: 0.28,
          ease: "elastic.out(1, 0.5)",
          onComplete: () => gsap.set(target, { clearProps: "transform" })
        }
      );
    }
  }, [selectedId]);

  useEffect(() => {
    function trackDrag(event) {
      const drag = dragRef.current;
      if (!drag) return;
      const moved = Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4;
      dragRef.current = {
        ...drag,
        currentX: event.clientX,
        currentY: event.clientY,
        moved: drag.moved || moved
      };
      setDragOffset({ x: event.clientX - drag.startX, y: event.clientY - drag.startY });
    }

    function finishDrag(event) {
      const drag = dragRef.current;
      if (!drag) return;
      const task = tasksById.get(drag.taskId);
      if (task) {
        const clientX = event.clientX ?? drag.currentX ?? drag.startX;
        const clientY = event.clientY ?? drag.currentY ?? drag.startY;
        if (drag.moved) {
          const nextGrid = gridFromPoint(boardRef.current, clientX, clientY, task.grid, board);
          const hitTask = taskAtGrid(status.tasks, nextGrid, task.id);
          if (hitTask) {
            onRequestInterdependence(task, hitTask, nextGrid);
          } else {
            setSnapId(task.id);
            onMove(task, nextGrid);
            window.setTimeout(() => setSnapId((current) => (current === task.id ? "" : current)), 90);
          }
        } else {
          onSelect(task);
        }
      }
      dragRef.current = null;
      setDraggingId("");
      setDragOffset({ x: 0, y: 0 });
    }

    window.addEventListener("pointermove", trackDrag);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("mousemove", trackDrag);
    window.addEventListener("mouseup", finishDrag);
    return () => {
      window.removeEventListener("pointermove", trackDrag);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("mousemove", trackDrag);
      window.removeEventListener("mouseup", finishDrag);
    };
  }, [board, onMove, onRequestInterdependence, onSelect, status.tasks, tasksById]);

  function startDrag(event, task) {
    if (event.button !== undefined && event.button !== 0) return;
    if (dragRef.current) return;
    event.preventDefault();
    dragRef.current = {
      taskId: task.id,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      moved: false
    };
    gsap.set(event.currentTarget, { clearProps: "transform,y,scale" });
    setDraggingId(task.id);
    setDragOffset({ x: 0, y: 0 });
  }

  function handlePointerCancel(event, task) {
    const drag = dragRef.current;
    if (!drag || drag.taskId !== task.id) return;
    dragRef.current = null;
    setDraggingId("");
    setDragOffset({ x: 0, y: 0 });
  }

  function handleBoardPointerDown(event) {
    if (event.target.closest?.(".task-tile, .node-menu")) return;
    onClearSelection();
  }

  return (
    <section className={`board-wrap ${taskFormOpen ? "form-open" : ""}`}>
      <div className="board-topline">
        <div>
          <span className="eyebrow">Visual Board</span>
          <h2>Task Interface Map</h2>
        </div>
        <div className="board-controls">
          <div className="legend">
            {Object.entries(STATUS_LABELS).map(([state, label]) => (
              <span key={state}>
                <i className={`legend-box state-${state}`} />
                {label}
              </span>
            ))}
          </div>
          <button className="add-node-button" type="button" onClick={() => onAddTask()} aria-label="Add task interface">
            +
          </button>
        </div>
      </div>

      {taskFormOpen && (
        <AddTaskForm
          categories={status.categories ?? []}
          draft={taskDraft}
          onCancel={onDraftCancel}
          onChange={onDraftChange}
          onSubmit={onDraftSubmit}
        />
      )}

      <div className="pixel-board" ref={boardRef} onPointerDown={handleBoardPointerDown}>
        <div className="task-grid" style={{ "--cols": cols, "--rows": rows }}>
          {emptyCells.map((cell) => (
            <button
              aria-label={`Add task at ${cell.x}, ${cell.y}`}
              className="empty-cell"
              key={`${cell.x}:${cell.y}`}
              onClick={() => onAddTask({ x: cell.x, y: cell.y, w: 1, h: 1 })}
              style={{
                gridColumn: `${cell.x} / span 1`,
                gridRow: `${cell.y} / span 1`
              }}
              type="button"
            />
          ))}

          {status.tasks.map((task, index) => {
            const owner = task.claimantId ? membersById.get(task.claimantId) : null;
            const isSelected = task.id === selectedId;
            const isHovered = hoveredTask?.id === task.id;
            const isRelated = selectedRelationIds.has(task.id);
            const isConflictFocus = focusIds.has(task.id);
            const isDimmed = (selectedTask || focusIds.size > 0) && !isSelected && !isRelated && !isConflictFocus;
            const isDragging = draggingId === task.id;
            const isSnap = snapId === task.id;
            const progress = normalizeProgress(task.progress);
            return (
              <button
                aria-label={`${task.id} ${task.title} ${progress}%`}
                className={`task-tile state-${normalizeState(task.state)} ${task.claimantId ? "claimed-color" : "unclaimed-color"} ${isSelected ? "selected" : ""} ${isRelated ? "related-highlight" : ""} ${isConflictFocus ? "conflict-highlight" : ""} ${isDimmed ? "dimmed" : ""} ${isHovered ? "hovered" : ""} ${isDragging ? "dragging" : ""} ${isSnap ? "snap" : ""}`}
                data-task-id={task.id}
                key={task.id}
                onMouseEnter={(event) => {
                  onHover(task.id);
                }}
                onMouseLeave={(event) => {
                  onHover("");
                  gsap.set(event.currentTarget, { clearProps: "transform,y,scale" });
                }}
                onMouseDown={(event) => startDrag(event, task)}
                onPointerDown={(event) => startDrag(event, task)}
                onPointerCancel={(event) => handlePointerCancel(event, task)}
                style={{
                  "--tile": owner?.color ?? "#7d838f",
                  "--tile-soft": toRgba(owner?.color ?? "#7d838f", 0.3),
                  "--tile-opacity": tileOpacity(progress),
                  "--tile-delay": `${index * 45}ms`,
                  "--drag-x": `${isDragging ? dragOffset.x : 0}px`,
                  "--drag-y": `${isDragging ? dragOffset.y : 0}px`,
                  gridColumn: `${task.grid.x} / span ${task.grid.w}`,
                  gridRow: `${task.grid.y} / span ${task.grid.h}`
                }}
                type="button"
              />
            );
          })}

          {selectedTask && (
            <NodeMenu
              currentActor={currentActor}
              membersById={membersById}
              related={selectedRelations}
              task={selectedTask}
              onClaim={() => onClaim(selectedTask)}
              onDelete={() => onDelete(selectedTask)}
              onForfeit={() => onForfeit(selectedTask)}
              board={board}
            />
          )}
        </div>

        {hoveredTask && hoveredTask.id !== selectedTask?.id && (
          <div className="hover-card">
            <b>{hoveredTask.id}</b>
            <span>{hoveredTask.title}</span>
            <small>
              {normalizeProgress(hoveredTask.progress)}% / {STATUS_LABELS[normalizeState(hoveredTask.state)]} /{" "}
              {hoveredTask.claimantId ? membersById.get(hoveredTask.claimantId)?.displayName : "Unclaimed"}
            </small>
            <small>{hoveredTask.updatedAt}</small>
          </div>
        )}
      </div>
    </section>
  );
}

function AddTaskForm({ categories, draft, onCancel, onChange, onSubmit }) {
  return (
    <form className="add-task-form" onSubmit={onSubmit}>
      <input
        aria-label="Task title"
        autoFocus
        placeholder="Task title"
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
      />
      <select
        aria-label="Task category"
        value={draft.category}
        onChange={(event) => onChange({ ...draft, category: event.target.value })}
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Task state"
        value={draft.state}
        onChange={(event) => onChange({ ...draft, state: event.target.value })}
      >
        {Object.entries(STATUS_LABELS).map(([state, label]) => (
          <option key={state} value={state}>
            {label}
          </option>
        ))}
      </select>
      <input
        aria-label="Related task IDs"
        placeholder="Related IDs"
        value={draft.related}
        onChange={(event) => onChange({ ...draft, related: event.target.value })}
      />
      <input
        aria-label="Task summary"
        placeholder="Summary"
        value={draft.summary}
        onChange={(event) => onChange({ ...draft, summary: event.target.value })}
      />
      <div className="add-task-actions">
        <button className="primary-button" type="submit">Create</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ProgressControl({ steps, value, onChange }) {
  const progress = normalizeProgress(value);
  const segmentCount = Math.max(8, Math.min(40, Number(steps) || 24));
  const activeSegments = Math.round((progress / 100) * segmentCount);

  return (
    <section className="progress-control" aria-label="Task progress control">
      <div className="progress-control-head">
        <span>Progress</span>
        <b>{progress}%</b>
      </div>
      <div className="segmented-progress" aria-label="Set task progress by segment" role="group" style={{ "--segments": segmentCount }}>
        {Array.from({ length: segmentCount }, (_, index) => {
          const segmentProgress = Math.min(100, Math.round(((index + 1) / segmentCount) * 100));
          return (
            <button
              aria-label={`Set progress to ${segmentProgress}%`}
              className={index < activeSegments ? "filled" : ""}
              key={index}
              onClick={() => onChange(segmentProgress)}
              type="button"
            />
          );
        })}
      </div>
      <input
        aria-label="Task progress"
        max="100"
        min="0"
        step="5"
        type="range"
        value={progress}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </section>
  );
}

function MeetingDialog({ draft, selectedTask, onCancel, onChange, onSubmit }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="meeting-dialog" onSubmit={onSubmit}>
        <div className="dialog-title">
          <span>Meeting note</span>
          <button aria-label="Close meeting note" type="button" onClick={onCancel}>x</button>
        </div>
        <label>
          Title
          <input
            aria-label="Meeting title"
            autoFocus
            placeholder="Weekly sync, boundary review, quick handoff..."
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
          />
        </label>
        <label>
          Content
          <textarea
            aria-label="Meeting content"
            placeholder="Write decisions, handoffs, unresolved interfaces, and next sync points."
            value={draft.notes}
            onChange={(event) => onChange({ ...draft, notes: event.target.value })}
          />
        </label>
        {selectedTask && <p className="meeting-context">Linked task: {selectedTask.id} / {selectedTask.title}</p>}
        <div className="dialog-actions">
          <button className="primary-button" type="submit">Add note</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function InterdependenceDialog({ draft, membersById, tasksById, onCancel, onChange, onSubmit }) {
  const source = tasksById.get(draft.sourceId);
  const target = tasksById.get(draft.targetId);
  const sourceOwner = source?.claimantId ? membersById.get(source.claimantId) : null;
  const targetOwner = target?.claimantId ? membersById.get(target.claimantId) : null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="interdependence-dialog" onSubmit={onSubmit}>
        <div className="dialog-title">
          <span>Add interdependence</span>
          <button aria-label="Close interdependence dialog" type="button" onClick={onCancel}>x</button>
        </div>
        <div className="interdependence-pair">
          <article>
            <b>{source?.id}</b>
            <span>{source?.title}</span>
            <small>{sourceOwner ? `${sourceOwner.signature} / ${sourceOwner.displayName}` : "Unclaimed"}</small>
          </article>
          <i>&lt;-&gt;</i>
          <article>
            <b>{target?.id}</b>
            <span>{target?.title}</span>
            <small>{targetOwner ? `${targetOwner.signature} / ${targetOwner.displayName}` : "Unclaimed"}</small>
          </article>
        </div>
        <label>
          Type
          <select value={draft.kind} onChange={(event) => onChange({ ...draft, kind: event.target.value })}>
            <option value="boundary">Boundary</option>
            <option value="dependency">Dependency</option>
            <option value="sync">Sync</option>
          </select>
        </label>
        <label>
          Related task info
          <textarea
            value={draft.info}
            onChange={(event) => onChange({ ...draft, info: event.target.value })}
            placeholder="Describe the coupling point, shared artifact, interface contract, and who should coordinate."
          />
        </label>
        <div className="dialog-actions">
          <button className="primary-button" type="submit">Add interdependence</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function NodeMenu({ board, currentActor, membersById, related, task, onClaim, onDelete, onForfeit }) {
  const owner = task.claimantId ? membersById.get(task.claimantId) : null;
  const menuDragRef = useRef(null);
  const [menuOffset, setMenuOffset] = useState({ x: 0, y: 0 });
  const menuSpan = Math.min(5, board.cols);
  const canPlaceRight = task.grid.x + task.grid.w + menuSpan <= board.cols + 1;
  const menuStart = canPlaceRight
    ? task.grid.x + task.grid.w + 1
    : Math.max(1, task.grid.x - menuSpan);
  const menuRow = Math.max(1, task.grid.y - 1);
  const ownershipMode = !task.claimantId ? "claim" : task.claimantId === currentActor?.id ? "forfeit" : "locked";

  useEffect(() => {
    setMenuOffset({ x: 0, y: 0 });
  }, [task.id]);

  useEffect(() => {
    function moveMenu(event) {
      const drag = menuDragRef.current;
      if (!drag) return;
      setMenuOffset({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY
      });
    }

    function releaseMenu() {
      menuDragRef.current = null;
    }

    window.addEventListener("pointermove", moveMenu);
    window.addEventListener("pointerup", releaseMenu);
    return () => {
      window.removeEventListener("pointermove", moveMenu);
      window.removeEventListener("pointerup", releaseMenu);
    };
  }, []);

  function startMenuDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    menuDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: menuOffset.x,
      originY: menuOffset.y
    };
  }

  return (
    <div
      className={`node-menu ${canPlaceRight ? "right-side" : "left-side"}`}
      style={{
        "--menu-x": `${menuOffset.x}px`,
        "--menu-y": `${menuOffset.y}px`,
        gridColumn: `${menuStart} / span ${menuSpan}`,
        gridRow: `${menuRow} / span 2`
      }}
    >
      <div className="node-menu-head" onPointerDown={startMenuDrag}>
        <span>{task.id}</span>
        <b>{owner?.signature ?? "N/A"}</b>
      </div>
      <h3>{task.title}</h3>
      <p>{task.summary}</p>
      <div className="node-meta">
        <span>Owner: {owner?.displayName ?? "N/A"}</span>
        <span>Related: {related.length ? related.map((item) => item.task.id).join(", ") : "N/A"}</span>
      </div>
      <div className="node-actions">
        {ownershipMode === "forfeit" ? (
          <button type="button" onClick={onForfeit}>Forfeit</button>
        ) : ownershipMode === "claim" ? (
          <button className="primary-button" type="button" onClick={onClaim}>Claim</button>
        ) : (
          <button className="owner-locked" type="button" disabled>
            Claimed by {owner?.signature ?? "N/A"}
          </button>
        )}
        <button className="danger-button" type="button" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function Inspector({
  conflicts,
  currentActor,
  activeConflictId,
  memberDraft,
  membersById,
  selectedTask,
  status,
  onClaim,
  onDelete,
  onForfeit,
  onConflictSelect,
  onActorChange,
  onMemberDelete,
  onMemberDraft,
  onMemberSubmit,
  onMemberUpdate,
  onProgressChange
}) {
  const owner = selectedTask?.claimantId ? membersById.get(selectedTask.claimantId) : null;
  const related = selectedTask ? relatedTasks(selectedTask, status) : [];
  const taskName = selectedTask ? `${selectedTask.id} / ${selectedTask.title}` : "No task selected";
  const taskArtifacts = selectedTask?.touches?.length ? selectedTask.touches.join(", ") : "No artifact declared yet.";
  const ownershipMode = !selectedTask?.claimantId
    ? "claim"
    : selectedTask.claimantId === currentActor?.id
      ? "forfeit"
      : "locked";

  return (
    <aside className="inspector-panel">
      <div className="panel-title">
        <span>Inspector</span>
        <b>{currentActor?.signature}</b>
      </div>

      {selectedTask && (
        <section className="task-detail">
          <div className="task-field">
            <b>Task name</b>
            <h2>{taskName}</h2>
          </div>

          <div className="task-field">
            <b>Task overview</b>
            <p>{selectedTask.summary}</p>
          </div>

          <div className="owner-line">
            <span style={{ "--owner": owner?.color ?? "#7d838f" }}>{owner?.signature ?? "--"}</span>
            <div>
              <b>Owner</b>
              <p>{owner?.displayName ?? "Unclaimed"}</p>
            </div>
          </div>

          <div className="task-field">
            <b>Artifacts</b>
            <p>{taskArtifacts}</p>
          </div>

          <ProgressControl
            steps={status.view?.progressSteps ?? 24}
            value={selectedTask.progress}
            onChange={(value) => onProgressChange(value, selectedTask)}
          />

          <div className="action-row">
            {ownershipMode === "forfeit" ? (
              <button type="button" onClick={() => onForfeit(selectedTask)}>Forfeit</button>
            ) : ownershipMode === "claim" ? (
              <button className="primary-button" type="button" onClick={() => onClaim(selectedTask)}>Claim</button>
            ) : (
              <button className="owner-locked" type="button" disabled>
                Claimed by {owner?.signature ?? "N/A"}
              </button>
            )}
            <button className="danger-button" type="button" onClick={() => onDelete(selectedTask)}>Delete</button>
          </div>

          <details className="related-docs" open>
            <summary>Related task info</summary>
            {related.length === 0 && <p>No related interface yet.</p>}
            {related.map(({ task, link }) => (
              <article key={link.id}>
                <div>
                  <b>{task.id}</b>
                  <span>{link.kind}</span>
                </div>
                <h3>{task.title}</h3>
                <p>{describeInterdependence(selectedTask, task, link, membersById)}</p>
                <small>{task.touches?.length ? `Artifacts: ${task.touches.join(", ")}` : "Artifacts: N/A"}</small>
              </article>
            ))}
          </details>
        </section>
      )}

      <details className="member-manager" open>
        <summary className="section-line">
          <span>Actors</span>
          <b>{status.members.length}</b>
        </summary>
        <div className="actor-table">
          {status.members.map((member) => (
            <div className="actor-row" key={member.id}>
              <button
                className={`actor-pick ${status.workspace.currentActorId === member.id ? "active" : ""}`}
                style={{ "--member": member.color ?? "#7d838f" }}
                type="button"
                onClick={() => onActorChange(member.id)}
                aria-label={`Use ${member.displayName}`}
              >
                {member.signature ?? "--"}
              </button>
              <input
                aria-label={`${member.signature} name`}
                value={member.displayName ?? ""}
                onChange={(event) => onMemberUpdate(member.id, { displayName: event.target.value })}
              />
              <input
                aria-label={`${member.signature} color`}
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(member.color ?? "") ? member.color : "#7d838f"}
                onChange={(event) => onMemberUpdate(member.id, { color: event.target.value })}
              />
              <button className="danger-button" type="button" onClick={() => onMemberDelete(member.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
        <form className="compact-form" onSubmit={onMemberSubmit}>
          <input
            placeholder="Name"
            value={memberDraft.displayName ?? ""}
            onChange={(event) => onMemberDraft({ ...memberDraft, displayName: event.target.value })}
          />
          <input
            placeholder="SIG"
            value={memberDraft.signature ?? ""}
            onChange={(event) => onMemberDraft({ ...memberDraft, signature: event.target.value })}
          />
          <input
            aria-label="Hex color"
            placeholder="#29d8d0"
            value={memberDraft.color ?? ""}
            onChange={(event) => onMemberDraft({ ...memberDraft, color: event.target.value })}
          />
          <button type="submit">Add</button>
        </form>
      </details>

      <section className="conflict-box">
        <div className="section-line">
          <span>Conflicts</span>
          <b>{conflicts.length}</b>
        </div>
        <div className="conflict-list">
          {conflicts.length === 0 && <p>No active conflicts.</p>}
          {conflicts.slice(0, 5).map((conflict) => (
            <button
              className={`conflict ${conflict.severity} ${activeConflictId === conflict.id ? "active" : ""}`}
              key={conflict.id}
              type="button"
              onClick={() => onConflictSelect(conflict)}
            >
              <b>{conflict.title}</b>
              <span>{conflict.message}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `OpenCollab API failed: ${path}`);
  }
  return payload;
}

function makeTimelineEvent({ type, actorId, taskIds, title, details, adds }) {
  return {
    id: `tl-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    type,
    actorId,
    taskIds,
    title,
    details,
    createdAt: new Date().toISOString(),
    adds
  };
}

function analyzeConflicts(status) {
  const tasksById = new Map(status.tasks.map((task) => [task.id, task]));
  const membersById = new Map(status.members.map((member) => [member.id, member]));
  const conflicts = [];
  const now = new Date().toISOString();

  for (const link of status.links) {
    const source = tasksById.get(link.source);
    const target = tasksById.get(link.target);
    if (!source || !target) continue;
    const sourceOwner = source.claimantId;
    const targetOwner = target.claimantId;
    const bothActive = isActive(source) && isActive(target);
    if ((link.kind === "boundary" || link.kind === "sync") && bothActive && sourceOwner && targetOwner && sourceOwner !== targetOwner) {
      conflicts.push({
        id: `boundary-${source.id}-${target.id}`,
        type: "boundary-sync",
        severity: normalizeState(source.state) === "done" && normalizeState(target.state) === "done" ? "high" : "medium",
        taskIds: [source.id, target.id],
        memberIds: [sourceOwner, targetOwner],
        title: "Boundary sync needed",
        message: `${source.id} and ${target.id} are active across ${link.kind}. ${membersById.get(sourceOwner)?.signature} and ${membersById.get(targetOwner)?.signature} should sync.`,
        detectedAt: now,
        resolved: false
      });
    }
  }

  const fileMap = new Map();
  for (const task of status.tasks) {
    if (!isActive(task)) continue;
    for (const file of task.touches) {
      if (!fileMap.has(file)) fileMap.set(file, []);
      fileMap.get(file).push(task);
    }
  }

  for (const [file, tasks] of fileMap) {
    const owners = new Set(tasks.map((task) => task.claimantId).filter(Boolean));
    if (tasks.length > 1 && owners.size > 1) {
      conflicts.push({
        id: `shared-${slug(file)}`,
        type: "shared-file",
        severity: "medium",
        taskIds: tasks.map((task) => task.id),
        memberIds: [...owners],
        title: "Shared file boundary",
        message: `${file} is touched by ${tasks.map((task) => task.id).join(", ")}.`,
        detectedAt: now,
        resolved: false
      });
    }
  }

  for (const link of status.links) {
    if (link.kind !== "dependency") continue;
    const prerequisite = tasksById.get(link.source);
    const downstream = tasksById.get(link.target);
    if (prerequisite && downstream && normalizeProgress(downstream.progress) >= 100 && normalizeProgress(prerequisite.progress) < 100) {
      conflicts.push({
        id: `blocked-${downstream.id}-${prerequisite.id}`,
        type: "dependency-not-done",
        severity: "high",
        taskIds: [downstream.id, prerequisite.id],
        memberIds: [downstream.claimantId, prerequisite.claimantId].filter(Boolean),
        title: "Unfinished dependency",
        message: `${downstream.id} is done but depends on ${prerequisite.id}, which is ${normalizeProgress(prerequisite.progress)}%.`,
        detectedAt: now,
        resolved: false
      });
    }
  }

  return conflicts;
}

function relatedTasks(task, status) {
  const tasksById = new Map(status.tasks.map((item) => [item.id, item]));
  const related = new Map();
  for (const link of status.links ?? []) {
    if (link.source !== task.id && link.target !== task.id) continue;
    const relatedId = link.source === task.id ? link.target : link.source;
    const relatedTask = tasksById.get(relatedId);
    if (!relatedTask) continue;
    const current = related.get(relatedId);
    if (!current || linkKindPriority(link.kind) < linkKindPriority(current.link.kind)) {
      related.set(relatedId, { link, task: relatedTask });
    }
  }
  return [...related.values()];
}

function linkKindPriority(kind) {
  if (kind === "sync") return 0;
  if (kind === "boundary") return 1;
  return 2;
}

function describeInterdependence(selectedTask, relatedTask, link, membersById) {
  if (link.info?.trim()) return link.info.trim();
  const relatedOwner = relatedTask.claimantId ? membersById.get(relatedTask.claimantId) : null;
  const selectedOutputs = selectedTask.interfaces?.outputs?.join(", ") || "this task output";
  const relatedInputs = relatedTask.interfaces?.inputs?.join(", ") || "the related task input";
  const ownerText = relatedOwner
    ? `Coordinate with ${relatedOwner.signature} (${relatedOwner.displayName})`
    : "Claim or assign the related task before final integration";
  if (link.kind === "dependency") {
    return `${selectedTask.id} and ${relatedTask.id} are coupled by prerequisite artifacts. Check ${selectedOutputs} against ${relatedInputs}; ${ownerText} before marking downstream work done.`;
  }
  if (link.kind === "sync") {
    return `${selectedTask.id} and ${relatedTask.id} need a fast sync before merge. Compare assumptions, artifact names, and handoff timing; ${ownerText}.`;
  }
  return `${selectedTask.id} and ${relatedTask.id} share a boundary. Keep claims separate, define the interface between ${selectedOutputs} and ${relatedInputs}, and ${ownerText} if wording or ownership changes.`;
}

function normalizeStatus(status) {
  if (!status) return status;
  const { classification, statusModel, ...statusBase } = status;
  const categories = status.categories?.length ? status.categories : [DEFAULT_CATEGORY];
  const initialBoard = getBoard(status);
  const occupied = new Set();
  const tasks = (status.tasks ?? []).map((task, index) => {
    const { dependsOn, ...taskBase } = task;
    const grid = normalizeGrid(task.grid, index, initialBoard, occupied);
    const progress = task.progress === undefined ? progressFromState(task.state) : normalizeProgress(task.progress);
    for (let y = grid.y; y < grid.y + grid.h; y += 1) {
      for (let x = grid.x; x < grid.x + grid.w; x += 1) {
        occupied.add(`${x}:${y}`);
      }
    }
    return {
      ...taskBase,
      category: task.category || categories[0]?.id || DEFAULT_CATEGORY.id,
      state: normalizeState(task.state),
      progress,
      grid,
      touches: task.touches ?? [],
      interfaces: normalizeInterfaces(task.interfaces),
      updatedAt: task.updatedAt ?? new Date().toISOString()
    };
  });
  const maxY = tasks.reduce((value, task) => Math.max(value, task.grid.y + task.grid.h - 1), initialBoard.rows);
  const board = { ...initialBoard, rows: maxY };
  const taskIdPrefix = status.view?.taskIdPrefix || inferTaskPrefix(tasks);
  return {
    ...statusBase,
    workspace: {
      name: status.workspace?.name ?? "OpenCollab Project",
      repo: status.workspace?.repo ?? "local",
      branch: status.workspace?.branch ?? "main",
      locked: status.workspace?.locked ?? true,
      statusFile: status.workspace?.statusFile ?? "opencollab/Task_Status.json",
      currentActorId: status.workspace?.currentActorId ?? status.members?.[0]?.id ?? "",
      updatedAt: status.workspace?.updatedAt ?? new Date().toISOString()
    },
    view: {
      ...(status.view ?? {}),
      board,
      taskIdPrefix,
      progressSteps: status.view?.progressSteps ?? 24
    },
    categories,
    members: status.members ?? [],
    tasks,
    links: status.links ?? [],
    timeline: status.timeline ?? [],
    meetings: status.meetings ?? [],
    conflicts: status.conflicts ?? []
  };
}

function normalizeState(state) {
  return state === "working" ? "active" : state;
}

function normalizeProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(clamp(numeric, 0, 100));
}

function progressFromState(state) {
  const normalized = normalizeState(state);
  if (normalized === "done") return 100;
  if (normalized === "active") return 60;
  return 0;
}

function stateFromProgress(progressValue, claimantId) {
  const progress = normalizeProgress(progressValue);
  if (progress >= 100) return "done";
  if (progress > 0) return "active";
  return claimantId ? "claimed" : "undo";
}

function tileOpacity(progressValue) {
  return String(0.36 + normalizeProgress(progressValue) * 0.0064);
}

function averageProgress(tasks) {
  if (!tasks?.length) return 0;
  const total = tasks.reduce((sum, task) => sum + normalizeProgress(task.progress), 0);
  return Math.round(total / tasks.length);
}

function getBoard(status) {
  const board = status?.view?.board ?? {};
  return {
    cols: Math.max(1, Math.round(Number(board.cols) || DEFAULT_BOARD.cols)),
    rows: Math.max(1, Math.round(Number(board.rows) || DEFAULT_BOARD.rows))
  };
}

function normalizeGrid(grid, index, board, occupied) {
  const fallback = firstOpenGrid(occupied, board) ?? {
    x: (index % board.cols) + 1,
    y: Math.floor(index / board.cols) + 1,
    w: 1,
    h: 1
  };
  const width = Math.max(1, Math.round(Number(grid?.w) || fallback.w));
  const height = Math.max(1, Math.round(Number(grid?.h) || fallback.h));
  const x = clamp(Math.round(Number(grid?.x) || fallback.x), 1, Math.max(1, board.cols - width + 1));
  const y = Math.max(1, Math.round(Number(grid?.y) || fallback.y));
  return { x, y, w: width, h: height };
}

function normalizeInterfaces(interfaces) {
  return {
    inputs: Array.isArray(interfaces?.inputs) ? interfaces.inputs : [],
    outputs: Array.isArray(interfaces?.outputs) ? interfaces.outputs : [],
    boundaryNotes: Array.isArray(interfaces?.boundaryNotes) ? interfaces.boundaryNotes : []
  };
}

function occupiedGridCells(tasks) {
  const cells = new Set();
  for (const task of tasks) {
    for (let y = task.grid.y; y < task.grid.y + task.grid.h; y += 1) {
      for (let x = task.grid.x; x < task.grid.x + task.grid.w; x += 1) {
        cells.add(`${x}:${y}`);
      }
    }
  }
  return cells;
}

function taskAtGrid(tasks, grid, excludeId = "") {
  return tasks.find((task) => task.id !== excludeId && rectsOverlap(task.grid, grid));
}

function rectsOverlap(first, second) {
  return (
    first.x < second.x + second.w &&
    first.x + first.w > second.x &&
    first.y < second.y + second.h &&
    first.y + first.h > second.y
  );
}

function gridFromPoint(boardElement, clientX, clientY, grid, board) {
  const gridElement = boardElement?.querySelector(".task-grid");
  const rect = gridElement?.getBoundingClientRect();
  if (!rect) return grid;
  const x = clamp(Math.floor(((clientX - rect.left) / rect.width) * board.cols) + 1, 1, board.cols - grid.w + 1);
  const y = clamp(Math.floor(((clientY - rect.top) / rect.height) * board.rows) + 1, 1, board.rows - grid.h + 1);
  return { ...grid, x, y };
}

function findOpenGrid(tasks, board = DEFAULT_BOARD) {
  const occupied = occupiedGridCells(tasks);
  return firstOpenGrid(occupied, board);
}

function firstOpenGrid(occupied, board) {
  for (let y = 1; y <= board.rows; y += 1) {
    for (let x = 1; x <= board.cols; x += 1) {
      if (!occupied.has(`${x}:${y}`)) return { x, y, w: 1, h: 1 };
    }
  }
  return null;
}

function nextTaskId(tasks, preferredPrefix) {
  const prefix = preferredPrefix || inferTaskPrefix(tasks);
  const expression = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  const next = tasks.reduce((highest, task) => {
    const match = expression.exec(task.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

function inferTaskPrefix(tasks) {
  const counts = new Map();
  for (const task of tasks ?? []) {
    const match = /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(task.id ?? "");
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "OCB";
}

function isActive(task) {
  return (
    normalizeProgress(task.progress) > 0 ||
    normalizeState(task.state) === "active" ||
    normalizeState(task.state) === "done"
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableHash(value) {
  return JSON.stringify(value);
}

function toRgba(hex, alpha) {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex.replace("#", "") : "3a3d48";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default App;
