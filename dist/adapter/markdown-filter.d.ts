/**
 * Streaming markdown filter — character-level state machine that strips
 * unsupported markdown syntax on the fly.
 *
 * Ported from Tencent/openclaw-weixin `src/messaging/markdown-filter.ts`
 * (MIT) — https://github.com/Tencent/openclaw-weixin
 *
 * WeChat renders bot text with its own markdown support that differs from
 * ordinary user text, so this filter is deliberately *selective*: it passes
 * most syntax through untouched and only removes the constructs the client
 * cannot render.
 *
 * Constructs passed through (not filtered):
 * - Code fences (```) and inline code (`)
 * - Tables (|...|), links ([text](url)), H1-H4 headings
 * - Horizontal rules (---, ***, ___)
 * - Bold (**) and italic/bold-italic wrapping non-CJK content
 *
 * Constructs filtered (markers stripped, content kept):
 * - Italic/bold-italic wrapping CJK content
 * - Headings H5/H6 (#####, ######)
 * - Images (![alt](url)) — removed entirely
 *
 * Outputs as much filtered text as possible on each `feed()` call, holding
 * back only the minimum characters needed for pattern disambiguation (e.g. a
 * trailing `*` that might still become `***`).
 */
export declare class StreamingMarkdownFilter {
    private buf;
    private fence;
    private sol;
    private inl;
    feed(delta: string): string;
    flush(): string;
    private pump;
    /** Inside a code fence: pass content and markers through verbatim. */
    private pumpFence;
    /** At start of line: detect and consume line-start patterns, then move to body. */
    private pumpSOL;
    /** Scan a line body for inline triggers; emit safe characters eagerly. */
    private pumpBody;
    /** Accumulate inline content until the closing marker is found. */
    private pumpInline;
}
/** CJK ranges used by the upstream filter to decide italic handling. */
export declare function containsCJK(text: string): boolean;
/**
 * Whole-text markdown preparation for one WeChat message.
 *
 * The bridge sends complete segments rather than a token stream, so the
 * streaming state machine is driven once and then flushed: unfinished markers
 * are restored exactly as upstream's `flush()` would.
 */
export declare function filterMarkdown(text: string): string;
//# sourceMappingURL=markdown-filter.d.ts.map