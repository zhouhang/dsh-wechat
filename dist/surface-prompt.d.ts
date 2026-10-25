/**
 * WeChat surface-prompt helpers: session-id extraction for prompt assembly
 * and the model-facing runtime-context text.
 *
 * DSH interpolates `{{variable}}` in runtime-context text; an unknown
 * reference throws and aborts the turn. User-edited prompts must not be
 * able to introduce those groups, so `{{` is broken up before injection.
 */
export declare function sessionIdFrom(session: unknown): string | undefined;
/**
 * Session id for one `systemPrompt.context` evaluation.
 *
 * `assembleContextFor(agent)` still puts the live agent on `context.agent`
 * (and as `context.scope`). The public `AssembleContext` type no longer
 * declares `agent`, so we also accept `scope` and walk the same id paths
 * `sessionIdFrom` uses.
 */
export declare function sessionIdFromAssembleContext(context: unknown): string | undefined;
/** Neutralize DSH `{{variable}}` interpolation in user-authored context text. */
export declare function sanitizeRuntimeContextText(text: string): string;
export declare function weChatSurfaceText(opts: {
    enabled: boolean;
    prompt: string;
    source: "wechat" | "gui" | undefined;
}): string;
//# sourceMappingURL=surface-prompt.d.ts.map