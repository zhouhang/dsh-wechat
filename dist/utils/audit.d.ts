/**
 * Append-only audit trail for the bridge's security-relevant events.
 *
 * One JSON object per line in `<storageDir>/audit.jsonl`. What is recorded
 * is deliberately shallow: WHO (a masked WeChat id), WHAT happened, and the
 * SIZE of a payload — never the message body, never a token, never a full
 * file content. The trail exists so an operator can answer "was a stranger
 * turned away?", "who raised the global permission default?", "which file did
 * the agent push to WeChat?" after the fact, without turning the log itself
 * into a second copy of the conversation.
 *
 * Bounded by construction: the file is capped at {@link AUDIT_MAX_BYTES} and
 * rotated to a single `<name>.1` predecessor, so the sink can never grow
 * without limit — the same rule the outbound queue follows ("a memory bound
 * must be enforced by code that removes memory on every path; retry is never
 * the bound"). Every rotation is logged loudly.
 *
 * Failure policy: auditing is best-effort and MUST NOT break the message
 * path — a read-only storage directory would otherwise turn every send into a
 * failure. The first failure is reported through the injected logger, then
 * further failures are counted and reported only on the way back up (so a
 * permanently broken sink does not flood the console).
 *
 * ## Why this holds an open descriptor instead of calling appendFileSync
 *
 * `record()` sits on the OUTBOUND hot path — `deliverOutboundLocked` writes
 * one line per send attempt, including the ones that only end up queued. The
 * obvious implementation (`ensurePrivateDir` + `appendFileSync` + `chmod`
 * + `stat` on every call) costs four synchronous syscalls per line: on Windows
 * NTFS that measured at ~0.9 ms per line, which turned a 450-attempt test into
 * 19.6 s and blew the 5 s default timeout. Nothing about that cost is
 * necessary:
 *
 *   - the directory is created and tightened ONCE, on first use (the mode of
 *     an existing file is already settled — re-chmod'ing it on every append
 *     cannot improve it, only cost a syscall);
 *   - the descriptor stays open across appends, so there is no per-line
 *     open/close;
 *   - the size is tracked in memory (`bytes`), so there is no per-line `stat`.
 *
 * The same measurement with a held descriptor: ~10.5 ms for those 450 lines.
 *
 * Correctness rules that keep the cheap path honest:
 *   - `bytes` is SEEDED from `fstat` when the descriptor opens, so a file left
 *     behind by a previous process is counted, not assumed empty;
 *   - every write failure drops the descriptor (`closeFd`), so the next call
 *     re-opens and re-seeds instead of writing into a stale handle;
 *   - rotation closes the descriptor before the rename and lets the next
 *     append re-open the fresh file — a rotated-away fd would keep appending
 *     to `<name>.1`.
 */
/** Cap of one audit file before it is rotated. Keep the previous file too. */
export declare const AUDIT_MAX_BYTES: number;
/** Longest single JSONL line kept — a runaway value must not eat the cap alone. */
export declare const AUDIT_MAX_LINE_CHARS = 2000;
export declare class AuditLog {
    private readonly storageDir;
    private readonly log;
    /** Injectable for tests; defaults to the module constant. */
    private readonly maxBytes;
    private readonly filePath;
    private readonly previousPath;
    /** Known on-disk size of the live file; -1 until the descriptor is opened. */
    private bytes;
    /** Open append descriptor, or null when not (yet) opened. */
    private fd;
    private failures;
    constructor(storageDir: string, log: (message: string) => void, 
    /** Injectable for tests; defaults to the module constant. */
    maxBytes?: number);
    /** Absolute path of the live audit file (reported on failure by the caller's log line). */
    path(): string;
    /**
     * Append one event. Adds `time` (ISO-8601) to the record; the caller owns
     * every other field and must already have masked identifiers and dropped
     * bodies.
     */
    record(event: Record<string, unknown>): void;
    /**
     * Open (once) the live audit file with `0o600`, creating the storage dir
     * `0o700` on first use, and seed {@link bytes} from the real file size.
     *
     * The `chmod` here is the one that matters: `{ mode }` on `open` only applies
     * when the file is CREATED, so a pre-existing world-readable `audit.jsonl`
     * would otherwise keep its old mode forever.
     */
    private ensureOpen;
    /** Write the whole buffer, tolerating a short write. */
    private writeAll;
    /** Close the descriptor, if any, so the next call re-opens and re-seeds. */
    private closeFd;
    /**
     * Release the descriptor. Called from `WeChatDSHBridge.stop()` so a plugin
     * dispose does not leave an open handle behind (a re-`apply()` in the same
     * process must not accumulate them). Auditing continues to work afterwards:
     * the next `record()` simply re-opens.
     */
    close(): void;
    /**
     * Rename the live file to `<name>.1`, replacing any previous rotation, and
     * start a new one. Logged loudly: an audit trail that silently loses its
     * history is worse than no trail at all.
     */
    private rotate;
    private fail;
}
//# sourceMappingURL=audit.d.ts.map