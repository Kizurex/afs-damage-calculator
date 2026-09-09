(function () {
	"use strict";

	const data = window.GAME_DATA;
	const Engine = window.Engine;
	const STORAGE_KEY = "afs-damage-calculator-v1";
	const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc", "Ud", "Dd", "Td", "Qad", "Qid", "Sxd", "Spd", "Ocd", "Nod", "Vg"];
	const KIND_LABELS = {
		Authority: "Authorities",
		Bloodline: "Bloodlines",
		BreathingTechnique: "Breathing Styles",
		CursedTechnique: "Cursed Techniques",
		Fruit: "Fruits",
		Kagune: "Kagunes",
		Other: "Other",
		Permanent: "Permanent",
		Reiatsu: "Reiatsu",
		Stand: "Stands",
	};
	const STAT_FOLDERS = ["Strength", "Chakra", "Sword", "Speed", "Agility", "Durability"];
	const ACCESSORY_KINDS = ["Hat", "Face", "Body", "Back", "Arm", "Waist", "Leg", "Other"];
	const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic", "Secret", "Exclusive", "Sovereign"];

	const state = {
		loadout: Engine.defaultLoadout(),
		combo: [],
		selected: null,
		tab: "move",
		compare: { sort: "total", dir: -1, category: "all", stat: "all", search: "" },
		search: "",
		hideUtility: false,
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
				const key = standId ? `${ability.powerId}@${standId}` : ability.powerId;
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
			entries.push({
				key: power.id,
				powerId: power.id,
				standId: null,
				specialId: null,
				abilityKey: null,
				label: power.displayName || power.id,
				group: power.isSpecial ? power.specialType : power.statFolder,
			});
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
		let tier = Math.floor(Math.log10(abs) / 3);
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

	function el(tag, attrs, children) {
		const node = document.createElement(tag);
		if (attrs) {
			for (const [key, value] of Object.entries(attrs)) {
				if (value === null || value === undefined || value === false) continue;
				if (key === "class") node.className = value;
				else if (key === "text") node.textContent = value;
				else if (key === "html") node.innerHTML = value;
				else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
				else if (key === "checked" || key === "disabled" || key === "selected" || key === "hidden") node[key] = value;
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

	function load() {
		let restored = null;
		const hash = location.hash;
		if (hash.startsWith("#s=")) {
			try {
				restored = JSON.parse(decodeURIComponent(escape(atob(hash.slice(3)))));
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
		if (restored && restored.loadout) state.loadout = Object.assign(Engine.defaultLoadout(), restored.loadout);
		if (restored && Array.isArray(restored.combo)) state.combo = restored.combo.filter((e) => e && data.powers[e.powerId]);
		if (restored && restored.selected && data.powers[restored.selected.powerId]) state.selected = restored.selected;
	}

	function shareLink() {
		const payload = JSON.stringify({ loadout: state.loadout, combo: state.combo, selected: state.selected });
		const encoded = btoa(unescape(encodeURIComponent(payload)));
		const url = `${location.origin}${location.pathname}#s=${encoded}`;
		copyText(url).then(() => toast("Share link copied"));
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
		const standId = state.selected.standId || (state.loadout.standId || null);
		return Engine.getMoveConfig(data, state.selected.powerId, standId);
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
		const haystack = [entry.label, entry.powerId, power.displayName, special && special.displayName, special && special.id, power.specialCategory, power.specialType, power.statType]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
		return haystack.includes(query);
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
			const node = el("div", { class: `leaf${active ? " active" : ""}${power.isDisabled ? " disabled" : ""}`, title: entry.abilityName && entry.abilityName !== entry.label ? `Shown in the special as "${entry.abilityName}"` : null, onclick: () => selectMove(entry.powerId, entry.standId) }, [
				iconImage(power.icon, "leaf-icon") || (special ? iconImage(special.icon, "leaf-icon inherited") : null) || el("span", { class: "leaf-icon placeholder", text: (entry.label || "?").slice(0, 1) }),
				el("span", { class: "leaf-name", text: entry.label }),
				entry.abilityKey ? el("span", { class: "key", text: entry.abilityKey }) : null,
			]);
			return node;
		}

		function group(title, children, open) {
			const rendered = children.filter(Boolean);
			if (rendered.length === 0) return null;
			const details = el("details", { open: open || query ? true : null }, [
				el("summary", {}, [title, el("span", { class: "count", text: `(${rendered.length})` })]),
				...rendered,
			]);
			return details;
		}

		const powersGroups = STAT_FOLDERS.filter((folder) => folder !== "Durability").map((folder) => {
			const entries = moveCatalog.filter((e) => !e.specialId && !data.powers[e.powerId].isSpecial && data.powers[e.powerId].statFolder === folder);
			entries.sort((a, b) => a.label.localeCompare(b.label));
			return group(folder === "Durability" ? "Transformations (Durability)" : folder, entries.map(leaf), folder === "Strength");
		});
		container.append(group("Powers", powersGroups, true) || el("div"));

		const kinds = [...new Set(Object.values(data.specials).map((s) => s.kind))].sort();
		const specialGroups = kinds.map((kind) => {
			const specials = Object.values(data.specials).filter((s) => s.kind === kind).sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || a.displayName.localeCompare(b.displayName));
			const specialNodes = specials.map((special) => {
				const entries = moveCatalog.filter((e) => e.specialId === special.id);
				const leaves = entries.map(leaf);
				const title = el("span", { class: "special-title" }, [iconImage(special.icon, "tree-icon"), special.displayName, el("span", { class: "rarity", text: special.rarity || "" })]);
				return group(title, leaves, false);
			});
			return group(KIND_LABELS[kind] || kind, specialNodes, false);
		});
		container.append(group("Specials", specialGroups, true) || el("div"));

	}

	function rarityIndex(rarity) {
		const index = RARITY_ORDER.indexOf(rarity);
		return index === -1 ? 0 : index;
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

		const header = el("div", { class: "move-header" }, [
			iconImage(move.icon, "move-icon"),
			el("div", {}, [
				el("h1", { text: `${move.displayName || move.id}${stand ? ` (${stand.displayName})` : ""}` }),
				el("div", { class: "meta" }, [
					el("span", { class: `badge ${move.isSpecial ? "Special" : move.statType}`, text: move.isSpecial ? `Special · ${move.specialType}` : `Power · ${move.statType}` }),
					move.isSpecial && move.statType ? el("span", { class: `badge ${move.statType}`, text: `scales with ${move.statType}` }) : null,
					move.appliesBleed ? el("span", { class: "badge", text: `applies bleed ×${move.bleedStacks || 1}` }) : null,
					move.Transformation ? el("span", { class: "badge", text: `transformation (${move.TransformationType || "?"})` }) : null,
				]),
				el("p", { text: move.description || "" }),
				owners.length ? el("p", { class: "muted", text: `Used by: ${owners.join(", ")}` }) : null,
			]),
			el("div", { class: "move-actions" }, [
				el("button", { class: "primary", text: "Add to combo", onclick: () => addToCombo(move.id, state.selected.standId) }),
				el("button", { text: "Copy JSON", onclick: () => copyText(JSON.stringify(Engine.exportMoveJson(move, result), null, 2)).then(() => toast("Move JSON copied")) }),
			]),
		]);
		panel.append(header);

		panel.append(el("h2", { text: `Damage vs ${modeLabel(state.loadout.mode)}` }));
		panel.append(el("div", { class: "grid" }, [
			statCard("Total damage", formatNumber(result.total), `${result.totalHits} hit${result.totalHits === 1 ? "" : "s"}${result.totalDot && state.loadout.includeDot ? " + DoT" : ""}${result.detonation ? " + bleed detonation" : ""}`, "big"),
			statCard("Direct damage", formatNumber(result.totalDirect), result.hits.length ? `${result.hits.map((h) => `${h.count}× ${formatNumber(h.perHit)}`).join(" · ")}` : "no damaging hitbox"),
			statCard("Damage over time", formatNumber(result.totalDot), result.dots.length ? result.dots.map((d) => `${d.status.effect} ${formatNumber(d.total)} over ${formatSeconds(d.duration)}`).join(" · ") : "none"),
			statCard("DPS (during move)", result.dps === null ? "—" : formatNumber(result.dps), result.endlag !== null ? `over ${formatSeconds(result.endlag)} of endlag` : "no timing data"),
			statCard("Damage per cycle", result.damagePerCycle === null ? "—" : formatNumber(result.damagePerCycle), `cast + cooldown = ${formatSeconds(result.cycleTime)}`),
		]));

		panel.append(el("h2", { text: "Move data" }));
		panel.append(el("div", { class: "grid" }, [
			statCard("BossDmg", move.bossDamage ?? "—", "damage vs bosses, dungeons and tower"),
			statCard("PlayerDmg", move.playerDamage ?? "—", "damage vs players in duels and tournaments"),
			statCard("PveDmgMultiplier", move.damageMultiplier ?? "—", "× your stat vs regular mobs"),
			statCard("TickCount", String(result.totalHits), "max hits on one target"),
			statCard("CooldownSeconds", formatSeconds(move.baseCooldown), "before cooldown reductions"),
			statCard("ActivationTillCooldownStart", formatSeconds(runtime.activationTillCooldownStart), "from pressing the key to the cooldown starting"),
			statCard("ActivationTillEndlagEnd", formatSeconds(runtime.activationTillEndlagEnd), "from pressing the key to being able to attack again"),
			statCard("ActivationTillFirstHitbox", formatSeconds(runtime.activationTillFirstHitbox), "from pressing the key to the first hit landing"),
			statCard("DurationSeconds", formatSeconds(runtime.durationSeconds), "how long the move keeps hitting"),
			statCard("HitboxLengthSize", size[2] === null || size[2] === undefined ? "—" : String(size[2]), "depth in studs"),
			statCard("HitboxWidthSize", size[0] === null || size[0] === undefined ? "—" : String(size[0]), "width in studs"),
			statCard("HitboxHeightSize", size[1] === null || size[1] === undefined ? "—" : String(size[1]), "height in studs"),
		]));

		if (hits.length) {
			panel.append(el("h2", { text: "Hits" }));
			panel.append(el("div", { class: "table-wrap" }, el("table", {}, [
				el("thead", {}, el("tr", {}, [
					el("th", { text: "Hit" }), el("th", { class: "num", text: "Max hits" }), el("th", { class: "num", text: "Per hit" }), el("th", { class: "num", text: "Total" }), el("th", { text: "Hitbox" }), el("th", { class: "num", text: "Starts" }), el("th", { class: "num", text: "Window" }), el("th", { text: "Conditions" }),
				])),
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

		panel.append(el("h2", { text: "Damage breakdown (one full hit)" }));
		const breakdown = el("ul", { class: "breakdown" });
		for (const step of result.baseSteps) {
			breakdown.append(el("li", {}, [el("span", { text: step.label }), el("span", { text: step.label.includes("stat") || step.label.includes("Damage") && step.value > 50 ? formatNumber(step.value) : formatMultiplier(step.value) })]));
		}
		for (const step of result.postSteps) {
			breakdown.append(el("li", {}, [el("span", { text: step.label }), el("span", { text: formatMultiplier(step.value) })]));
		}
		breakdown.append(el("li", { class: "total" }, [el("span", { text: "Damage per full hit" }), el("span", { text: formatNumber(result.perHitBase * result.postMultiplier) })]));
		panel.append(breakdown);
	}

	function modeLabel(mode) {
		return { boss: "bosses / dungeon / tower mobs", mob: "regular mobs", duel: "players in duels & tournaments", freepvp: "players in free roam" }[mode] || mode;
	}

	function renderComparePanel() {
		const panel = document.getElementById("panel-compare");
		panel.innerHTML = "";
		const controls = el("div", { class: "compare-controls" }, [
			el("input", { type: "search", placeholder: "Filter…", value: state.compare.search, oninput: (e) => { state.compare.search = e.target.value; renderComparePanel(); } }),
			el("select", { onchange: (e) => { state.compare.category = e.target.value; renderComparePanel(); } }, [
				el("option", { value: "all", text: "All categories", selected: state.compare.category === "all" }),
				el("option", { value: "Power", text: "Powers", selected: state.compare.category === "Power" }),
				...Object.keys(KIND_LABELS).map((kind) => el("option", { value: kind, text: KIND_LABELS[kind], selected: state.compare.category === kind })),
			]),
			el("select", { onchange: (e) => { state.compare.stat = e.target.value; renderComparePanel(); } }, [
				el("option", { value: "all", text: "Any scaling", selected: state.compare.stat === "all" }),
				...["Strength", "Chakra", "Sword"].map((stat) => el("option", { value: stat, text: stat, selected: state.compare.stat === stat })),
			]),
			el("span", { class: "muted", text: `vs ${modeLabel(state.loadout.mode)}` }),
		]);
		panel.append(controls);

		const query = state.compare.search.trim().toLowerCase();
		const rows = [];
		for (const entry of moveCatalog) {
			const power = data.powers[entry.powerId];
			if (power.category === "Enemy") continue;
			if (power.isDisabled) continue;
			if (state.compare.category === "Power" && power.isSpecial) continue;
			if (state.compare.category !== "all" && state.compare.category !== "Power" && entry.group !== state.compare.category) continue;
			if (state.compare.stat !== "all" && power.statType !== state.compare.stat) continue;
			if (!catalogEntryMatches(entry, query)) continue;
			const move = Engine.getMoveConfig(data, entry.powerId, entry.standId);
			if (!isDamaging(move)) continue;
			const result = Engine.computeMove(data, state.loadout, move);
			const special = entry.specialId ? data.specials[entry.specialId] : null;
			rows.push({
				entry,
				move,
				result,
				name: `${entry.label}${entry.standId ? ` (${data.specials[entry.standId].displayName})` : ""}`,
				source: special ? special.displayName : power.statType,
				total: result.total,
				perHit: result.perHitBase * result.postMultiplier,
				hits: result.totalHits,
				dps: result.dps,
				cycle: result.damagePerCycle,
				cooldown: result.cooldown,
				endlag: result.endlag,
				bossDamage: move.bossDamage ?? null,
				playerDamage: move.playerDamage ?? null,
				multiplier: move.damageMultiplier ?? null,
			});
		}
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
		const table = el("table", {}, [
			el("thead", {}, el("tr", {}, columns.map(([key, label, numeric]) => el("th", {
				class: `sortable${numeric ? " num" : ""}${sortKey === key ? " active" : ""}`,
				text: `${label}${sortKey === key ? (state.compare.dir === -1 ? " ↓" : " ↑") : ""}`,
				onclick: () => { if (state.compare.sort === key) state.compare.dir *= -1; else { state.compare.sort = key; state.compare.dir = numeric ? -1 : 1; } renderComparePanel(); },
			})))),
			el("tbody", {}, rows.map((row) => el("tr", { class: "clickable", onclick: () => selectMove(row.entry.powerId, row.entry.standId) }, [
				el("td", { text: row.name }),
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
		]);
		panel.append(el("p", { class: "muted", text: `${rows.length} damaging moves. Click a column to sort, a row to open the move.` }));
		panel.append(el("div", { class: "table-wrap" }, table));
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
		const options = moveCatalog
			.filter((e) => data.powers[e.powerId].category !== "Enemy" && !data.powers[e.powerId].isDisabled)
			.sort((a, b) => a.label.localeCompare(b.label));
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
					el("div", {}, [
						el("strong", { text: `${row.move.displayName || row.move.id}${row.entry.standId ? ` (${data.specials[row.entry.standId].displayName})` : ""}` }),
					]),
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
				el("td", { class: "num", text: row.result.runtime && row.result.runtime.activationTillFirstHitbox !== null && row.result.runtime.activationTillFirstHitbox !== undefined ? formatSeconds(row.startAt + row.result.runtime.activationTillFirstHitbox) : "—" }),
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

	function renderHelpPanel() {
		const panel = document.getElementById("panel-help");
		panel.innerHTML = "";
		panel.className = "panel help";
		panel.innerHTML = `
			<h1>Guide</h1>
			<p>This calculator exists to make balancing easier: it reproduces the game's damage rules for any move, loadout and target, so you can check a number, compare two moves side by side or test a whole combo without stepping into the game. Everything below is driven by the three panes: the <b>move list</b> on the left, the <b>workspace</b> in the middle (Move, Compare, Combo) and the <b>loadout</b> on the right.</p>

			<h2>1. Quick start</h2>
			<ol>
				<li>Pick a <b>target mode</b> at the top of the loadout pane. This decides which damage rule is used and is the single most important setting.</li>
				<li>Fill in the rest of the loadout: stats, champion, title, accessories, transformation, stand and any active buffs or debuffs. Every change recalculates instantly.</li>
				<li>Click a move on the left. The <b>Move</b> tab shows its damage for that loadout, the move data table, hits, statuses and a step-by-step breakdown of every multiplier applied.</li>
				<li>Open <b>Compare</b> to rank every move for the same loadout, or add moves to <b>Combo</b> to chain them in order.</li>
				<li>Use <b>Share link</b> to copy a URL that restores the exact loadout and combo for someone else. <b>Reset</b> clears everything.</li>
			</ol>

			<h2>2. Finding a move</h2>
			<ul>
				<li>The list is grouped into <b>Powers</b> (Strength, Chakra, Sword, Speed, Agility) and <b>Specials</b> (Authorities, Bloodlines, Breathing Styles, Cursed Techniques, Fruits, Kagunes, Permanent, Reiatsu, Stands). Each special expands into its Z / X / C / V abilities.</li>
				<li>Stand moves that are shared between stands (barrages, Timestop) appear once per stand with that stand's own damage and cooldown values.</li>
				<li>The search box matches move names, special names and scaling types. <b>Hide non-damaging moves</b> removes buffs, dashes and transformations from the list.</li>
				<li>A move's tooltip shows the name the special's ability list uses when it differs from the move's own name.</li>
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
			<p>Below that, <b>Hits</b> lists each separate hit source (for example an initial slash and a follow-up explosion) with its hit cap, per-hit damage, hitbox and timing, and <b>Statuses applied</b> lists crowd control and damage over time with duration and target. The <b>Damage breakdown</b> shows every multiplier in the order it is applied, so you can see exactly where a number comes from. <b>Copy JSON</b> copies the move data in a shareable format.</p>

			<h2>4. Target modes</h2>
			<ul>
				<li><b>Boss / dungeon / tower</b> — every hit deals <code>BossDmg</code> × boosts. Stats are ignored. Pick a boss from the list to load its HP for lethal checks.</li>
				<li><b>Regular mob</b> — stat × stat limit × boosts × <code>PveDmgMultiplier</code>. Enter the stat that matches the move's scaling (Sword for sword moves, Chakra for fruits, and so on).</li>
				<li><b>Duel / tournament</b> — every hit deals <code>PlayerDmg</code> against a 1000 HP opponent. Only PvP-specific boosts apply: accessory PvP damage, bleed, juggernaut and the defender's PvP low-health defense.</li>
				<li><b>Free-roam PvP</b> — same base as regular mobs, then the defender's total damage reduction (title, champion, transformation, party buffs) is subtracted. Enter it as one percentage.</li>
			</ul>
			<p><b>Place</b> switches on location-only effects: Dimension 2 titles, dungeon-only champion boosts and tower boss titles.</p>

			<h2>5. Loadout reference</h2>
			<ul>
				<li><b>Target</b> — max HP (used for lethal checks and any hit that scales with target HP), current HP %, damage reduction, vulnerability %, and whether the target is frozen or burning. Some champions deal more to frozen targets; some burns deal more to bosses.</li>
				<li><b>Your stats</b> — the stat value and the in-game stat limit percentage for Strength, Chakra and Sword. Your HP % drives low-health and missing-health boosts.</li>
				<li><b>Champion</b> — applies the champion's damage boosts and unlocks its specific toggles (combat stacks, hit stacks, meltdown, berserker, daytime, shrine). <b>Critical hits</b> can be ignored, averaged by chance, or forced on every hit. Traits with a damage boost are selectable with their tier.</li>
				<li><b>Title &amp; accessories</b> — titles that change damage; one accessory per slot, with their damage, special-specific and boss-damage boosts summed the way the game does.</li>
				<li><b>Transformation &amp; stand</b> — the active transformation's damage perks, the Harden Fist buff, and which stand you are using (this chooses the override values for shared stand moves).</li>
				<li><b>Buffs &amp; debuffs</b> — an active DamageBuff status, a party damage aura, the intense-burn multiplier when you are burning, and bleed stacks already on the target. <b>Include damage over time</b> and <b>Include bleed detonation</b> control what goes into totals.</li>
			</ul>

			<h2>6. Compare tab</h2>
			<ul>
				<li>Every damaging move is calculated with the current loadout. Click a column header to sort, click again to flip. Click a row to open the move.</li>
				<li>Filter by category (Powers or a special kind), by scaling stat, or by name.</li>
				<li>For balancing, the most useful columns are <b>Per hit</b> and <b>Total</b> (burst), <b>DPS</b> (how quickly the damage comes out) and <b>Dmg / cycle</b> (sustained output including cooldown). A move with high Total but low Dmg / cycle is a long-cooldown burst tool; the reverse is a spammable filler.</li>
				<li>To compare specials fairly, keep the loadout fixed and only change the category filter. To compare across scaling types, set all three stats to the same value.</li>
			</ul>

			<h2>7. Combo tab</h2>
			<ul>
				<li>Add moves in the order you would press them, from the picker or with <b>Add to combo</b> on a move card. Reorder with the arrows, remove with ✕.</li>
				<li>Each move starts when the previous one's endlag ends. If a move is still on cooldown, the combo waits for it and the wait is shown on that row.</li>
				<li>The timeline lists start, first-hit and end times, damage, running total and when each cooldown will be ready again.</li>
				<li>Bleed is simulated: bleeding moves add stacks per hit, stacks decay while no bleeding hit lands, and passing the stack cap detonates. The stack count after each move is shown.</li>
				<li><b>Combo DPS</b> is total damage over total time, including any cooldown waits. <b>Target HP</b> tells you whether the combo is lethal for the HP you entered.</li>
			</ul>

			<h2>8. Status effects</h2>
			<ul>
				<li><b>Burn</b> — damage over time, usually a fraction of <code>BossDmg</code> spread over the duration. Some burns also weaken the burned player's own damage: model that with "You are burning".</li>
				<li><b>Bleed</b> — moves that bleed add stacks on every hit (+2% damage per stack, up to 30). Past 30 stacks the bleed detonates for half of the damage stored in those stacks. Sword champions with a bleed perk bleed on every sword hit.</li>
				<li><b>Frozen, Stunned, Slowed, Heavy</b> — listed on the move with duration and who they affect.</li>
				<li><b>Vulnerability</b> — a mark that makes the target take more damage; enter the percentage in the loadout while it is active.</li>
			</ul>

			<h2>9. Assumptions and limits</h2>
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
				if (options && options.set) options.set(Number.isFinite(parsed) ? parsed : 0);
				else loadout[key] = Number.isFinite(parsed) ? parsed : 0;
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

	function renderLoadout() {
		const panel = document.getElementById("loadout");
		panel.innerHTML = "";
		const loadout = state.loadout;

		panel.append(el("h2", { text: "Target" }));
		const modes = [["boss", "Boss / dungeon / tower"], ["mob", "Regular mob"], ["duel", "Duel / tournament"], ["freepvp", "Free-roam PvP"]];
		panel.append(el("div", { class: "mode-buttons" }, modes.map(([value, label]) => el("button", { class: loadout.mode === value ? "active" : "", text: label, onclick: () => { loadout.mode = value; if (value === "duel") loadout.targetMaxHealth = 1000; onLoadoutChanged(true); } }))));
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
		for (const stat of ["Strength", "Chakra", "Sword"]) {
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
		panel.append(field("Champion", selectInput("championId", [{ value: "", label: "None" }, ...champions.map((c) => ({ value: c.id, label: `${c.displayName} · ${c.rarity || ""}` }))])));
		const champion = loadout.championId ? data.champions[loadout.championId] : null;
		if (champion) panel.append(el("div", { class: "champion-preview" }, [iconImage(champion.icon, "champion-icon"), el("div", { class: "hint", text: champion.specialPerkDescription || champion.displayName })]));
		const traits = Object.values(data.traits).filter((t) => t.tiers.some((tier) => (tier.effects || []).some((e) => e.category === "DamageBoost")));
		panel.append(field("Trait", selectInput("traitId", [{ value: "", label: "None" }, ...traits.map((t) => ({ value: t.id, label: t.name }))], { set: (v) => { loadout.traitId = v; loadout.traitTier = 0; } })));
		if (loadout.traitId && data.traits[loadout.traitId]) {
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
			if (boosts.Bleed) panel.append(el("div", { class: "hint", text: `Sword bleed: +${Math.round(boosts.Bleed.damageBoostPerStack * 100)}% per stack, max ${boosts.Bleed.maxStacks}, detonates ×${boosts.Bleed.detonationMultiplier}` }));
		}

		panel.append(el("h2", { text: "Title & accessories" }));
		const titles = Object.values(data.titles).sort((a, b) => a.displayName.localeCompare(b.displayName));
		panel.append(field("Title", selectInput("titleId", [{ value: "", label: "None" }, ...titles.map((t) => ({ value: t.id, label: `${t.displayName} · ${Object.entries(t.effects).map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} ×${v}`).join(", ")}` }))])));
		for (const kind of ACCESSORY_KINDS) {
			const items = Object.values(data.accessories).filter((a) => a.kind === kind).sort((a, b) => a.displayName.localeCompare(b.displayName));
			if (items.length === 0) continue;
			panel.append(field(kind, selectInput(null, [{ value: "", label: "None" }, ...items.map((a) => ({ value: a.id, label: a.displayName }))], {
				get: () => loadout.accessories[kind] || "",
				set: (v) => { if (v) loadout.accessories[kind] = v; else delete loadout.accessories[kind]; },
			})));
		}
		const equipped = Object.values(loadout.accessories).map((id) => data.accessories[id]).filter(Boolean);
		if (equipped.length) panel.append(el("div", { class: "hint", text: equipped.map((a) => a.description).join(" ") }));

		panel.append(el("h2", { text: "Transformation & stand" }));
		const transformations = Object.values(data.transformations).sort((a, b) => a.displayName.localeCompare(b.displayName));
		panel.append(field("Transformation", selectInput("transformationId", [{ value: "", label: "None" }, ...transformations.map((t) => ({ value: t.id, label: `${t.displayName}${t.specialCategory ? ` (${t.specialCategory})` : ""}` }))])));
		const transformation = loadout.transformationId ? data.transformations[loadout.transformationId] : null;
		if (transformation && transformation.Perks) {
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

	function onLoadoutChanged(rerenderLoadout) {
		save();
		if (rerenderLoadout) renderLoadout();
		else renderLoadout();
		renderActivePanel();
	}

	function renderActivePanel() {
		if (state.tab === "move") renderMovePanel();
		else if (state.tab === "compare") renderComparePanel();
		else if (state.tab === "combo") renderComboPanel();
		else renderHelpPanel();
	}

	function render() {
		document.querySelectorAll("#main-tabs .tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.tab));
		document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${state.tab}`));
		renderTree();
		renderLoadout();
		renderActivePanel();
	}

	const THEME_KEY = "afs-damage-calculator-theme";

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
		initTheme();
		document.getElementById("data-stamp").textContent = `${moveCatalog.length} moves`;
		document.querySelectorAll("#main-tabs .tab").forEach((tab) => tab.addEventListener("click", () => { state.tab = tab.dataset.tab; render(); }));
		document.getElementById("search").addEventListener("input", (e) => { state.search = e.target.value; renderTree(); });
		document.getElementById("filter-hide-utility").addEventListener("change", (e) => { state.hideUtility = e.target.checked; renderTree(); });
		document.getElementById("share-button").addEventListener("click", shareLink);
		document.getElementById("reset-button").addEventListener("click", () => { state.loadout = Engine.defaultLoadout(); state.combo = []; save(); history.replaceState(null, "", location.pathname); render(); toast("Reset"); });
		if (!state.selected) {
			const first = moveCatalog.find((e) => e.powerId === "JudgementCut") || moveCatalog[0];
			if (first) state.selected = { powerId: first.powerId, standId: first.standId };
		}
		render();
	}

	init();
})();
