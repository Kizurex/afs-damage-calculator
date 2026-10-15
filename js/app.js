(function () {
	"use strict";

	const data = window.GAME_DATA;
	const changelog = Array.isArray(window.GAME_CHANGELOG) ? window.GAME_CHANGELOG : [];
	const Engine = window.Engine;
	const CUSTOM = Engine.CUSTOM_ID;
	const STORAGE_KEY = "afs-damage-calculator-v2";
	const THEME_KEY = "afs-damage-calculator-theme";
	const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc", "Ud", "Dd", "Td", "Qad", "Qid", "Sxd", "Spd", "Ocd", "Nod", "Vg"];
	const KIND_LABELS = {
		Authority: "Authorities",
		Bloodline: "Bloodlines",
		BreathingTechnique: "Breathing Styles",
		CursedTechnique: "Cursed Techniques",
		Fruit: "Fruits",
		Grimoire: "Grimoires",
		Kagune: "Kagunes",
		Other: "Other",
		Permanent: "Permanent",
		Reiatsu: "Reiatsu",
		Stand: "Stands",
		Superpower: "Superpowers",
	};
	const STAT_FOLDERS = ["Strength", "Chakra", "Sword", "Speed", "Agility"];
	const STAT_TYPES = ["Strength", "Chakra", "Sword"];
	const SPECIAL_TYPES = Engine.SPECIAL_TYPES;
	const ACCESSORY_KINDS = ["Hat", "Face", "Body", "Back", "Arm", "Waist", "Leg", "Other"];
	const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic", "Secret", "Exclusive", "Sovereign"];
	const OVERRIDE_FIELDS = [
		["bossDamage", "BossDmg", "number"],
		["playerDamage", "PlayerDmg", "number"],
		["damageMultiplier", "PveDmgMultiplier", "number"],
		["baseCooldown", "CooldownSeconds", "seconds"],
		["tickCount", "TickCount", "integer"],
		["activationTillFirstHitbox", "ActivationTillFirstHitbox", "seconds"],
		["activationTillEndlagEnd", "ActivationTillEndlagEnd", "seconds"],
		["activationTillCooldownStart", "ActivationTillCooldownStart", "seconds"],
		["durationSeconds", "DurationSeconds", "seconds"],
		["dotMultiplier", "Damage over time ×", "number"],
	];

	const state = {
		loadout: Engine.defaultLoadout(),
		combo: [],
		selected: null,
		tab: "move",
		compare: { sort: "total", dir: -1, category: "all", stat: "all", search: "" },
		diffSearch: "",
		search: "",
		hideUtility: false,
		comboPick: null,
		openGroups: new Set(["Powers", "Powers/Strength", "Specials"]),
	};

	const moveCatalog = buildCatalog();

	function isDebugPower(power) {
		return power.specialCategory === "Debug" || /^Debug/.test(power.id) || (typeof power.bossDamage === "number" && power.bossDamage >= 1e40);
	}

	function buildCatalog() {
		const entries = [];
		const seen = new Set();
		for (const special of Object.values(data.specials)) {
			if (special.id === "Debug") continue;
			for (const ability of special.abilities) {
				if (!ability.powerId || !data.powers[ability.powerId]) continue;
				const standId = special.kind === "Stand" ? special.id : null;
				const key = Engine.moveKey(ability.powerId, standId);
				if (seen.has(key)) continue;
				seen.add(key);
				entries.push({
					key,
					powerId: ability.powerId,
					standId,
					specialId: special.id,
					abilityKey: ability.key,
					abilityName: ability.displayName || null,
					label: data.powers[ability.powerId].displayName || ability.displayName || ability.powerId,
					group: special.kind,
				});
			}
		}
		for (const power of Object.values(data.powers)) {
			if (seen.has(power.id)) continue;
			if (isDebugPower(power)) continue;
			if (Object.values(data.specials).some((s) => s.kind === "Stand" && s.abilities.some((a) => a.powerId === power.id))) continue;
			seen.add(power.id);
			entries.push({ key: power.id, powerId: power.id, standId: null, specialId: null, abilityKey: null, abilityName: null, label: power.displayName || power.id, group: power.isSpecial ? power.specialType : power.statFolder });
		}
		return entries;
	}

	function formatNumber(value, digits) {
		if (value === null || value === undefined || Number.isNaN(value)) return "—";
		if (!Number.isFinite(value)) return "∞";
		const abs = Math.abs(value);
		if (abs < 1000) {
			const d = digits !== undefined ? digits : abs < 10 ? 2 : abs < 100 ? 1 : 0;
			return value.toLocaleString(undefined, { maximumFractionDigits: d });
		}
		const tier = Math.floor(Math.log10(abs) / 3);
		if (tier >= SUFFIXES.length) return value.toExponential(2);
		const scaled = value / Math.pow(10, tier * 3);
		return `${scaled.toLocaleString(undefined, { maximumFractionDigits: 2 })}${SUFFIXES[tier]}`;
	}

	function formatSeconds(value) {
		if (value === null || value === undefined) return "—";
		return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}s`;
	}

	function formatMultiplier(value) {
		return `×${Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })}`;
	}

	function formatDelta(before, after) {
		if (typeof before !== "number" || typeof after !== "number" || before === 0) return "";
		const pct = ((after - before) / Math.abs(before)) * 100;
		return `${pct >= 0 ? "+" : ""}${pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
	}

	function el(tag, attrs, children) {
		const node = document.createElement(tag);
		if (attrs) {
			for (const [key, value] of Object.entries(attrs)) {
				if (value === null || value === undefined || value === false) continue;
				if (key === "class") node.className = value;
				else if (key === "text") node.textContent = value;
				else if (key === "html") node.innerHTML = value;
				else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
				else if (key === "checked" || key === "disabled" || key === "selected" || key === "hidden" || key === "value") node[key] = value;
				else node.setAttribute(key, value);
			}
		}
		if (children) {
			for (const child of Array.isArray(children) ? children : [children]) {
				if (child === null || child === undefined || child === false) continue;
				node.append(child instanceof Node ? child : document.createTextNode(String(child)));
			}
		}
		return node;
	}

	function iconUrl(icon) {
		const match = /^rbxassetid:\/\/(\d+)$/.exec(icon || "");
		return match ? `assets/icons/${match[1]}.png` : null;
	}

	function iconImage(icon, className) {
		const url = iconUrl(icon);
		if (!url) return null;
		return el("img", { class: className, src: url, alt: "", loading: "lazy", onerror: (e) => e.target.remove() });
	}

	function toast(message) {
		const node = document.getElementById("toast");
		node.textContent = message;
		node.hidden = false;
		clearTimeout(toast.timer);
		toast.timer = setTimeout(() => (node.hidden = true), 1800);
	}

	function save() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ loadout: state.loadout, combo: state.combo, selected: state.selected }));
		} catch (err) {
			/* storage unavailable */
		}
	}

	function normaliseLoadout(restored) {
		const loadout = Object.assign(Engine.defaultLoadout(), restored || {});
		loadout.custom = Object.assign({ champion: null, accessory: null, title: null, transformation: null }, (restored && restored.custom) || {});
		loadout.moveOverrides = (restored && restored.moveOverrides) || {};
		loadout.stats = Object.assign({ Strength: 1e6, Chakra: 1e6, Sword: 1e6 }, (restored && restored.stats) || {});
		loadout.statLimits = Object.assign({ Strength: 100, Chakra: 100, Sword: 100 }, (restored && restored.statLimits) || {});
		return loadout;
	}

	function load() {
		let restored = null;
		if (location.hash.startsWith("#s=")) {
			try {
				restored = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(3)))));
			} catch (err) {
				restored = null;
			}
		}
		if (!restored) {
			try {
				restored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
			} catch (err) {
				restored = null;
			}
		}
		if (restored && restored.loadout) state.loadout = normaliseLoadout(restored.loadout);
		if (restored && Array.isArray(restored.combo)) state.combo = restored.combo.filter((e) => e && data.powers[e.powerId]);
		if (restored && restored.selected && data.powers[restored.selected.powerId]) state.selected = restored.selected;
	}

	function shareLink() {
		const payload = JSON.stringify({ loadout: state.loadout, combo: state.combo, selected: state.selected });
		const encoded = btoa(unescape(encodeURIComponent(payload)));
		copyText(`${location.origin}${location.pathname}#s=${encoded}`).then(() => toast("Share link copied"));
	}

	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
		const area = document.createElement("textarea");
		area.value = text;
		document.body.append(area);
		area.select();
		document.execCommand("copy");
		area.remove();
		return Promise.resolve();
	}

	function currentMove() {
		if (!state.selected) return null;
		const standId = state.selected.standId || state.loadout.standId || null;
		return Engine.getMoveConfig(data, state.selected.powerId, standId, state.loadout);
	}

	function selectMove(powerId, standId) {
		state.selected = { powerId, standId: standId || null };
		if (standId) state.loadout.standId = standId;
		state.tab = "move";
		save();
		render();
	}

	function isDamaging(power) {
		const runtime = power.runtime;
		return runtime && Array.isArray(runtime.hits) && runtime.hits.some((h) => h.damage && h.damage.basis !== "none" && h.count > 0);
	}

	function catalogEntryMatches(entry, query) {
		if (!query) return true;
		const power = data.powers[entry.powerId];
		const special = entry.specialId ? data.specials[entry.specialId] : null;
		const haystack = [entry.label, entry.powerId, power.displayName, special && special.displayName, special && special.id, power.specialCategory, power.specialType, power.statType].filter(Boolean).join(" ").toLowerCase();
		return haystack.includes(query);
	}

	function overrideFor(key) {
		return state.loadout.moveOverrides[key] || null;
	}

	function rarityIndex(rarity) {
		const index = RARITY_ORDER.indexOf(rarity);
		return index === -1 ? 0 : index;
	}

	function renderTree() {
		const container = document.getElementById("move-tree");
		container.innerHTML = "";
		const query = state.search.trim().toLowerCase();

		function leaf(entry) {
			const power = data.powers[entry.powerId];
			if (power.isDisabled) return null;
			if (state.hideUtility && !isDamaging(power) && !power.Transformation) return null;
			if (!catalogEntryMatches(entry, query)) return null;
			const active = state.selected && state.selected.powerId === entry.powerId && (state.selected.standId || null) === (entry.standId || null);
			const special = entry.specialId ? data.specials[entry.specialId] : null;
			const edited = Engine.hasOverrides(overrideFor(entry.key));
			return el("div", { class: `leaf${active ? " active" : ""}`, title: entry.abilityName && entry.abilityName !== entry.label ? `Shown in the special as "${entry.abilityName}"` : null, onclick: () => selectMove(entry.powerId, entry.standId) }, [
				iconImage(power.icon, "leaf-icon") || (special ? iconImage(special.icon, "leaf-icon inherited") : null) || el("span", { class: "leaf-icon placeholder", text: (entry.label || "?").slice(0, 1) }),
				el("span", { class: "leaf-name", text: entry.label }),
				edited ? el("span", { class: "dot edited", title: "Has rebalance overrides" }) : null,
				entry.abilityKey ? el("span", { class: "key", text: entry.abilityKey }) : null,
			]);
		}

		function group(id, title, children) {
			const rendered = children.filter(Boolean);
			if (rendered.length === 0) return null;
			const details = el("details", { open: state.openGroups.has(id) || query ? true : null }, [el("summary", {}, [title, el("span", { class: "count", text: `(${rendered.length})` })]), ...rendered]);
			details.addEventListener("toggle", () => {
				if (query) return;
				if (details.open) state.openGroups.add(id);
				else state.openGroups.delete(id);
				saveOpenGroups();
			});
			return details;
		}

		const powersGroups = STAT_FOLDERS.map((folder) => {
			const entries = moveCatalog.filter((e) => !e.specialId && !data.powers[e.powerId].isSpecial && data.powers[e.powerId].statFolder === folder).sort((a, b) => a.label.localeCompare(b.label));
			return group(`Powers/${folder}`, folder, entries.map(leaf));
		});
		container.append(group("Powers", "Powers", powersGroups) || el("div"));

		const kinds = [...new Set(Object.values(data.specials).map((s) => s.kind))].sort();
		const specialGroups = kinds.map((kind) => {
			const specials = Object.values(data.specials).filter((s) => s.kind === kind).sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || a.displayName.localeCompare(b.displayName));
			return group(`Specials/${kind}`, KIND_LABELS[kind] || kind, specials.map((special) => {
				const entries = moveCatalog.filter((e) => e.specialId === special.id);
				const title = el("span", { class: "special-title" }, [iconImage(special.icon, "tree-icon"), special.displayName, el("span", { class: "rarity", text: special.rarity || "" })]);
				return group(`Specials/${kind}/${special.id}`, title, entries.map(leaf));
			}));
		});
		container.append(group("Specials", "Specials", specialGroups) || el("div"));
	}

	function saveOpenGroups() {
		try {
			localStorage.setItem(`${STORAGE_KEY}-groups`, JSON.stringify([...state.openGroups]));
		} catch (err) {
			/* storage unavailable */
		}
	}

	function loadOpenGroups() {
		try {
			const stored = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-groups`) || "null");
			if (Array.isArray(stored)) state.openGroups = new Set(stored);
		} catch (err) {
			/* keep defaults */
		}
	}

	function openGroupsForSelection() {
		if (!state.selected) return;
		const entry = moveCatalog.find((e) => e.powerId === state.selected.powerId && (e.standId || null) === (state.selected.standId || null)) || moveCatalog.find((e) => e.powerId === state.selected.powerId);
		if (!entry) return;
		if (entry.specialId) {
			const special = data.specials[entry.specialId];
			state.openGroups.add("Specials");
			state.openGroups.add(`Specials/${special.kind}`);
			state.openGroups.add(`Specials/${special.kind}/${special.id}`);
		} else {
			state.openGroups.add("Powers");
			state.openGroups.add(`Powers/${data.powers[entry.powerId].statFolder}`);
		}
	}

	function statCard(label, value, hint, extraClass) {
		return el("div", { class: `stat${extraClass ? ` ${extraClass}` : ""}` }, [
			el("div", { class: "label", text: label }),
			el("div", { class: `value${value === "—" ? " muted" : ""}`, text: value }),
			hint ? el("div", { class: "hint", text: hint }) : null,
		]);
	}

	function hitboxText(hitbox) {
		if (!hitbox) return "—";
		const size = Array.isArray(hitbox.size) ? hitbox.size.map((v) => (typeof v === "number" ? formatNumber(v, 1) : "?")).join(" × ") : "?";
		return `${hitbox.shape || "?"} ${size}${hitbox.attached ? " (attached)" : ""}`;
	}

	function modeLabel(mode) {
		return { boss: "bosses / dungeon / tower mobs", mob: "regular mobs", duel: "players in duels & tournaments", freepvp: "players in free roam" }[mode] || mode;
	}

	function liveMove(move) {
		return Engine.getMoveConfig(data, move.id, move.standId, null);
	}

	function renderOverrideEditor(move, result) {
		const override = overrideFor(move.key) || {};
		const live = liveMove(move);
		const liveResult = Engine.computeMove(data, state.loadout, live);
		const original = move.original || {
			bossDamage: live.bossDamage ?? null,
			playerDamage: live.playerDamage ?? null,
			damageMultiplier: live.damageMultiplier ?? null,
			baseCooldown: live.baseCooldown ?? null,
			tickCount: liveResult.totalHits,
			activationTillFirstHitbox: live.runtime ? live.runtime.activationTillFirstHitbox : null,
			activationTillEndlagEnd: live.runtime ? live.runtime.activationTillEndlagEnd : null,
			activationTillCooldownStart: live.runtime ? live.runtime.activationTillCooldownStart : null,
			durationSeconds: live.runtime ? live.runtime.durationSeconds : null,
			dotMultiplier: 1,
		};
		const wrap = el("div", { class: "override-editor" });
		wrap.append(el("p", { class: "muted", text: "Type hypothetical values to test a rebalance before it goes into the game. Empty fields keep the live value. Overrides apply everywhere: Compare, Combo and the Diff tab." }));
		const grid = el("div", { class: "override-grid" });
		for (const [field, label, kind] of OVERRIDE_FIELDS) {
			const liveValue = original[field];
			const input = el("input", {
				type: "number",
				step: kind === "integer" ? 1 : "any",
				min: 0,
				placeholder: liveValue === null || liveValue === undefined ? "—" : String(liveValue),
				value: typeof override[field] === "number" ? override[field] : "",
				onchange: (e) => {
					const current = Object.assign({}, overrideFor(move.key) || {});
					if (e.target.value === "") delete current[field];
					else {
						const parsed = Number(e.target.value);
						if (Number.isFinite(parsed)) current[field] = parsed;
					}
					if (Engine.hasOverrides(current)) state.loadout.moveOverrides[move.key] = current;
					else delete state.loadout.moveOverrides[move.key];
					save();
					renderTree();
					renderMovePanel();
				},
			});
			const changed = typeof override[field] === "number";
			grid.append(el("label", { class: `override-field${changed ? " changed" : ""}` }, [
				el("span", { class: "override-label", text: label }),
				input,
				el("span", { class: "override-live", text: liveValue === null || liveValue === undefined ? "live: —" : `live: ${kind === "seconds" ? formatSeconds(liveValue) : liveValue}` }),
			]));
		}
		wrap.append(grid);
		const actions = el("div", { class: "summary-row" }, [
			el("button", { class: "small danger", text: "Clear overrides for this move", disabled: !Engine.hasOverrides(override), onclick: () => { delete state.loadout.moveOverrides[move.key]; save(); renderTree(); renderMovePanel(); } }),
		]);
		if (Engine.hasOverrides(override)) {
			actions.append(el("span", { class: "muted", text: `Total damage: ${formatNumber(liveResult.total)} live → ${formatNumber(result.total)} with overrides (${formatDelta(liveResult.total, result.total) || "no change"})` }));
		}
		wrap.append(actions);
		return wrap;
	}

	function renderMovePanel() {
		const panel = document.getElementById("panel-move");
		panel.innerHTML = "";
		const move = currentMove();
		if (!move) {
			panel.append(el("div", { class: "empty", text: "Pick a move from the list on the left to see its numbers, or use Compare to rank every move against your loadout." }));
			return;
		}
		const result = Engine.computeMove(data, state.loadout, move);
		const runtime = move.runtime || {};
		const hits = runtime.hits || [];
		const firstHitbox = hits.find((h) => h.hitbox && Array.isArray(h.hitbox.size));
		const size = firstHitbox ? firstHitbox.hitbox.size : [null, null, null];
		const owners = (move.usedBy || []).map((u) => `${data.specials[u.specialId] ? data.specials[u.specialId].displayName : u.specialId} [${u.key}]`);
		const stand = move.overrideSource ? data.specials[move.overrideSource] : null;
		const edited = result.isOverridden;

		panel.append(el("div", { class: "move-header" }, [
			iconImage(move.icon, "move-icon"),
			el("div", {}, [
				el("h1", { text: `${move.displayName || move.id}${stand ? ` (${stand.displayName})` : ""}` }),
				el("div", { class: "meta" }, [
					el("span", { class: `badge ${move.isSpecial ? "Special" : move.statType}`, text: move.isSpecial ? `Special · ${move.specialType}` : `Power · ${move.statType}` }),
					move.isSpecial && move.statType ? el("span", { class: `badge ${move.statType}`, text: `scales with ${move.statType}` }) : null,
					move.appliesBleed ? el("span", { class: "badge", text: `applies bleed ×${move.bleedStacks || 1}` }) : null,
					move.Transformation ? el("span", { class: "badge", text: `transformation (${move.TransformationType || "?"})` }) : null,
					edited ? el("span", { class: "badge edited", text: "rebalance overrides active" }) : null,
					state.loadout.stacking === "additive" ? el("span", { class: "badge warn", text: "additive bonuses" }) : null,
				]),
				el("p", { text: move.description || "" }),
				owners.length ? el("p", { class: "muted", text: `Used by: ${owners.join(", ")}` }) : null,
			]),
			el("div", { class: "move-actions" }, [
				el("button", { class: "primary", text: "Add to combo", onclick: () => addToCombo(move.id, state.selected.standId) }),
				el("button", { text: "Copy JSON", onclick: () => copyText(JSON.stringify(Engine.exportMoveJson(move, result), null, 2)).then(() => toast("Move JSON copied")) }),
			]),
		]));

		panel.append(el("h2", { text: `Damage vs ${modeLabel(state.loadout.mode)}` }));
		panel.append(el("div", { class: "grid" }, [
			statCard("Total damage", formatNumber(result.total), `${result.totalHits} hit${result.totalHits === 1 ? "" : "s"}${result.totalDot && state.loadout.includeDot ? " + DoT" : ""}${result.detonation ? " + bleed detonation" : ""}`, "big"),
			statCard("Direct damage", formatNumber(result.totalDirect), result.hits.length ? result.hits.map((h) => `${h.count}× ${formatNumber(h.perHit)}`).join(" · ") : "no damaging hitbox"),
			statCard("Damage over time", formatNumber(result.totalDot), result.dots.length ? result.dots.map((d) => `${d.status.effect} ${formatNumber(d.total)} over ${formatSeconds(d.duration)}`).join(" · ") : "none"),
			statCard("DPS (during move)", result.dps === null ? "—" : formatNumber(result.dps), result.endlag !== null ? `over ${formatSeconds(result.endlag)} of endlag` : "no timing data"),
			statCard("Damage per cycle", result.damagePerCycle === null ? "—" : formatNumber(result.damagePerCycle), `cast + cooldown = ${formatSeconds(result.cycleTime)}`),
		]));

		panel.append(el("h2", { text: "Move data" }));
		const original = move.original || {};
		function dataCard(label, value, hint, field, format) {
			const changed = edited && typeof (move.override || {})[field] === "number";
			return statCard(label, value, changed ? `live: ${format ? format(original[field]) : original[field] ?? "—"}` : hint, changed ? "changed" : "");
		}
		panel.append(el("div", { class: "grid" }, [
			dataCard("BossDmg", move.bossDamage ?? "—", "damage vs bosses, dungeons and tower", "bossDamage"),
			dataCard("PlayerDmg", move.playerDamage ?? "—", "damage vs players in duels and tournaments", "playerDamage"),
			dataCard("PveDmgMultiplier", move.damageMultiplier ?? "—", "× your stat vs regular mobs", "damageMultiplier"),
			dataCard("TickCount", String(result.totalHits), "max hits on one target", "tickCount"),
			dataCard("CooldownSeconds", formatSeconds(move.baseCooldown), "before cooldown reductions", "baseCooldown", formatSeconds),
			dataCard("ActivationTillCooldownStart", formatSeconds(runtime.activationTillCooldownStart), "from pressing the key to the cooldown starting", "activationTillCooldownStart", formatSeconds),
			dataCard("ActivationTillEndlagEnd", formatSeconds(runtime.activationTillEndlagEnd), "from pressing the key to being able to attack again", "activationTillEndlagEnd", formatSeconds),
			dataCard("ActivationTillFirstHitbox", formatSeconds(runtime.activationTillFirstHitbox), "from pressing the key to the first hit landing", "activationTillFirstHitbox", formatSeconds),
			dataCard("DurationSeconds", formatSeconds(runtime.durationSeconds), "how long the move keeps hitting", "durationSeconds", formatSeconds),
			statCard("HitboxLengthSize", size[2] === null || size[2] === undefined ? "—" : String(size[2]), "depth in studs"),
			statCard("HitboxWidthSize", size[0] === null || size[0] === undefined ? "—" : String(size[0]), "width in studs"),
			statCard("HitboxHeightSize", size[1] === null || size[1] === undefined ? "—" : String(size[1]), "height in studs"),
		]));

		panel.append(el("h2", { text: "Rebalance this move" }));
		panel.append(renderOverrideEditor(move, result));

		if (hits.length) {
			panel.append(el("h2", { text: "Hits" }));
			panel.append(el("div", { class: "table-wrap" }, el("table", {}, [
				el("thead", {}, el("tr", {}, [el("th", { text: "Hit" }), el("th", { class: "num", text: "Max hits" }), el("th", { class: "num", text: "Per hit" }), el("th", { class: "num", text: "Total" }), el("th", { text: "Hitbox" }), el("th", { class: "num", text: "Starts" }), el("th", { class: "num", text: "Window" }), el("th", { text: "Conditions" })])),
				el("tbody", {}, hits.map((hit) => {
					const computed = result.hits.find((h) => h.hit === hit);
					return el("tr", {}, [
						el("td", { text: hit.label || "Hit" }),
						el("td", { class: "num", text: String(hit.count ?? "—") }),
						el("td", { class: "num", text: computed ? formatNumber(computed.perHit) : "—" }),
						el("td", { class: "num", text: computed ? formatNumber(computed.total) : "—" }),
						el("td", { text: hitboxText(hit.hitbox) }),
						el("td", { class: "num", text: formatSeconds(hit.startsAt) }),
						el("td", { class: "num", text: formatSeconds(hit.duration) }),
						el("td", { text: hit.conditions || "" }),
					]);
				})),
			])));
		}

		const statuses = runtime.statuses || [];
		if (statuses.length) {
			panel.append(el("h2", { text: "Statuses applied" }));
			panel.append(el("div", {}, statuses.map((status) => {
				const parts = [`${status.effect}${status.label ? ` (${status.label})` : ""}`];
				if (status.target) parts.push({ players: "players only", mobs: "mobs only", both: "players and mobs" }[status.target] || status.target);
				if (status.duration !== undefined && status.duration !== null) parts.push(formatSeconds(status.duration));
				const dot = result.dots.find((d) => d.status === status);
				if (dot) parts.push(`${formatNumber(dot.total)} damage over ${dot.ticks} ticks`);
				else if (status.dot) parts.push("damage over time (not applied to this target type)");
				return el("span", { class: "status-chip" }, [el("b", { text: parts[0] }), parts.slice(1).join(" · ")]);
			})));
		}

		panel.append(el("h2", { text: `Damage breakdown (one full hit, ${state.loadout.stacking === "additive" ? "additive" : "multiplicative"} bonuses)` }));
		const breakdown = el("ul", { class: "breakdown" });
		for (const step of result.baseSteps) breakdown.append(el("li", {}, [el("span", { text: step.label }), el("span", { text: step.label.includes("stat") || step.value > 50 ? formatNumber(step.value) : formatMultiplier(step.value) })]));
		const bonusSteps = result.sourceSteps.concat(result.postSteps);
		for (const step of bonusSteps) {
			const isBonus = !step.kind || step.kind === "bonus";
			breakdown.append(el("li", { class: isBonus ? "bonus" : "" }, [
				el("span", { text: step.label }),
				el("span", { text: state.loadout.stacking === "additive" && isBonus ? `${step.value >= 1 ? "+" : ""}${((step.value - 1) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : formatMultiplier(step.value) }),
			]));
		}
		if (state.loadout.stacking === "additive" && bonusSteps.some((s) => !s.kind || s.kind === "bonus")) {
			const sum = bonusSteps.filter((s) => !s.kind || s.kind === "bonus").reduce((acc, s) => acc + (s.value - 1), 0);
			breakdown.append(el("li", {}, [el("span", { text: "Bonuses summed" }), el("span", { text: formatMultiplier(1 + sum) })]));
		}
		breakdown.append(el("li", { class: "total" }, [el("span", { text: "Damage per full hit" }), el("span", { text: formatNumber(result.perHitFull) })]));
		panel.append(breakdown);
	}

	function comparableRows() {
		const query = state.compare.search.trim().toLowerCase();
		const rows = [];
		for (const entry of moveCatalog) {
			const power = data.powers[entry.powerId];
			if (power.category === "Enemy" || power.isDisabled) continue;
			if (state.compare.category === "Power" && power.isSpecial) continue;
			if (state.compare.category !== "all" && state.compare.category !== "Power" && entry.group !== state.compare.category) continue;
			if (state.compare.stat !== "all" && power.statType !== state.compare.stat) continue;
			if (!catalogEntryMatches(entry, query)) continue;
			const move = Engine.getMoveConfig(data, entry.powerId, entry.standId, state.loadout);
			if (!isDamaging(move)) continue;
			const result = Engine.computeMove(data, state.loadout, move);
			const special = entry.specialId ? data.specials[entry.specialId] : null;
			rows.push({
				entry, move, result,
				name: `${entry.label}${entry.standId ? ` (${data.specials[entry.standId].displayName})` : ""}`,
				source: special ? special.displayName : power.statType,
				total: result.total, perHit: result.perHitFull, hits: result.totalHits, dps: result.dps, cycle: result.damagePerCycle,
				cooldown: result.cooldown, endlag: result.endlag,
				bossDamage: move.bossDamage ?? null, playerDamage: move.playerDamage ?? null, multiplier: move.damageMultiplier ?? null,
			});
		}
		return rows;
	}

	function renderComparePanel() {
		const panel = document.getElementById("panel-compare");
		panel.innerHTML = "";
		panel.append(el("div", { class: "compare-controls" }, [
			el("input", { type: "search", placeholder: "Filter…", value: state.compare.search, oninput: (e) => { state.compare.search = e.target.value; renderComparePanel(); } }),
			el("select", { onchange: (e) => { state.compare.category = e.target.value; renderComparePanel(); } }, [
				el("option", { value: "all", text: "All categories", selected: state.compare.category === "all" }),
				el("option", { value: "Power", text: "Powers", selected: state.compare.category === "Power" }),
				...Object.keys(KIND_LABELS).map((kind) => el("option", { value: kind, text: KIND_LABELS[kind], selected: state.compare.category === kind })),
			]),
			el("select", { onchange: (e) => { state.compare.stat = e.target.value; renderComparePanel(); } }, [
				el("option", { value: "all", text: "Any scaling", selected: state.compare.stat === "all" }),
				...STAT_TYPES.map((stat) => el("option", { value: stat, text: stat, selected: state.compare.stat === stat })),
			]),
			el("span", { class: "muted", text: `vs ${modeLabel(state.loadout.mode)} · ${state.loadout.stacking} bonuses` }),
		]));

		const rows = comparableRows();
		const sortKey = state.compare.sort;
		rows.sort((a, b) => {
			const av = a[sortKey], bv = b[sortKey];
			if (typeof av === "string") return av.localeCompare(bv) * state.compare.dir;
			return ((av ?? -Infinity) - (bv ?? -Infinity)) * state.compare.dir;
		});
		const columns = [
			["name", "Move", false], ["source", "Source", false], ["bossDamage", "BossDmg", true], ["playerDamage", "PlayerDmg", true], ["multiplier", "PveDmgMultiplier", true],
			["hits", "Hits", true], ["perHit", "Per hit", true], ["total", "Total", true], ["endlag", "Endlag", true], ["dps", "DPS", true], ["cooldown", "Cooldown", true], ["cycle", "Dmg / cycle", true],
		];
		panel.append(el("p", { class: "muted", text: `${rows.length} damaging moves. Click a column to sort, a row to open the move. Moves with a dot carry rebalance overrides.` }));
		panel.append(el("div", { class: "table-wrap" }, el("table", {}, [
			el("thead", {}, el("tr", {}, columns.map(([key, label, numeric]) => el("th", {
				class: `sortable${numeric ? " num" : ""}${sortKey === key ? " active" : ""}`,
				text: `${label}${sortKey === key ? (state.compare.dir === -1 ? " ↓" : " ↑") : ""}`,
				onclick: () => { if (state.compare.sort === key) state.compare.dir *= -1; else { state.compare.sort = key; state.compare.dir = numeric ? -1 : 1; } renderComparePanel(); },
			})))),
			el("tbody", {}, rows.map((row) => el("tr", { class: "clickable", onclick: () => selectMove(row.entry.powerId, row.entry.standId) }, [
				el("td", {}, [row.result.isOverridden ? el("span", { class: "dot edited" }) : null, row.name]),
				el("td", { text: row.source }),
				el("td", { class: "num", text: row.bossDamage ?? "—" }),
				el("td", { class: "num", text: row.playerDamage ?? "—" }),
				el("td", { class: "num", text: row.multiplier ?? "—" }),
				el("td", { class: "num", text: String(row.hits) }),
				el("td", { class: "num", text: formatNumber(row.perHit) }),
				el("td", { class: "num", text: formatNumber(row.total) }),
				el("td", { class: "num", text: formatSeconds(row.endlag) }),
				el("td", { class: "num", text: row.dps === null ? "—" : formatNumber(row.dps) }),
				el("td", { class: "num", text: formatSeconds(row.cooldown) }),
				el("td", { class: "num", text: row.cycle === null ? "—" : formatNumber(row.cycle) }),
			]))),
		])));
	}

	function addToCombo(powerId, standId) {
		state.combo.push({ powerId, standId: standId || null });
		save();
		toast(`${data.powers[powerId].displayName || powerId} added to combo`);
		renderComboPanel();
	}

	function renderComboPanel() {
		const panel = document.getElementById("panel-combo");
		panel.innerHTML = "";
		const options = moveCatalog.filter((e) => data.powers[e.powerId].category !== "Enemy" && !data.powers[e.powerId].isDisabled).sort((a, b) => a.label.localeCompare(b.label));
		const select = el("select", { onchange: (e) => { state.comboPick = e.target.value; } }, options.map((e) => el("option", { value: e.key, selected: state.comboPick === e.key, text: `${e.label}${e.standId ? ` (${data.specials[e.standId].displayName})` : e.specialId ? ` (${data.specials[e.specialId].displayName})` : ` (${data.powers[e.powerId].statType})`}` })));
		panel.append(el("div", { class: "combo-add" }, [
			select,
			el("button", { class: "primary", text: "Add move", onclick: () => { const entry = options.find((e) => e.key === select.value); if (entry) addToCombo(entry.powerId, entry.standId); } }),
		]));

		if (state.combo.length === 0) {
			panel.append(el("div", { class: "empty", text: "Your combo is empty. Add moves in the order you would use them; the calculator chains their endlag, tracks cooldowns and stacks bleed." }));
			return;
		}

		const sim = Engine.simulateCombo(data, state.loadout, state.combo);
		panel.append(el("div", { class: "grid" }, [
			statCard("Combo damage", formatNumber(sim.totalDamage), `vs ${modeLabel(state.loadout.mode)}`, "big"),
			statCard("Combo time", formatSeconds(sim.totalTime), "sum of endlag (+ waiting on cooldowns)"),
			statCard("Combo DPS", sim.dps === null ? "—" : formatNumber(sim.dps), "damage ÷ time"),
			statCard("Target HP", formatNumber(state.loadout.targetMaxHealth), sim.totalDamage >= state.loadout.targetMaxHealth ? "lethal" : `${Math.round((sim.totalDamage / Math.max(1, state.loadout.targetMaxHealth)) * 100)}% of max HP`),
		]));

		const list = el("div", { class: "combo-list" });
		sim.rows.forEach((row, index) => {
			list.append(el("div", { class: "combo-item" }, [
				el("span", { class: "idx", text: String(index + 1) }),
				el("div", {}, [
					el("div", {}, [el("strong", { text: `${row.move.displayName || row.move.id}${row.entry.standId ? ` (${data.specials[row.entry.standId].displayName})` : ""}` }), row.result.isOverridden ? el("span", { class: "badge edited", text: "edited" }) : null]),
					el("div", { class: "muted", text: `${formatSeconds(row.startAt)} → ${formatSeconds(row.endAt)} · ${formatNumber(row.damage)} dmg (${row.result.totalHits} hits${row.detonation ? `, bleed detonation ${formatNumber(row.detonation)}` : ""})${row.waitForCooldown > 0 ? ` · waited ${formatSeconds(row.waitForCooldown)} for cooldown` : ""}${row.result.bleed ? ` · bleed stacks ${row.bleedStacksAfter}` : ""}` }),
				]),
				el("div", { class: "actions" }, [
					el("button", { class: "small", text: "↑", disabled: index === 0, onclick: () => { const [item] = state.combo.splice(index, 1); state.combo.splice(index - 1, 0, item); save(); renderComboPanel(); } }),
					el("button", { class: "small", text: "↓", disabled: index === state.combo.length - 1, onclick: () => { const [item] = state.combo.splice(index, 1); state.combo.splice(index + 1, 0, item); save(); renderComboPanel(); } }),
					el("button", { class: "small", text: "Open", onclick: () => selectMove(row.entry.powerId, row.entry.standId) }),
					el("button", { class: "small danger", text: "✕", onclick: () => { state.combo.splice(index, 1); save(); renderComboPanel(); } }),
				]),
			]));
		});
		panel.append(list);

		panel.append(el("h2", { text: "Timeline" }));
		panel.append(el("div", { class: "table-wrap" }, el("table", {}, [
			el("thead", {}, el("tr", {}, [el("th", { text: "#" }), el("th", { text: "Move" }), el("th", { class: "num", text: "Start" }), el("th", { class: "num", text: "First hit" }), el("th", { class: "num", text: "End" }), el("th", { class: "num", text: "Hits" }), el("th", { class: "num", text: "Damage" }), el("th", { class: "num", text: "Cumulative" }), el("th", { class: "num", text: "Cooldown ready" })])),
			el("tbody", {}, sim.rows.map((row, index) => el("tr", {}, [
				el("td", { text: String(index + 1) }),
				el("td", { text: row.move.displayName || row.move.id }),
				el("td", { class: "num", text: formatSeconds(row.startAt) }),
				el("td", { class: "num", text: row.result.runtime && typeof row.result.runtime.activationTillFirstHitbox === "number" ? formatSeconds(row.startAt + row.result.runtime.activationTillFirstHitbox) : "—" }),
				el("td", { class: "num", text: formatSeconds(row.endAt) }),
				el("td", { class: "num", text: String(row.result.totalHits) }),
				el("td", { class: "num", text: formatNumber(row.damage) }),
				el("td", { class: "num", text: formatNumber(row.cumulative) }),
				el("td", { class: "num", text: formatSeconds(row.startAt + (row.result.cooldownStart ?? row.result.endlag ?? 0) + row.result.cooldown) }),
			]))),
		])));
		panel.append(el("div", { class: "summary-row" }, [
			el("button", { text: "Copy combo JSON", onclick: () => copyText(JSON.stringify({ loadout: state.loadout, combo: state.combo, result: { totalDamage: sim.totalDamage, totalTime: sim.totalTime, dps: sim.dps, rows: sim.rows.map((r) => ({ move: r.move.id, stand: r.entry.standId, startAt: r.startAt, endAt: r.endAt, damage: r.damage })) } }, null, 2)).then(() => toast("Combo JSON copied")) }),
			el("button", { class: "danger", text: "Clear combo", onclick: () => { state.combo = []; save(); renderComboPanel(); } }),
		]));
	}

	function rebalanceExport() {
		return {
			stacking: state.loadout.stacking,
			moveOverrides: state.loadout.moveOverrides,
			custom: state.loadout.custom,
			selections: { championId: state.loadout.championId, traitId: state.loadout.traitId, customTraitBoost: state.loadout.customTraitBoost, titleId: state.loadout.titleId, accessories: state.loadout.accessories, transformationId: state.loadout.transformationId },
		};
	}

	function rebalanceImport(text) {
		const parsed = JSON.parse(text);
		if (parsed.stacking) state.loadout.stacking = parsed.stacking === "additive" ? "additive" : "multiplicative";
		if (parsed.moveOverrides && typeof parsed.moveOverrides === "object") state.loadout.moveOverrides = parsed.moveOverrides;
		if (parsed.custom && typeof parsed.custom === "object") state.loadout.custom = Object.assign({ champion: null, accessory: null, title: null, transformation: null }, parsed.custom);
		if (parsed.selections && typeof parsed.selections === "object") Object.assign(state.loadout, parsed.selections);
		save();
		render();
	}

	function describeCustomSource(label, obj) {
		if (!obj) return null;
		return el("div", { class: "diff-custom" }, [el("b", { text: label }), el("pre", { class: "json", text: JSON.stringify(obj, null, 2) })]);
	}

	function renderDiffPanel() {
		const panel = document.getElementById("panel-diff");
		panel.innerHTML = "";
		const loadout = state.loadout;

		panel.append(el("h1", { text: "Diff" }));
		panel.append(el("p", { class: "muted", text: "Two views of change: the rebalance you are testing right now (overrides and custom sources versus the live values), and the history of value changes pulled from the game each time the site data is updated." }));

		panel.append(el("h2", { text: "Your rebalance vs live values" }));
		const overrideKeys = Object.keys(loadout.moveOverrides).filter((key) => Engine.hasOverrides(loadout.moveOverrides[key]));
		const hasCustom = loadout.championId === CUSTOM || loadout.titleId === CUSTOM || loadout.transformationId === CUSTOM || Object.values(loadout.accessories).includes(CUSTOM) || loadout.traitId === CUSTOM;
		panel.append(el("div", { class: "summary-row" }, [
			el("span", { class: `badge ${loadout.stacking === "additive" ? "warn" : ""}`, text: `Bonus stacking: ${loadout.stacking}` }),
			el("button", { class: "small", text: "Copy rebalance JSON", onclick: () => copyText(JSON.stringify(rebalanceExport(), null, 2)).then(() => toast("Rebalance JSON copied")) }),
			el("button", { class: "small", text: "Import rebalance JSON", onclick: () => { const text = window.prompt("Paste rebalance JSON"); if (!text) return; try { rebalanceImport(text); toast("Rebalance imported"); } catch (err) { toast("Could not parse JSON"); } } }),
			el("button", { class: "small danger", text: "Clear all overrides", disabled: overrideKeys.length === 0, onclick: () => { loadout.moveOverrides = {}; save(); render(); } }),
		]));

		if (overrideKeys.length === 0 && !hasCustom) {
			panel.append(el("div", { class: "empty", text: "No overrides yet. Open a move and use \"Rebalance this move\", or pick a custom champion, title, accessory or transformation in the loadout." }));
		} else {
			if (overrideKeys.length) {
				const rows = [];
				for (const key of overrideKeys) {
					const [powerId, standId] = key.split("@");
					if (!data.powers[powerId]) continue;
					const edited = Engine.getMoveConfig(data, powerId, standId || null, loadout);
					const live = Engine.getMoveConfig(data, powerId, standId || null, null);
					const editedResult = Engine.computeMove(data, loadout, edited);
					const liveResult = Engine.computeMove(data, loadout, live);
					const name = `${edited.displayName || powerId}${standId && data.specials[standId] ? ` (${data.specials[standId].displayName})` : ""}`;
					for (const [field, label, kind] of OVERRIDE_FIELDS) {
						if (typeof edited.override[field] !== "number") continue;
						const before = edited.original[field];
						const after = edited.override[field];
						rows.push(el("tr", { class: "clickable", onclick: () => selectMove(powerId, standId || null) }, [
							el("td", { text: name }),
							el("td", { text: label }),
							el("td", { class: "num", text: before === null || before === undefined ? "—" : kind === "seconds" ? formatSeconds(before) : String(before) }),
							el("td", { class: "num changed", text: kind === "seconds" ? formatSeconds(after) : String(after) }),
							el("td", { class: "num", text: formatDelta(before, after) }),
							el("td", { class: "num", text: `${formatNumber(liveResult.total)} → ${formatNumber(editedResult.total)}` }),
							el("td", { class: "num", text: formatDelta(liveResult.total, editedResult.total) }),
						]));
					}
				}
				panel.append(el("div", { class: "table-wrap" }, el("table", {}, [
					el("thead", {}, el("tr", {}, [el("th", { text: "Move" }), el("th", { text: "Field" }), el("th", { class: "num", text: "Live" }), el("th", { class: "num", text: "Override" }), el("th", { class: "num", text: "Change" }), el("th", { class: "num", text: "Total damage" }), el("th", { class: "num", text: "Change" })])),
					el("tbody", {}, rows),
				])));
			}
			if (hasCustom) {
				panel.append(el("h3", { text: "Custom sources in use" }));
				panel.append(el("div", { class: "diff-customs" }, [
					loadout.championId === CUSTOM ? describeCustomSource("Custom champion", loadout.custom.champion || {}) : null,
					loadout.traitId === CUSTOM ? el("div", { class: "diff-custom" }, [el("b", { text: "Custom trait" }), el("span", { class: "muted", text: ` +${loadout.customTraitBoost || 0}% damage` })]) : null,
					loadout.titleId === CUSTOM ? describeCustomSource("Custom title", loadout.custom.title || {}) : null,
					Object.values(loadout.accessories).includes(CUSTOM) ? describeCustomSource("Custom accessory", loadout.custom.accessory || {}) : null,
					loadout.transformationId === CUSTOM ? describeCustomSource("Custom transformation", loadout.custom.transformation || {}) : null,
				]));
			}
		}

		panel.append(el("h2", { text: "Game data updates" }));
		if (changelog.length === 0) {
			panel.append(el("div", { class: "empty", text: "No update history yet. It appears here after the site data is refreshed from the game with a change." }));
			return;
		}
		panel.append(el("div", { class: "compare-controls" }, [
			el("input", { type: "search", placeholder: "Filter changes…", value: state.diffSearch, oninput: (e) => { state.diffSearch = e.target.value; renderDiffPanel(); } }),
		]));
		const query = state.diffSearch.trim().toLowerCase();
		for (const entry of changelog) {
			const changes = (entry.changes || []).filter((c) => !query || `${c.category} ${c.name} ${c.field}`.toLowerCase().includes(query));
			if (query && changes.length === 0) continue;
			panel.append(el("details", { class: "diff-entry", open: entry === changelog[0] ? true : null }, [
				el("summary", {}, [
					el("b", { text: new Date(entry.date).toLocaleString() }),
					el("span", { class: "muted", text: ` · ${(entry.changes || []).length} change${(entry.changes || []).length === 1 ? "" : "s"}${entry.added ? ` · ${entry.added} added` : ""}${entry.removed ? ` · ${entry.removed} removed` : ""}${entry.gameCommit ? ` · game ${entry.gameCommit.slice(0, 9)}` : ""}` }),
				]),
				changes.length ? el("div", { class: "table-wrap" }, el("table", {}, [
					el("thead", {}, el("tr", {}, [el("th", { text: "Type" }), el("th", { text: "Name" }), el("th", { text: "Field" }), el("th", { class: "num", text: "Before" }), el("th", { class: "num", text: "After" }), el("th", { class: "num", text: "Change" })])),
					el("tbody", {}, changes.map((c) => el("tr", {}, [
						el("td", { text: c.category }),
						el("td", { text: c.name }),
						el("td", { text: c.field }),
						el("td", { class: "num", text: c.before === null || c.before === undefined ? "—" : typeof c.before === "object" ? JSON.stringify(c.before) : String(c.before) }),
						el("td", { class: "num changed", text: c.after === null || c.after === undefined ? "—" : typeof c.after === "object" ? JSON.stringify(c.after) : String(c.after) }),
						el("td", { class: "num", text: formatDelta(c.before, c.after) }),
					]))),
				])) : el("p", { class: "muted", text: "No value changes in this update." }),
			]));
		}
	}

	function renderHelpPanel() {
		const panel = document.getElementById("panel-help");
		panel.className = "panel help active";
		panel.innerHTML = `
			<h1>Guide</h1>
			<p>This calculator exists to make balancing easier: it reproduces the game's damage rules for any move, loadout and target, so you can check a number, compare two moves side by side, test a whole combo, or try hypothetical values before they go into the game. Everything is driven by the three panes: the <b>move list</b> on the left, the <b>workspace</b> in the middle (Move, Compare, Combo, Diff) and the <b>loadout</b> on the right.</p>

			<h2>1. Quick start</h2>
			<ol>
				<li>Pick a <b>target mode</b> in the loadout pane. This decides which damage rule is used and is the single most important setting.</li>
				<li>Fill in the rest of the loadout: stats, champion, title, accessories, transformation, stand and any active buffs or debuffs. Every change recalculates instantly.</li>
				<li>Click a move on the left. The <b>Move</b> tab shows its damage for that loadout, the move data, hits, statuses and a step-by-step breakdown of every multiplier applied.</li>
				<li>Open <b>Compare</b> to rank every move for the same loadout, or add moves to <b>Combo</b> to chain them in order.</li>
				<li>Use <b>Share link</b> to copy a URL that restores the exact loadout, overrides and combo for someone else. <b>Reset</b> clears everything.</li>
			</ol>

			<h2>2. Finding a move</h2>
			<ul>
				<li>The list is grouped into <b>Powers</b> (Strength, Chakra, Sword, Speed, Agility) and <b>Specials</b> (Authorities, Bloodlines, Breathing Styles, Cursed Techniques, Fruits, Grimoires, Kagunes, Permanent, Reiatsu, Stands, Superpowers). Each special expands into its Z / X / C / V abilities, with the move's icon (or the special's icon when the move has none).</li>
				<li>Stand moves that are shared between stands (barrages, Timestop) appear once per stand with that stand's own damage and cooldown values.</li>
				<li>The search box matches move names, special names and scaling types. <b>Hide non-damaging moves</b> removes buffs, dashes and transformations from the list. A coloured dot marks moves that carry rebalance overrides.</li>
			</ul>

			<h2>3. Reading the move card</h2>
			<p>The top block is the result for your loadout:</p>
			<ul>
				<li><b>Total damage</b> — direct hits plus damage over time (and a bleed detonation when enabled) that one target takes if every hit lands.</li>
				<li><b>Direct damage</b> — hits only, with the per-hit value for each hit source.</li>
				<li><b>Damage over time</b> — burns and other ticking effects the move applies, totalled over their full duration.</li>
				<li><b>DPS (during move)</b> — total damage divided by the time the move locks you out of other moves.</li>
				<li><b>Damage per cycle</b> — total damage divided by cast time plus cooldown. This is the best single number for comparing sustained output between moves with different cooldowns.</li>
			</ul>
			<p>The <b>Move data</b> block lists the underlying values:</p>
			<ul>
				<li><b>BossDmg</b> — damage per hit against bosses, dungeon mobs and tower mobs.</li>
				<li><b>PlayerDmg</b> — damage per hit against players in duels and tournaments, where everyone has 1000 HP.</li>
				<li><b>PveDmgMultiplier</b> — multiplied by your stat against regular mobs and in free-roam PvP.</li>
				<li><b>TickCount</b> — the most times one target can be hit by a single use of the move.</li>
				<li><b>CooldownSeconds</b> — base cooldown before any cooldown reduction.</li>
				<li><b>ActivationTillFirstHitbox</b> — seconds from pressing the key until the first hit can connect (startup).</li>
				<li><b>ActivationTillEndlagEnd</b> — seconds from pressing the key until you can use another move.</li>
				<li><b>ActivationTillCooldownStart</b> — seconds from pressing the key until the cooldown timer starts counting. Cooldowns begin when the move finishes, not when it is pressed.</li>
				<li><b>DurationSeconds</b> — how long the move keeps dealing damage.</li>
				<li><b>HitboxWidthSize / HitboxHeightSize / HitboxLengthSize</b> — the main hitbox in studs (X, Y, Z). Spheres show their diameter in all three.</li>
			</ul>
			<p>Below that, <b>Hits</b> lists each separate hit source with its hit cap, per-hit damage, hitbox and timing, and <b>Statuses applied</b> lists crowd control and damage over time with duration and target. The <b>Damage breakdown</b> shows every multiplier in the order it is applied, so you can see exactly where a number comes from. <b>Copy JSON</b> copies the move data in a shareable format.</p>

			<h2>4. Rebalancing: hypothetical values</h2>
			<ul>
				<li><b>Rebalance this move</b> on the move card lets you type new values for BossDmg, PlayerDmg, PveDmgMultiplier, cooldown, tick count, timings and damage over time. Empty fields keep the live value. The card, Compare, Combo and Diff all use the override, and changed fields show the live value underneath.</li>
				<li><b>Custom champion, trait, title, accessory and transformation</b> — pick "Custom…" in the loadout to define your own boosts. Use <b>Copy values from</b> to start from an existing one and then edit the numbers; the advanced JSON box exposes every value. Custom sources are calculated exactly like their real counterparts.</li>
				<li><b>Bonus stacking</b> — switch between <b>Multiplicative</b> (how the game currently combines bonuses: each boost multiplies the last) and <b>Additive</b> (the upcoming system: all bonus percentages are summed once, then applied). Critical hits, target vulnerability, bleed and damage reduction stay multiplicative in both modes. The breakdown shows percentages and the summed bonus in additive mode.</li>
				<li>The <b>Diff</b> tab lists every override next to its live value, with the resulting total damage before and after. <b>Copy rebalance JSON</b> exports the whole set (overrides, custom sources, stacking) so another balancer can import it; the share link carries it too.</li>
			</ul>

			<h2>5. Target modes</h2>
			<ul>
				<li><b>Boss / dungeon / tower</b> — every hit deals <code>BossDmg</code> × bonuses. Stats are ignored. Pick a boss from the list to load its HP for lethal checks.</li>
				<li><b>Regular mob</b> — stat × stat limit × bonuses × <code>PveDmgMultiplier</code>. Enter the stat that matches the move's scaling (Sword for sword moves, Chakra for fruits, and so on).</li>
				<li><b>Duel / tournament</b> — every hit deals <code>PlayerDmg</code> against a 1000 HP opponent. Only PvP-specific bonuses apply: accessory PvP damage, bleed, juggernaut and the defender's PvP low-health defense.</li>
				<li><b>Free-roam PvP</b> — same base as regular mobs, then the defender's total damage reduction (title, champion, transformation, party buffs) is subtracted. Enter it as one percentage.</li>
			</ul>
			<p><b>Place</b> switches on location-only effects: Dimension 2 titles, dungeon-only champion boosts and tower boss titles.</p>

			<h2>6. Loadout reference</h2>
			<ul>
				<li><b>Target</b> — max HP (used for lethal checks and any hit that scales with target HP), current HP %, damage reduction, vulnerability %, and whether the target is frozen or burning.</li>
				<li><b>Your stats</b> — the stat value and the in-game stat limit percentage for Strength, Chakra and Sword. Your HP % drives low-health and missing-health boosts.</li>
				<li><b>Champion</b> — applies the champion's damage boosts and unlocks its specific toggles (combat stacks, hit stacks, meltdown, berserker, daytime, shrine). <b>Critical hits</b> can be ignored, averaged by chance, or forced on every hit. Traits with a damage boost are selectable with their tier, or define a custom trait percentage.</li>
				<li><b>Title &amp; accessories</b> — titles that change damage; one accessory per slot, with their damage, special-specific and boss-damage boosts summed the way the game does. A custom accessory slot is available for hypothetical items.</li>
				<li><b>Transformation &amp; stand</b> — the active transformation's damage perks, the Harden Fist buff, and which stand you are using (this chooses the override values for shared stand moves).</li>
				<li><b>Buffs &amp; debuffs</b> — an active DamageBuff status, a party damage aura, the intense-burn multiplier when you are burning, and bleed stacks already on the target. <b>Include damage over time</b> and <b>Include bleed detonation</b> control what goes into totals.</li>
			</ul>

			<h2>7. Compare tab</h2>
			<ul>
				<li>Every damaging move is calculated with the current loadout and overrides. Click a column header to sort, click again to flip. Click a row to open the move.</li>
				<li>Filter by category (Powers or a special kind), by scaling stat, or by name.</li>
				<li>For balancing, the most useful columns are <b>Per hit</b> and <b>Total</b> (burst), <b>DPS</b> (how quickly the damage comes out) and <b>Dmg / cycle</b> (sustained output including cooldown). A move with high Total but low Dmg / cycle is a long-cooldown burst tool; the reverse is a spammable filler.</li>
				<li>To compare specials fairly, keep the loadout fixed and only change the category filter. To compare across scaling types, set all three stats to the same value.</li>
			</ul>

			<h2>8. Combo tab</h2>
			<ul>
				<li>Add moves in the order you would press them, from the picker or with <b>Add to combo</b> on a move card. Reorder with the arrows, remove with ✕.</li>
				<li>Each move starts when the previous one's endlag ends. If a move is still on cooldown, the combo waits for it and the wait is shown on that row.</li>
				<li>The timeline lists start, first-hit and end times, damage, running total and when each cooldown will be ready again.</li>
				<li>Bleed is simulated: bleeding moves add stacks per hit, stacks decay while no bleeding hit lands, and passing the stack cap detonates. The stack count after each move is shown.</li>
				<li><b>Combo DPS</b> is total damage over total time, including any cooldown waits. <b>Target HP</b> tells you whether the combo is lethal for the HP you entered.</li>
			</ul>

			<h2>9. Diff tab</h2>
			<ul>
				<li><b>Your rebalance vs live values</b> — every move override with its live value, the percentage change, and the total damage before and after. Click a row to open the move. Custom sources in use are listed underneath.</li>
				<li><b>Game data updates</b> — each time the site data is refreshed from the game, every value that changed (moves, champions, titles, accessories, transformations, stand overrides) is recorded with before and after. Use the filter to find a move or field.</li>
			</ul>

			<h2>10. Status effects</h2>
			<ul>
				<li><b>Burn</b> — damage over time, usually a fraction of <code>BossDmg</code> spread over the duration. Some burns also weaken the burned player's own damage: model that with "You are burning".</li>
				<li><b>Bleed</b> — moves that bleed add stacks on every hit (+2% damage per stack, up to 30). Past 30 stacks the bleed detonates for half of the damage stored in those stacks. Sword champions with a bleed perk bleed on every sword hit.</li>
				<li><b>Frozen, Stunned, Slowed, Heavy</b> — listed on the move with duration and who they affect.</li>
				<li><b>Vulnerability</b> — a mark that makes the target take more damage; enter the percentage in the loadout while it is active.</li>
			</ul>

			<h2>11. Assumptions and limits</h2>
			<ul>
				<li>Hold-to-aim moves assume an instant release; holding longer delays every timing by the hold time.</li>
				<li>Projectiles assume they travel their full range before landing, so first-hit times are an upper bound.</li>
				<li>Hit counts are the maximum for a target that stays inside the hitbox for the whole move.</li>
				<li>Cooldown reduction from champions, titles and transformations is not applied to <code>CooldownSeconds</code>; the combo tab uses base cooldowns.</li>
				<li>Random effects (critical hits, evasion, proc chances) are shown as expected values where a toggle offers it and otherwise ignored.</li>
			</ul>
		`;
	}

	function field(labelText, input, hint) {
		return el("div", { class: "field" }, [el("label", { text: labelText }), input, hint ? el("div", { class: "hint", text: hint }) : null]);
	}

	function numberInput(key, options) {
		const loadout = state.loadout;
		const value = options && options.get ? options.get() : loadout[key];
		return el("input", {
			type: "number",
			step: options && options.step !== undefined ? options.step : "any",
			min: options && options.min !== undefined ? options.min : null,
			max: options && options.max !== undefined ? options.max : null,
			value: value === null || value === undefined ? "" : value,
			onchange: (e) => {
				const parsed = e.target.value === "" ? 0 : Number(e.target.value);
				const finalValue = Number.isFinite(parsed) ? parsed : 0;
				if (options && options.set) options.set(finalValue);
				else loadout[key] = finalValue;
				onLoadoutChanged();
			},
		});
	}

	function checkbox(key, labelText, hint) {
		return el("label", { class: "check", title: hint || null }, [
			el("input", { type: "checkbox", checked: !!state.loadout[key], onchange: (e) => { state.loadout[key] = e.target.checked; onLoadoutChanged(); } }),
			labelText,
		]);
	}

	function selectInput(key, optionList, options) {
		return el("select", {
			onchange: (e) => {
				if (options && options.set) options.set(e.target.value);
				else state.loadout[key] = e.target.value;
				onLoadoutChanged();
			},
		}, optionList.map((o) => el("option", { value: o.value, text: o.label, selected: (options && options.get ? options.get() : state.loadout[key]) === o.value })));
	}

	function getPath(obj, path) {
		return path.split(".").reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
	}

	function setPath(obj, path, value) {
		const parts = path.split(".");
		let node = obj;
		for (let i = 0; i < parts.length - 1; i++) {
			if (!node[parts[i]] || typeof node[parts[i]] !== "object") node[parts[i]] = {};
			node = node[parts[i]];
		}
		if (value === null || value === undefined) delete node[parts[parts.length - 1]];
		else node[parts[parts.length - 1]] = value;
		for (let i = parts.length - 2; i >= 0; i--) {
			const parent = parts.slice(0, i).reduce((acc, part) => acc[part], obj);
			const child = parent[parts[i]];
			if (child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length === 0) delete parent[parts[i]];
		}
	}

	function customEditor(kind, specs, copyOptions, copyResolver) {
		const wrap = el("div", { class: "custom-editor" });
		const target = () => state.loadout.custom[kind] || (state.loadout.custom[kind] = {});
		if (copyOptions.length) {
			const copySelect = el("select", {}, [el("option", { value: "", text: "Copy values from…" }), ...copyOptions.map((o) => el("option", { value: o.value, text: o.label }))]);
			copySelect.addEventListener("change", () => {
				if (!copySelect.value) return;
				const source = copyResolver(copySelect.value);
				state.loadout.custom[kind] = source ? JSON.parse(JSON.stringify(source)) : {};
				onLoadoutChanged();
			});
			wrap.append(copySelect);
		}
		const grid = el("div", { class: "custom-grid" });
		for (const spec of specs) {
			const current = getPath(target(), spec.path);
			let displayValue = "";
			if (typeof current === "number") displayValue = spec.kind === "percent" ? Math.round(current * 10000) / 100 : current;
			grid.append(el("label", { class: "custom-field" }, [
				el("span", { text: spec.label }),
				el("input", {
					type: "number",
					step: "any",
					placeholder: spec.kind === "percent" ? "0" : spec.kind === "multiplier" ? "1" : "0",
					value: displayValue,
					onchange: (e) => {
						const raw = e.target.value === "" ? null : Number(e.target.value);
						const value = raw === null || !Number.isFinite(raw) ? null : spec.kind === "percent" ? raw / 100 : raw;
						setPath(target(), spec.path, value);
						onLoadoutChanged();
					},
				}),
				el("span", { class: "unit", text: spec.kind === "percent" ? "%" : spec.kind === "multiplier" ? "×" : "" }),
			]));
		}
		wrap.append(grid);
		wrap.append(el("details", {}, [
			el("summary", { text: "Advanced: edit all values as JSON" }),
			el("textarea", { class: "json-editor", rows: 8, value: JSON.stringify(target(), null, 2), onchange: (e) => { try { state.loadout.custom[kind] = JSON.parse(e.target.value || "{}"); onLoadoutChanged(); } catch (err) { toast("Invalid JSON"); } } }),
		]));
		return wrap;
	}

	function championSpecs() {
		const specs = STAT_TYPES.map((stat) => ({ path: `Damage.${stat}`, label: `${stat} damage`, kind: "percent" }));
		specs.push({ path: "Damage.Any", label: "Any damage", kind: "percent" });
		for (const type of SPECIAL_TYPES) specs.push({ path: `Damage.${type}`, label: `${type} damage`, kind: "percent" });
		specs.push({ path: "BossDamage", label: "Boss damage", kind: "percent" });
		specs.push({ path: "KillableMobDamage", label: "Killable mob damage", kind: "percent" });
		specs.push({ path: "FrozenTargetDamageBoost", label: "Frozen target damage", kind: "percent" });
		specs.push({ path: "CriticalHit.chance", label: "Crit chance", kind: "percent" });
		specs.push({ path: "CriticalHit.multiplier", label: "Crit multiplier", kind: "multiplier" });
		specs.push({ path: "Bleed.damageBoostPerStack", label: "Sword bleed per stack", kind: "percent" });
		specs.push({ path: "Bleed.maxStacks", label: "Sword bleed max stacks", kind: "number" });
		specs.push({ path: "Bleed.detonationMultiplier", label: "Sword bleed detonation", kind: "multiplier" });
		specs.push({ path: "LowTargetHealthDamageBoost.threshold", label: "Low target HP threshold", kind: "percent" });
		specs.push({ path: "LowTargetHealthDamageBoost.boost", label: "Low target HP damage", kind: "percent" });
		specs.push({ path: "LowHealthDamageBoost.threshold", label: "Own low HP threshold", kind: "percent" });
		specs.push({ path: "LowHealthDamageBoost.boost", label: "Own low HP damage", kind: "percent" });
		return specs;
	}

	function accessorySpecs() {
		const specs = STAT_TYPES.map((stat) => ({ path: `Damage.${stat}`, label: `${stat} damage`, kind: "percent" }));
		specs.push({ path: "Damage.Any", label: "Any damage", kind: "percent" });
		for (const type of SPECIAL_TYPES) specs.push({ path: `Damage.${type}`, label: `${type} damage`, kind: "percent" });
		specs.push({ path: "BossDamage", label: "Boss damage", kind: "percent" });
		specs.push({ path: "PvpDamage", label: "PvP damage", kind: "percent" });
		return specs;
	}

	function titleSpecs() {
		return [
			{ path: "StrengthDamage", label: "Strength damage", kind: "multiplier" },
			{ path: "ChakraDamage", label: "Chakra damage", kind: "multiplier" },
			{ path: "SwordDamage", label: "Sword damage", kind: "multiplier" },
			{ path: "AuthorityDamage", label: "Authority damage", kind: "multiplier" },
			{ path: "BloodlineDamage", label: "Bloodline damage", kind: "multiplier" },
			{ path: "CurseTechniqueDamage", label: "Cursed Technique damage", kind: "multiplier" },
			{ path: "FruitDamage", label: "Fruit damage", kind: "multiplier" },
			{ path: "KaguneDamage", label: "Kagune damage", kind: "multiplier" },
			{ path: "ReiatsuDamage", label: "Reiatsu damage", kind: "multiplier" },
			{ path: "StandDamage", label: "Stand damage", kind: "multiplier" },
			{ path: "BossDamage", label: "Boss damage", kind: "multiplier" },
			{ path: "DamageInDungeons", label: "Dungeon damage", kind: "multiplier" },
			{ path: "Dimension2Damage", label: "Dimension 2 damage", kind: "multiplier" },
			{ path: "TowerBossDamage", label: "Tower boss damage", kind: "multiplier" },
		];
	}

	function transformationEditor() {
		const wrap = el("div", { class: "custom-editor" });
		const target = () => state.loadout.custom.transformation || (state.loadout.custom.transformation = {});
		const options = Object.values(data.transformations).filter((t) => t.Perks).sort((a, b) => a.displayName.localeCompare(b.displayName));
		const copySelect = el("select", {}, [el("option", { value: "", text: "Copy values from…" }), ...options.map((t) => el("option", { value: t.id, text: t.displayName }))]);
		copySelect.addEventListener("change", () => {
			if (!copySelect.value) return;
			state.loadout.custom.transformation = JSON.parse(JSON.stringify(data.transformations[copySelect.value].Perks || {}));
			onLoadoutChanged();
		});
		wrap.append(copySelect);
		const grid = el("div", { class: "custom-grid" });
		function boostValue(stat) {
			const list = Array.isArray(target().damageBoost) ? target().damageBoost : [];
			const entry = list.find((b) => b.stat === stat);
			return entry ? entry.value : "";
		}
		function setBoost(stat, value) {
			const perks = target();
			const list = Array.isArray(perks.damageBoost) ? perks.damageBoost.filter((b) => b.stat !== stat) : [];
			if (value !== null) list.push({ stat, value });
			if (list.length) perks.damageBoost = list;
			else delete perks.damageBoost;
		}
		for (const stat of ["Universal", ...STAT_TYPES]) {
			grid.append(el("label", { class: "custom-field" }, [
				el("span", { text: `${stat} damage` }),
				el("input", { type: "number", step: "any", placeholder: "1", value: boostValue(stat), onchange: (e) => { const raw = e.target.value === "" ? null : Number(e.target.value); setBoost(stat, raw === null || !Number.isFinite(raw) ? null : raw); onLoadoutChanged(); } }),
				el("span", { class: "unit", text: "×" }),
			]));
		}
		for (const type of SPECIAL_TYPES) {
			const current = getPath(target(), `specialDamageBoost.${type}`);
			grid.append(el("label", { class: "custom-field" }, [
				el("span", { text: `${type} damage` }),
				el("input", { type: "number", step: "any", placeholder: "0", value: typeof current === "number" ? Math.round(current * 10000) / 100 : "", onchange: (e) => { const raw = e.target.value === "" ? null : Number(e.target.value); setPath(target(), `specialDamageBoost.${type}`, raw === null || !Number.isFinite(raw) ? null : raw / 100); onLoadoutChanged(); } }),
				el("span", { class: "unit", text: "%" }),
			]));
		}
		wrap.append(grid);
		wrap.append(el("details", {}, [
			el("summary", { text: "Advanced: edit all values as JSON" }),
			el("textarea", { class: "json-editor", rows: 8, value: JSON.stringify(target(), null, 2), onchange: (e) => { try { state.loadout.custom.transformation = JSON.parse(e.target.value || "{}"); onLoadoutChanged(); } catch (err) { toast("Invalid JSON"); } } }),
		]));
		return wrap;
	}

	function renderLoadout() {
		const panel = document.getElementById("loadout");
		panel.innerHTML = "";
		const loadout = state.loadout;

		panel.append(el("h2", { text: "Bonus stacking" }));
		panel.append(el("div", { class: "mode-buttons" }, [
			el("button", { class: loadout.stacking !== "additive" ? "active" : "", text: "Multiplicative (live)", onclick: () => { loadout.stacking = "multiplicative"; onLoadoutChanged(); } }),
			el("button", { class: loadout.stacking === "additive" ? "active" : "", text: "Additive (upcoming)", onclick: () => { loadout.stacking = "additive"; onLoadoutChanged(); } }),
		]));
		panel.append(el("div", { class: "hint", text: loadout.stacking === "additive" ? "All bonus percentages are summed once, then applied. Crits, vulnerability, bleed and damage reduction stay multiplicative." : "Each bonus multiplies the last, as the game currently does." }));

		panel.append(el("h2", { text: "Target" }));
		const modes = [["boss", "Boss / dungeon / tower"], ["mob", "Regular mob"], ["duel", "Duel / tournament"], ["freepvp", "Free-roam PvP"]];
		panel.append(el("div", { class: "mode-buttons" }, modes.map(([value, label]) => el("button", { class: loadout.mode === value ? "active" : "", text: label, onclick: () => { loadout.mode = value; if (value === "duel") loadout.targetMaxHealth = 1000; onLoadoutChanged(); } }))));
		panel.append(el("div", { class: "hint", text: loadout.mode === "boss" ? "Uses BossDmg; your stats are ignored." : loadout.mode === "duel" ? "Uses PlayerDmg against a 1000 HP target." : "Uses your stat × PveDmgMultiplier." }));

		if (loadout.mode === "boss") {
			const bosses = data.entities.filter((e) => e.isBoss || e.isTrueDamageDummy).sort((a, b) => a.name.localeCompare(b.name));
			panel.append(field("Boss", selectInput("targetEntityId", [{ value: "", label: "Custom HP" }, ...bosses.map((b) => ({ value: b.id, label: `${b.name} (${formatNumber(b.maxHealth)} HP)` }))], {
				set: (value) => { loadout.targetEntityId = value; const boss = bosses.find((b) => b.id === value); if (boss && typeof boss.maxHealth === "number") loadout.targetMaxHealth = boss.maxHealth; },
			})));
		}
		panel.append(field("Place", selectInput("place", [["overworld", "Overworld"], ["dimension2", "Dimension 2"], ["dungeon", "Dungeon"], ["tower", "Tower"]].map(([value, label]) => ({ value, label })))));
		panel.append(field("Target max HP", numberInput("targetMaxHealth", { min: 1 }), "used for flat / % HP hits and lethal checks"));
		panel.append(field("Target HP %", numberInput("targetHealthPercent", { min: 0, max: 100, step: 1 })));
		if (loadout.mode === "freepvp" || loadout.mode === "duel") {
			panel.append(field("Target dmg reduction %", numberInput("targetDamageReduction", { min: 0, max: 100, step: 1 }), loadout.mode === "duel" ? "PvP low-health defense from accessories" : "defender's total reduction (title, champion, transformation…)"));
		}
		panel.append(field("Target vulnerability %", numberInput("targetVulnerability", { min: 0, step: 1 }), "champion vulnerability mark on the target"));
		panel.append(checkbox("targetFrozen", "Target is frozen"));
		panel.append(checkbox("targetBurning", "Target is burning", "enables boss burn damage-taken boosts"));

		panel.append(el("h2", { text: "Your stats" }));
		for (const stat of STAT_TYPES) {
			panel.append(el("div", { class: "field" }, [
				el("label", { text: stat }),
				el("div", { class: "row", style: "grid-template-columns: 2fr 1fr" }, [
					numberInput(null, { get: () => loadout.stats[stat], set: (v) => (loadout.stats[stat] = v), min: 0 }),
					numberInput(null, { get: () => loadout.statLimits[stat], set: (v) => (loadout.statLimits[stat] = v), min: 0, max: 100, step: 1 }),
				]),
			]));
		}
		panel.append(el("div", { class: "hint", text: "stat value · limit % (the in-game stat limit setting)" }));
		panel.append(field("Your HP %", numberInput("attackerHealthPercent", { min: 0, max: 100, step: 1 }), "drives low-health and missing-health boosts"));

		panel.append(el("h2", { text: "Champion" }));
		const champions = Object.values(data.champions).sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || a.displayName.localeCompare(b.displayName));
		panel.append(field("Champion", selectInput("championId", [{ value: "", label: "None" }, { value: CUSTOM, label: "Custom champion…" }, ...champions.map((c) => ({ value: c.id, label: `${c.displayName} · ${c.rarity || ""}` }))])));
		const champion = Engine.getChampion(data, loadout);
		if (champion && champion.isCustom) {
			panel.append(customEditor("champion", championSpecs(), champions.map((c) => ({ value: c.id, label: c.displayName })), (id) => data.champions[id] && data.champions[id].Boosts));
		} else if (champion) {
			panel.append(el("div", { class: "champion-preview" }, [iconImage(champion.icon, "champion-icon"), el("div", { class: "hint", text: champion.specialPerkDescription || champion.displayName })]));
		}
		const traits = Object.values(data.traits).filter((t) => t.tiers.some((tier) => (tier.effects || []).some((e) => e.category === "DamageBoost")));
		panel.append(field("Trait", selectInput("traitId", [{ value: "", label: "None" }, { value: CUSTOM, label: "Custom trait…" }, ...traits.map((t) => ({ value: t.id, label: t.name }))], { set: (v) => { loadout.traitId = v; loadout.traitTier = 0; } })));
		if (loadout.traitId === CUSTOM) {
			panel.append(field("Trait damage %", numberInput("customTraitBoost", { min: 0, step: 1 })));
		} else if (loadout.traitId && data.traits[loadout.traitId]) {
			const tiers = data.traits[loadout.traitId].tiers;
			panel.append(field("Trait tier", selectInput("traitTier", tiers.map((tier, index) => ({ value: String(index), label: `${tier.rarity} (+${Math.round(((tier.effects || []).find((e) => e.category === "DamageBoost") || { modifier: 0 }).modifier * 100)}%)` })), { get: () => String(loadout.traitTier), set: (v) => (loadout.traitTier = Number(v)) })));
			if (loadout.traitId === "Berserker") panel.append(checkbox("berserkerActive", "Berserker active (≤ 50% HP)"));
		}
		if (champion) {
			const boosts = champion.Boosts || {};
			if (boosts.InCombatStacking) panel.append(field("Combat stacks", numberInput("combatStacks", { min: 0, max: boosts.InCombatStacking.maxStacks, step: 1 }), `max ${boosts.InCombatStacking.maxStacks}`));
			if (boosts.DamageStackOnHit) panel.append(field("Hit stacks", numberInput("hitStacks", { min: 0, max: boosts.DamageStackOnHit.maxStacks, step: 1 }), `max ${boosts.DamageStackOnHit.maxStacks}`));
			if (boosts.ChakraMeltdown) panel.append(checkbox("chakraMeltdown", "Chakra meltdown active"));
			if (boosts.LowHealthBerserker) panel.append(checkbox("berserkerActive", "Low-health berserker active"));
			if (boosts.DaytimeBoost) panel.append(checkbox("daytime", "Daytime"));
			if (boosts.NirvanasBlessing) panel.append(checkbox("nirvana", "Nirvana's blessing active"));
			if (boosts.MoveModifiers && Object.values(boosts.MoveModifiers).some((m) => m && m.shrineDamageBoost)) panel.append(checkbox("shrineActive", "Shrine active"));
			if (boosts.CriticalHit) {
				panel.append(field("Critical hits", selectInput("critMode", [["none", "Ignore"], ["expected", "Average (chance-weighted)"], ["always", "Always crit"]].map(([value, label]) => ({ value, label })))));
				if (boosts.CriticalHit.combatChanceBonus) panel.append(checkbox("critCombatBonus", `In combat ≥ ${boosts.CriticalHit.combatReadDuration}s (+crit chance)`));
			}
			if (boosts.Bleed) panel.append(el("div", { class: "hint", text: `Sword bleed: +${Math.round((boosts.Bleed.damageBoostPerStack || 0) * 100)}% per stack, max ${boosts.Bleed.maxStacks}, detonates ×${boosts.Bleed.detonationMultiplier}` }));
		}

		panel.append(el("h2", { text: "Title & accessories" }));
		const titles = Object.values(data.titles).sort((a, b) => a.displayName.localeCompare(b.displayName));
		panel.append(field("Title", selectInput("titleId", [{ value: "", label: "None" }, { value: CUSTOM, label: "Custom title…" }, ...titles.map((t) => ({ value: t.id, label: `${t.displayName} · ${Object.entries(t.effects).map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} ×${v}`).join(", ")}` }))])));
		if (loadout.titleId === CUSTOM) {
			panel.append(customEditor("title", titleSpecs(), titles.map((t) => ({ value: t.id, label: t.displayName })), (id) => data.titles[id] && data.titles[id].effects));
		}
		for (const kind of ACCESSORY_KINDS) {
			const items = Object.values(data.accessories).filter((a) => a.kind === kind).sort((a, b) => a.displayName.localeCompare(b.displayName));
			if (items.length === 0) continue;
			panel.append(field(kind, selectInput(null, [{ value: "", label: "None" }, ...items.map((a) => ({ value: a.id, label: a.displayName }))], {
				get: () => loadout.accessories[kind] || "",
				set: (v) => { if (v) loadout.accessories[kind] = v; else delete loadout.accessories[kind]; },
			})));
		}
		const customAccessoryOn = loadout.accessories.Custom === CUSTOM;
		panel.append(el("label", { class: "check" }, [
			el("input", { type: "checkbox", checked: customAccessoryOn, onchange: (e) => { if (e.target.checked) loadout.accessories.Custom = CUSTOM; else delete loadout.accessories.Custom; onLoadoutChanged(); } }),
			"Custom accessory (extra slot)",
		]));
		if (customAccessoryOn) {
			panel.append(customEditor("accessory", accessorySpecs(), Object.values(data.accessories).sort((a, b) => a.displayName.localeCompare(b.displayName)).map((a) => ({ value: a.id, label: a.displayName })), (id) => data.accessories[id] && data.accessories[id].Boosts));
		}
		const equipped = Engine.getAccessoryConfigs(data, loadout).filter((a) => !a.isCustom);
		if (equipped.length) panel.append(el("div", { class: "hint", text: equipped.map((a) => a.description).filter(Boolean).join(" ") }));

		panel.append(el("h2", { text: "Transformation & stand" }));
		const transformations = Object.values(data.transformations).sort((a, b) => a.displayName.localeCompare(b.displayName));
		panel.append(field("Transformation", selectInput("transformationId", [{ value: "", label: "None" }, { value: CUSTOM, label: "Custom transformation…" }, ...transformations.map((t) => ({ value: t.id, label: `${t.displayName}${t.specialCategory ? ` (${t.specialCategory})` : ""}` }))])));
		const transformation = Engine.getTransformation(data, loadout);
		if (transformation && transformation.isCustom) {
			panel.append(transformationEditor());
		} else if (transformation && transformation.Perks) {
			const perks = transformation.Perks;
			const parts = [];
			for (const boost of perks.damageBoost || []) parts.push(`${boost.stat} ×${boost.value}`);
			for (const [type, value] of Object.entries(perks.specialDamageBoost || {})) parts.push(`${type} +${Math.round(value * 100)}%`);
			if (perks.damageReduction) parts.push(`${Math.round(perks.damageReduction * 100)}% damage reduction`);
			if (perks.healthBoost) parts.push(`HP ×${perks.healthBoost}`);
			panel.append(el("div", { class: "hint", text: parts.join(" · ") || "no damage perks" }));
		}
		panel.append(checkbox("hardenFist", "Harden Fist active (Strength ×1.15)"));
		const stands = Object.values(data.specials).filter((s) => s.kind === "Stand").sort((a, b) => a.displayName.localeCompare(b.displayName));
		panel.append(field("Stand", selectInput("standId", [{ value: "", label: "None / default" }, ...stands.map((s) => ({ value: s.id, label: s.displayName }))])), "applies stand overrides to shared stand moves");

		panel.append(el("h2", { text: "Buffs & debuffs" }));
		panel.append(field("DamageBuff status %", numberInput("damageBuff", { min: 0, step: 1 }), "e.g. from a buff move or champion"));
		panel.append(field("Party damage %", numberInput("partyDamageBoost", { min: 0, step: 1 }), "champion party aura on you"));
		panel.append(field("You are burning ×", numberInput("attackerBurnDebuff", { min: 0, max: 1, step: 0.05 }), "intense burn outgoing multiplier (1 = not burning)"));
		panel.append(field("Bleed stacks on target", numberInput("bleedStacks", { min: 0, max: 30, step: 1 }), "already applied before this move"));
		if (loadout.mode === "duel") panel.append(checkbox("pvpJuggernaut", "Tournament juggernaut (×1.5)"));
		panel.append(checkbox("includeDot", "Include damage over time in totals"));
		panel.append(checkbox("includeBleedDetonation", "Include bleed detonation if the move overflows 30 stacks"));
	}

	function onLoadoutChanged() {
		save();
		renderLoadout();
		renderActivePanel();
	}

	function renderActivePanel() {
		if (state.tab === "move") renderMovePanel();
		else if (state.tab === "compare") renderComparePanel();
		else if (state.tab === "combo") renderComboPanel();
		else if (state.tab === "diff") renderDiffPanel();
		else renderHelpPanel();
	}

	function render() {
		document.querySelectorAll("#main-tabs .tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.tab));
		document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${state.tab}`));
		renderTree();
		renderLoadout();
		renderActivePanel();
	}

	function applyTheme(theme) {
		document.documentElement.setAttribute("data-theme", theme);
		const toggle = document.getElementById("theme-toggle");
		if (toggle) toggle.checked = theme === "dark";
		try {
			localStorage.setItem(THEME_KEY, theme);
		} catch (err) {
			/* storage unavailable */
		}
	}

	function initTheme() {
		const current = document.documentElement.getAttribute("data-theme") || "light";
		const toggle = document.getElementById("theme-toggle");
		toggle.checked = current === "dark";
		toggle.addEventListener("change", () => applyTheme(toggle.checked ? "dark" : "light"));
		if (window.matchMedia) {
			window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
				let stored = null;
				try { stored = localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }
				if (!stored) applyTheme(event.matches ? "dark" : "light");
			});
		}
	}

	function init() {
		load();
		loadOpenGroups();
		initTheme();
		const updated = data.generatedAt ? new Date(data.generatedAt) : null;
		document.getElementById("data-stamp").textContent = `${moveCatalog.length} moves${updated ? ` · data from ${updated.toLocaleDateString()}` : ""}`;
		document.querySelectorAll("#main-tabs .tab").forEach((tab) => tab.addEventListener("click", () => { state.tab = tab.dataset.tab; render(); }));
		document.getElementById("search").addEventListener("input", (e) => { state.search = e.target.value; renderTree(); });
		document.getElementById("filter-hide-utility").addEventListener("change", (e) => { state.hideUtility = e.target.checked; renderTree(); });
		document.getElementById("share-button").addEventListener("click", shareLink);
		document.getElementById("reset-button").addEventListener("click", () => { state.loadout = Engine.defaultLoadout(); state.combo = []; save(); history.replaceState(null, "", location.pathname); render(); toast("Reset"); });
		if (!state.selected) {
			const first = moveCatalog.find((e) => e.powerId === "JudgementCut") || moveCatalog[0];
			if (first) state.selected = { powerId: first.powerId, standId: first.standId };
		}
		openGroupsForSelection();
		render();
	}

	init();
})();
