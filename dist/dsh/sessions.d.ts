/**
 * DSH session mapper: binds a WeChat user to a live DSH agent.
 *
 * Creates fresh agents through `ctx.agents.create` (minting a durable
 * session id) or resumes persisted ones through `ctx.agents.resume` after
 * a DSH restart. All service access goes through `ctx.get(...)` with
 * undefined checks — this plugin has zero runtime coupling to
 * `@deepseek-ai/*` packages.
 */
import type { BusyEnterBehavior } from "./ops.js";
import type { Agent, AgentHandle, ContentBlock, CreateAgentOptions, ResumeAgentOptions } from "./types.js";
import type { UserState } from "../state.js";
/** Minimal structural surface of the `agents` registry service. */
export interface AgentsService {
    create(options: CreateAgentOptions): Promise<AgentHandle>;
    resume(options: ResumeAgentOptions): Promise<AgentHandle>;
    get(id: string): Agent | undefined;
    list(): Agent[];
}
/** Minimal structural surface of `ctx` (Cordis). */
export interface BridgeContext {
    get<T = unknown>(name: string): T | undefined;
    on(event: string, listener: (...args: unknown[]) => unknown): () => void;
}
/** Result of {@link AgentStore.ensure}. */
export interface EnsureAgentResult {
    readonly agent: Agent | undefined;
    /**
     * Previous bound session id that failed to resume, when a replacement
     * session was minted (`replaceOnResumeFailure: true`). Absent when the
     * bound session loaded, or when replacement was not requested.
     */
    readonly replacedSessionId?: string;
}
/** Options for {@link AgentStore.ensure}. */
export interface EnsureAgentOptions {
    /**
     * When the bound session fails to resume (corrupt log, missing file,
     * persistence validation), clear the binding and create a fresh session
     * instead of leaving the user stuck. Used by the inbound message path.
     * Management commands that name a specific session (`/s switch`) leave
     * this off so a failed load does not silently mint a different id.
     */
    readonly replaceOnResumeFailure?: boolean;
}
/**
 * Mint a durable session id for a WeChat-bound session — the SAME format the
 * GUI uses (`session-<uuid>`, the same mint the session controller uses). Uniform
 * ids keep WeChat-created sessions indistinguishable from GUI-created ones
 * everywhere (lists, workspace accounting, log exports).
 */
export declare function mintSessionId(): string;
export declare class AgentStore {
    private readonly ctx;
    private readonly ensuring;
    constructor(ctx: BridgeContext);
    private agents;
    /** The live agent for a bound user state, if any. */
    get(user: UserState): Agent | undefined;
    /**
     * Ensure a live agent for the user state. Creates a fresh session when
     * none is bound yet; resumes the persisted session otherwise.
     * Returns `{ agent }` (agent undefined when the agents service is
     * unavailable or create/resume failed). With `replaceOnResumeFailure`,
     * a corrupt or unreadable bound session is unbound and replaced.
     */
    ensure(user: UserState, options?: EnsureAgentOptions): Promise<EnsureAgentResult>;
    private ensureNow;
    /**
     * Account the session to the workspace owning `cwd` (create it on first
     * use), exactly like the GUI's session.create remote does via
     * `workspace.attachSession`. Without this, WeChat-created sessions fall
     * into the sidebar's "ungrouped" bucket: the workspace registry derives
     * membership from its durable `sessionIds` records, which only
     * `attachSession` (or the startup bootstrap) populates.
     */
    private attachToWorkspace;
    /**
     * Deliver a user-role message to the agent.
     *
     * `mode` mirrors the DSH `ui-conversation.busyEnter` preference (the GUI's
     * 「繁忙时 Enter 键行为」): `"queue"` routes through `agent.followup` — an
     * ordinary follow-up turn, the behavior while idle and the historical
     * default; `"steer"` routes through `agent.steer` — an idle driver starts a
     * turn, a running driver consumes the message at its nearest step boundary
     * (a closed window degrades to the next waking queue turn, never lost).
     * The caller resolves the mode from agent.status + the shared setting.
     */
    followup(agent: Agent, content: ContentBlock[], mode?: BusyEnterBehavior, onCreated?: (messageId: string) => void): string;
}
export declare function agentSetup(agentCtx: unknown, agent?: Agent): Promise<void>;
//# sourceMappingURL=sessions.d.ts.map