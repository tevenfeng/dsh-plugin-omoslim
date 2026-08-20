window.__ModuleLoader__.load({
	id: "dsh-plugin-omoslim",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region lib/client.js
		/**
		 * Subagent Models - browser half.
		 *
		 * Adds a small "Subagent models" pill button to the conversation composer's
		 * right list seat (immediately left of the model selector). Clicking it
		 * opens a popover that lazily fetches the active subagent model
		 * configuration from the server endpoint and lists each configured slot,
		 * its resolved model/provider, and whether it is inherited from the main
		 * agent.
		 *
		 * Data is (re)fetched on every open for freshness. CSS lives in one owned
		 * <style> element appended to <head> and is removed on plugin stop. The
		 * bundle runtime has no `styles` builtin (dynamic-package only), so the
		 * stylesheet is injected manually.
		 */
		const react = require("react");

		/** Required services before mounting. */
		const inject = ["slots"];

		const ENDPOINT = "/dsh-plugin-omoslim/subagent-models";

		const isZh = (navigator.language || "").startsWith("zh");
		const TITLE = isZh ? "Subagent 模型" : "Subagent models";
		const LOADING = "Loading…";
		const EMPTY = "No subagent slots configured.";
		const INHERITED = "继承(主 agent)";

		const STATIC_CSS =
			".omoslim-root{position:relative;display:inline-block}" +
			".omoslim-trigger{min-width:0;max-width:220px;height:28px;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;justify-content:center;align-items:center;gap:4px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}" +
			".omoslim-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
			".omoslim-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3,var(--dsw-alias-border-l2))}" +
			".omoslim-panel{position:absolute;top:auto;bottom:calc(100% + 8px);right:0;z-index:50;width:max-content;min-width:220px;max-width:min(300px,calc(100vw - 24px));max-height:320px;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-specific-menu,var(--dsw-alias-bg-popover));border:1px solid var(--dsw-alias-border-inverted,var(--dsw-alias-border-l2));border-radius:12px;box-shadow:var(--dsw-shadow-lv3,var(--dsw-alias-shadow-popover));color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:20px}" +
			".omoslim-header{flex:0 0 auto;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-inverted));font-weight:500;color:var(--dsw-alias-label-primary);font-size:12px;letter-spacing:0.02em;white-space:nowrap}" +
			".omoslim-body{flex:1 1 auto;min-height:0;padding:6px;overflow-y:auto;overflow-x:hidden;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);scrollbar-width:thin;scrollbar-color:var(--dsh-scrollbar-thumb) transparent}" +
			".omoslim-body::-webkit-scrollbar{width:8px}" +
			".omoslim-body::-webkit-scrollbar-thumb{background:var(--dsh-scrollbar-thumb);border-radius:4px}" +
			".omoslim-body::-webkit-scrollbar-track{background:0 0}" +
			".omoslim-row{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border-radius:8px}" +
			".omoslim-row:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
			".omoslim-slotName{font-family:var(--dsw-font-family-mono,ui-monospace,monospace);color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}" +
			".omoslim-slotModel{color:var(--dsw-alias-label-primary);white-space:normal;word-break:break-all}" +
			".omoslim-inherited{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}" +
			".omoslim-footer{flex:0 0 auto;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-inverted));color:var(--dsw-alias-label-secondary);font-size:11px}" +
			".omoslim-footerLine{white-space:normal;word-break:break-word;line-height:1.45;overflow-wrap:anywhere}" +
			".omoslim-state{padding:16px 12px;color:var(--dsw-alias-label-tertiary);text-align:center;font-size:12px}" +
			".omoslim-error{color:var(--dsw-alias-state-error-primary,#ff6b6b)}";

		/** Fetch the subagent model config; throws with a message on any error. */
		async function fetchModels() {
			const res = await fetch(ENDPOINT);
			let json = null;
			try {
				json = await res.json();
			} catch {
				json = null;
			}
			if (!res.ok) {
				if (json && json.error) throw new Error(json.error);
				throw new Error("HTTP " + res.status);
			}
			return json;
		}

		const ORCHESTRATOR_PRESET_ID = "orchestrator";

		function SubagentModelsButton({ session, useSessions }) {
			// Show only when the current session runs the omoslim orchestrator
			// preset — these subagent slots don't exist under dsh's own presets
			// or third-party presets, so showing the inspector would mislead.
			// agentPreset/blank come from the sessions store (the same source the
			// agent-preset UI reads) — via `session` (ownerProps) when present,
			// else the guaranteed `useSessions` standard hook from the kit.
			const sid = session && session.id;
			const storePreset = useSessions((s) => (sid === void 0 ? void 0 : s.byId[sid]?.agentPreset));
			const agentPreset = (session && session.agentPreset) !== void 0 ? session.agentPreset : storePreset;
			const blank = (session && session.blank) === true;
			const [state, setState] = react.useState({
				open: false,
				data: null,
				loading: false,
				fetchError: null
			});
			const panelRef = react.useRef(null);
			const triggerRef = react.useRef(null);

			const startOpen = () => setState((s) => ({ ...s, open: true, loading: true, fetchError: null }));
			const toggle = () => {
				if (state.open) {
					setState((s) => ({ ...s, open: false }));
					return;
				}
				startOpen();
			};

			// Re-fetch on every open for freshness.
			react.useEffect(() => {
				if (!state.open) return;
				let cancelled = false;
				fetchModels().then(
					(data) => { if (!cancelled) setState((s) => ({ ...s, data, loading: false })); },
					(err) => { if (!cancelled) setState((s) => ({ ...s, fetchError: err && err.message ? err.message : String(err), loading: false })); }
				);
				return () => { cancelled = true; };
			}, [state.open]);

			// Close on outside click.
			react.useEffect(() => {
				if (!state.open) return;
				const onDocMouseDown = (e) => {
					const panel = panelRef.current;
					const trigger = triggerRef.current;
					if (panel && panel.contains(e.target)) return;
					if (trigger && trigger.contains(e.target)) return;
					setState((s) => ({ ...s, open: false }));
				};
				document.addEventListener("mousedown", onDocMouseDown);
				return () => document.removeEventListener("mousedown", onDocMouseDown);
			}, [state.open]);

			// Close on Escape.
			react.useEffect(() => {
				if (!state.open) return;
				const onKeyDown = (e) => {
					if (e.key === "Escape") setState((s) => ({ ...s, open: false }));
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [state.open]);

			// Hide on a blank/new-session screen: no composition is mounted yet and
			// a preset pick there is only "staged" (never written to a session
			// store), so gate on `blank` instead of trusting store agentPreset.
			// Then hide when we positively know another preset is in use. Unknown
			// (store not yet synced on first paint) → show, so a running
			// orchestrator session reliably gets the button. Placed after every
			// hook to keep the hook order stable across renders.
			if ((session && session.blank) === true) return null;
			if (agentPreset !== void 0 && agentPreset !== ORCHESTRATOR_PRESET_ID) return null;

			const { open, data, loading, fetchError } = state;
			const errorText = fetchError != null ? fetchError : (data && data.error) || null;
			const slots = data && data.slots ? data.slots : [];

			const rows = slots.map((item, idx) => {
				const provider = item.provider || null;
				const children = [];
				children.push(react.createElement("span", { key: "name", className: "omoslim-slotName" }, item.slot));
				children.push(react.createElement("span", { key: "model", className: "omoslim-slotModel" },
					provider ? provider + "/" + item.model : item.model
				));
				if (item.inherited) {
					children.push(react.createElement("span", { key: "inherited", className: "omoslim-inherited" }, INHERITED));
				}
				return react.createElement("div", { key: idx, className: "omoslim-row" }, children);
			});

			return react.createElement("div", { className: "omoslim-root" },
				react.createElement("button", {
					ref: triggerRef,
					type: "button",
					className: "omoslim-trigger",
					onClick: toggle,
					title: TITLE,
					"aria-label": TITLE,
					"aria-expanded": open,
					"aria-haspopup": "dialog"
				},
					react.createElement("svg", {
						width: 16,
						height: 16,
						viewBox: "0 0 16 16",
						fill: "currentColor",
						"aria-hidden": "true"
					},
						react.createElement("rect", { x: 2, y: 10, width: 12, height: 2, rx: 1 }),
						react.createElement("rect", { x: 3, y: 6, width: 10, height: 2, rx: 1 }),
						react.createElement("rect", { x: 4, y: 2, width: 8, height: 2, rx: 1 })
					),
					react.createElement("span", null, TITLE)
				),
				open && react.createElement("div", {
					className: "omoslim-panel",
					role: "dialog",
					"aria-label": TITLE,
					ref: panelRef
				},
					react.createElement("div", { className: "omoslim-header" },
						"orchestrator · active: " + (data ? data.active : "")
					),
					react.createElement("div", { className: "omoslim-body" },
						loading && react.createElement("div", { className: "omoslim-state" }, LOADING),
						!loading && errorText != null && react.createElement("div", { className: "omoslim-state omoslim-error" }, errorText),
						!loading && errorText == null && slots.length === 0 &&
							react.createElement("div", { className: "omoslim-state" }, EMPTY),
						!loading && errorText == null && rows
					),
					react.createElement("div", { className: "omoslim-footer" },
						react.createElement("div", { className: "omoslim-footerLine" },
							"Profiles: " + (data && data.profiles ? data.profiles.join(", ") : "")),
						react.createElement("div", { className: "omoslim-footerLine" },
							(isZh ? "切换命令行：" : "Switch via ") + "`omoslim switch <name>`")
					)
				)
			);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;

			const styleEl = document.createElement("style");
			styleEl.dataset.plugin = "dsh-plugin-omoslim";
			styleEl.textContent = STATIC_CSS;
			document.head.appendChild(styleEl);

			ctx.effect(() => () => {
				styleEl.remove();
			}, "dsh-plugin-omoslim: style element");

			slots.inject("conversation.input.right", () => slots.register(
				{
					name: "conversation.input.right",
					id: "omoslim-subagent-models",
					order: 0,
					inject: (sessionId) => ({ sessionId })
				},
				SubagentModelsButton
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		//#endregion
		return module.exports;
	}
});
