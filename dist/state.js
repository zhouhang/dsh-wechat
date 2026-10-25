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
import fs from "node:fs";
import path from "node:path";
import { ensurePrivateDir, writePrivateFile } from "./utils/secure-fs.js";
/**
 * Soft cap for the outbound FIFO. Reaching it makes `parkOutbound` try to
 * force-send the oldest item instead of dropping it, so a full queue means
 * "try harder", not "discard".
 */
export const MAX_OUTBOUND_QUEUE = 100;
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
export const MAX_OUTBOUND_QUEUE_HARD = MAX_OUTBOUND_QUEUE * 4;
function normalizeOutbound(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const raw = value;
    if (raw.version !== 1 || typeof raw.peerUserId !== "string" || !raw.peerUserId)
        return undefined;
    const count = typeof raw.messageCount === "number" && Number.isFinite(raw.messageCount)
        ? Math.max(0, Math.min(10, Math.floor(raw.messageCount)))
        : 0;
    const queue = [];
    if (Array.isArray(raw.queue)) {
        for (const item of raw.queue) {
            if (!item || typeof item !== "object")
                continue;
            const candidate = item;
            if (candidate.kind === "text" && typeof candidate.text === "string") {
                queue.push({ kind: "text", text: candidate.text });
            }
            else if (candidate.kind === "file" &&
                typeof candidate.filePath === "string" && candidate.filePath &&
                typeof candidate.fileName === "string" && candidate.fileName) {
                queue.push({ kind: "file", filePath: candidate.filePath, fileName: candidate.fileName });
            }
        }
    }
    return {
        version: 1,
        peerUserId: raw.peerUserId,
        messageCount: count,
        // The reload cap MUST match the runtime hard ceiling, not the soft cap:
        // the runtime queue legally holds up to `MAX_OUTBOUND_QUEUE_HARD` (400)
        // entries, so keeping only the last 100 here silently discarded items
        // 101–400 of a full queue on every restart. `persistOutboundState` writes
        // the whole bounded set, so a reload restores exactly what was saved.
        queue: queue.slice(-MAX_OUTBOUND_QUEUE_HARD),
    };
}
export class StateStore {
    filePath;
    state;
    constructor(storageDir) {
        this.filePath = path.join(storageDir, "state.json");
        this.state = this.load();
    }
    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
                if (parsed && typeof parsed === "object" && parsed.users) {
                    // Normalize legacy files: ensure optional fields have safe defaults
                    for (const user of Object.values(parsed.users)) {
                        if (!Array.isArray(user.watchedSessions)) {
                            // Seed history with current binding so old users get at least their present session
                            user.watchedSessions = user.sessionId ? [user.sessionId] : [];
                        }
                        if (user.crossSessionNotify !== "on" && user.crossSessionNotify !== "off") {
                            user.crossSessionNotify = "inherit";
                        }
                    }
                    const outbound = normalizeOutbound(parsed.outbound);
                    if (outbound)
                        parsed.outbound = outbound;
                    else
                        delete parsed.outbound;
                    return parsed;
                }
            }
        }
        catch {
            // fall through to fresh state
        }
        return { users: {} };
    }
    save() {
        ensurePrivateDir(path.dirname(this.filePath));
        const tempPath = `${this.filePath}.tmp-${process.pid}`;
        try {
            // 0o600 on both the temp file and the renamed target: the state file
            // carries the WeChat↔session mapping and the queued outbound bodies.
            writePrivateFile(tempPath, JSON.stringify(this.state, null, 2));
            fs.renameSync(tempPath, this.filePath);
        }
        catch (err) {
            try {
                if (fs.existsSync(tempPath))
                    fs.unlinkSync(tempPath);
            }
            catch {
                // best effort cleanup
            }
            throw err;
        }
    }
    ensureUser(userId, cwd, opts) {
        let user = this.state.users[userId];
        if (!user) {
            user = {
                userId,
                sessionId: "",
                cwd,
                silent: opts?.silent === true,
                crossSessionNotify: "inherit",
                watchedSessions: [],
            };
            this.state.users[userId] = user;
            this.save();
        }
        else {
            // Backfill missing fields for users created before this feature
            let changed = false;
            if (user.crossSessionNotify !== "on" && user.crossSessionNotify !== "off" && user.crossSessionNotify !== "inherit") {
                user.crossSessionNotify = "inherit";
                changed = true;
            }
            if (!Array.isArray(user.watchedSessions)) {
                user.watchedSessions = user.sessionId ? [user.sessionId] : [];
                changed = true;
            }
            if (changed)
                this.save();
        }
        return user;
    }
    getUser(userId) {
        return this.state.users[userId];
    }
    update(userId, patch) {
        const user = this.state.users[userId];
        if (!user)
            return;
        Object.assign(user, patch);
        this.save();
    }
    /** Record that `userId` has been bound to `sessionId` (for cross-session recipient resolution). */
    watchSession(userId, sessionId) {
        if (!sessionId)
            return;
        const user = this.state.users[userId];
        if (!user)
            return;
        if (!Array.isArray(user.watchedSessions))
            user.watchedSessions = [];
        if (!user.watchedSessions.includes(sessionId)) {
            user.watchedSessions.push(sessionId);
            // Cap history to avoid unbounded growth
            if (user.watchedSessions.length > 100)
                user.watchedSessions = user.watchedSessions.slice(-100);
            this.save();
        }
    }
    /** Return a defensive copy of the single-peer outbound snapshot. */
    outbound() {
        const value = this.state.outbound;
        if (!value)
            return undefined;
        return { ...value, queue: value.queue.map((item) => ({ ...item })) };
    }
    /** Replace and durably save the single-peer outbound snapshot. */
    setOutbound(value) {
        const normalized = normalizeOutbound(value);
        if (!normalized)
            throw new Error("invalid outbound state");
        this.state.outbound = normalized;
        this.save();
    }
    /** Remove any durable outbound budget and queue. */
    clearOutbound() {
        if (!this.state.outbound)
            return;
        delete this.state.outbound;
        this.save();
    }
    /** Effective cross-session preference for display. */
    getNotifyPreference(userId) {
        const user = this.state.users[userId];
        if (!user)
            return "inherit";
        if (user.crossSessionNotify === "on" || user.crossSessionNotify === "off")
            return user.crossSessionNotify;
        return "inherit";
    }
    all() {
        return Object.values(this.state.users);
    }
    /**
     * Drop every persisted WeChat user. Logout / re-login must not keep the
     * previous single-user peer, or a newly scanned account is ignored.
     */
    clearUsers() {
        if (Object.keys(this.state.users).length === 0)
            return;
        this.state.users = {};
        this.save();
    }
}
//# sourceMappingURL=state.js.map