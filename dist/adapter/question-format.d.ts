/**
 * Question formatting and parsing, adapted to DSH's user-questions types.
 *
 * Ported from wechat-opencode (MIT) —
 * https://github.com/pan17/wechat-opencode (src/adapter/question-format.ts)
 *
 * Public functions:
 *   - formatQuestionForWeChat(items) — render prompts for WeChat display
 *   - parseQuestionReply(text, items) — parse user reply into answers
 *
 * Parsing strategy (from the reference):
 *   Step 0 (format detection, priority order):
 *     1. Qn-format    — input contains "Q\d+\s*[=\-]"; each Qn routed to a question
 *     2. dash-format  — questions.length > 1 AND input contains "---"; positional
 *     3. single       — questions.length === 1; whole input = that question's answer
 *     4. fallback     — multi-question, no Qn/---: first segment = Q1, rest = defaults
 */
import type { AskUserQuestionAnswer, AskUserQuestionItem } from "../dsh/types.js";
export interface ParseResult {
    /**
     * Per-question answers. `answers.length === items.length`. Each inner
     * array contains the selected option labels (or a single custom string).
     */
    answers: string[][];
    /**
     * True if every question got a non-empty answer (either explicit or
     * via default). False if any question is empty.
     */
    allAnswered: boolean;
    /** Non-fatal diagnostics. Logged for the operator; never throw. */
    warnings: string[];
}
/**
 * Render a question (or set of questions) as a WeChat-friendly plain-text
 * message. The output stays within the 4000-char WeChat chunk limit and
 * uses emoji + indentation for visual structure.
 */
export declare function formatQuestionForWeChat(items: ReadonlyArray<AskUserQuestionItem>): string;
/**
 * Parse a WeChat user reply into per-question answers. See file-header
 * JSDoc for the 4-strategy detection logic.
 */
export declare function parseQuestionReply(input: string, items: ReadonlyArray<AskUserQuestionItem>): ParseResult;
/**
 * Convert the parse-internal string[] answers into DSH answer items.
 * Callers pass the same items array they passed to `parseQuestionReply`.
 */
export declare function buildAnswer(parsed: ParseResult, items: ReadonlyArray<AskUserQuestionItem>): AskUserQuestionAnswer;
//# sourceMappingURL=question-format.d.ts.map