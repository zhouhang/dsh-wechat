/**
 * The command-help catalog — the SINGLE source of every user-facing help
 * string, shared by the DSH WebUI settings panel and WeChat `/help`.
 *
 * Two consumers, one source:
 *
 *   - The settings page (「指令帮助」) reads it as JSON from
 *     `/wechat/api/help` (`catalog`) and renders 6 groups, 21 commands and
 *     every example, with a `?` on each row.
 *   - WeChat's `/help` renders the SAME data as Markdown: a one-line-per-command
 *     listing (`formatHelp()`), plus `/help <命令>` for one command's full
 *     example list (`helpTopicBlock()`), both in `bridge/slash.ts`.
 *
 * So a wording change here lands in both places at once, and neither side can
 * document a command the other has never heard of.
 *
 * Rules for editing (all enforced by `tests/help-catalog.test.ts`):
 *
 *   - Every local command in `formatHelp()` must appear here, and vice versa
 *     (the drift guard).
 *   - Every entry in `subcommands` must have at least one example using it, so
 *     a new subcommand cannot be documented by its absence.
 *   - Every `kind: "command"` example must actually be recognized by the
 *     bridge's slash parsers — the help must never advertise a line that the
 *     bridge would forward to the agent as chat.
 *   - Examples contain no `<placeholder>` angle brackets: a user copies a line
 *     and sends it. Concrete sample values are labelled in `note`.
 *   - `summary` is one sentence, ≤ 40 characters, no implementation jargon.
 *   - `aliases` holds SHORTENINGS only — a second full word is not listed even
 *     though the parser accepts it.
 */
export type HelpGroupId = "basics" | "navigate" | "model" | "pacing" | "reference" | "card";
export interface HelpGroup {
    id: HelpGroupId;
    title: string;
    blurb: string;
}
/**
 * One example line.
 *
 * `kind` is `"command"` for a real slash command the bridge recognizes, and
 * `"text"` for plain text the user types (the `..` / `!!` merge suffixes are
 * message text, not commands — calling them commands would be a lie the test
 * suite cannot catch any other way).
 */
export interface HelpExample {
    line: string;
    note: string;
    kind?: "command" | "text";
}
export interface HelpCommandEntry {
    id: string;
    /** Leading-slash spelling, e.g. `/session`. */
    command: string;
    /**
     * Alternate spellings the bridge accepts, without the slash.
     *
     * Only SHORTENINGS belong here (`s`, `ws`, `p`, `sl`, `fo`, `f`, `mg`,
     * `md`, `h`, `?`). A second full word (`permission`, `busy`, `watch`,
     * `notice`, `wxprompt`) is deliberately NOT listed: the parser still accepts
     * it, but showing `/notify (watch, notice)` reads as three commands in a row
     * and made the WeChat `/help` listing unreadable.
     */
    aliases: string[];
    /**
     * One short, neutral sentence: what the command does.
     *
     * Written in a technical register, not conversational prose — the SAME
     * string is rendered in the settings panel AND in WeChat's `/help` table, so
     * "别憋了，现在就把暂存的结论发给我" would read as chatty noise in a
     * monospace listing. Aim for "立即发送暂存的结论": short, plain, no slang.
     */
    summary: string;
    /** Grammar string, shown as secondary text once the row is expanded. */
    usage: string;
    /**
     * Canonical subcommand keywords. Every one of them must be exercised by an
     * example (see the coverage test) — this is the field that keeps a
     * multi-subcommand entry from being documented by three of its ten forms.
     */
    subcommands: string[];
    examples: HelpExample[];
    group: HelpGroupId;
}
export interface HelpCatalog {
    intro: string;
    footer: string;
    groups: HelpGroup[];
    commands: HelpCommandEntry[];
}
/**
 * The catalog, as a JSON-safe snapshot.
 *
 * Returned as fresh objects so a consumer (or a test) mutating its copy can
 * never change what the next request serves — the browser half and the WeChat
 * `/help` text are two views of the same install.
 */
export declare function helpCatalog(): HelpCatalog;
/**
 * The shortest spelling of a command: the command name itself or its shortest
 * alias, with the leading slash. `/session` → `/s`, `/perm` → `/perm`.
 *
 * WeChat's `/help` uses this for BOTH the command head and every subcommand it
 * lists (`/s list`, `/md at`), so a reader never sees a long spelling where a
 * short one exists.
 */
export declare function shortestSpelling(entry: HelpCommandEntry): string;
/**
 * Find a catalog entry by any spelling it accepts, case-insensitively.
 *
 * Used by WeChat's `/help <topic>`: the user may type `/help session`,
 * `/help s`, or `/help SESSION`. Returns `undefined` for an unknown topic so
 * the caller can fall back to the listing instead of inventing an answer.
 */
export declare function findHelpEntry(topic: string): HelpCommandEntry | undefined;
//# sourceMappingURL=help-catalog.d.ts.map