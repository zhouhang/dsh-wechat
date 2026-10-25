/**
 * WeChat slash-command parsers.
 *
 * Ported and trimmed from wechat-opencode (MIT) —
 * https://github.com/pan17/wechat-opencode (src/adapter/workspace-cmd.ts).
 * Only the commands the DSH bridge handles itself are kept: DSH owns
 * workspace/session/agent/model management in its GUI, so those commands
 * are intentionally absent here.
 *
 * This module also owns the two `/help` renderers (`formatHelp` and
 * `helpTopicBlock`). Their wording is NOT written here — it comes from
 * `src/help-catalog.ts`, the same catalog the settings page renders, so the
 * WeChat reply and the GUI panel can never disagree.
 */
export type HelpCommand = {
    kind: "help";
};
export type StatusCommand = {
    kind: "status";
};
export type SilentCommand = {
    kind: "silent";
    mode: "on" | "off" | "status";
};
export type FinalCommand = {
    kind: "final";
    mode: "on" | "off" | "status";
};
export type MergeCommand = {
    kind: "merge";
    mode: "on" | "off" | "status";
};
/**
 * `/media` — 图片/文件与文字合并发送 + 附件交付措辞.
 *
 * One command, two independent switches (whether to hold a caption-less
 * attachment for the sentence typed next, and how the saved file is spelled in
 * the prompt), because a user asks for them together ("send the picture AND the
 * question") and splitting them across two commands would make neither
 * discoverable.
 *
 * `at|path` changes the SPELLING only: `adapter/inbound.ts` hands over a pointer
 * in both cases and never inlines the file's content.
 */
export type MediaCommand = {
    kind: "media";
    target: "merge";
    mode: "on" | "off";
} | {
    kind: "media";
    target: "ref";
    style: "at" | "path";
} | {
    kind: "media";
    target: "status";
};
export type SurfaceCommand = {
    kind: "surface";
    mode: "on" | "off" | "status";
};
export type StopCommand = {
    kind: "stop";
};
export type RejectQuestionCommand = {
    kind: "reject-question";
};
export type RejectPermissionCommand = {
    kind: "reject-permission";
};
export type NotifyCommand = {
    kind: "status";
} | {
    kind: "on";
} | {
    kind: "off";
} | {
    kind: "tasks-on";
} | {
    kind: "tasks-off";
};
export type SlashCommand = HelpCommand | StatusCommand | SilentCommand | FinalCommand | MergeCommand | MediaCommand | StopCommand | RejectQuestionCommand | RejectPermissionCommand;
/**
 * Parse `/help` (aliases `/h`, `/?`), optionally with a command name.
 *
 *   /help                 → `true`   (the listing)
 *   /help s               → `{ topic: "s" }`  (that command's examples)
 *   /help session         → `{ topic: "session" }`
 *   /help fuck            → `{ unknown: "fuck" }` (listing + "没有这条命令")
 *   /help me write a test → `{ unknown: "me write a test" }` (same)
 *
 * Everything after `/help` is a COMMAND NAME, so a line that does not resolve
 * to a documented command is still a help request: it gets "没有 /xxx 这条命令"
 * plus the listing, never a forwarded sentence. Forwarding it would answer a
 * help request with "未知命令 /help", which is the one reply guaranteed to be
 * wrong — the user is asking for help. This matches `man`, which answers an
 * unknown page with an error and its own usage instead of ignoring the word.
 *
 * The only non-help shape left is `/help` followed by NOTHING but whitespace,
 * which is the plain listing.
 */
export declare function parseHelpCommand(text: string): boolean | {
    topic: string;
} | {
    unknown: string;
};
/** Parse `/status`. */
export declare function parseStatusCommand(text: string): StatusCommand | null;
/**
 * Parse `/silent` (alias `/sl`) — query or toggle silent mode.
 * Bare command defaults to status.
 */
export declare function parseSilentCommand(text: string): SilentCommand | null;
/**
 * Parse `/final` (alias `/fo`) — query or toggle 结论模式 (final-only).
 * Bare command defaults to status.
 *
 * `/f` is deliberately NOT an alias: it already means `/flush`, and
 * "take back what is held" is the opposite of "start holding". `/fo`
 * is the shortest unambiguous prefix.
 */
export declare function parseFinalCommand(text: string): FinalCommand | null;
/**
 * Parse `/merge` (alias `/mg`) — query or toggle the inbound merge window
 * (打字合并). Bare command defaults to status.
 *
 * The alias must not collide with an existing name: `/m` is NOT used (it
 * would be the shortest but is not obviously "merge"), and `/mg` is free —
 * `tests/merge-window.test.ts` asserts the whole alias table for collisions.
 */
export declare function parseMergeCommand(text: string): MergeCommand | null;
/**
 * Parse `/media` (alias `/md`) — 图片/文件与文字合并发送, plus how a saved
 * attachment is spelled in the prompt:
 *
 *   /media                    → status (both switches + the current wording)
 *   /media on|off             → hold a caption-less image/file/video and send
 *                               it together with the text typed next
 *   /media at|path            → `@路径` reference (default) vs. the plain-path
 *                               "文件已保存到: 路径" wording — SPELLING only,
 *                               neither inlines the file's content
 *
 * `/md` is safe: `/m`, `/mo` and `/me` are already taken or ambiguous, while
 * `/md` collides with nothing in `LOCAL_COMMAND_NAMES` (asserted by the alias
 * guard in tests/media-merge.test.ts).
 */
export declare function parseMediaCommand(text: string): MediaCommand | null;
/**
 * Parse `/surface` (alias `/wxprompt`) — query or toggle the WeChat
 * surface-prompt injection. Bare command defaults to status. The prompt
 * text itself is edited from the settings page, not this command.
 */
export declare function parseSurfaceCommand(text: string): SurfaceCommand | null;
/** Parse `/stop`. */
export declare function parseStopCommand(text: string): StopCommand | null;
/**
 * Parse `/notify` (aliases `/watch`, `/notice`) — cross-session decision
 * push, plus an independent task-event toggle:
 *   /notify                → status
 *   /notify status         → status
 *   /notify on|off         → decision-card gate
 *   /notify tasks on|off   → background turn/end + error notices
 */
export declare function parseNotifyCommand(text: string): NotifyCommand | null;
/**
 * Parse `/next` — the explicit continuation for outbound messages cached by
 * the WeChat per-window send limit (the limit notices tell the user to send
 * this). Any ordinary user message also auto-flushes the cache, but `/next`
 * is recognized so it is not mistaken for an unknown command and forwarded.
 */
export declare function parseNextCommand(text: string): boolean;
/**
 * Parse `/flush` (alias `/f`) — deliver whatever 结论模式 (final-only) is
 * currently holding, without waiting for the quiescence timer. This is the
 * escape hatch for "I can see it is done, tell me now".
 */
export declare function parseFlushCommand(text: string): boolean;
/** Parse `/reject-question` (alias `/rq`). */
export declare function parseRejectQuestionCommand(text: string): RejectQuestionCommand | null;
/**
 * Parse a `P{n}=…` / `P{n}:…` / `P{n}-…` prefix that addresses one pending
 * card by its WeChat number. Used so a lone cross-session card cannot
 * swallow a bare reply meant for the current session, and so `P1=/rq`
 * closes that card instead of being forwarded as chat.
 */
export declare function parsePnCardReply(text: string): {
    index: number;
    rest: string;
} | null;
/** Every `P{n}=` / `P{n}-` segment in the line, in order. */
export declare function parseAllPnCardReplies(text: string): Array<{
    index: number;
    rest: string;
}>;
/** Parse `/reject-permission` (alias `/rp`). */
export declare function parseRejectPermissionCommand(text: string): RejectPermissionCommand | null;
/**
 * Detect an unknown leading-slash command for the hint reply.
 *
 * Returns null for a name this plugin owns. "/help fuck" answering "未知命令
 * /help" is the one reply guaranteed to be wrong — the user is literally
 * asking for help — and the same holds for a documented command with a bad
 * argument (`/model foo`), where `commandUsageHint` answers instead.
 */
export declare function detectUnknownSlashCommand(text: string): string | null;
/**
 * Usage line for a DOCUMENTED command whose arguments did not parse.
 *
 * `/model foo` is not an unknown command — `/model` is printed in the `/help`
 * listing, so answering "未知命令 /model" contradicts what the user just read.
 * The command exists; the argument is wrong, and the reply has to say which
 * argument it wanted. Bare commands never reach here (every parser handles
 * them), and `/help <文字>` is excluded because that is a question for the
 * agent, not a syntax error.
 */
export declare function commandUsageHint(text: string): string | null;
/**
 * Parse just the lowercase command name out of a leading-slash line.
 *
 * Mirrors the wire contract of `@deepseek-ai/dsh-commands.parseCommand`:
 * a slash at byte zero, a lowercase name containing letters, digits, `_`,
 * or `-`, followed by either end-of-input or whitespace. Anything that
 * survives the name is the handler's `rawInput` (separator whitespace
 * included — handlers own their own grammar).
 *
 * Returns `null` for: empty input, missing leading slash, name starting
 * with a digit, uppercase letters, or any other shape the registry
 * itself would reject. Callers use the result to look up a definition
 * with `ctx.commands.find(agent, name)` before deciding whether to
 * dispatch natively or fall through to forwarding.
 *
 * @param text The raw inbound WeChat text (untrimmed — leading whitespace
 *   is rejected so an accidental " /plan off" never matches).
 * @returns The lowercase command name, or `null` if the line is not a
 *   recognized native-command shape.
 */
export declare function parseCommandName(text: string): string | null;
/**
 * Rows shown by a numbered list command (`/s list`, `/workspace list`)
 * when the caller does not ask for more. `all` (or an explicit larger
 * number) lifts the window; the default is deliberately small because
 * WeChat splits a long reply into 4000-char messages and only 10 of
 * those fit in one gateway window.
 */
export declare const LIST_DEFAULT = 20;
export type WorkspaceCommand = {
    kind: "list";
    limit?: number;
    all?: boolean;
} | {
    kind: "status";
} | {
    kind: "switch";
    target: string;
} | {
    kind: "add";
    path: string;
};
export type SessionCommand = {
    kind: "list";
    scope?: "current";
    limit?: number;
    all?: boolean;
} | {
    kind: "switch";
    index: number;
    scope?: "current";
} | {
    kind: "new";
} | {
    kind: "status";
} | {
    kind: "pin";
    index?: number;
} | {
    kind: "unpin";
    index?: number;
};
export type PresetCommand = {
    kind: "list";
} | {
    kind: "switch";
    target: string;
} | {
    kind: "status";
};
export type ModelCommand = {
    kind: "list";
    provider?: string;
} | {
    kind: "switch";
    target: string;
} | {
    kind: "status";
};
export type PermCommand = {
    kind: "status";
} | {
    kind: "list";
} | {
    kind: "switch";
    target: string;
} | {
    kind: "default";
    target?: string;
};
export type ReasoningCommand = {
    kind: "status";
} | {
    kind: "list";
} | {
    kind: "switch";
    target: string;
} | {
    kind: "clear";
};
/** Busy-time delivery behavior switch (`/enter`), shared with the DSH setting. */
export type EnterCommand = {
    kind: "status";
} | {
    kind: "switch";
    target: "queue" | "steer";
};
/**
 * Parse `/workspace` (alias `/ws`):
 *   (bare) | list [all|<数量>] | status | switch <path|n> | add <path>
 *
 * Bare `/ws` reports status, the same shape every other management command
 * uses (`/reasoning`, `/enter`, `/notify`, `/surface`). It used to parse to
 * `null`, which made the bridge answer "未知命令 /workspace" for a command the
 * `/help` listing documents two lines above — the most confusing possible
 * reply, because the user just read the name there.
 */
export declare function parseWorkspaceCommand(text: string): WorkspaceCommand | null;
/**
 * Parse `/session` (alias `/s`):
 *   list [current] [all|<数量>] | switch [current] <n> | new | status
 *   | pin [编号] | unpin [编号]
 *
 * `switch current <n>` selects the same current-working-directory scope as
 * `list current`; the explicit scope keeps the command deterministic instead
 * of relying on a hidden "last list" state. The window tokens may appear on
 * either side of `current` (`list current 50` / `list 50 current`).
 *
 * `pin` / `unpin` carry an optional row number from the latest `/s list`
 * (same numbering `switch` uses). Without one they act on the user's
 * currently bound session, so a bare `/s pin` needs no list first.
 */
export declare function parseSessionCommand(text: string): SessionCommand | null;
/**
 * Parse `/preset` (alias `/p`; legacy aliases `/agent`, `/a` still parse):
 *   list | switch <name|n> | status
 *
 * The preset default lives in the DSH settings document (`agent-presets`
 * namespace), the same one the GUI settings page edits — `/preset switch`
 * writes that document, so GUI and WeChat stay in sync.
 */
export declare function parsePresetCommand(text: string): PresetCommand | null;
/**
 * Parse `/model`:
 *   list [provider] | switch <provider/model> | status
 *
 * `switch` keeps the rest of the line intact — OpenRouter-style model ids
 * contain `/` (`inclusionai/ling-3.0-flash-fin:free`), so the provider
 * split happens later against the known provider list. A missing target
 * still parses so the handler can print usage instead of forwarding.
 */
export declare function parseModelCommand(text: string): ModelCommand | null;
/**
 * Split `provider/model` after a known provider id or name. Model ids may
 * themselves contain `/`, so this is not `split("/")[0]`.
 *
 * Longest matching prefix wins (`foo-bar/x` beats `foo` if both exist).
 * Returns null when no known provider owns the first segment.
 */
export declare function splitProviderModelTarget(target: string, providers: ReadonlyArray<{
    id: string;
    name?: string;
}>): {
    provider: string;
    model: string;
} | null;
/**
 * Parse `/perm` (alias `/permission`):
 *   status | list | switch <名称|编号> | default [名称|编号]
 *
 * Session-level switches (`switch`) go through the native permissionPresets
 * service and take effect on the current session immediately; `default`
 * writes the DSH settings document (`permission` namespace) — the same
 * default the GUI settings page's Permission row edits, so both sides stay
 * in sync and new sessions pick it up natively.
 */
export declare function parsePermCommand(text: string): PermCommand | null;
/**
 * Parse `/reasoning`:
 *   (bare) | list | default | switch <等级>
 *
 * The reasoning effort rides the same selection as the model: `/reasoning`
 * with no argument reports the current/default effort and the current
 * model's supported levels; `default` clears it (provider/model default);
 * `switch <等级>` switches the effort (by id or display name), applying to
 * the current session immediately and persisting as the new default.
 * The explicit `switch` keyword matches the other management commands
 * (`/workspace`, `/session`, `/preset`, `/model`, `/perm`).
 */
export declare function parseReasoningCommand(text: string): ReasoningCommand | null;
/**
 * Parse `/enter` (alias `/busy`) — busy-time delivery behavior, shared with
 * the DSH General Settings 「繁忙时 Enter 键行为」 preference
 * (`ui-conversation.busyEnter`):
 *   /enter              → status
 *   /enter status       → status
 *   /enter queue|q|排队 → switch to queue (running messages wait for a new turn)
 *   /enter steer|s|插话 → switch to steer (splice into the running turn)
 *
 * Returns null for unknown subcommands so the text falls through to the
 * unknown-command hint + agent forwarding.
 */
export declare function parseEnterCommand(text: string): EnterCommand | null;
export declare const HISTORY_DEFAULT = 5;
export declare const HISTORY_MAX = 20;
export type HistoryCommand = {
    kind: "history";
    count: number;
    includeSystem: boolean;
};
/**
 * `/at` (引用) — the WeChat stand-in for the GUI composer's `@` completion.
 *
 * WeChat has no composer attachment surface, so a reference cannot be
 * inserted at a caret. Instead `/at` STAGES a reference and the next message
 * delivered to the agent carries it: the model then sees the same tokens the
 * GUI would have produced (`@[标题](dsh-session:…)` for a session, `@path` /
 * `@"path with spaces"` for a file).
 *
 *   /at                      → list what is staged
 *   /at s <编号|关键词>       → stage another session (by /s list row or a substring)
 *   /at f <路径>              → stage a file or directory
 *   /at rm <编号>             → drop one staged reference
 *   /at clear                → drop every staged reference
 *
 * `target` is the raw rest-of-line: a path may contain spaces, and the caller
 * strips one pair of surrounding quotes (the `@"…"` spelling the GUI shows).
 */
export type AtCommand = {
    kind: "list";
} | {
    kind: "clear";
} | {
    kind: "remove";
    index: number;
} | {
    kind: "session";
    target: string;
} | {
    kind: "file";
    target: string;
};
export declare function parseAtCommand(text: string): AtCommand | null;
/**
 * True if text looks like an `/at` attempt (including an invalid argument),
 * used to decide whether to show usage instead of forwarding to the agent —
 * the same contract as {@link isHistoryCommandAttempt}.
 */
export declare function isAtCommandAttempt(text: string): boolean;
/**
 * Parse `/history [all] [N]` — view recent conversation history.
 *   /history            → 5 human+assistant turns (default)
 *   /history 10         → 10
 *   /history all        → 5, including synthesized system injections
 *   /history all 10     → 10, including system
 *   /history 10 all     → same as `all 10`
 *   /history 30         → 20 (clamped to HISTORY_MAX)
 *
 * Returns null for: invalid tokens, non-integer / <=0 counts, extra
 * trailing garbage, or a non-history prefix. The caller detects a
 * leading `/history` with an invalid arg and replies with usage
 * instead of forwarding to the agent.
 */
export declare function parseHistoryCommand(text: string): HistoryCommand | null;
/**
 * True if text looks like a /history attempt (including invalid args),
 * used to decide whether to show usage instead of forwarding to agent.
 */
export declare function isHistoryCommandAttempt(text: string): boolean;
/**
 * True if `text` is a recognized slash command that should BYPASS any
 * pending question/approval card and execute normally.
 *
 * The bridge pre-empts the next user text after a `question/requested` or
 * `approval/requested` frame, treating it as the card's answer. Without
 * this helper, typing a management command (e.g. `/next`) while a card
 * is shown silently submits the command text as the card's custom-text
 * answer (questions) or rejects it as "unrecognized reply" (approvals),
 * dropping the user's real intent.
 *
 * Card-specific commands (`/rq`, leftover `/rp`) are intentionally
 * excluded so they keep card semantics. `/help` is
 * included: its only effect is "print the help text", which
 * `handleMessage` already handles; the card handlers' two duplicate
 * `parseHelpCommand` branches become dead code once `/help` bypasses.
 *
 * Empty text returns false (the empty-text card hint still fires).
 */
export declare function isBypassSlashCommand(text: string): boolean;
/**
 * DSH `ctx.commands` names already documented by the local whitelist
 * below. Used by `formatHelp(nativeCommands)` to de-duplicate the
 * "/xxx — 说明" section so users do not see two rows for the same
 * name (the local row stays the authoritative one because it carries
 * the full subcommand grammar; native rows only describe their
 * discovery-surface description).
 */
export declare const LOCAL_COMMAND_NAMES: ReadonlySet<string>;
/** The /help reply, optionally augmented with native command descriptors. */
export declare function formatHelp(nativeCommands?: ReadonlyArray<{
    name: string;
    description?: string;
    input?: {
        hint?: string;
    };
}>): string;
/**
 * One command's full example list, for WeChat `/help <命令>`.
 *
 * Every example the settings panel shows is listed here too, in the same order
 * and with the same `note` — so a user who reads `/help s` in WeChat sees
 * exactly what the panel's `/session` row expands to.
 *
 * @param topic Command name or any alias, with or without the leading slash.
 * @returns The block, or `null` when `topic` is not a documented command (the
 *   caller then shows the listing instead of inventing an answer).
 */
export declare function helpTopicBlock(topic: string): string | null;
/**
 * Render one projection value into a WeChat-bounded one-liner.
 *
 * The `ctx.sessionProjections.snapshot(session).values` map is
 * `Record<string, unknown>` — the bridge does not (and intentionally
 * cannot) know each plugin's exact shape. Generic rule:
 *
 * - `null` / `undefined` → literal text `null` / `undefined` so users
 *   can see at a glance whether a key has state (vs. being absent).
 * - `string` / `number` / `boolean` / `bigint` → `String(v)`.
 * - `function` / `symbol` → `undefined` (skip — never legitimate value).
 * - everything else (objects, arrays) → `JSON.stringify(v)` in compact
 *   form. If the result is longer than 120 code units, truncate to 117
 *   and append `…` — WeChat per-message cap is 4 KB but a single
 *   projection line should stay readable on phone screens.
 * - circular references / BigInt / values JSON cannot serialize →
 *   `undefined`; the caller skips the key and logs once. We never
 *   surface an unsanitized shape back to the user.
 *
 * Pure function — no I/O, no side effects, fully testable.
 *
 * @param v The projection's view output (schema-validated host side).
 * @returns A WeChat-ready one-liner, or `undefined` to drop the row.
 */
export declare function renderProjectionValue(v: unknown): string | undefined;
/**
 * Render the full projection section that `/status` appends under the
 * "── 会话级状态 ──" banner.
 *
 * Algorithm:
 *   1. For each key (alphabetically sorted within its group), pick a
 *      smart renderer when known or fall back to `renderProjectionValue`.
 *   2. Group keys into `[模式]`, `[用量与统计]`, `[会话]`, `[其它]`
 *      buckets; emit each non-empty bucket as `[label]` + indented
 *      `• key:` lines (with multi-line continuation indented deeper).
 *   3. Empty buckets are dropped. The caller decides whether the
 *      whole section appears.
 *
 * Smart renderer exceptions are caught and downgraded to the JSON
 * fallback for that single key; other keys still render. The caller
 * does not see exceptions and `/status` stays intact.
 *
 * @param values The `snapshot(session).values` map from
 *   `ctx.sessionProjections`.
 * @returns Pre-formatted lines ready to be appended to `/status`.
 *   Empty when `values` has no keys with renderable output.
 */
export declare function renderProjectionSection(values: Record<string, unknown>): string[];
//# sourceMappingURL=slash.d.ts.map