/**
 * The core bridge: WeChat iLink ⇄ DSH agents.
 *
 * Ported design from wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 * The OpenCode Server half is replaced by direct in-process DSH service
 * calls: agents are created/resumed through the `agents` registry, WeChat
 * messages enter via `agent.followup`, assistant output leaves via the
 * `session/event` feed, and approval/question cards are MIRRORED to WeChat
 * from the Host `approval/request` and `user-questions/request` waterfalls
 * — the decision point and trigger policy stay exactly as in the GUI
 * (`approval.request` from sandbox escalation, `userQuestions.ask` from
 * the native ask tool). The bridge races `next()` (GUI / other answerers)
 * against the WeChat reply. Whoever answers first wins; there is no
 * custom approval list.
 */
import type { AssistantStreamFrame } from "../dsh/types.js";
import { type BridgeContext } from "../dsh/sessions.js";
import type { Agent, AskUserQuestionAnswer, AskUserQuestionItem } from "../dsh/types.js";
import { type UserState } from "../state.js";
import type { WeChatDSHConfig } from "../config.js";
import { type ConfigStore, type EditableConfig } from "../config-store.js";
export interface LoginState {
    phase: "idle" | "waiting-qr" | "scaned" | "logged-in" | "failed";
    qrUrl?: string;
    error?: string;
    botId?: string;
}
/** Closed approval outcomes the Host waterfall accepts. */
export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";
/**
 * Host `approval/request` waterfall payload (structural). `agent.id` is the
 * live session id; `callId` correlates the GUI tool card when present.
 */
export interface ApprovalRequestLike {
    readonly agent?: {
        readonly id?: string;
        session?: {
            header?: {
                id?: string;
            };
        };
    };
    readonly toolName?: string;
    readonly callId?: string;
    readonly reason?: string;
    readonly signal?: AbortSignal;
}
/**
 * Host `user-questions/request` waterfall payload (structural).
 */
export interface QuestionRequestLike {
    readonly agent?: {
        readonly id?: string;
        session?: {
            header?: {
                id?: string;
            };
        };
    };
    readonly questions?: AskUserQuestionItem[];
    readonly signal?: AbortSignal;
}
/**
 * Structural surface of the DSH `ctx.commands` plugin-owned human command
 * registry (host side). Mirrors only the minimum the bridge consumes:
 *
 * - `find(agent, name)` — name-presence check; the bridge uses this to
 *   decide whether to dispatch natively or fall through to the local
 *   whitelist. Returns `undefined` when the name is not registered for
 *   this agent.
 * - `execute(agent, line, signal)` — full parse + dispatch; returns the
 *   settled `CommandExecution` (`{ commandId, result: CommandResult }`)
 *   or `undefined` for invalid syntax / unknown names. The bridge reads
 *   `result.kind` / `result.text` and renders to WeChat. Per the host
 *   type contract, `CommandResult` is `{ kind: 'success', text? }` or
 *   `{ kind: 'error', text }` — the success text is optional (some
 *   commands reply through `sourceEventSeq` instead), the error text
 *   is required.
 * - `list(agent)` — name-sorted descriptors for discovery; used by
 *   `/help` to surface whatever the host has registered so users can
 *   discover commands that have no entry in this plugin's local docs.
 *
 * No `@deepseek-ai/*` runtime dep — the registry lives in the host
 * process; the bridge reaches it via `ctx.inject(['commands'], ...)`
 * through the cordis injection pattern already used for `tools` /
 * `systemPrompt`.
 */
export interface NativeCommandsSurface {
    find(agent: Agent, name: string): {
        name: string;
        description?: string;
        input?: {
            hint?: string;
        };
    } | undefined;
    /**
     * Mirrors `@deepseek-ai/dsh-commands.CommandRuntime.execute`. The host
     * signature is `(agent, line, images, signal)` — `images` is the composer
     * attachment batch (base64-encoded), and `signal` is the UI request's
     * cancellation signal. WeChat has no composer attachment surface, so the
     * bridge always passes `[]`; the previous 3-arg call placed the signal
     * in `images`'s slot, leaving `signal` undefined inside the host handler
     * and triggering `Cannot read properties of undefined (reading
     * 'aborted')` on every native command.
     */
    execute(agent: Agent, line: string, images: readonly unknown[], signal: AbortSignal): Promise<{
        commandId: string;
        result: {
            kind: "success";
            text?: string;
            sourceEventSeq?: number;
        } | {
            kind: "error";
            text: string;
        };
    } | undefined>;
    list(agent: Agent): Array<{
        name: string;
        description?: string;
        input?: {
            hint?: string;
        };
    }>;
}
export declare class WeChatDSHBridge {
    private readonly ctx;
    private config;
    private readonly configStore?;
    private readonly state;
    private readonly agents;
    private readonly ops;
    private token;
    /**
     * Gateway rejected the current bot session (`-14` / session timeout).
     * Distinct from `token === null` (never logged in / mid re-login).
     * While invalid and not given up, outbound is parked and flushed on recover.
     * Cleared when getUpdates succeeds again or a fresh QR login lands.
     */
    private tokenInvalid;
    /**
     * `-14` recovery exhausted (re-scan hint). Further outbound is dropped,
     * and any parked items are discarded.
     */
    private tokenGiveUp;
    /**
     * Single WeChat peer. First inbound user wins; later distinct
     * `from_user_id`s are ignored. Single-user deployments only.
     */
    private peerUserId;
    /**
     * Peer id written into `allowedUsers` by the S3 upgrade seeding, until its
     * one-time notice has been delivered (see {@link notifyAllowlistSeed}).
     * Reading it is what makes the notice exactly-once instead of once per
     * inbound message.
     */
    private allowlistSeededPeer;
    /**
     * Latest inbound iLink `context_token` for the peer. Wired into the
     * send payload when present; never used as a send gate.
     */
    private wireContextToken;
    /** Per-run monitor cancellation; recreated on every reconnect. */
    private monitorAbort;
    private monitorRunning;
    private monitorTask;
    private readonly seenInbound;
    private loginState;
    /** One QR flow at a time; a second start would race the same bot session. */
    private loginInFlight;
    /** Retry armed after a failed/expired flow so the QR page never dead-ends. */
    private loginRetryTimer;
    /** Pending question cards per user (rpcId-keyed, first = active). */
    private readonly pendingQuestions;
    /** Pending approval cards per user (rpcId-keyed). */
    private readonly pendingApprovals;
    /**
     * Card rpcIds already pushed to WeChat in full, per user. Prevents a
     * re-send when the user switches into the card's session after it was
     * already delivered (the card is always re-viewable via /history).
     */
    private readonly pushedCardRpcIds;
    private readonly silentBuffers;
    /** Desktop-style process group for the currently bound conversation. */
    private readonly processes;
    private readonly assistantStreams;
    private readonly streamedReasoning;
    /** Bounded dedup of committed output records (not transient stream chunks). */
    private readonly seenOutputEvents;
    /** Invalidates queued sends across logout / re-login, even for the same peer. */
    private outboundGeneration;
    /**
     * 结论模式 (final-only) hold table, keyed by session id. While
     * `config.finalOnly` is on, neither the bound session's assistant text nor
     * a cross-session task notice is pushed as it happens: each is folded into
     * the entry for its session and the whole entry is delivered ONCE, after
     * the task has been quiet for `finalOnlyIdleMs` (or at the
     * `finalOnlyCeilingMs` hard ceiling). This is what collapses a goal that
     * auto-continues over N rounds — each round is a separate DSH turn, so the
     * per-turn `silent` mode still emits one message per round — into a single
     * conclusion.
     */
    private readonly pendingFinal;
    /** One global queue and budget: dsh-wechat intentionally serves one peer. */
    private outboundCache;
    private wechatMsgCount;
    private cacheNoticeSent;
    /** Sliding-window limiter for agent-initiated `send_wechat` pushes. */
    private readonly pushRate;
    /** Reentrancy guard for the cap-pressure force-send in `parkOutbound`. */
    private capFlushActive;
    /** Force-sends performed at the cap (log throttle only). */
    private capFlushes;
    /** Serializes all outbound budget/queue mutations across assistant and tool sends. */
    private outboundSerial;
    /**
     * Marks the async call chain of the body currently holding the outbound
     * slot. `AsyncLocalStorage` (rather than a boolean) is what makes the
     * re-entrancy check exact: an unrelated caller that merely ARRIVES while
     * the slot is held is legitimate FIFO queueing, while a call made from
     * INSIDE the held body is the self-deadlock this guards against.
     */
    private readonly outboundChain;
    /** Operations enqueued but not settled — keeps the happy path timer-free. */
    private outboundPending;
    /** Bounded wait for the slot; a test seam, and the R1 escape from a wedged predecessor. */
    private outboundSlotWaitMs;
    /** Append-only audit trail (S4): JSONL under the storage dir, capped + rotated. */
    private readonly audit;
    /** Per-agent model overrides set by `/model switch` / `/reasoning` (applied via agent/request). */
    private readonly modelOverrides;
    /** Dedup for cross-session turn/end notifications (userId -> sessionIds already notified this turn). */
    private readonly notifiedCrossSessionTurns;
    /**
     * Last assistant text per session (for cross-session completion preview).
     * Bounded FIFO at {@link ASSISTANT_PREVIEW_MAX_SESSIONS}: the value is a
     * whole assistant message, so an unbounded map is a real leak on a long
     * lived install with many sessions; eviction only means a completion card
     * loses its quoted tail.
     */
    private readonly lastAssistantTextBySession;
    /**
     * Last user-prompt time per session (from `user/message` events with
     * source.kind === "user" — the same activity the GUI sidebar uses). Used
     * for `/s list` ordering and the time column; sessions without a recorded
     * activity (cold after restart) fall back to their creation time.
     * Bounded FIFO at {@link ACTIVITY_MAX_SESSIONS} (numbers only — the cap
     * exists because every session the process ever sees would otherwise stay
     * resident forever).
     */
    private readonly lastActivityBySession;
    /**
     * Inbound merge window state per WeChat chat (F1). Present only while a
     * batch is open or a dispatch is in flight; deleted once drained, so this
     * map never grows past the number of chats being merged (one peer here).
     */
    private readonly mergedText;
    /**
     * The most recent numbered session list per WeChat user. Keeping the exact
     * ids (rather than only its scope) lets a following shorthand `/s switch
     * <n>` select the row the user actually saw, even if recency changes before
     * the switch arrives. Explicit `/s switch current <n>` bypasses this
     * ephemeral snapshot and resolves the current scope afresh.
     */
    private readonly lastSessionListByUser;
    /**
     * `/at` references staged for the NEXT message, per WeChat user (one peer in
     * practice). In-memory only: a reference is a one-shot intent, and after a
     * restart the user's next sentence is very likely about something else, so
     * resurrecting a stale mention would silently attach unrelated context to a
     * new turn. `/at clear` and a TTL both drop it; delivery consumes it.
     */
    private readonly pendingRefs;
    /**
     * Per-session message-source tracking for the dynamic WeChat surface
     * prompt: the most recent user-message origin per session ("wechat" when
     * the last user message was injected from WeChat, "gui" when it came from
     * the GUI chat box). The global `dsh-wechat-surface` prompt section
     * consults this via `surfaceSourceFor()` at assembly time, so the WeChat
     * prompt follows the message source — present exactly while WeChat
     * messages drive the session, absent while GUI messages do. Entries are
     * lazily dropped after SURFACE_TTL_MS without a touch.
     */
    private readonly sourceBySession;
    /**
     * Ids of user messages this bridge injected from WeChat (pending their
     * `user/message` echo), so `handleSessionEvent` can tell WeChat-injected
     * messages apart from GUI-typed ones. One-shot consumption with a TTL and a
     * hard cap (see {@link markWechatMessage}).
     */
    private readonly wechatMessageIds;
    /** True after plugin dispose; pending waterfall waiters must not settle to WeChat. */
    private interactionStopped;
    /**
     * DSH native command registry (ctx.commands) when present in the host.
     * Set late by `attachCommands` once the cordis commands child has
     * resolved (host's own injection pattern). When `null` the bridge
     * silently skips the native command layer and the local whitelist
     * keeps full ownership — every `/xxx` either hits a hard-coded branch
     * or is forwarded as text to the agent.
     */
    private commandsCtx;
    /**
     * Per-user typing_ticket cache: the iLink `sendtyping` ticket is short-lived
     * and tied to the user's current context. We re-fetch via getconfig only on
     * miss / TTL expiry; otherwise the same ticket is reused across multiple
     * status changes of the same turn.
     */
    private readonly typingTickets;
    /**
     * Per-user active typing indicator. Tracks which user/session is currently
     * shown as "正在输入", so we can (a) suppress duplicate TYPING sends on
     * re-entry, (b) periodically refresh the indicator (TYPING is fire-and-
     * forget and the WeChat client auto-hides after a few seconds), and
     * (c) cancel cleanly on turn end / agent error / plugin stop. The
     * `safetyTimer` is the TTL fallback — it is refreshed by every keepalive
     * tick and only fires if the keepalive loop itself stops running.
     */
    private readonly typingActive;
    constructor(ctx: BridgeContext, config: WeChatDSHConfig, commandsCtx?: NativeCommandsSurface | null, configStore?: ConfigStore);
    /**
     * Pre-global-silent installs stored the toggle only on the WeChat user.
     * Copy it into config.json once so the settings page and a later re-scan
     * still see the same value.
     */
    private migrateSilentFromUsers;
    /**
     * S3 — seed the inbound allowlist from the peer this install already
     * belongs to.
     *
     * `allowedUsers` is empty by default, which means "the first inbound user
     * becomes the peer". That is right for a fresh install and WRONG for an
     * install that already has a bound peer: after the upgrade, the first
     * stranger to message the bot would take it over. So when the list has
     * never been configured (`config.json` carries no `allowedUsers` key) and
     * `state.json` already names a peer, the peer is written into the list.
     *
     * Deliberately gated on "never configured": an explicitly stored `[]` is a
     * decision (open to everyone) and is never overwritten. A brand-new install
     * has no peer at all, so it keeps first-contact-wins and can never lock its
     * owner out.
     */
    private seedAllowlistFromPeer;
    /** The peer an existing install already belongs to, or undefined on a fresh one. */
    private boundPeerFromState;
    /**
     * Deliver the S3 seeding notice exactly once, to the peer it concerns.
     *
     * Called from the inbound path (and after login), so it needs no timer: the
     * pending flag is cleared only when the message actually left the process,
     * which keeps the "one-shot mark is a commit" rule — a logged-out bot does
     * not burn the notice on a drop.
     */
    private notifyAllowlistSeed;
    /** Bind or create the WeChat user, inheriting the global silent default. */
    private ensureBoundUser;
    /** Hydrate the one peer's persisted budget and queue without auto-flushing. */
    private restoreOutboundState;
    /** Persist the one peer's budget/queue; empty state needs no snapshot. */
    private persistOutboundState;
    /**
     * Serialize remote sends with budget and durable queue mutations.
     *
     * Two safety properties, both added after the re-entrancy deadlock that
     * shipped once (a locked body calling a public entry queued itself behind
     * the operation it was awaiting, wedging the WHOLE outbound chain forever):
     *
     *  1. **Re-entrancy assertion.** Entering the slot from inside the async
     *     chain that currently holds it is a programming error, not a queueing
     *     decision. It is detected exactly (via `AsyncLocalStorage`, so a
     *     legitimate concurrent caller that merely arrives while the slot is
     *     held is NOT flagged) and fails LOUDLY and immediately instead of
     *     deadlocking. The fix is always the same: call the `*Locked` variant.
     *  2. **Bounded wait.** A single hung operation must not wedge every later
     *     send: a waiter gives its predecessor {@link OUTBOUND_SLOT_WAIT_MS}
     *     and then proceeds without it, with a loud log. This trades strict
     *     FIFO order — only in the pathological case — for liveness.
     *
     * Happy path is deliberately cheap: when nothing is pending (`outboundPending
     * === 0`) there is no timer, no race and no extra promise hop.
     */
    private serializeOutbound;
    /** Keep the FIFO tail and the pending counter honest for one enqueued operation. */
    private trackOutbound;
    /**
     * Wait for the operation currently holding the slot, but never forever.
     * `previous` never rejects (`trackOutbound` maps both outcomes), so the
     * race cannot surface a spurious error into the next operation.
     */
    private waitForOutboundSlot;
    /**
     * Late-bind the native command registry (`ctx.commands`).
     *
     * Called from `src/index.ts` after the host's commands child has
     * resolved via `ctx.inject(['commands'], ...)`. Idempotent: a second
     * call with the same surface is a no-op, a `null` is recorded as the
     * "unavailable" state.
     */
    attachCommands(commandsCtx: NativeCommandsSurface | null): void;
    /**
     * True when the line shape is a candidate for native command bypass
     * of a pending approval/question card. Used by `bypassCard` so a card
     * does not silently swallow a `/plan off` while waiting for the user.
     *
     * Two-gate:
     *   1. The host's `ctx.commands` registry is composed — without it
     *      the native dispatch layer is dormant and we must not bypass.
     *   2. The shape parses as a leading-slash lowercase command name
     *      (`parseCommandName`).
     *
     * `find(agent, name)` is NOT called here: at the bypass-card decision
     * point the bound agent may not be ensured yet (cost reasons) and
     * "shape-not-registered" is correctly re-detected inside
     * `tryNativeCommand` — a name that parses but is unregistered simply
     * falls through. The cost is that dsh-wechat-owned commands whose
     * shape parses as a slash name (today: `/rp`, `/rq`, `/stop`) would
     * bypass the card if matched here; those names are explicitly excluded
     * below so the card handler keeps full ownership of their semantics.
     */
    private isBypassableNativeCommand;
    /**
     * Probe the host's `ctx.commands` registry for the leading-slash name
     * in `text`; if registered, run the native handler and render its
     * settled result as a single WeChat reply. Returns `true` iff the
     * reply was sent (the caller should stop processing); returns `false`
     * for every "not ours" case so the local whitelist / forwarding
     * pipeline continues unchanged.
     *
     * Failure isolation: a thrown native handler is caught and rendered as
     * a friendly "command execution exception" reply; the message is never
     * silently forwarded to the agent (a malformed command must not look
     * like a real user prompt).
     *
     * The agent is ensured lazily on first hit so cold sessions without a
     * cached DSH session still resolve cleanly. We do NOT call
     * `agents.ensure` for unmatched names — the call would be wasted work
     * on the (very common) "user typed `/foo bar`" path.
     */
    private tryNativeCommand;
    /**
     * Resolve the host's native command descriptors for `/help` discovery.
     *
     * Returns the name-sorted `ctx.commands.list(agent)` snapshot when
     * the registry is composed AND an agent is bound; returns an empty
     * array otherwise. The host registry may legitimately list commands
     * that are not yet defined for the bound agent — `formatHelp` then
     * falls back to those entries; the bridge never re-filters by the
     * local whitelist (de-duplication is `formatHelp`'s job). A failed
     * `list` is logged once and treated as "no native commands" so
     * `/help` still works for users with a degraded registry.
     */
    private listNativeCommandsForHelp;
    getLoginState(): LoginState;
    /** Current effective config (for the settings page). */
    getConfig(): WeChatDSHConfig;
    /** Full status snapshot for the settings page / QR page. */
    getStatus(): Record<string, unknown>;
    /**
     * Message-source marker for one session, consulted by the global
     * `dsh-wechat-surface` prompt section at assembly time. "wechat" means
     * the most recent user message came from WeChat (the WeChat prompt is
     * shown); "gui" (or undefined) means it did not (the prompt is hidden).
     * Stale markers are dropped lazily.
     */
    surfaceSourceFor(sessionId: string): "wechat" | "gui" | undefined;
    /** Remember one WeChat-injected message id for echo matching. */
    private markWechatMessage;
    /**
     * Insert into a memo map with a deterministic hard cap: re-inserting moves
     * the key to the tail (so the eviction order is "least recently WRITTEN"),
     * and overflowing drops the head — the oldest entry — with a loud log, the
     * same rule `parkOutbound`'s hard ceiling follows. Every caller of this
     * helper is a cache, never a queue: the evicted value is recomputable or
     * merely cosmetic, which is why the cap may be small.
     */
    private boundedSet;
    /** Record that the last user message in `sessionId` came from WeChat. */
    private markSessionSource;
    /**
     * Resolve a usable typing_ticket for the given user, caching the result
     * for `TYPING_TICKET_TTL_MS`. Returns undefined when the bot is not
     * logged in or the iLink call fails (caller treats this as "skip").
     */
    /** Bot can talk to WeChat: logged in and the gateway has not rejected the session. */
    private botReady;
    private markTokenInvalid;
    private markTokenRecovered;
    private markTokenGiveUp;
    private dropOutboundReason;
    private logDropOutbound;
    private getTypingTicket;
    /**
     * Best-effort iLink sendtyping call. Swallows all errors so a transient
     * iLink failure never breaks the surrounding message flow.
     */
    private sendTypingStatus;
    /**
     * Show the typing indicator for `userId` on the bound session. Idempotent:
     * a second call while the indicator is already active is a no-op. Starts
     * a periodic refresh (`TYPING_KEEPALIVE_MS`) so the WeChat client does
     * not auto-hide the indicator during long turns, and a safety timer
     * (`TYPING_SAFETY_TIMEOUT_MS`) refreshed on every keepalive tick so a
     * stuck keepalive loop doesn't leave a phantom "正在输入" forever. The
     * indicator is removed by `endTyping` on turn end, agent error, plugin
     * stop, or (as a safety net) when the keepalive loop itself stops.
     */
    private beginTyping;
    /**
     * Clear the typing indicator for `userId`. Idempotent: no-op when nothing
     * is active. `reason` names the call site (safety-timeout / plugin-stop /
     * turn-end, …) and is not logged.
     */
    private endTyping;
    /** Start the bridge: resume with a stored token or begin QR login. */
    start(): Promise<void>;
    /** First persisted user is the single peer (legacy multi-user files keep only the first). */
    private lockPeerFromState;
    /**
     * Plugin dispose: stop the iLink monitor AND abandon pending WeChat
     * waterfall waiters. WeChat reconnect/logout must NOT use this — they
     * only bounce the gateway long-poll (`stopIlink`). Host answerers stay
     * registered for the plugin lifetime and survive QR re-login.
     */
    stop(): Promise<void>;
    /** Stop the WeChat long-poll and typing indicators; leave Host answerers running. */
    private stopIlink;
    /**
     * Restart the iLink long-poll with the current token (or begin QR login
     * when no token exists). Used after gateway config changes, not as a
     * user-facing "reconnect" action — that duplicated 重新扫码.
     */
    reconnect(): Promise<{
        ok: boolean;
        message: string;
    }>;
    /**
     * Force re-login: drop the stored token and start a fresh QR flow.
     */
    relogin(): Promise<{
        ok: boolean;
        message: string;
    }>;
    /** Log out: stop the monitor and remove the stored token. */
    logout(): Promise<{
        ok: boolean;
        message: string;
    }>;
    /**
     * A new QR login is a new bot session. Forget the previous WeChat peer
     * (memory + `state.json`) and the old long-poll cursor, otherwise the
     * first inbound from a different account is dropped as
     * `ignore inbound … (single-user peer is <old>)`.
     */
    private resetPeerBinding;
    /**
     * Drop every not-yet-sent WeChat payload. Logout / re-login must not
     * keep GUI replies from the logged-out window and then flush them on
     * the next inbound ping.
     */
    private discardQueuedOutbound;
    private deleteToken;
    private startLoginFlow;
    /** Re-arm a failed QR flow after a short pause; no-op while one is running. */
    private scheduleLoginRetry;
    private clearLoginRetry;
    private startMonitor;
    /**
     * Apply a config patch. Returns the updated editable values. When the
     * gateway connection fields change while logged in, the monitor is
     * restarted automatically.
     */
    updateConfig(patch: Partial<EditableConfig>): Promise<{
        config: Record<string, unknown>;
        message: string;
    }>;
    /**
     * Update per-user settings from the WebUI (silent / crossSessionNotify).
     * Returns the updated user snapshot or null when user not found.
     */
    updateUserConfig(userId: string, patch: {
        silent?: boolean;
        crossSessionNotify?: "inherit" | "on" | "off";
    }): {
        ok: boolean;
        message: string;
        user?: UserState;
    };
    /** Resolve the bound WeChat user for a DSH agent id. */
    userForAgent(agentId: string): UserState | undefined;
    private inboundKey;
    private handleMessage;
    private processMessage;
    private persistSessionBinding;
    private forwardToAgent;
    /**
     * Convert ONE inbound WeChat message into prompt blocks (text + media).
     *
     * Split out of {@link forwardToAgent} so a merged batch can build its blocks
     * from SEVERAL messages and then hand them to the same delivery path — the
     * agent ensure, the `/at` mention, the source marker and the busy-enter
     * choice must exist exactly once.
     */
    private promptBlocksFor;
    /**
     * Deliver already-assembled blocks to the bound session's agent.
     *
     * `agent` may be passed when the caller already ensured it (the merge
     * dispatcher does, to keep its ordering barrier honest about what it is
     * waiting on).
     */
    private forwardBlocksToAgent;
    private mergeEnabled;
    private mergeSilenceMs;
    private mergeMaxMsgs;
    private mergeForcedReleaseMs;
    /** 图片/文件合并 total switch (default off = media is never delayed). */
    private mediaMergeEnabled;
    /**
     * Attachment spelling: plain-path wording (default) or an `@文件` reference.
     *
     * Wording ONLY — `adapter/inbound.ts` is a pointer in both cases and never
     * inlines the file's content, whatever this returns. Off by default because
     * the chip only renders when the host has `dsh-file-reference` mounted.
     */
    private mediaAtRefEnabled;
    /**
     * How long a held attachment waits for its sentence (default 3 min).
     *
     * Bounded by {@link mergeForcedReleaseMs} on purpose: the merge window's own
     * liveness ceiling must also cap this wait, so a configured 10-minute media
     * window can never outlive the batch's guaranteed dispatch. The two defaults
     * are equal, so out of the box the attachment wait IS the longest a turn may
     * be held.
     */
    private mediaHoldMs;
    /** Buffered entries that are attachments (for `/status` and `/media`). */
    private bufferedMediaCount;
    /**
     * Entry point for every inbound item: decide merge vs. immediate turn.
     *
     * The decision is driven by WHAT the message carries, because the two
     * features that buffer have different shapes:
     *
     *   - plain text → 打字合并 window (`mergeEnabled`);
     *   - caption-less image/file/video → attachment hold (`mediaMergeEnabled`);
     *   - text + its own media (one message) → never held: it already says what
     *     it wants, so waiting for another sentence would only add latency;
     *   - voice / anything else → never held.
     */
    private enqueueInbound;
    /**
     * Arm the timers every open batch needs regardless of which feature opened
     * it: the forced release (always) and the attachment wait (only while a
     * media entry is buffered).
     */
    private armBatchCeilings;
    private mergeStateFor;
    /** Arm one batch timer; every timer is cleared on every flush path. */
    private armMergeTimer;
    /**
     * Deliver the chat's buffered items as ONE prompt.
     *
     * Assembly order is TEXT FIRST, then attachments: the host's title generator
     * joins every text block of the first eligible user message, and a media
     * block leading would title the session
     * `[收到图片] 文件已保存到: C:/…` — the same reason `/at` mentions are
     * appended rather than prepended.
     *
     * Attachments are downloaded HERE, not when they were buffered: a batch that
     * is dropped (identity change) must not have spent network or disk on files
     * nobody will receive, and the user's own media is fetched once, at the
     * moment its sentence is known.
     *
     * Ordering: a batch that arrives while the previous one is still being
     * dispatched waits for it — but only up to `mergeForcedReleaseMs`, after
     * which it logs and dispatches anyway. Waiting is about preserving the
     * user's message order; it is never allowed to become a stuck channel.
     */
    private flushMergedText;
    /** Deliver every open batch (plugin dispose — the user's own words are not destroyed). */
    private flushAllMergedText;
    /** Drop a chat's buffer and timers (identity change: logout / re-login / re-bind). */
    private dropMergedText;
    /** Human-readable merge state for `/merge status` and `/status` (never write-only state). */
    private mergeStatusText;
    /** 图片/文件合并 state, for `/media` and `/status` (never write-only state). */
    private mediaMergeStatusText;
    /** Buffered (not yet dispatched) inbound message count across chats. */
    private pendingMergedCount;
    /**
     * Handle one session event for a WeChat-bound session.
     * Assistant prose stays separate; reasoning and tool events accumulate in
     * one process group until prose, a decision card, or turn/end.
     * Silent mode buffers only the last assistant prose.
     * (Approval/question cards are frame-driven via handleMuxFrame, not
     * session events — this listener only carries agent output.)
     *
     * NOTE: SessionEvent is the wrapped `{ type, seq, time, data }` shape —
     * the message lives in `event.data.message`, NOT at the top level.
     */
    handleSessionEvent(sessionId: string, event: {
        type: string;
        [k: string]: unknown;
    }): void;
    /** Whether 结论模式 (per-task hold) is on. Supersedes `silent`. */
    private finalOnlyEnabled;
    private finalOnlyIdleMs;
    private finalOnlyCeilingMs;
    private ensurePendingFinal;
    /** (Re)arm the quiescence timer: every activity event pushes delivery back. */
    private armFinalSettle;
    /** A turn started (or a new round was queued): stop the countdown. */
    private cancelFinalSettle;
    /**
     * Hold one assistant text. Returns true when the caller must NOT deliver it
     * now (the hold owns delivery from here on).
     */
    private holdFinalText;
    /**
     * Fold a cross-session completion notice into the hold. A real assistant
     * body always wins over the 80-char preview, so a bound session keeps its
     * full conclusion while an unbound one still collapses to one message.
     */
    private holdFinalNotice;
    /** Count a finished turn into the hold's round tally (for the digest header). */
    private foldFinalRound;
    /** True when this session currently has something held back. */
    hasPendingFinal(sessionId: string): boolean;
    /**
     * Deliver the held conclusion for one session, if any. Delivery goes
     * through `sendReply`, so chunking, the outbound budget and the offline
     * park/queue behaviour are exactly the same as a normal reply.
     */
    private flushPendingFinal;
    /** Deliver everything currently held (the `/flush` escape hatch). */
    private flushAllPendingFinal;
    /** Throw the held conclusions away without delivering (stop / re-bind). */
    private discardPendingFinal;
    /**
     * Drop one session's hold without delivering it. Used on error: the error
     * notice IS the outcome, so a stale "conclusion" must not follow it.
     */
    private dropPendingFinal;
    /**
     * `agent/status` mirror: a running agent means a round is in flight, so the
     * countdown stops; going idle arms it. `agent.id` IS the session id in DSH
     * (`Agent.id: SessionId`), so no extra mapping is needed.
     */
    handleAgentStatus(sessionId: string, status: string): void;
    /** Flush accumulated process on the FIRST prose chunk, before the response commits. */
    handleAssistantStream(sessionId: string, frame: AssistantStreamFrame): void;
    private processFor;
    private flushProcess;
    private pushOutput;
    /** Drop unfinished process / silent prose when its conversation leaves the live feed. */
    clearSessionOutput(sessionId: string): void;
    /** Notify the bound user of an agent error. */
    handleAgentError(agentId: string, error: unknown): void;
    /**
     * Plugin dispose only — abandon pending WeChat waiters so `next()` (GUI)
     * can still settle. WeChat reconnect/logout must NOT call this.
     */
    stopInteraction(): void;
    private sessionIdOfRequest;
    /**
     * DSH 0.1.2 Web cards dismiss only when the waterfall `request.signal`
     * aborts (Gateway then pushes a `cancel` frame). The tool's own
     * `exec.signal` must stay live so the turn can continue after a WeChat
     * answer — so we replace `req.signal` with a fork for `next()` (GUI)
     * and abort only that fork when this answerer returns. The original
     * turn abort is forwarded onto the fork so a GUI Stop still withdraws
     * the Web card.
     */
    private forkGuiCardSignal;
    private abortGuiCard;
    /**
     * Host `approval/request` waterfall answerer. Races the GUI (`next()`)
     * against a WeChat reply so whoever answers first wins. No WeChat peer
     * → immediately `next()`. Soft timeout withdraws the WeChat waiter
     * without deciding, leaving the GUI card live.
     */
    answerApprovalRequest(req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>;
    /**
     * Host `user-questions/request` waterfall answerer. Same race as
     * approvals: WeChat vs GUI, first settle wins. Soft timeout withdraws
     * the WeChat waiter without answering.
     */
    answerQuestionRequest(req: QuestionRequestLike, next: () => Promise<AskUserQuestionAnswer>): Promise<AskUserQuestionAnswer>;
    /**
     * Test / replay helper: register a card without holding a live waterfall.
     * Production cards come from {@link answerApprovalRequest} /
     * {@link answerQuestionRequest}. Kept so existing unit tests can seed
     * pending tables without spinning a Host waterfall.
     */
    handleMuxFrame(frame: {
        type: "server-request";
        rpcId: string;
        method: string;
        payload: {
            type: string;
            [k: string]: unknown;
        };
    }): void;
    /**
     * Session provenance label for a card: which workspace and which session
     * the request belongs to (`📂 <工作区> · 💬 <会话标题>`), so a card for a
     * non-current session is identifiable without switching.
     */
    private sessionContextLabel;
    /**
     * Block-quoted preview of a session's last assistant text for a
     * cross-session notice, or "" when there is nothing to quote.
     *
     * Two deliberate properties:
     *   - the TAIL, not the head — an assistant message opens with preamble
     *     and closes with the conclusion, and the notice exists to convey
     *     the conclusion;
     *   - `maskSecrets` — assistant prose can echo a token or hash it was
     *     shown. Only this excerpt is masked; a normal reply body never is
     *     (the mask's hex/base64 rules would eat its commit SHAs).
     * Measured in code points, so a tail of emoji is not half a surrogate.
     */
    private previewSuffix;
    /**
     * Send one mirrored approval card with its session provenance header.
     * The P{n} number is the card's index across answerable approvals
     * (current session, plus other sessions while the decision gate is on).
     */
    private sendApprovalCard;
    /**
     * Send one mirrored question card with its session provenance header.
     * The P{n} number is the card's index across answerable questions;
     * multi-card replies use `P{n}=` to pick the card.
     */
    private sendQuestionCard;
    /**
     * Whether cross-session notifications are enabled (single-user: global only).
     */
    private shouldNotifyCrossSession;
    private resolveCrossSessionRecipients;
    private notifyCrossSessionTurnEnd;
    private notifyCrossSessionError;
    private clearCrossSessionTurnNotified;
    private trackWatchedSession;
    /**
     * After the user switches into `sessionId`, flush any pending cards for
     * it that were NOT already pushed in full on arrival (a card pushed for
     * a non-current session must not repeat on switch; /history re-shows
     * everything on demand).
     */
    private flushPendingCardsForSession;
    /** Push every still-pending card that has not yet been shown on WeChat. */
    private flushUnseenCardsForUser;
    /**
     * Resolve the WeChat user for a calling DSH agent id. Prefers the user
     * bound to this agent (session) id; otherwise falls back to the first
     * known user (single-user deployments are the norm). Returns undefined
     * only when no user has ever interacted with the bridge.
     */
    private resolveUserForAgent;
    /** The WeChat user a card for `sessionId` goes to: its bound user, else the first known user. */
    private recipientForSession;
    /** Pending cards that belong to the user's *current* bound session. */
    private pendingCardsForCurrentSession;
    /**
     * Cards the user may answer from WeChat right now.
     * Gate off → current session only (unseen background cards stay silent).
     * Gate on  → every pending card (they were / will be pushed in full).
     */
    private answerableApprovals;
    private answerableQuestions;
    /**
     * Global P{n} order: questions first, then approvals. One namespace so a
     * plan card labelled P1 is not intercepted as a permission reply.
     */
    private answerableCards;
    private pnOfCard;
    /**
     * Snapshot `rpcId → P{n}` for every answerable card, taken ONCE at the
     * start of an inbound reply.
     *
     * A receipt must name the number the card was PRINTED with, and `P{n}` is
     * a live position in the pending tables: settling a card removes it from
     * those tables before the receipt is composed (measured — a lookup taken
     * after the removal returns nothing, not a shifted number). Resolving
     * against a map frozen before the batch therefore both preserves the
     * printed number and keeps `P1=1 P2=2` from degrading to a numberless
     * receipt.
     */
    private cardIndices;
    /** Background task completion/error notice gate (decision cards only follow `crossSessionNotify`). */
    private notifyTaskEventsEnabled;
    /** Record that the card's full content was pushed to WeChat for this user. */
    private markCardPushed;
    /**
     * Push one card and claim its one-shot "already pushed" mark — in that
     * order, and only when the card can actually leave the process.
     *
     * Why the order matters (S5): `sendReply` DROPS its payload while the bot is
     * logged out or mid re-login (it does not park it), so marking first burns
     * the one-shot on a delivery that never happened, and `isCardPushed` then
     * blocks the re-push until the card times out — the user simply never sees
     * the card. Reachability is therefore confirmed BEFORE the mark is taken,
     * and the mark is rolled back if the send itself throws (the same
     * mark-then-rollback shape `notifyCachePendingLocked` uses). A "parked"
     * outcome is a success for this purpose: the card text is in the durable
     * FIFO and will be flushed.
     */
    private pushCardOnce;
    /** Whether the card's full content was already pushed to WeChat for this user. */
    private isCardPushed;
    /** Drop the pushed marker when the card leaves the pending table. */
    private unmarkCardPushed;
    private isCardCloseCommand;
    /** Route every `P{n}=` in the line onto the globally numbered card. */
    private handlePnReplies;
    private handleApprovalReply;
    private applyApprovalDecisions;
    private respondApproval;
    private removeApprovalCard;
    private rejectOneApproval;
    private handleQuestionReply;
    private answerOneQuestion;
    private respondQuestion;
    /** `/rq` — close pending cards of the current session only. */
    private rejectCurrentSessionCards;
    /** `P{n}=/rq` — close that globally numbered card. */
    private rejectCardByPn;
    private rejectOneQuestion;
    /**
     * Plan-mode `exit_plan_mode` review: dismissing the card is "Keep planning",
     * not an aborted ask. Detect via host intent, else the well-known review id.
     */
    private planKeepPlanningAnswer;
    private removeQuestionCard;
    private handleNotifyCommand;
    /**
     * Write one editable field both in memory and, when a ConfigStore is
     * attached, to `config.json`. Tests that construct the bridge without a
     * store still see the in-memory change for the rest of the process.
     */
    private persistEditable;
    private handleSurfaceCommand;
    private handleSilentCommand;
    /** Global silent switch, mirrored onto the current peer so runtime reads stay consistent. */
    private setSilent;
    private isSilent;
    /**
     * `/final` — view or switch 结论模式. Mirrors `/silent`: the value is
     * persisted to `config.json` (so a re-scan keeps it) and the settings
     * page shows the same switch.
     *
     * Turning the mode OFF flushes whatever is held. A hold is a conclusion
     * the agent has already produced — the user just asked us to stop
     * holding things back, so handing it over now is the only reading that
     * does not silently destroy output. (Dispose does the same; only
     * logout / re-bind discard.)
     */
    private handleFinalCommand;
    /**
     * `/merge` — view or switch the inbound merge window. Mirrors `/silent`:
     * persisted to `config.json` (survives a re-scan), shown in the settings
     * page, bypasses a pending card, appears in `/help` and in
     * `LOCAL_COMMAND_NAMES` so a native command of the same name never shadows
     * it.
     *
     * Turning it OFF flushes the buffer first: those are the user's own words
     * and dropping them because they flipped a switch would silently swallow a
     * message (the same rule `/final off` follows).
     */
    private handleMergeCommand;
    /**
     * `/media` — hold a caption-less image/file/video until the sentence that
     * explains it, and choose how an attachment is handed to the model.
     *
     * Wired exactly like `/merge`: persisted to `config.json`, mirrored in the
     * settings page, bypasses a pending card, listed in `/help` and
     * `LOCAL_COMMAND_NAMES`. Turning the hold OFF flushes what it was holding
     * first — "stop waiting for me" is not "throw the picture away".
     */
    private handleMediaCommand;
    /**
     * `/enter` — view or switch the busy-time delivery behavior. Reads and
     * writes the DSH settings document (`ui-conversation.busyEnter`), the same
     * field the GUI General Settings 「繁忙时 Enter 键行为」 row edits, so both
     * ends always share one value. The behavior applies at delivery time: while
     * the agent is running, `queue` waits for a follow-up turn and `steer`
     * splices into the running turn.
     */
    private handleEnterCommand;
    private handleStopCommand;
    private handleWorkspaceCommand;
    /**
     * Rebind the user to the workspace's most recent visible session.
     * Returns the restored session id, or "" when the workspace has none
     * (the next user message will create one — this method does not mint).
     */
    private switchUserWorkspace;
    /** Two-line workspace switch/add reply: workspace row + restored session. */
    private formatWorkspaceSwitchReply;
    /**
     * WeChat-facing session label: cleaned title (id prefix fallback) + full id.
     */
    private formatSessionLabel;
    /**
     * Resolve the same recency-ordered session set for both `/s list` and
     * `/s switch`. `scope` is explicit on the command so `list current` cannot
     * accidentally be paired with the unfiltered switch list.
     *
     * Pinned sessions come first, then everything else. Each group keeps the
     * recency order, so the pin set is a *partition* marker only — the host's
     * own "most recently pinned first" array order deliberately does not drive
     * the row order, matching the GUI's 「最近更新」 view where the pin time does
     * not affect the sort. This keeps `/s list` numbers stable for unpinned
     * users (no pins = byte-identical order to before).
     */
    private listRecentSessions;
    /**
     * Resolve every distinct path through {@link canonicalPath} once.
     *
     * Callers that compare several directories at the same time (a workspace
     * roster against a session cwd against each user's cwd) share one Map
     * instead of re-resolving the same spelling per comparison.
     */
    private canonicalizePaths;
    /**
     * Sessions whose recorded cwd is the user's current directory, compared
     * through the host's canonical-path rule (see {@link canonicalPath}).
     *
     * A plain `header.cwd === user.cwd` string compare misses the same
     * directory spelled with a trailing separator, a `.` segment, or a
     * different letter case — the host's `workspaceRegistry` resolves all of
     * those to one workspace, so the WeChat side must agree with it.
     *
     * Sessions with no recorded cwd stay excluded, as before.
     */
    private filterByCurrentCwd;
    /**
     * Resolve a shorthand switch against the exact rows from the last list.
     * Return `undefined` when the snapshot is unavailable or no longer valid;
     * the caller then falls back to a fresh all-session list.
     */
    private sessionsFromLastList;
    private handleSessionCommand;
    /**
     * Handle `/s pin [编号]` and `/s unpin [编号]`.
     *
     * The pin set lives in the host registry (`workspaceRegistry.pinnedSessionIds`),
     * so the GUI sidebar and WeChat read and write one durable set. Without a row
     * number the command acts on the user's currently bound session — the common
     * case, needing no list first. With one, the number resolves through the exact
     * rows of the latest `/s list` (same helper `/s switch` uses), so a number the
     * user just read always addresses the row they saw.
     *
     * Pre-checks keep the happy path off the host's exception channel: an
     * already-pinned id is a no-op (the host would also no-op), and an archived
     * session cannot be pinned at all (the host would reject). Both are reported
     * with the state the user asked about, not as a failure.
     */
    private handlePinCommand;
    /** User-facing text for a non-`ok` pin outcome. */
    private pinFailureText;
    /**
     * Re-store the full recency-ordered session list for the user after a pin
     * change, so the numbered snapshot stays aligned with the reordered rows.
     */
    private refreshSessionListSnapshot;
    /**
     * Unbind the current session and mint a fresh one via `agents.ensure`.
     * Used by `/s new` when no reusable blank exists, and when the bound
     * session's log is corrupt.
     */
    private createFreshSession;
    /**
     * Find the newest blank (never-spoken-to) session in `cwd`, mirroring the
     * GUI's "reuse-or-create its blank session" behavior. A blank session is
     * one with no `user/message` event in its log — created by a previous
     * "new session" that the user never used. Archived sessions are already
     * filtered by `listSessions()`. Unreadable / corrupt logs are skipped
     * (they are not blank). `excludeId` skips the caller's current session
     * (the caller handles "already blank" separately).
     */
    private findBlankSession;
    private handlePresetCommand;
    /**
     * `/reasoning` — view or switch the reasoning effort. The effort rides the
     * same model selection as the GUI's model picker. Switching goes through
     * `sessionController.selectModel` (the exact Remote the GUI submits) so the
     * durable `model/selection` and the GUI projection update together; on
     * hosts without that service it falls back to `agentDefaultModel` +
     * the legacy request override.
     */
    private handleReasoningCommand;
    /**
     * `/at` — stage a session or file reference for the NEXT message.
     *
     * WeChat has no composer, so the GUI's `@` completion is replaced by an
     * explicit staging step: `/at` records the reference, replies with what is
     * staged, and `forwardToAgent` prepends the mentions to the next delivered
     * message. Every rejection below happens BEFORE anything is sent, because
     * the host's `agent/pre-step` treats a bad mention as fatal for the turn:
     *
     *   - a self-reference throws `SESSION_REFERENCE_SELF_REFERENCE`;
     *   - a fourth session throws `SESSION_REFERENCE_TOO_MANY`;
     *   - an unreadable target throws `SESSION_REFERENCE_READ_FAILED`.
     *
     * Failing at `/at` time costs one reply; failing at send time costs the
     * user's whole prompt.
     */
    private handleAtCommand;
    /** `/at s …` — resolve, validate, and stage one session reference. */
    private stageSessionRef;
    /**
     * Resolve `/at s <target>` to one session id plus its display label.
     *
     * A NUMBER resolves through the SAME rows `/s switch` uses (the latest
     * `/s list` snapshot first), so a number the user just read always addresses
     * the row they saw.
     *
     * A KEYWORD goes through the host's own `listCandidates` when a live agent
     * exists: it ranks by working-directory affinity and reads titles from
     * projections only, so one `/at s 报告` costs no log folds. The local
     * fallback (filter `/s list` rows by title/cwd/id) covers the case where no
     * agent is live yet, and is deliberately the SAME field set the host
     * filters on, so the two paths agree.
     *
     * Ambiguity is reported as a list, never guessed: with the host path the
     * rows are not `/s list` numbers, so the hint points at the label instead of
     * a number that would address a different session.
     */
    private resolveAtSessionTarget;
    /**
     * Keyword discovery through `ctx.sessionReferenceResolver`, or `undefined`
     * when the host cannot answer (no service, no live agent, or the call threw)
     * so the caller falls back to the local row scan.
     */
    private hostAtCandidates;
    /** `/s list` rows whose title, cwd, or id contains `target` (case-insensitive). */
    private matchAtSessionRows;
    /** Numbered ambiguity reply (one line per candidate, capped). */
    private describeAmbiguousAtSessions;
    /** `/at f …` — resolve, validate, and stage one file/directory reference. */
    private stageFileRef;
    /**
     * Why a path could not be resolved, with the nearest candidates when they
     * can be found.
     *
     * Two sources, in this order, because each covers what the other cannot:
     *
     *   1. the host's `ctx.fileReferences` provider, when a LIVE agent exists —
     *      it ranks over the whole indexed workspace, which is exactly the
     *      "fuzzy basename" query a mistyped path is;
     *   2. a local listing of the parent directory otherwise. `/at f` is often
     *      the very first thing a user sends, and no agent exists yet at that
     *      point (`agents.get` needs a bound session), so depending on the
     *      provider alone would answer the most common case with no help at all.
     *
     * Both are advisory: a miss ends with the resolution rule, never a silent
     * no-op.
     */
    private describeMissingAtPath;
    /** Up to five near-match spellings for a path that does not exist. */
    private suggestAtPathCandidates;
    /**
     * Parent-directory listing fallback: the entries of the directory the target
     * names (or the target's own parent), filtered by the last path segment.
     *
     * Advisory only, and deliberately bounded by a small cap. It lists whatever
     * directory the caller named — the same place `/at f` itself resolves — since
     * a suggestion for a mistyped absolute path is only useful if it can name the
     * directory the user actually meant.
     */
    private localAtPathCandidates;
    /**
     * The path spelling sent to the model: relative to the working directory
     * when the target lives under it (short, portable, and what the GUI inserts),
     * otherwise the absolute path (which `FILE_REFERENCE_PROMPT` explicitly
     * allows). Always `/`-separated so a mention never depends on the host OS.
     */
    private relativeRefPath;
    /**
     * Read a user's staged references, lazily dropping an expired or empty set.
     *
     * The returned object IS the map entry (callers mutate it in place for
     * `/at rm`); nothing outside this file holds a reference across an await.
     */
    private pendingRefsFor;
    /**
     * Stage one reference, enforcing both limits on the post-mutation state.
     *
     * Reads through {@link pendingRefsFor} rather than the raw map: an EXPIRED
     * set must be dropped, not revived. Pushing into the stale entry would
     * silently re-attach references the user staged twenty minutes ago to the
     * new one.
     */
    private stageRef;
    /** `/at rm <n>` — drop the reference at the same position `/at` printed. */
    private removePendingRef;
    /** Remove one entry by its printed position (sessions first, then files). */
    private removeRefAt;
    /** Drop every staged reference for one user; returns how many were dropped. */
    private clearPendingRefs;
    /** Drop one user's staged references (delivery consumed them). */
    private dropPendingRefs;
    /** Drop every user's staged references (identity change). */
    private dropAllPendingRefs;
    /** `/at` reply: the numbered staging table, or the usage text. */
    private formatStagedRefs;
    /** `/status` row for staged `/at` references (only rendered when non-empty). */
    private describeStagedRefs;
    /**
     * `/history [all] [N]` — show the most recent N conversation entries of
     * the current session (default 5, max 20). Default lists only human and
     * assistant turns; `all` also includes synthesized system injections
     * (compaction checkpoints, plugin context, goal rounds). Each entry is
     * Each entry is its own block (`角色 · 时间` then the original body),
     * oldest→newest, so it reads closer to a live WeChat message than a dump.
     */
    private handleHistoryCommand;
    /** After `/history`, re-send every still-answerable card in full. */
    private resendPendingCardsForHistory;
    private handleModelCommand;
    /**
     * `/perm` — permission management over the native permissionPresets
     * service (session-level switches) and the `permission` settings document
     * (the default for new sessions, shared with the GUI settings page).
     */
    private handlePermCommand;
    /**
     * `current()` with a guard. The host reads the Session's `permissions`
     * projection (`current(session: Session)`), so the live Session must be
     * passed; a session without that projection still degrades to `undefined`.
     */
    private safeCurrent;
    /** Resolve a preset target by name or list index. */
    private matchPermission;
    /** Human-readable preset description: name（sandbox + approval）plus detail. */
    private describePermission;
    /**
     * Whether a preset is an ESCALATION, read from the same knob bundle the
     * host applies (`permissionPresets.resolve(name)` → `{ sandbox, approval }`,
     * the schema of `@deepseek-ai/dsh-permission-presets`):
     *
     *   - `sandbox === "danger-full-access"` — no filesystem confinement, or
     *   - `approval === "never"` — no approval prompt will ever be shown,
     *     regardless of what the sandbox refuses.
     *
     * Both knobs are read on purpose: the host ships `danger-full-access` as
     * `{sandbox: danger-full-access, approval: never}` and `auto` as
     * `{sandbox: danger-full-access, approval: ask}`, so keying on the sandbox
     * alone would miss a config-declared preset that only drops approvals.
     *
     * A preset whose bundle cannot be resolved counts as escalating: an
     * unreadable knob bundle must not be written globally just because we could
     * not prove it is dangerous.
     */
    private isEscalatingPreset;
    /**
     * Apply the user's model override to a frozen request config. Called from
     * the `agent/request` waterfall listener (registered in index.ts) for
     * WeChat-bound agents. An override without a reasoning effort leaves the
     * caller's effort untouched (`/model switch` does not clear a set effort).
     *
     * The override itself is preserved by `handleModelCommand` when the user
     * issues `/model switch`: the new selection carries the existing effort
     * (from the override first, then the persisted default) IF the new
     * model supports the same effort id. So in practice this merge is the
     * last-line defense for the live request; the displayed selection (in
     * `/status` via `resolveEffectiveModel`) reads the effort straight off
     * the override.
     */
    applyModelOverride(config: {
        provider: string;
        model: string;
        reasoningEffort?: string;
    }, agentId: string): {
        provider: string;
        model: string;
        reasoningEffort?: string;
    };
    /**
     * Record one session's model override under a hard FIFO cap.
     *
     * The map is keyed by session id and nothing ever removed an entry, so a
     * long-lived install with many sessions kept every override alive for the
     * process lifetime. The cap bounds it; eviction is deterministic (oldest
     * written first) and only affects sessions that have not had `/model` or
     * `/reasoning` touched in the last {@link MODEL_OVERRIDE_MAX_SESSIONS}
     * writes — for those, the model falls back to the persisted default, which
     * `/model switch` writes in the same breath.
     */
    private setModelOverride;
    /**
     * Color marker for boolean toggles on /status. Each field has its own
     * semantic — `on` for 静默模式 means "we stop forwarding to WeChat"
     * (warning), `on` for 跨会话决策推送 means "extra delivery is enabled"
     * (good). The colored glyph is field-specific; this helper just
     * annotates an explicit `value` with `🟢` / `🔴`. iLink text items
     * have no `<font color>` support — emoji glyphs are the only
     * colored channel that survives the wire.
     */
    private paintBadge;
    private formatStatus;
    /**
     * `/status` inbound-allowlist row (S3). When the list is empty the row says
     * so explicitly — "first contact wins" is a security-relevant state and must
     * be visible; when it is set, the bound peer's OWN id is printed in full so
     * the owner never has to discover their id elsewhere to edit the list.
     */
    private describeAllowlist;
    /** `/status` rows for unanswered cards, split into current vs other sessions. */
    private formatPendingStatusLines;
    private formatPendingParts;
    /**
     * `/status` preset rows: deployment default (settings document) and
     * the bound session's live preset (event-aware). Shown as two lines
     * so a switched session is not mistaken for the global default.
     * The default row sits after permission; the session row stays with
     * the session/agent block.
     */
    private formatStatusPresetLines;
    /**
     * Preset id → metadata display name (`/preset list` 同款 `preset.name ?? preset.id`).
     * Used everywhere the bridge shows a preset (session list, /status, /preset status default),
     * so a session actually running `cordis` shows up as "创造模式" rather than the
     * raw id. Returns undefined when the id is missing; returns the id itself when
     * the roster has no matching entry or no `name` field — both edges preserve
     * `/preset list`'s fallback semantics so a deleted/broken preset never produces
     * an empty label.
     */
    private resolvePresetLabel;
    /**
     * Recency value for `/s list` ordering and display: the last recorded
     * user-prompt time, falling back to the session creation time for cold
     * sessions (no activity observed since this process started).
     */
    private sessionActivityTime;
    /** Compact relative time for the `/s list` column (like the GUI sidebar). */
    private formatRelativeTime;
    /**
     * The model the user's session actually runs on, in host-equivalent
     * precedence: a legacy in-memory override (only set when the deployment has
     * no `sessionController`) > the Session's durable `modelSelection`
     * projection (`next`, falling back to `lastUsed`) > the latest logged
     * request config > the agent's creation options > the deployment default.
     * The projection is the same value the GUI picker shows and
     * `sessionController.selectModel` installs, so a switch from either surface
     * is reflected by `/status`, `/model status`, and `/reasoning status`
     * immediately.
     *
     * `reasoningEffort` follows the same precedence chain, with one defensive
     * branch: when the override carries a model selection but no effort AND
     * the persisted default has an effort for the SAME model, borrow that
     * effort. This rescues users whose override was written by an older
     * `/model switch` that did not preserve the effort — they see the
     * preserved effort in `/status` immediately on upgrade instead of
     * needing to re-issue `/reasoning switch`. Only triggers when the
     * default's provider/model matches the override; otherwise the default's
     * effort belongs to a different model and must not be applied.
     */
    private resolveEffectiveModel;
    /** Effective outgoing-file size ceiling (bytes); malformed config falls back to the default. */
    private maxOutgoingFileBytes;
    /** Size of a file in bytes, or undefined when it cannot be stat'ed. */
    private outgoingFileSize;
    /**
     * Roots an outgoing file may live under: the working directory of the
     * session that is ACTUALLY sending, plus every registered workspace.
     *
     * The sender is resolved from the calling agent id — never from the
     * recipient fallback. Those are different questions: an unbound (GUI)
     * session still sends to the first known WeChat user, and the file bound
     * must be the CALLER's, otherwise any session could read any other
     * session's workspace by relying on the recipient fallback.
     */
    private outgoingFileRoots;
    /**
     * Validate one `send_wechat` file: it must exist, be a regular file, fit in
     * {@link maxOutgoingFileBytes}, and — unless `allowAnyFilePath` is set —
     * resolve inside one of {@link outgoingFileRoots}.
     *
     * @returns `undefined` when the file may be sent, else the refusal message
     *   the tool returns verbatim.
     */
    private guardOutgoingFile;
    /**
     * Handle the `send_wechat` tool: push text or a local file to a
     * WeChat user. The recipient is the user bound to the calling agent
     * (session), or — when the agent has no binding — the first known
     * WeChat user (single-user deployments are the norm).
     *
     * Delivery goes through `deliverOutbound`, so tool pushes share the same
     * per-user gateway budget as assistant replies, and budget overflow /
     * transient send failures are queued (`/next` or the next inbound
     * message flushes them) instead of being lost. A queued push reports
     * `ok: true` with an explicit "queued" message: the bridge has taken
     * over delivery, and an error result would only tempt the model into
     * retrying (→ duplicate deliveries on flush). Only an unreadable
     * `file_path` returns `ok: false` immediately.
     *
     * S2: `file_path` is NOT an arbitrary-file-read primitive. The path is
     * validated against the sending session's workspace (and every registered
     * workspace) with a size ceiling before anything is read or queued; the
     * check happens against the CALLER, not against the recipient fallback, so
     * an unbound session cannot borrow another session's roots.
     */
    handleSendWeChat(agentId: string, args: {
        text?: string;
        file_path?: string;
    }): Promise<{
        ok: boolean;
        message: string;
    }>;
    /** Deliver one item, serialized with all other outbound sends and flushes. */
    private deliverOutbound;
    /**
     * One outbound attempt, audited. Split from the body so EVERY caller —
     * `deliverOutbound`, `sendReply`'s batch and `flushPendingLocked` — records
     * exactly one line per attempt without sprinkling audit calls over a dozen
     * early returns. Body contents are never recorded: kind, size and outcome
     * only.
     */
    private deliverOutboundLocked;
    private deliverOutboundLockedBody;
    /**
     * Append to the one durable FIFO. At the soft cap the oldest item is
     * FORCE-SENT instead of dropped; at the hard ceiling it is dropped with a
     * loud log, because that ceiling is what actually bounds memory.
     *
     * The cap exists to bound memory, but the queue's contents are exactly
     * what must not vanish: notifications, task conclusions, tool pushes. So
     * reaching the cap means "try harder", not "discard": one item leaves the
     * queue by being delivered. The only way it is still lost is if that send
     * itself fails, and `deliverOutboundLocked` then appends it again (there
     * is room, one slot was just freed) so nothing is destroyed silently.
     *
     * A force-send that keeps failing, however, frees nothing: the queue would
     * otherwise grow for the whole outage, taking `state.json` with it. The
     * hard ceiling is where the oldest item is sacrificed instead, so the
     * "never silently drop" promise degrades to "never *silently* drop" rather
     * than to an unbounded process.
     */
    private parkOutbound;
    /** Best-effort notice for transient failures while budget remains. */
    private notifyCachePendingLocked;
    private sendReply;
    /** After -14 recovery, silently flush the one peer's parked outbound. */
    private flushParkedAfterRecover;
    /** Flush the one FIFO (/next, next inbound, or -14 recovery). */
    private flushPending;
    private flushPendingLocked;
    private log;
    private previewMessage;
}
//# sourceMappingURL=bridge.d.ts.map