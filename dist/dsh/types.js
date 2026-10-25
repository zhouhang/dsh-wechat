/**
 * Structural types for the DSH service surface this bridge touches.
 *
 * Deliberately local and minimal: the bridge runs as a third-party static
 * plugin and must not import `@deepseek-ai/*` packages at runtime (they are
 * not resolvable from the profile's node_modules). These shapes mirror the
 * documented contracts verified against the running harness.
 */
/**
 * Read the live session log. Prefers `snapshotEvents()` (DSH 0.1.5);
 * falls back to the legacy `events` array when that is all the host
 * exposes.
 */
export function sessionEvents(session) {
    if (!session)
        return [];
    if (typeof session.snapshotEvents === "function") {
        try {
            const snap = session.snapshotEvents();
            if (Array.isArray(snap))
                return snap;
        }
        catch {
            // fall through to the legacy array
        }
    }
    return Array.isArray(session.events) ? session.events : [];
}
/**
 * Fold the host `modelSelection` projection value into a selection.
 *
 * DSH 0.2.1's session controller publishes
 * `{ lastUsed, next }` (both nullable): `next` is the durable
 * `model/selection` the following request should use, `lastUsed` is the
 * selection consumed by the latest recorded request. This is the same
 * pair the GUI model picker and `session.selectModel` operate on, so
 * reading it keeps WeChat on the host-owned selection instead of
 * inventing a second one. Returns `undefined` for absent/malformed
 * values; callers fall back to the session request header, the agent
 * options, or the deployment default.
 */
export function modelSelectionFromProjection(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const projected = value;
    const pick = (candidate) => {
        if (!candidate || typeof candidate !== "object")
            return undefined;
        const entry = candidate;
        if (typeof entry.provider !== "string" || typeof entry.model !== "string")
            return undefined;
        return {
            provider: entry.provider,
            model: entry.model,
            ...(typeof entry.reasoningEffort === "string"
                ? { reasoningEffort: entry.reasoningEffort }
                : {}),
        };
    };
    return pick(projected.next) ?? pick(projected.lastUsed);
}
//# sourceMappingURL=types.js.map