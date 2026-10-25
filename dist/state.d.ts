/**
 * Durable per-user bridge state: session mapping, silent mode, and workspace
 * choices. The default preset deliberately lives in the DSH settings
 * document (`agent-presets` namespace), not here — the GUI settings page and
 * WeChat's `/preset switch` share that one source of truth.
 *
 * Mirrors the reference project's UserState (wechat-opencode) but keeps
 * ONLY what the DSH bridge needs. Persisted to `~/.dsh-wechat/state.json`
 * so restarts restore the WeChat user → DSH session mapping.
 */
export interface UserState {
    /** The WeChat user id this state belongs to. */
    userId: string;
    /** Bound DSH session id. */
    sessionId: string;
    /** Working directory the bound session was created with. */
    cwd: string;
    /**
      * Whether the user explicitly switched workspaces (/workspace, /session
      * switch). Explicit choices are NOT overwritten by the settings-page cwd
      * default; users without this flag follow the settings default.
      */
    cwdExplicit?: boolean;
    /** Silent mode: only send the final text of each turn. */
    silent: boolean;
    /** Cross-session notification preference (default inherit -> follows global config). */
    crossSessionNotify?: "inherit" | "on" | "off";
    /** Sessions this user has ever been bound to — used for cross-session recipient resolution. */
    watchedSessions?: string[];
}
/** One globally ordered outbound queue for the bridge's single WeChat peer. */
export type OutboundMessage = {
    kind: "text";
    text: string;
} | {
    kind: "file";
    filePath: string;
    fileName: string;
};
/**
 * Soft cap for the outbound FIFO. Reaching it makes `parkOutbound` try to
 * force-send the oldest item instead of dropping it, so a full queue means
 * "try harder", not "discard".
 */
export declare const MAX_OUTBOUND_QUEUE = 100;
/**
 * Hard ceiling for the outbound FIFO — the actual memory bound.
 *
 * The soft cap alone cannot bound memory: when the force-send fails (invalid
 * token, gateway rejection, closed message window) nothing leaves the queue,
 * yet the caller still appends. Without a ceiling the queue — and the
 * `state.json` snapshot written from it — grows without limit for as long as
 * the outage lasts. This ceiling is the point where the oldest item is
 * dropped *with a loud log* instead, trading the least-recent message for a
 * bounded process. It sits well above the soft cap so the force-send path has
 * room to work before any loss is contemplated.
 */
export declare const MAX_OUTBOUND_QUEUE_HARD: number;
export interface OutboundState {
    version: 1;
    peerUserId: string;
    messageCount: number;
    queue: OutboundMessage[];
}
export interface BridgeStateFile {
    users: Record<string, UserState>;
    /** Single-peer send-window state; absent in legacy files and when empty. */
    outbound?: OutboundState;
}
export declare class StateStore {
    private readonly filePath;
    private state;
    constructor(storageDir: string);
    private load;
    private save;
    ensureUser(userId: string, cwd: string, opts?: {
        silent?: boolean;
    }): UserState;
    getUser(userId: string): UserState | undefined;
    update(userId: string, patch: Partial<UserState>): void;
    /** Record that `userId` has been bound to `sessionId` (for cross-session recipient resolution). */
    watchSession(userId: string, sessionId: string): void;
    /** Return a defensive copy of the single-peer outbound snapshot. */
    outbound(): OutboundState | undefined;
    /** Replace and durably save the single-peer outbound snapshot. */
    setOutbound(value: OutboundState): void;
    /** Remove any durable outbound budget and queue. */
    clearOutbound(): void;
    /** Effective cross-session preference for display. */
    getNotifyPreference(userId: string): "inherit" | "on" | "off";
    all(): UserState[];
    /**
     * Drop every persisted WeChat user. Logout / re-login must not keep the
     * previous single-user peer, or a newly scanned account is ignored.
     */
    clearUsers(): void;
}
//# sourceMappingURL=state.d.ts.map