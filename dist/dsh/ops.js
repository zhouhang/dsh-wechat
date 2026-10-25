/**
 * DSH read/write operations behind the WeChat workspace/session/agent/model
 * commands. All service access goes through `ctx.get(...)` with undefined
 * checks — no runtime imports of `@deepseek-ai/*` packages.
 */
import { modelSelectionFromProjection, sessionEvents } from "./types.js";
/** Settings namespace owning the busy-Enter preference (dsh-client-ui-conversation). */
export const BUSY_ENTER_NAMESPACE = "ui-conversation";
export class DshOps {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    get(name) {
        return this.ctx.get(name);
    }
    // ─── Workspaces ───
    listWorkspaces() {
        return this.get("workspaceRegistry")?.list() ?? [];
    }
    /** Sessions hidden from every grouping surface (dsh-workspace archive set). */
    archivedSessionIds() {
        return this.get("workspaceRegistry")?.archivedSessionIds ?? [];
    }
    /**
     * Sessions pinned on every grouping surface (dsh-workspace pin set), in the
     * host's own order — most recently pinned first. Empty when the registry is
     * absent or the host version predates the pin feature.
     */
    pinnedSessionIds() {
        try {
            return this.get("workspaceRegistry")?.pinnedSessionIds ?? [];
        }
        catch {
            return [];
        }
    }
    /**
     * Whether this host exposes the durable pin API at all. Callers need it to
     * avoid reading an *absent* pin set as "nothing is pinned" — on an older
     * host that reading is indistinguishable from a genuinely empty set, so
     * `/s unpin` would otherwise claim a session is not pinned instead of
     * reporting that the service is missing.
     */
    supportsPin() {
        const registry = this.get("workspaceRegistry");
        return typeof registry?.pinSession === "function" && typeof registry?.unpinSession === "function";
    }
    /**
     * Pin one session through the host registry, so the GUI sidebar and WeChat
     * read one durable set. Never throws: the outcome is mapped for the caller's
     * wording (see {@link PinOutcome}).
     */
    async pinSession(sessionId) {
        return this.writePin("pinSession", sessionId);
    }
    /**
     * Unpin one session through the host registry. Idempotent, and the host runs
     * no existence check here — an id that is not pinned simply resolves.
     */
    async unpinSession(sessionId) {
        return this.writePin("unpinSession", sessionId);
    }
    /**
     * Shared body of {@link pinSession} / {@link unpinSession}: resolve the
     * registry, refuse when this host exposes no such method, then classify the
     * rejection by `err.name` (the host's stable discriminator, which avoids a
     * runtime `@deepseek-ai/*` import).
     */
    async writePin(method, sessionId) {
        if (!sessionId)
            return "unknown";
        const registry = this.get("workspaceRegistry");
        if (!registry)
            return "unavailable";
        const write = registry[method];
        if (typeof write !== "function")
            return "unavailable";
        try {
            await write.call(registry, sessionId);
            return "ok";
        }
        catch (err) {
            const name = err instanceof Error ? err.name : "";
            if (name === "WorkspaceArchivedSessionPinError")
                return "archived";
            if (name === "WorkspaceUnknownSessionError")
                return "unknown";
            return "failed";
        }
    }
    async resolveWorkspaceByPath(path) {
        try {
            return await this.get("workspaceRegistry")?.resolveByPath(path);
        }
        catch {
            return undefined;
        }
    }
    async createWorkspace(path) {
        try {
            return await this.get("workspaceRegistry")?.create(path);
        }
        catch (err) {
            return undefined;
        }
    }
    // ─── Sessions ───
    async listSessions() {
        const query = this.get("sessionQuery");
        if (!query)
            return [];
        try {
            const all = await query.listSessions();
            // Top-level sessions only (no subagent origin), and never archived
            // sessions — the same "hidden from every grouping surface" rule the
            // GUI sidebar applies (dsh-workspace archivedSessionIds).
            const archived = new Set(this.get("workspaceRegistry")?.archivedSessionIds ?? []);
            return all.filter((r) => r.header.origin !== "subagent" && !archived.has(r.header.id));
        }
        catch {
            return [];
        }
    }
    /**
     * Latest `session/title` text. Does not call host `readTitle()` (that
     * inspects the complete validated log). Live events / projection cache /
     * the raw-log fold used by `/s list` are enough for WeChat labels.
     */
    async readSessionTitle(sessionId, cwd, header) {
        if (!sessionId)
            return undefined;
        const facts = await this.readSessionListFacts(sessionId, cwd, header);
        return facts.title;
    }
    /**
     * The preset a session actually runs under, with the same precedence the
     * host reads (`@deepseek-ai/dsh-agent-presets.resolveSessionPreset`):
     * newest `agent-preset/selected` event wins, else the header's frozen
     * creation value, else undefined.
     *
     * Reading the header alone silently reverts a session that was switched
     * after creation — the same bug class the host module's doc-comment calls
     * out: "Reconstruction reads resolveSessionPreset, never the header alone."
     * The bridge surfaces `/s list` and `/status` from this path.
     * `/preset status` reports the deployment default instead.
     *
     * Why a raw log read here, not `sessionQuery.listEvents`: that service
     * returns lightweight `{sessionId, seq, type, time, surface}` records
     * (a recency-recovery shape) and intentionally drops `data` to keep the
     * surface small. The `agent-preset/selected` payload lives in
     * `data.agentPreset`, so the bridge has to reach the persistence layer.
     * `session-log.cjs` reproduces the host's frame-scanning path
     * (multi-frame Zstandard) so this stays a single-process, dependency-
     * free read — no `@deepseek-ai/*` imports.
     *
     * @param sessionId - the durable session id (the same format the GUI
     *   mints via `mintSessionId()`).
     * @param cwd - optional recorded working directory. `/s list` already
     *   has this from the first `listSessions()`; passing it avoids a
     *   second full roster scan per row. When omitted, the roster is
     *   consulted once to recover `header.cwd`.
     * @returns the preset id, or undefined when the session has none on
     *   record (no header value, no switch events, no readable log).
     */
    async resolveSessionPreset(sessionId, cwd, header) {
        if (!sessionId)
            return undefined;
        const facts = await this.readSessionListFacts(sessionId, cwd, header);
        return facts.preset;
    }
    async sessionLog() {
        try {
            return await import("./session-log.cjs");
        }
        catch {
            return undefined;
        }
    }
    /**
     * Walk a live agent's in-memory log newest-first. `found: true` means
     * the session is attached (even when it has no user prompt).
     */
    liveListFacts(sessionId) {
        try {
            const agents = this.get("agents");
            const session = agents?.get(sessionId)?.session;
            if (!session)
                return { found: false, facts: {} };
            // A live Session object is not enough: 0.1.5 always has one, but
            // the log is only readable via snapshotEvents() (or the legacy
            // `events` array). Without either, fall through to disk.
            if (typeof session.snapshotEvents !== "function" && !Array.isArray(session.events)) {
                return { found: false, facts: {} };
            }
            const events = sessionEvents(session);
            const facts = {};
            if (typeof session?.header?.agentPreset === "string" && session.header.agentPreset.length > 0) {
                facts.preset = session.header.agentPreset;
            }
            for (const ev of events) {
                if (!ev || typeof ev !== "object")
                    continue;
                if (ev.type === "agent-preset/selected") {
                    const data = ev.data;
                    if (typeof data?.agentPreset === "string" && data.agentPreset.length > 0) {
                        facts.preset = data.agentPreset;
                    }
                }
                else if (ev.type === "session/title") {
                    const data = ev.data;
                    if (typeof data?.title === "string" && data.title.length > 0) {
                        facts.title = data.title;
                    }
                }
                else if (ev.type === "user/message" && typeof ev.time === "number") {
                    const data = ev.data;
                    const kind = data?.source?.kind;
                    if (!kind || kind === "user")
                        facts.lastUserMessageTime = ev.time;
                }
            }
            return { found: true, facts };
        }
        catch {
            return { found: false, facts: {} };
        }
    }
    /** Zero-I/O listing hint from the host projection cache (same source as the GUI sidebar). */
    cachedListHint(header) {
        if (!header)
            return undefined;
        const cache = this.get("sessionProjectionCache");
        if (!cache || typeof cache.cachedSnapshot !== "function")
            return undefined;
        try {
            const snap = cache.cachedSnapshot(header);
            const values = snap?.values;
            if (!values)
                return undefined;
            const hint = {};
            const meta = values.sessionListMetadata;
            if (meta && typeof meta === "object") {
                const lastPromptAt = meta.lastPromptAt;
                if (typeof lastPromptAt === "number")
                    hint.lastUserMessageTime = lastPromptAt;
            }
            const title = values.title;
            if (typeof title === "string" && title.length > 0)
                hint.title = title;
            return hint;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Read whether a session log is usable and, if so, when the last
     * `user/message` landed. Distinguishes a true blank session (readable,
     * never spoken to) from a corrupt / unreadable log — `/s new` must not
     * treat the latter as "already blank".
     *
     * With `cwd`, `/s new` can skip `listEvents()` for sessions that are
     * obviously used (live log, projection cache, or an artifact larger
     * than a blank header). Full inspect remains the authority for small
     * unknown files and for callers that only have an id.
     */
    async inspectSessionActivity(sessionId, cwd, header) {
        const live = this.liveListFacts(sessionId);
        if (live.found) {
            return { ok: true, lastUserMessageTime: live.facts.lastUserMessageTime };
        }
        const cachedPrompt = this.cachedListHint(header)?.lastUserMessageTime;
        if (cachedPrompt !== undefined) {
            return { ok: true, lastUserMessageTime: cachedPrompt };
        }
        if (typeof cwd === "string" && cwd.length > 0) {
            const runtime = await this.sessionLog();
            if (runtime) {
                try {
                    const hint = runtime.readSessionUsedHint(cwd, sessionId, undefined);
                    if (hint.status === "used") {
                        return { ok: true, lastUserMessageTime: hint.time ?? header?.createdAt ?? 1 };
                    }
                    if (hint.status === "blank")
                        return { ok: true };
                }
                catch {
                    // fall through to listEvents
                }
            }
        }
        const query = this.get("sessionQuery");
        // No query service: we cannot prove corruption. Treat as a readable
        // empty log so `/s new` keeps the historical "already blank" path
        // instead of minting a duplicate session on every command.
        if (!query)
            return { ok: true };
        try {
            const records = await query.listEvents(sessionId);
            for (let i = records.length - 1; i >= 0; i--) {
                if (records[i].type === "user/message") {
                    return { ok: true, lastUserMessageTime: records[i].time };
                }
            }
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }
    /**
     * Time of the session's last user-prompt event (`user/message`).
     *
     * `/s list` calls this for every visible session on a cold start, so this
     * must not `listEvents()` (that inspects the complete validated log).
     * Prefer the live in-memory log, then the GUI's projection-cache hint,
     * then a newest-first tail read of the raw artifact. `cwd` comes from
     * the roster header; without it we fall back to {@link inspectSessionActivity}.
     */
    async lastUserMessageTime(sessionId, cwd, header) {
        const live = this.liveListFacts(sessionId);
        if (live.found)
            return live.facts.lastUserMessageTime;
        const cached = this.cachedListHint(header)?.lastUserMessageTime;
        if (cached !== undefined)
            return cached;
        if (typeof cwd === "string" && cwd.length > 0) {
            const runtime = await this.sessionLog();
            if (!runtime)
                return undefined;
            try {
                // `undefined` here means "no prompt in the cheap tail" (or blank),
                // not "try the full inspect". `/s list` falls back to createdAt.
                return runtime.readSessionRecency(cwd, sessionId, undefined);
            }
            catch {
                return undefined;
            }
        }
        const activity = await this.inspectSessionActivity(sessionId);
        return activity.ok ? activity.lastUserMessageTime : undefined;
    }
    /**
     * Title + live preset + recency for one displayed `/s list` row. One
     * raw-log fold replaces a `readTitle` inspect plus a second preset scan.
     */
    async readSessionListFacts(sessionId, cwd, header) {
        const live = this.liveListFacts(sessionId);
        if (live.found) {
            return {
                ...this.cachedListHint(header),
                ...live.facts,
            };
        }
        const hint = this.cachedListHint(header) ?? {};
        let resolvedCwd = typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
        if (!resolvedCwd) {
            const query = this.get("sessionQuery");
            if (query) {
                try {
                    resolvedCwd = (await query.listSessions()).find((r) => r.header.id === sessionId)?.header.cwd;
                }
                catch {
                    resolvedCwd = undefined;
                }
            }
        }
        if (!resolvedCwd)
            return hint;
        const runtime = await this.sessionLog();
        if (!runtime)
            return hint;
        try {
            const facts = runtime.readSessionListFacts(resolvedCwd, sessionId, undefined);
            return {
                ...hint,
                ...facts,
                lastUserMessageTime: facts.lastUserMessageTime ?? hint.lastUserMessageTime,
                title: facts.title ?? hint.title,
                preset: facts.preset ?? hint.preset,
            };
        }
        catch {
            return hint;
        }
    }
    // ─── History ──────────────────────────────────────────────────────────────
    /**
     * Extract display text from a session event's data payload.
     * Handles multiple host shapes: `data.message.content[]`, `data.content`,
     * `data.text`, etc. Returns empty string when nothing text-like is found.
     */
    extractHistoryText(data) {
        if (!data || typeof data !== "object") {
            if (typeof data === "string")
                return data;
            return "";
        }
        const d = data;
        // Primary: DSH message shape `data.message.content: [{type:"text",text}]`
        const msg = d.message;
        if (msg && Array.isArray(msg.content)) {
            const parts = msg.content
                .filter((b) => b.type === "text" && typeof b.text === "string")
                .map((b) => String(b.text));
            if (parts.length > 0)
                return parts.join("\n");
        }
        // Fallback: `data.content` array (some versions flatten)
        if (Array.isArray(d.content)) {
            const parts = d.content
                .filter((b) => b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
                .map((b) => String(b.text));
            if (parts.length > 0)
                return parts.join("\n");
        }
        // Fallback: plain `data.text`
        if (typeof d.text === "string" && d.text.trim())
            return d.text;
        // Fallback: `data.prompt` or `data.input` string
        if (typeof d.prompt === "string" && d.prompt.trim())
            return d.prompt;
        if (typeof d.input === "string" && d.input.trim())
            return d.input;
        return "";
    }
    /**
     * Classify one `user/message` payload as a genuine human turn or a
     * synthesized system injection.
     *
     * The host attributes synthesized user-role messages through
     * `source.kind` — `plugin` (context injections / compaction
     * checkpoints), `goal` (goal rounds), `session-reference` (recalls),
     * `agent-message` (relays). The GUI sidebar lists only `kind === "user"`
     * (session-turn-outline). Legacy payloads without a source stay human
     * so nothing real is hidden. Nested `data.message.source` is accepted
     * alongside the host's flat `data.source`.
     */
    userMessageRole(data) {
        if (!data || typeof data !== "object")
            return "user";
        const d = data;
        const direct = d.source?.kind;
        const nested = d.message?.source?.kind;
        const kind = direct ?? nested;
        return kind === undefined || kind === "user" ? "user" : "system";
    }
    /** Fold chronological history entries out of surface or raw-log events. */
    historyEntries(events) {
        const entries = [];
        for (const ev of events) {
            if (ev.type !== "user/message" && ev.type !== "assistant/message")
                continue;
            const text = this.extractHistoryText(ev.data);
            if (!text)
                continue;
            const role = ev.type === "user/message" ? this.userMessageRole(ev.data) : "assistant";
            entries.push({ role, text, time: typeof ev.time === "number" ? ev.time : Date.now() });
        }
        return entries;
    }
    takeHistoryWindow(entries, cap, includeSystem) {
        const visible = includeSystem ? entries : entries.filter((e) => e.role !== "system");
        return visible.slice(-cap);
    }
    /**
     * Retrieve the most recent `limit` conversation entries for `sessionId`,
     * ordered oldest→newest.
     *
     * Strategy:
     *  1. Try in-memory `session.snapshotEvents()` (0.1.5) or the legacy
     *     `session.events` array via `ctx.get("agents")` — fast, no I/O,
     *     survives even when `sessionQuery` is unavailable.
     *  2. Fall back to persisted `sessionQuery.readSession(sessionId)` (full
     *     raw log with `data`). `listEvents` is metadata-only since 0.1.2
     *     and cannot reconstruct text.
     *
     * Folds `user/message` and `assistant/message`. Synthesized user-role
     * messages (see {@link userMessageRole}) are tagged `system` and omitted
     * unless `includeSystem` is set. Other event types (tool results, true
     * `system/message`, etc.) stay out of the WeChat view.
     *
     * Returns `[]` on any error or when no history exists — caller renders
     * a friendly empty-state message.
     */
    async getSessionHistory(sessionId, limit, opts) {
        const cap = Math.max(1, Math.min(limit, 20));
        const includeSystem = opts?.includeSystem === true;
        // 1) In-memory fast path
        try {
            const agents = this.get("agents");
            const agent = agents?.get(sessionId);
            const events = sessionEvents(agent?.session);
            if (events.length > 0) {
                const entries = this.takeHistoryWindow(this.historyEntries(events), cap, includeSystem);
                if (entries.length > 0) {
                    // events are already in chronological order (ascending seq)
                    return entries;
                }
            }
        }
        catch {
            // fall through to persisted path
        }
        // 2) Persisted fallback. Prefer `readSession` (full events with `data`);
        // `listEvents` in 0.1.2 is metadata-only and cannot reconstruct text.
        const query = this.get("sessionQuery");
        if (!query)
            return [];
        try {
            let records = [];
            if (typeof query.readSession === "function") {
                const snapshot = await query.readSession(sessionId);
                records = snapshot.events ?? [];
            }
            else {
                records = await query.listEvents(sessionId);
            }
            return this.takeHistoryWindow(this.historyEntries(records), cap, includeSystem);
        }
        catch {
            return [];
        }
    }
    // ─── Models ───
    listProviders() {
        return this.get("llm")?.listProviders() ?? [];
    }
    async listModels(provider) {
        const llm = this.get("llm");
        if (!llm)
            return [];
        try {
            return await llm.listModels(provider);
        }
        catch {
            return [];
        }
    }
    /** Reasoning-effort capability of one exact model route, or undefined. */
    async resolveModelReasoning(provider, model) {
        const llm = this.get("llm");
        if (!llm)
            return undefined;
        try {
            const info = await llm.resolveModelInfo(provider, model);
            return info.reasoning;
        }
        catch {
            return undefined;
        }
    }
    defaultModelSelection() {
        return this.get("agentDefaultModel")?.currentSelection();
    }
    async saveDefaultModel(selection) {
        const service = this.get("agentDefaultModel");
        if (!service)
            return false;
        try {
            await service.saveSelection(selection);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * The Session's host-owned model selection, folded from the
     * `modelSelection` projection (`next` = the durable selection the next
     * request should use, `lastUsed` = the selection consumed by the latest
     * request). This is the same pair the GUI picker reads, so `/status` and
     * `/reasoning status` stay truthful after either surface switches.
     * Returns `undefined` when the projection registry is not composed or
     * the Session has no recorded selection yet.
     */
    sessionModelSelection(session) {
        if (!session)
            return undefined;
        try {
            const snapshot = this.sessionProjections()?.snapshot(session);
            const selected = modelSelectionFromProjection(snapshot?.values?.["modelSelection"]);
            return selected?.provider && selected.model
                ? {
                    provider: selected.provider,
                    model: selected.model,
                    ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
                }
                : undefined;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Route one model/effort switch through the Host session controller — the
     * same `session.selectModel` Remote the GUI picker submits. On success the
     * Host records `model/selection`, installs the selection for the next
     * prompt assembly, and updates the default, so the GUI and WeChat see the
     * same value immediately (and a later GUI switch simply replaces it).
     *
     * Older hosts or minimal profiles without that service report
     * `unsupported`; the caller keeps the legacy in-memory override path.
     * A controller rejection is reported as `error` rather than silently
     * falling back, matching the GUI's "unavailable model" behavior.
     */
    async selectSessionModel(sessionId, selection) {
        const controller = this.get("sessionController");
        if (!controller || typeof controller.selectModel !== "function") {
            return { kind: "unsupported" };
        }
        try {
            await controller.selectModel({
                sessionId,
                provider: selection.provider,
                model: selection.model,
                ...(selection.reasoningEffort !== undefined
                    ? { reasoningEffort: selection.reasoningEffort }
                    : {}),
            });
            return { kind: "host" };
        }
        catch (err) {
            return { kind: "error", message: err instanceof Error ? err.message : String(err) };
        }
    }
    // ─── Agent presets ───
    async listPresets() {
        const presets = this.get("agentPresets");
        if (!presets)
            return [];
        try {
            return await presets.list();
        }
        catch {
            return [];
        }
    }
    defaultPresetId() {
        const presets = this.get("agentPresets");
        try {
            return presets?.defaultId;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Persist the deployment-wide default preset — the exact selection the GUI
     * settings page edits, so a change from WeChat shows up there and vice versa.
     * Returns false when no settings provider is mounted or the write is refused.
     *
     * DSH 0.2 exposes `agent-preset-registry.selectedDefault` as a live settings
     * field and removed `settings.get`; the ordinary `default` config is only the
     * deployment fallback, and older hosts use `agent-presets.default` instead.
     * The config-row id IS the settings namespace (`settings.update` resolves it
     * against the profile's loader entries and throws `No configurable plugin
     * entry` otherwise), so a describe-capable host must advertise the entry
     * before we write; the legacy pair stays as the older-host path.
     */
    async saveDefaultPreset(presetId) {
        const settings = this.get("settings");
        if (!settings)
            return false;
        try {
            const descriptors = settings.describe?.();
            const registry = descriptors?.find((row) => row.ns === "agent-preset-registry")
                ?? descriptors?.find((row) => row.ns.endsWith(":agent-preset-registry"));
            if (registry) {
                await settings.update(registry.ns, { selectedDefault: presetId });
            }
            else {
                const legacy = descriptors?.find((row) => row.ns === "agent-presets");
                // A describe-capable host must advertise the entry before we write.
                if (descriptors && !legacy)
                    return false;
                await settings.update((legacy?.ns ?? "agent-presets"), { default: presetId });
            }
            return true;
        }
        catch (err) {
            console.error(`[dsh-wechat] save default preset failed: ${String(err)}`);
            return false;
        }
    }
    async recomposeAgent(agentCtx, id) {
        const presets = this.get("agentPresets");
        if (!presets || !agentCtx)
            return false;
        try {
            await presets.recompose(agentCtx, id);
            return true;
        }
        catch {
            return false;
        }
    }
    // ─── Permission presets ───
    permissionPresets() {
        return this.get("permissionPresets");
    }
    /** The deployment default permission preset for new sessions (settings-first). */
    permissionDefault() {
        return this.permissionPresets()?.defaultPreset;
    }
    // ─── Commands ───
    /**
     * The global `commands` service (dsh-commands). Exposes `execute` to dispatch
     * slash commands through the same registry the GUI's command palette reads,
     * so the registered handler — including `command/run` ↔ `command/done`
     * lifecycle events — runs unchanged for WeChat users.
     */
    commands() {
        return this.get("commands");
    }
    // ─── Session projections ───
    /**
     * The `ctx.sessionProjections` registry (`@deepseek-ai/dsh-session-projection`).
     * Hosts the whole-value projections every domain plugin registers for a
     * session — plan mode (`key: 'plan'`), goal (`key: 'goal'`), and any
     * future mode any third-party plugin adds. The WeChat bridge uses
     * `snapshot(agent.session)` to read the whole map at once and render
     * it in `/status`. Returns `undefined` when the registry is not
     * composed (e.g. minimal headless profiles) — the caller treats that
     * as "no projections, omit the section" without any further signal.
     */
    sessionProjections() {
        return this.get("sessionProjections");
    }
    /**
     * Persist the default permission preset into the DSH settings document
     * (`permission` namespace) — the exact document the GUI settings page's
     * Permission row edits, so a change from WeChat shows up there and vice
     * versa. New sessions pick it up natively (`pinInitialPermission`).
     * Returns false when no settings provider is mounted or the write is
     * refused.
     */
    async saveDefaultPermission(presetName) {
        const settings = this.get("settings");
        if (!settings)
            return false;
        try {
            await settings.update("permission", { defaultPreset: presetName });
            return true;
        }
        catch (err) {
            console.error(`[dsh-wechat] save default permission failed: ${String(err)}`);
            return false;
        }
    }
    // ─── Busy-Enter delivery behavior (ui-conversation.busyEnter) ───
    /**
     * The resolved busy-time delivery behavior — the same value the GUI's
     * General Settings 「繁忙时 Enter 键行为」 row shows. Falls back to
     * `"queue"` (the schema default) when no settings provider is mounted,
     * the namespace is unregistered, or the read throws.
     */
    busyEnter() {
        const settings = this.get("settings");
        try {
            // Read the resolved live value, not the sparse user override. In DSH
            // 0.2 settings.get was removed when settings moved into profile Config.
            const section = (typeof settings?.describe === "function"
                ? settings.describe().find((row) => row.ns === BUSY_ENTER_NAMESPACE)?.value
                : settings?.get?.(BUSY_ENTER_NAMESPACE));
            return section?.busyEnter === "steer" ? "steer" : "queue";
        }
        catch {
            return "queue";
        }
    }
    /**
     * Persist the busy-Enter behavior through the DSH settings service
     * (`ui-conversation` namespace) — the exact field the GUI settings page
     * edits, so a switch from WeChat shows up there and vice versa. Returns
     * false when no settings provider is mounted or the write is refused.
     */
    async saveBusyEnter(next) {
        const settings = this.get("settings");
        if (!settings)
            return false;
        try {
            await settings.update(BUSY_ENTER_NAMESPACE, { busyEnter: next });
            return true;
        }
        catch (err) {
            console.error(`[dsh-wechat] save busyEnter failed: ${String(err)}`);
            return false;
        }
    }
    // ─── References (`/at`) ───
    /**
     * The `ctx.sessionReferenceResolver` service (`@deepseek-ai/dsh-session-
     * reference`), or `undefined` when the host does not compose it.
     *
     * `/at s` needs two things from it: `listCandidates` for discovery and —
     * more importantly — the guarantee that the mention this bridge stages will
     * be accepted at `agent/pre-step`. The service is the ONLY consumer of
     * `dsh-session:` mentions, so its absence means a staged session mention
     * would be forwarded as literal text and never expanded: the caller must
     * refuse instead of silently degrading.
     */
    sessionReferenceResolver() {
        return this.get("sessionReferenceResolver");
    }
    /**
     * The `ctx.fileReferences` discovery seam
     * (`@deepseek-ai/dsh-file-reference`), or `undefined` when uncomposed.
     *
     * `/at f` does not NEED it (a path is valid prompt text on its own — the
     * provider's job is the model-facing prompt section, which is installed by
     * whoever mounts the provider). It is used only to suggest near-matches
     * when the typed path does not exist, so its absence degrades the hint,
     * never the command.
     */
    fileReferences() {
        return this.get("fileReferences");
    }
    // ─── Helpers for cross-session notification recipients ───
    /**
     * Find the full session record for `sessionId`, or undefined when not found
     * or when the session is filtered (archived / subagent). Mirrors listSessions filtering.
     */
    async findSessionRecord(sessionId) {
        const all = await this.listSessions();
        return all.find((r) => r.header.id === sessionId);
    }
    // ─── Context pressure (token meter) ───
    /** Approximate context occupancy for one session (the GUI's context meter source). */
    contextPressure(session) {
        const projections = this.get("sessionProjections");
        if (!projections)
            return undefined;
        try {
            const snapshot = projections.snapshot(session);
            const value = snapshot.values.contextPressure;
            if (!value || typeof value !== "object")
                return undefined;
            const p = value;
            if (p.projectedTokens === undefined && p.contextWindow === undefined)
                return undefined;
            return {
                ...(p.pressureTokens !== undefined ? { pressureTokens: p.pressureTokens } : {}),
                ...(p.projectedTokens !== undefined ? { projectedTokens: p.projectedTokens } : {}),
                ...(p.contextWindow !== undefined ? { contextWindow: p.contextWindow } : {}),
            };
        }
        catch {
            return undefined;
        }
    }
}
//# sourceMappingURL=ops.js.map