/**
 * dsh-wechat — Bridge WeChat (iLink bot) to DeepSeek Harness (DSH).
 *
 * Cordis host plugin entry. Loaded through the package's cordis.patch.yml
 * bundle layer (`- insert: - id: dsh-wechat name: 'dsh-wechat'`).
 *
 * Zero runtime dependencies on `@deepseek-ai/*` packages: every DSH
 * service is read through `ctx.get(...)` and all message/value types are
 * constructed by local vendors or structural shapes.
 */
import { WeChatDSHBridge } from "./bridge/bridge.js";
import { formatHelp } from "./bridge/slash.js";
import { helpCatalog } from "./help-catalog.js";
import { ConfigStore } from "./config-store.js";
import { defaultConfig } from "./config.js";
import { qrSvgFor } from "./qr.js";
import { sessionIdFrom, sessionIdFromAssembleContext, weChatSurfaceText } from "./surface-prompt.js";
export { sessionIdFrom };
export const name = "dsh-wechat";
export const inject = [];
export function apply(ctx, rawConfig = {}) {
    const baseConfig = {
        ...defaultConfig(),
        ...pickDefined(rawConfig),
    };
    const configStore = new ConfigStore(baseConfig.storageDir);
    const config = configStore.resolve(baseConfig);
    const context = ctx;
    const bridge = new WeChatDSHBridge(context, config, undefined, configStore);
    // ─── Session event feed: assistant output → WeChat ───
    context.on("session/event", (session, event) => {
        const sessionId = sessionIdFrom(session);
        if (!sessionId) {
            console.warn("[dsh-wechat] session/event dropped: no session id on payload");
            return;
        }
        bridge.handleSessionEvent(sessionId, event);
    });
    console.log("[dsh-wechat] session/event listener attached");
    context.on("agent/assistant-stream", (payload) => {
        const { agent, frame } = payload;
        if (agent?.id && frame)
            bridge.handleAssistantStream(agent.id, frame);
    });
    context.on("session/disposed", (session) => {
        const sessionId = sessionIdFrom(session);
        if (sessionId)
            bridge.clearSessionOutput(sessionId);
    });
    // ─── Agent idleness → 结论模式 (final-only) quiescence ───
    // The goal round-driver wakes the NEXT round exactly when `agent.status`
    // flips to `idle`, so this is also the signal that tells the hold "more
    // rounds are coming" (running cancels the countdown) versus "the task is
    // genuinely finished" (idle arms it). `agent.id` IS the session id in DSH
    // (`Agent.id: SessionId`), so no session lookup is needed.
    context.on("agent/status", (payload) => {
        const data = payload;
        const sessionId = data?.agent?.id;
        const status = data?.status;
        if (!sessionId || !status)
            return;
        bridge.handleAgentStatus(sessionId, status);
    });
    // ─── Agent errors → WeChat notification ───
    context.on("agent/error", (payload) => {
        const agentId = payload?.agent?.id;
        if (!agentId)
            return;
        bridge.handleAgentError(agentId, payload?.error);
    });
    // ─── Model overrides: /model switch applies to the live agent's next
    // request by rewriting the frozen call config (same cooperative pattern
    // as dsh-agent's installModelSelection: await next(), then replace). ───
    context.on("agent/request", async (payload, next) => {
        const agentId = payload?.agent?.id;
        const nextFn = next;
        const config = await nextFn();
        if (!agentId || !bridge.userForAgent(agentId))
            return config;
        return bridge.applyModelOverride(config, agentId);
    });
    // ─── send_wechat tool: agent-initiated push to the bound user ───
    // (Approval/question cards are fully native — the Host waterfalls below
    // race WeChat against the GUI so whoever answers first wins.)
    //
    // The registration ALWAYS goes through `ctx.effect` / the `ctx.inject`
    // fiber so its disposer is parked on the plugin's fiber: `register()`
    // returns the exact disposer that unregisters the tool, and discarding
    // it leaves `send_wechat` bound to a stale bridge after the plugin is
    // reloaded or removed. Both paths dispose identically — `effect` gives
    // the disposer an explicit, labelled owner and is the host's own idiom
    // (see `packages/host/open-in-app`).
    if (typeof context.inject === "function") {
        context.inject(["tools"], (toolsCtx) => {
            const toolsService = toolsCtx.get("tools");
            if (!toolsService)
                return;
            const registerSendWechatTool = () => {
                const dispose = toolsService.register({
                    name: "send_wechat",
                    description: "Send a text message or a local file to a WeChat user. " +
                        "If the calling session is bound to a WeChat user, the message goes to that user; " +
                        "otherwise it goes to the first known WeChat user (single-user deployments are the norm). " +
                        "Use this to proactively push results, confirmations, or files to WeChat. " +
                        "A file must live inside the calling session's working directory or a registered " +
                        "workspace, and must be under the configured size limit; anything else is refused.",
                    parameters: {
                        type: "object",
                        properties: {
                            text: {
                                type: "string",
                                description: "The text message to send to WeChat.",
                            },
                            file_path: {
                                type: "string",
                                description: "Path of a local file to send to WeChat. Must resolve inside the calling "
                                    + "session's working directory or a registered workspace (unless the operator "
                                    + "enabled allowAnyFilePath), and must fit maxOutgoingFileBytes.",
                            },
                        },
                    },
                    output: {
                        schema: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                                ok: { type: "boolean" },
                                message: { type: "string" },
                            },
                        },
                        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
                    },
                    async execute(args, exec) {
                        return bridge.handleSendWeChat(exec.agent?.id ?? "", args);
                    },
                });
                return () => {
                    if (typeof dispose === "function")
                        dispose();
                };
            };
            if (typeof context.effect === "function") {
                context.effect(registerSendWechatTool);
            }
            else {
                // Legacy host without `ctx.effect`: `register()` still binds the
                // tool to the calling (injected) scope, and `ctx.inject` returns
                // the child fiber that owns it, so unload already unregisters it.
                registerSendWechatTool();
            }
        });
    }
    else {
        console.warn("[dsh-wechat] ctx.inject unavailable; send_wechat tool disabled");
    }
    // ─── Approval / question cards: Host waterfalls (GUI-equivalent mirror) ───
    // Untagged listeners are admitted globally by scopeTarget, so a host-level
    // answerer sees every session. prepend:true so we wrap next() (the GUI
    // terminal answerer) instead of running after it. No WeChat peer →
    // immediately next() so the GUI remains the sole answerer. Errors fall
    // through to next() rather than collapsing the GUI card.
    context.on("approval/request", async (req, next) => {
        const nextFn = next;
        try {
            return await bridge.answerApprovalRequest(req, nextFn);
        }
        catch (err) {
            console.error(`[dsh-wechat] approval/request answerer failed: ${String(err)}`);
            return nextFn();
        }
    }, { prepend: true });
    context.on("user-questions/request", async (req, next) => {
        const nextFn = next;
        try {
            return await bridge.answerQuestionRequest(req, nextFn);
        }
        catch (err) {
            // WeChat /rq cancels by rejecting the waiter; rethrow so the Host
            // settles the ask. ASK_CANCELLED = user closed the card (Web X);
            // ASK_ABORTED = turn/signal abort. Other failures fall through to GUI.
            const code = err && typeof err === "object" ? err.code : undefined;
            if (code === "ASK_CANCELLED" || code === "ASK_ABORTED") {
                throw err;
            }
            console.error(`[dsh-wechat] user-questions/request answerer failed: ${String(err)}`);
            return nextFn();
        }
    }, { prepend: true });
    console.log("[dsh-wechat] approval/question waterfall answerers attached");
    // ─── DSH native command registry (ctx.commands) ───
    // When the host composes `@deepseek-ai/dsh-commands`, late-bind the
    // command surface so WeChat can dispatch `/plan`, `/goal`, `/compact`
    // and any other plugin-registered slash command through the same
    // native handler the GUI uses. If the registry is not composed
    // (minimal headless profiles, host version drift, etc.) we fall through
    // to the local whitelist exactly like before — no behavioral change.
    if (typeof context.inject === "function") {
        context.inject(["commands"], (cmdCtx) => {
            const commands = cmdCtx.get("commands");
            if (!commands) {
                console.warn("[dsh-wechat] ctx.commands unavailable; 原生命令层禁用，回落到本地白名单");
                return;
            }
            // Cast through the bridge's structural surface — we never reference
            // the actual `@deepseek-ai/dsh-commands` types here, so zero runtime
            // dep is added.
            bridge.attachCommands(commands);
            console.log("[dsh-wechat] 原生命令层已挂载 (/plan、/goal 等通过 ctx.commands 分发)");
        });
    }
    else {
        console.warn("[dsh-wechat] ctx.inject unavailable; 原生命令层禁用，回落到本地白名单");
    }
    // ─── Dynamic WeChat surface prompt (per-message-source) ───
    // Registered as a GLOBAL RUNTIME CONTEXT (not a prompt section): DSH's
    // system-prompt assembly applies a "complete-section replacement" pass to
    // sections (a preset's complete section replaces ALL ordinary sections,
    // which would drop a section-registered surface prompt — exactly the
    // failure observed), while CONTEXTS are assembled on an independent path
    // ("Current runtime context" snapshot) that complete replacement never
    // touches. The context text is evaluated per assembly: the bridge tracks
    // the most recent user-message source per session, and the context returns
    // the WeChat prompt ONLY while the session's last user message came from
    // WeChat; otherwise it returns "" (empty contexts are filtered out, so
    // GUI-driven assemblies are untouched). Global registration means EVERY
    // agent — old or new, GUI- or WeChat-created, live or resumed — gets the
    // same dynamic context, so the WeChat prompt follows the message source
    // rather than the session's setup path.
    if (typeof context.inject === "function") {
        context.inject(["systemPrompt"], (promptCtx) => {
            const systemPrompt = promptCtx.get("systemPrompt");
            if (!systemPrompt) {
                console.warn("[dsh-wechat] systemPrompt unavailable; WeChat surface prompt disabled");
                return;
            }
            systemPrompt.context({
                name: "dsh-wechat-surface",
                order: 50,
                text: (context) => {
                    const sessionId = sessionIdFromAssembleContext(context);
                    const source = sessionId ? bridge.surfaceSourceFor(sessionId) : undefined;
                    const cfg = bridge.getConfig();
                    return weChatSurfaceText({
                        enabled: cfg.surfacePromptEnabled,
                        prompt: cfg.surfacePrompt,
                        source,
                    });
                },
            });
        });
    }
    // ─── QR page + settings-page API ───
    // The webserver row activates only after `webStartup` resolves (it waits on
    // inject), so `ctx.get('webServer')` at apply time is undefined. Use the
    // conditional-inject pattern to register the routes once the service is
    // available; the bridge itself works without them (QR URL is logged).
    if (typeof context.inject === "function") {
        context.inject(["webServer"], (httpCtx) => {
            const webServer = httpCtx.get("webServer");
            if (!webServer)
                return;
            // QR login page (standalone viewer; the settings page is the primary UI).
            webServer.register({
                kind: "exact",
                path: "/wechat/qr",
                handler: (_req, res) => {
                    const response = res;
                    response.setHeader("Content-Type", "text/html; charset=utf-8");
                    response.setHeader("Cache-Control", "no-store");
                    response.end(QR_PAGE);
                },
            });
            // QR image: the iLink qrcode_img_content URL is an HTML page, not an
            // image — the URL string is encoded into a QR server-side instead.
            webServer.register({
                kind: "exact",
                path: "/wechat/api/qr-image",
                handler: (_req, res) => {
                    const status = bridge.getStatus();
                    const response = res;
                    if (!status.qrUrl) {
                        response.statusCode = 404;
                        response.setHeader("Content-Type", "text/plain; charset=utf-8");
                        response.setHeader("Cache-Control", "no-store");
                        response.end("no QR available");
                        return;
                    }
                    response.statusCode = 200;
                    response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
                    response.setHeader("Cache-Control", "no-store");
                    response.end(qrSvgFor(status.qrUrl));
                },
            });
            // QR page poll endpoint (phase/qrUrl/botId/error).
            webServer.register({
                kind: "exact",
                path: "/wechat/status",
                handler: (_req, res) => {
                    sendJson(res, 200, bridge.getStatus());
                },
            });
            // Settings-page API.
            webServer.register({
                kind: "exact",
                path: "/wechat/api/status",
                handler: (_req, res) => {
                    sendJson(res, 200, bridge.getStatus());
                },
            });
            webServer.register({
                kind: "exact",
                path: "/wechat/api/help",
                handler: (_req, res) => {
                    // `text` stays the verbatim `/help` reply (the WeChat side and any
                    // older client keep working); `catalog` is the settings page's
                    // plain-language view of the same command set. Both come from this
                    // install, so they cannot disagree about which commands exist —
                    // `tests/help-catalog.test.ts` pins the two sets together.
                    sendJson(res, 200, { ok: true, text: formatHelp(), catalog: helpCatalog() });
                },
            });
            webServer.register({
                kind: "exact",
                path: "/wechat/api/config",
                handler: async (req, res) => {
                    try {
                        const patch = (await readJsonBody(req));
                        const stored = configStore.update(patch);
                        const result = await bridge.updateConfig(stored);
                        sendJson(res, 200, { ok: true, ...result });
                    }
                    catch (err) {
                        sendJson(res, 400, { ok: false, message: String(err) });
                    }
                },
            });
            webServer.register({
                kind: "exact",
                path: "/wechat/api/relogin",
                handler: async (_req, res) => {
                    const result = await bridge.relogin();
                    sendJson(res, 200, { ok: result.ok, message: result.message });
                },
            });
            webServer.register({
                kind: "exact",
                path: "/wechat/api/logout",
                handler: async (_req, res) => {
                    const result = await bridge.logout();
                    sendJson(res, 200, { ok: result.ok, message: result.message });
                },
            });
            // Per-user toggles (silent / crossSessionNotify) for the WebUI
            webServer.register({
                kind: "prefix",
                path: "/wechat/api/user/",
                handler: async (req, res) => {
                    try {
                        const httpReq = req;
                        const rawUrl = (httpReq.url ?? httpReq.path ?? "");
                        const prefix = "/wechat/api/user/";
                        const after = rawUrl.startsWith(prefix) ? rawUrl.slice(prefix.length) : rawUrl.split("/").pop() ?? "";
                        const userId = decodeURIComponent(after.split("?")[0].split("#")[0].trim());
                        if (!userId) {
                            sendJson(res, 400, { ok: false, message: "缺少 userId" });
                            return;
                        }
                        const patch = (await readJsonBody(req));
                        const normalized = {};
                        if (typeof patch.silent === "boolean")
                            normalized.silent = patch.silent;
                        if (patch.crossSessionNotify === "on" || patch.crossSessionNotify === "off" || patch.crossSessionNotify === "inherit") {
                            normalized.crossSessionNotify = patch.crossSessionNotify;
                        }
                        const result = bridge.updateUserConfig(userId, normalized);
                        sendJson(res, result.ok ? 200 : 400, result);
                    }
                    catch (err) {
                        sendJson(res, 400, { ok: false, message: String(err) });
                    }
                },
            });
            webServer.register({
                kind: "exact",
                path: "/wechat/api/user",
                handler: async (req, res) => {
                    try {
                        const patch = (await readJsonBody(req));
                        const userId = typeof patch.userId === "string" ? patch.userId.trim() : "";
                        if (!userId) {
                            sendJson(res, 400, { ok: false, message: "缺少 userId" });
                            return;
                        }
                        const normalized = {};
                        if (typeof patch.silent === "boolean")
                            normalized.silent = patch.silent;
                        if (patch.crossSessionNotify === "on" || patch.crossSessionNotify === "off" || patch.crossSessionNotify === "inherit") {
                            normalized.crossSessionNotify = patch.crossSessionNotify;
                        }
                        const result = bridge.updateUserConfig(userId, normalized);
                        sendJson(res, result.ok ? 200 : 400, result);
                    }
                    catch (err) {
                        sendJson(res, 400, { ok: false, message: String(err) });
                    }
                },
            });
            console.log("[dsh-wechat] Settings UI available: 设置 → WeChat；扫码页 http://127.0.0.1:3080/wechat/qr");
        });
    }
    else {
        console.log("[dsh-wechat] ctx.inject unavailable; QR page disabled (login QR is logged)");
    }
    // Start the bridge (token resume or QR login), stop on dispose.
    void bridge.start().catch((err) => {
        console.error(`[dsh-wechat] bridge start failed: ${String(err)}`);
    });
    return () => bridge.stop();
}
function pickDefined(raw) {
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
}
function sendJson(res, status, body) {
    const response = res;
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(body));
}
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const stream = req;
        stream.on("data", (chunk) => {
            if (typeof chunk === "string")
                chunks.push(Buffer.from(chunk));
            else if (chunk instanceof Uint8Array)
                chunks.push(Buffer.from(chunk));
        });
        stream.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            if (!raw.trim()) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            }
            catch (err) {
                reject(new Error(`invalid JSON body: ${String(err)}`));
            }
        });
        stream.on("error", reject);
    });
}
/** Standalone QR login page (no client build needed). */
const QR_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DSH 微信登录</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; padding: 2rem; }
  .card { background: #fff; border-radius: 12px; padding: 2rem; max-width: 420px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,.08); text-align: center; }
  h1 { font-size: 1.2rem; margin: 0 0 .5rem; }
  .state { color: #666; margin: 1rem 0; min-height: 1.5em; }
  img.qr { width: 260px; height: 260px; border: 1px solid #eee; border-radius: 8px; }
  .error { color: #c0392b; white-space: pre-wrap; }
  .ok { color: #27ae60; font-weight: 600; }
  button.retry { display: none; margin: .5rem 0 0; padding: .5rem 1rem; border: 0; border-radius: 8px; background: #07c160; color: #fff; font-size: .9rem; cursor: pointer; }
  button.retry[disabled] { opacity: .6; cursor: default; }
</style>
</head>
<body>
<div class="card">
  <h1>📱 DSH 微信助手 — 扫码登录</h1>
  <div id="state" class="state">正在获取二维码…</div>
  <img id="qr" class="qr" alt="QR" style="display:none" />
  <div id="err" class="error"></div>
  <button id="retry" class="retry">重新生成二维码</button>
  <p style="color:#999;font-size:.8rem">用微信扫描二维码，确认登录后本页自动刷新。二维码约 5 分钟有效，过期会自动换一张。</p>
</div>
<script>
  async function poll() {
    try {
      const res = await fetch('/wechat/status');
      const data = await res.json();
      const state = document.getElementById('state');
      const qr = document.getElementById('qr');
      const err = document.getElementById('err');
      const retry = document.getElementById('retry');
      err.textContent = '';
      if (data.phase === 'logged-in') {
        state.className = 'state ok';
        state.textContent = '✅ 已登录 (Bot: ' + (data.botId || '') + ')';
        qr.style.display = 'none';
        retry.style.display = 'none';
        return;
      }
      if (data.phase === 'failed') {
        // The bridge re-arms the flow every few seconds; keep polling so a
        // fresh QR replaces this notice without the user reloading.
        state.className = 'state';
        state.textContent = '登录已过期，正在自动换一张…';
        err.textContent = data.error || '';
        qr.style.display = 'none';
        retry.style.display = 'inline-block';
      } else {
        retry.style.display = 'none';
        if (data.phase === 'scaned') {
          state.textContent = '已扫码，请在微信中确认…';
        } else {
          state.textContent = data.qrUrl ? '请用微信扫描下方二维码' : '正在获取二维码…';
        }
        if (data.qrUrl) {
          qr.src = '/wechat/api/qr-image?v=' + encodeURIComponent(data.qrUrl);
          qr.style.display = 'block';
        }
      }
    } catch (e) {
      document.getElementById('state').textContent = '无法连接 DSH（' + e + '）';
    }
    setTimeout(poll, 2000);
  }
  document.getElementById('retry').addEventListener('click', async () => {
    const btn = document.getElementById('retry');
    btn.disabled = true;
    btn.textContent = '正在重新生成…';
    try { await fetch('/wechat/api/relogin', { method: 'POST' }); } catch (e) { /* the poll below reports it */ }
    btn.disabled = false;
    btn.textContent = '重新生成二维码';
    btn.style.display = 'none';
  });
  poll();
</script>
</body>
</html>`;
//# sourceMappingURL=index.js.map