/**
 * DSH read/write operations behind the WeChat workspace/session/agent/model
 * commands. All service access goes through `ctx.get(...)` with undefined
 * checks — no runtime imports of `@deepseek-ai/*` packages.
 */
import type { Agent, AgentSessionLike, SessionProjectionService } from "./types.js";
import type { BridgeContext } from "./sessions.js";
/** Nominal id of one registered settings namespace (dsh-settings brand). */
export type SettingsNamespace = string & {
    readonly __settingsNamespace?: undefined;
};
/**
 * Busy-time delivery behavior for user messages (DSH `ui-conversation.busyEnter`).
 * `queue` = ordinary follow-up turn; `steer` = splice into the running turn at
 * the nearest step boundary. The value lives in the host configuration
 * (profile config in DSH 0.2, user-settings document in older hosts) — the exact field the GUI's General Settings
 * 「繁忙时 Enter 键行为」 row edits — so WeChat and the GUI always agree.
 */
export type BusyEnterBehavior = "queue" | "steer";
/** Settings namespace owning the busy-Enter preference (dsh-client-ui-conversation). */
export declare const BUSY_ENTER_NAMESPACE = "ui-conversation";
export interface Workspace {
    readonly id: string;
    readonly path: string;
    readonly title: string;
    readonly createdAt: string;
    readonly sessionIds: readonly string[];
}
export interface SessionRecord {
    header: SessionHeader;
    live: boolean;
    persisted: boolean;
}
export interface SessionHeader {
    readonly version: number;
    readonly id: string;
    readonly createdAt: number;
    readonly cwd?: string;
    readonly origin?: "subagent";
    readonly agentPreset?: string;
}
export interface ProviderInfo {
    id: string;
    name: string;
}
export interface ModelInfo {
    provider: string;
    id: string;
    name: string;
    description?: string;
}
export interface AgentPreset {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    readonly broken?: string;
}
export interface ModelSelection {
    provider: string;
    model: string;
    /** Adapter-owned reasoning effort id; absent = provider/model default. */
    reasoningEffort?: string;
}
/** Reasoning-effort capability of one exact model route (dsh-llm). */
export interface ModelReasoningInfo {
    /** Supported efforts in adapter-preferred display order. */
    efforts: readonly {
        id: string;
        name: string;
        description?: string;
    }[];
    /** Adapter-configured default materialized when callers omit an effort. */
    defaultEffort?: string;
}
export interface WorkspaceRegistry {
    list(): Workspace[];
    create(path: string, title?: string): Promise<Workspace>;
    resolveByPath(path: string): Promise<Workspace | undefined>;
    /**
     * Registry-global archive set (dsh-workspace): sessions hidden from every
     * grouping surface. Archiving keeps the session's workspace slot; this is
     * the "hidden from lists" marker the GUI sidebar honors.
     */
    readonly archivedSessionIds: readonly string[];
    /**
     * Registry-global pin set (dsh-workspace): sessions surfaced ahead of every
     * unpinned session on grouping surfaces. **Most recently pinned first** —
     * this is the host's own array order, not a recency sort. Pinning never
     * touches workspace accounting, and archiving a session drops its pin in
     * the same durable write.
     *
     * Optional: a host older than the pin feature simply omits it, so readers
     * must fall back to "no pinned sessions".
     */
    readonly pinnedSessionIds?: readonly string[];
    /**
     * Pin one session durably, prepending it to the pin set. Idempotent: an
     * already pinned id resolves without writing or reordering. Rejects with
     * `WorkspaceArchivedSessionPinError` (name-matching) for an archived
     * session — pinning and archival are mutually exclusive — and with
     * `WorkspaceUnknownSessionError` for a session that does not exist.
     */
    pinSession?(sessionId: string): Promise<void>;
    /**
     * Drop one session from the pin set. Idempotent and, unlike pinning, runs
     * no session-existence check (removing an id cannot introduce an unknown
     * one), so an entry whose session is gone still resolves.
     */
    unpinSession?(sessionId: string): Promise<void>;
}
/**
 * Result of a pin/unpin attempt, mapped from the host's own outcomes so the
 * bridge can word a precise reply without importing `@deepseek-ai/*` error
 * classes (the host sets `err.name`, which is the stable discriminator).
 *
 * - `ok` — the write landed (or was already in the requested state).
 * - `archived` — `pinSession` refused an archived session.
 * - `unknown` — the host reported no such session.
 * - `unavailable` — no registry, or the host version has no pin API.
 * - `failed` — anything else (storage fault, unexpected rejection).
 */
export type PinOutcome = "ok" | "archived" | "unknown" | "unavailable" | "failed";
export interface SessionQuery {
    listSessions(): Promise<SessionRecord[]>;
    readTitle(sessionId: string): Promise<{
        title?: string;
    } | undefined>;
    /** Lightweight raw-log event records (ascending seq), for recency recovery. */
    listEvents(sessionId: string): Promise<Array<{
        type: string;
        time: number;
        data?: unknown;
        seq?: number;
    }>>;
    /**
     * Full validated log (0.1.2+). `listEvents` no longer carries `data`, so
     * `/history` prefers this when the host exposes it.
     */
    readSession?(sessionId: string): Promise<{
        events: Array<{
            type: string;
            time?: number;
            data?: unknown;
        }>;
    }>;
}
/** Listing facts folded from a session log without a full `listEvents` inspect. */
export interface SessionListFacts {
    preset?: string;
    title?: string;
    lastUserMessageTime?: number;
}
/**
 * Outcome of reading a session log for "has the user spoken?" checks.
 * `ok: false` means the log could not be validated (corrupt persistence);
 * that is NOT a blank session.
 */
export type SessionLogActivity = {
    ok: true;
    lastUserMessageTime?: number;
} | {
    ok: false;
    error: string;
};
export interface HistoryEntry {
    /** `system` is a synthesized user-role message (compact / plugin / goal / recall). */
    role: "user" | "assistant" | "system";
    text: string;
    time: number;
}
export interface LlmService {
    listProviders(): ProviderInfo[];
    listModels(provider: string): Promise<ModelInfo[]>;
    /** Exact-route metadata: context window, reasoning efforts, etc. */
    resolveModelInfo(provider: string, model: string): Promise<{
        reasoning?: ModelReasoningInfo;
    }>;
}
export interface AgentPresetsService {
    list(): Promise<AgentPreset[]>;
    recompose(agentCtx: unknown, id: string): Promise<unknown>;
    /** Preset id mounted when a caller names none (dsh-agent-presets). */
    defaultId?: string;
}
export interface AgentDefaultModelService {
    currentSelection(): ModelSelection;
    saveSelection(next: ModelSelection): Promise<void>;
}
/**
 * Minimal structural surface of the Host `sessionController` service
 * (`@deepseek-ai/dsh-api-session-controller`). `selectModel` is the exact
 * Remote operation the GUI model picker calls: it validates the route,
 * appends the durable `model/selection` event, installs the Session-local
 * selection, and saves the deployment default in the background. Calling it
 * from WeChat is what keeps both surfaces on ONE selection instead of the
 * bridge maintaining a second, request-only override.
 */
export interface SessionControllerService {
    selectModel?(request: {
        sessionId: string;
        provider: string;
        model: string;
        reasoningEffort?: string;
    }): Promise<{
        selected?: ModelSelection;
    } | undefined>;
}
/** Outcome of routing one switch through the Host session controller. */
export type SessionModelSelectionOutcome = {
    kind: "host";
}
/** The deployment composes no session controller (older Host / headless). */
 | {
    kind: "unsupported";
} | {
    kind: "error";
    message: string;
};
/** Minimal structural surface of the `permissionPresets` service (dsh-permission-presets). */
export interface PermissionPresetsService {
    /** Advertised preset names, in table declaration order. */
    readonly names: readonly string[];
    /** Preset selected as the default for future sessions (settings-first). */
    readonly defaultPreset: string;
    /**
     * Effective preset for one session, or `custom` when nothing matches.
     * The host folds `sessionProjections.stateOf(session, "permissions")`
     * (host signature `current(session: Session): string`, since
     * dsh 0.1.2-alpha.2), so this face takes the live Session — an event
     * array makes the host throw `permission: permissions session
     * projection is not registered`.
     */
    current(session: unknown): string;
    /** Switch one session's permission preset (records events + writes knobs). */
    set(session: unknown, name: string): void;
    /** Resolve a preset's knob bundle. */
    resolve(name: string): {
        sandbox: string;
        approval: string;
        name?: string;
        description?: string;
    };
    /** Build the client option for a table entry or `custom`. */
    optionOf(name: string): {
        value: string;
        name: string;
        description?: string;
    };
}
/**
 * Minimal structural surface of the `commands` service (dsh-commands).
 * Only the `execute` entry is needed — the bridge mirrors the GUI's
 * command palette by dispatching each recognized slash command through
 * the same registry, so the registered handler (e.g. dsh-command-compact)
 * owns the `command/run` ↔ `command/done` lifecycle and the localized
 * CommandResult text. We type `commandId` as opaque because the bridge
 * never correlates across sessions.
 */
export interface CommandsService {
    /**
     * Mirrors `@deepseek-ai/dsh-commands.CommandRuntime.execute`. The host
     * signature is `(agent, line, images, signal)` — `images` is the composer
     * attachment batch (always `[]` from WeChat; there is no composer), and
     * `signal` is the UI request's cancellation signal. The previous 3-arg
     * shape put the signal in `images`'s slot, leaving `signal` undefined
     * inside the host and breaking every native command with
     * `Cannot read properties of undefined (reading 'aborted')`.
     */
    execute(agent: Agent, line: string, images: readonly unknown[], signal: AbortSignal): Promise<{
        commandId: unknown;
        result: CommandResultShape;
    } | undefined>;
}
/** Minimal shape of the handler's normalized result (dsh-commands CommandResult). */
export interface CommandResultShape {
    readonly kind: "success" | "error";
    readonly text?: string;
    readonly sourceEventSeq?: number;
}
/**
 * Host settings across versions: DSH 0.2 projects live plugin Config values
 * through describe(); older hosts expose get(ns). update(ns, patch) remains
 * the shared write entry point used by the GUI.
 */
export interface SettingsService {
    get?(ns: SettingsNamespace): unknown;
    describe?(): readonly {
        ns: string;
        value?: unknown;
    }[];
    update(ns: SettingsNamespace, patch: object): Promise<void>;
}
/** One session-reference discovery candidate (dsh-session-reference). */
export interface SessionReferenceCandidate {
    readonly sessionId: string;
    /** Mention label: the session's latest title, or its id when untitled. */
    readonly label: string;
    /** Presentation title (a subagent's durable creation label wins). */
    readonly displayTitle?: string;
    readonly cwd?: string;
    /** True when the candidate shares the requesting agent's working directory. */
    readonly sameWorkspace?: boolean;
    readonly createdAt?: number;
}
/**
 * Minimal structural surface of `ctx.sessionReferenceResolver`
 * (`@deepseek-ai/dsh-session-reference`). Only discovery is consumed:
 * preparation is the HOST's job at `agent/pre-step`, driven purely by the
 * canonical mention the bridge stages in the message text. `prepare` is
 * deliberately not called — invoking it out of band would prepare a snapshot
 * the host never attaches to a message.
 */
export interface SessionReferenceResolverService {
    listCandidates(agent: Agent, query?: string, limit?: number, signal?: AbortSignal): Promise<readonly SessionReferenceCandidate[]>;
}
/** One file-reference candidate (`ctx.fileReferences.list`). */
export interface FileReferenceCandidate {
    /** Workspace-relative path; directories carry no trailing slash here. */
    readonly path: string;
    readonly kind: "file" | "directory";
}
/**
 * Minimal structural surface of `ctx.fileReferences`
 * (`@deepseek-ai/dsh-file-reference`). Used by `/at f` only to suggest
 * near-matches for a path that does not exist.
 */
export interface FileReferencesService {
    list(agent: Agent, query: string, signal: AbortSignal): Promise<readonly FileReferenceCandidate[]>;
}
/** Approximate context occupancy (dsh-token-meter `contextPressure` projection). */
export interface ContextPressureProjection {
    /** Provider-reported prompt tokens of the most recent request. */
    pressureTokens?: number;
    /** What the NEXT request's prompt would cost (pressure + surface delta). */
    projectedTokens?: number;
    /** Newest recorded model route capacity (total context window). */
    contextWindow?: number;
}
export declare class DshOps {
    private readonly ctx;
    constructor(ctx: BridgeContext);
    private get;
    listWorkspaces(): Workspace[];
    /** Sessions hidden from every grouping surface (dsh-workspace archive set). */
    archivedSessionIds(): readonly string[];
    /**
     * Sessions pinned on every grouping surface (dsh-workspace pin set), in the
     * host's own order — most recently pinned first. Empty when the registry is
     * absent or the host version predates the pin feature.
     */
    pinnedSessionIds(): readonly string[];
    /**
     * Whether this host exposes the durable pin API at all. Callers need it to
     * avoid reading an *absent* pin set as "nothing is pinned" — on an older
     * host that reading is indistinguishable from a genuinely empty set, so
     * `/s unpin` would otherwise claim a session is not pinned instead of
     * reporting that the service is missing.
     */
    supportsPin(): boolean;
    /**
     * Pin one session through the host registry, so the GUI sidebar and WeChat
     * read one durable set. Never throws: the outcome is mapped for the caller's
     * wording (see {@link PinOutcome}).
     */
    pinSession(sessionId: string): Promise<PinOutcome>;
    /**
     * Unpin one session through the host registry. Idempotent, and the host runs
     * no existence check here — an id that is not pinned simply resolves.
     */
    unpinSession(sessionId: string): Promise<PinOutcome>;
    /**
     * Shared body of {@link pinSession} / {@link unpinSession}: resolve the
     * registry, refuse when this host exposes no such method, then classify the
     * rejection by `err.name` (the host's stable discriminator, which avoids a
     * runtime `@deepseek-ai/*` import).
     */
    private writePin;
    resolveWorkspaceByPath(path: string): Promise<Workspace | undefined>;
    createWorkspace(path: string): Promise<Workspace | undefined>;
    listSessions(): Promise<SessionRecord[]>;
    /**
     * Latest `session/title` text. Does not call host `readTitle()` (that
     * inspects the complete validated log). Live events / projection cache /
     * the raw-log fold used by `/s list` are enough for WeChat labels.
     */
    readSessionTitle(sessionId: string, cwd?: string, header?: SessionHeader): Promise<string | undefined>;
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
    resolveSessionPreset(sessionId: string, cwd?: string, header?: SessionHeader): Promise<string | undefined>;
    private sessionLog;
    /**
     * Walk a live agent's in-memory log newest-first. `found: true` means
     * the session is attached (even when it has no user prompt).
     */
    private liveListFacts;
    /** Zero-I/O listing hint from the host projection cache (same source as the GUI sidebar). */
    private cachedListHint;
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
    inspectSessionActivity(sessionId: string, cwd?: string, header?: SessionHeader): Promise<SessionLogActivity>;
    /**
     * Time of the session's last user-prompt event (`user/message`).
     *
     * `/s list` calls this for every visible session on a cold start, so this
     * must not `listEvents()` (that inspects the complete validated log).
     * Prefer the live in-memory log, then the GUI's projection-cache hint,
     * then a newest-first tail read of the raw artifact. `cwd` comes from
     * the roster header; without it we fall back to {@link inspectSessionActivity}.
     */
    lastUserMessageTime(sessionId: string, cwd?: string, header?: SessionHeader): Promise<number | undefined>;
    /**
     * Title + live preset + recency for one displayed `/s list` row. One
     * raw-log fold replaces a `readTitle` inspect plus a second preset scan.
     */
    readSessionListFacts(sessionId: string, cwd?: string, header?: SessionHeader): Promise<SessionListFacts>;
    /**
     * Extract display text from a session event's data payload.
     * Handles multiple host shapes: `data.message.content[]`, `data.content`,
     * `data.text`, etc. Returns empty string when nothing text-like is found.
     */
    private extractHistoryText;
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
    private userMessageRole;
    /** Fold chronological history entries out of surface or raw-log events. */
    private historyEntries;
    private takeHistoryWindow;
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
    getSessionHistory(sessionId: string, limit: number, opts?: {
        includeSystem?: boolean;
    }): Promise<HistoryEntry[]>;
    listProviders(): ProviderInfo[];
    listModels(provider: string): Promise<ModelInfo[]>;
    /** Reasoning-effort capability of one exact model route, or undefined. */
    resolveModelReasoning(provider: string, model: string): Promise<ModelReasoningInfo | undefined>;
    defaultModelSelection(): ModelSelection | undefined;
    saveDefaultModel(selection: ModelSelection): Promise<boolean>;
    /**
     * The Session's host-owned model selection, folded from the
     * `modelSelection` projection (`next` = the durable selection the next
     * request should use, `lastUsed` = the selection consumed by the latest
     * request). This is the same pair the GUI picker reads, so `/status` and
     * `/reasoning status` stay truthful after either surface switches.
     * Returns `undefined` when the projection registry is not composed or
     * the Session has no recorded selection yet.
     */
    sessionModelSelection(session: AgentSessionLike | undefined): ModelSelection | undefined;
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
    selectSessionModel(sessionId: string, selection: ModelSelection): Promise<SessionModelSelectionOutcome>;
    listPresets(): Promise<AgentPreset[]>;
    defaultPresetId(): string | undefined;
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
    saveDefaultPreset(presetId: string): Promise<boolean>;
    recomposeAgent(agentCtx: unknown, id: string): Promise<boolean>;
    permissionPresets(): PermissionPresetsService | undefined;
    /** The deployment default permission preset for new sessions (settings-first). */
    permissionDefault(): string | undefined;
    /**
     * The global `commands` service (dsh-commands). Exposes `execute` to dispatch
     * slash commands through the same registry the GUI's command palette reads,
     * so the registered handler — including `command/run` ↔ `command/done`
     * lifecycle events — runs unchanged for WeChat users.
     */
    commands(): CommandsService | undefined;
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
    sessionProjections(): SessionProjectionService | undefined;
    /**
     * Persist the default permission preset into the DSH settings document
     * (`permission` namespace) — the exact document the GUI settings page's
     * Permission row edits, so a change from WeChat shows up there and vice
     * versa. New sessions pick it up natively (`pinInitialPermission`).
     * Returns false when no settings provider is mounted or the write is
     * refused.
     */
    saveDefaultPermission(presetName: string): Promise<boolean>;
    /**
     * The resolved busy-time delivery behavior — the same value the GUI's
     * General Settings 「繁忙时 Enter 键行为」 row shows. Falls back to
     * `"queue"` (the schema default) when no settings provider is mounted,
     * the namespace is unregistered, or the read throws.
     */
    busyEnter(): BusyEnterBehavior;
    /**
     * Persist the busy-Enter behavior through the DSH settings service
     * (`ui-conversation` namespace) — the exact field the GUI settings page
     * edits, so a switch from WeChat shows up there and vice versa. Returns
     * false when no settings provider is mounted or the write is refused.
     */
    saveBusyEnter(next: BusyEnterBehavior): Promise<boolean>;
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
    sessionReferenceResolver(): SessionReferenceResolverService | undefined;
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
    fileReferences(): FileReferencesService | undefined;
    /**
     * Find the full session record for `sessionId`, or undefined when not found
     * or when the session is filtered (archived / subagent). Mirrors listSessions filtering.
     */
    findSessionRecord(sessionId: string): Promise<SessionRecord | undefined>;
    /** Approximate context occupancy for one session (the GUI's context meter source). */
    contextPressure(session: unknown): ContextPressureProjection | undefined;
}
//# sourceMappingURL=ops.d.ts.map