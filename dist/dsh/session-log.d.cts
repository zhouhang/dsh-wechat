export type CacheEntry = {
    size: number;
    mtimeMs: number;
    scannedBytes: number;
    preset: string | undefined;
    headerPreset: string | undefined;
    title: string | undefined;
    lastUserMessageTime: number | undefined;
    recencyChecked: boolean;
    complete: boolean;
};
/** The Zstandard-compressed suffix DSH uses for session artifacts. */
export const COMPRESSED_SUFFIX: ".jsonl.zstd";
export function clearSessionLogCache(): void;
/**
 * Reproduce `@deepseek-ai/dsh-session-persistence-jsonl`'s
 * `encodeSegment` — the per-session directory name. Verbatim port of
 * the host algorithm: safe code units (`A-Za-z0-9._-`) stay literal and
 * EVERY other UTF-16 code unit becomes `~XXXX` uppercase hex, `~`
 * itself included (`~007E`). `.` and `..` are special-cased so a whole
 * segment cannot traverse upward.
 *
 * Why not `encodeURIComponent`: the two agree on `session-<uuid>` (the
 * ids this plugin mints) but diverge on everything else. `encodeURIComponent`
 * leaves `~ ! * ' ( )` alone and writes UTF-8 percent escapes for
 * non-ASCII, so an id containing any of those resolves to a directory
 * the host never wrote — the log lookup fails silently and the session
 * looks empty rather than missing.
 */
export function encodeSegment(segment: any): string;
/**
 * Locate the current session log. Mirrors host `open()`: scan the
 * session directory and pick the highest canonical generation. A
 * migrated 0.1.5 session is `session.v3.jsonl.zstd` with the older
 * `session.jsonl.zstd` left in place as an immutable predecessor —
 * reading the v0 file would miss later events.
 *
 * Returns undefined when the directory is missing or contains no
 * canonical generation. We do not synthesise or write — read-only.
 */
export function locateSessionLog(cwd: any, sessionId: any, root: any): string | undefined;
/**
 * Parse a canonical generation filename. Returns the format version
 * (0 for the untagged `session.jsonl`) or undefined when the name is
 * not a committed generation.
 */
export function parseGenerationLogFilename(filename: any): number | undefined;
/**
 * Reproduce `@deepseek-ai/dsh-session-persistence-jsonl`'s `projectKey`
 * function — a workspace path becomes a safe directory name of the
 * form `--<slug>--`. Slashes/colons/dashes collapse; non-ASCII and
 * other unsafe chars become `~XXXX` hex-encoded; total capped at 255.
 */
export function projectKey(cwd: any): string;
/**
 * Read every event line from a session log. Returns parsed JSON
 * objects in log order. Header line (`type: "session"`) is included
 * as the first element — caller can ignore it. Not used by the
 * preset hot path (that path never materialises the full event list).
 */
export function readSessionEvents(cwd: any, sessionId: any, root: any): any[];
/**
 * Fold listing facts (runtime preset, last user-prompt time, latest
 * title) from the raw log. Used for the displayed `/s list` rows after
 * recency has already picked the top 20.
 */
export function readSessionListFacts(cwd: any, sessionId: any, root: any): {
    preset: any;
    title: any;
    lastUserMessageTime: any;
};
/**
 * Last `user/message` time, recovered newest-first. Does not decompress
 * the whole log — `/s list` uses this to sort every session before it
 * spends a full scan on the 20 rows it will actually render.
 */
export function readSessionRecency(cwd: any, sessionId: any, root: any): any;
/**
 * The preset a session actually runs under, walking the raw event
 * log for `agent-preset/selected` (newest wins, header fallback).
 * Mirrors `@deepseek-ai/dsh-agent-presets.resolveSessionPreset`.
 */
export function readSessionRuntimePreset(cwd: any, sessionId: any, root: any): any;
/**
 * Cheap used/blank hint for `/s new`.
 * - `used`: has a user prompt, or the artifact is larger than a blank header
 * - `blank`: small artifact, fully readable, no `user/message`
 * - `unknown`: missing file or unreadable small artifact (caller may inspect)
 *
 * @returns {{ status: "used", time?: number } | { status: "blank" } | { status: "unknown" }}
 */
export function readSessionUsedHint(cwd: any, sessionId: any, root: any): {
    status: "used";
    time?: number;
} | {
    status: "blank";
} | {
    status: "unknown";
};
/**
 * The absolute session root. Mirrors the host's `resolveDshHome`: an
 * explicit root or `$DSH_HOME` (a blank value counts as unset), then
 * `~/.dsh`, in every case tilde-expanded and made absolute.
 *
 * The resolve is not cosmetic. A relative `$DSH_HOME` or a root like
 * `~/.dsh` would otherwise be interpolated into the path verbatim and
 * the listing would read (or fail to read) a directory that no DSH
 * process ever wrote to — `/s list` silently loses every session.
 */
export function resolveDshHome(configured: any): string;
/**
 * Parse Zstandard frame boundaries without decompressing the payload.
 * Faithful port of `@deepseek-ai/dsh-session-persistence-jsonl`'s
 * `scanZstdFrames` — we only need to know where each frame starts
 * and ends so we can decompress them one at a time. Returns
 * `{frames, tornStart?}` ranges in byte offsets within `buffer`.
 */
export function scanZstdFrames(buffer: any, maxFrames: any): {
    frames: {
        start: number;
        end: number;
    }[];
    tornStart: number;
} | {
    frames: {
        start: number;
        end: number;
    }[];
    tornStart?: undefined;
};
/**
 * Build the on-disk session log path for `(cwd, sessionId)`. Returns
 * a `.jsonl.zstd` path even if the artifact is currently plaintext —
 * we just read what exists at the compressed path or the plain path.
 */
export function sessionLogPath(cwd: any, sessionId: any, root: any): string;
//# sourceMappingURL=session-log.d.cts.map