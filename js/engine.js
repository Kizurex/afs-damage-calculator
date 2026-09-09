(function () {
	"use strict";

	const STAT_TITLE_EFFECT = { Strength: "StrengthDamage", Chakra: "ChakraDamage", Sword: "SwordDamage" };
	const SPECIAL_TITLE_EFFECT = {
		Authorities: "AuthorityDamage",
		Bloodlines: "BloodlineDamage",
		CursedTechniques: "CurseTechniqueDamage",
		Fruits: "FruitDamage",
		Kagunes: "KaguneDamage",
		Reiatsu: "ReiatsuDamage",
		Stands: "StandDamage",
	};
	const SPECIAL_TYPES = ["Authorities", "Bloodlines", "BreathingStyles", "CursedTechniques", "Fruits", "Kagunes", "Permanent", "Reiatsu", "Stands"];
	const CUSTOM_ID = "__custom";

	const MOVE_BLEED = { damageBoostPerStack: 0.02, decayInterval: 2, detonationMultiplier: 0.5, maxStacks: 30 };
	const HARDEN_FIST = 1.15;
	const JUGGERNAUT_MULTIPLIER = 1.5;
	const MOVE_OVERRIDE_FIELDS = [
		"bossDamage", "playerDamage", "damageMultiplier", "baseCooldown", "tickCount",
		"activationTillFirstHitbox", "activationTillEndlagEnd", "activationTillCooldownStart", "durationSeconds", "dotMultiplier",
	];

	function num(value, fallback) {
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	}

	function defaultLoadout() {
		return {
			mode: "boss",
			stacking: "multiplicative",
			stats: { Strength: 1e6, Chakra: 1e6, Sword: 1e6 },
			statLimits: { Strength: 100, Chakra: 100, Sword: 100 },
			championId: "",
			traitId: "",
			traitTier: 0,
			customTraitBoost: 0,
			titleId: "",
			accessories: {},
			transformationId: "",
			standId: "",
			custom: { champion: null, accessory: null, title: null, transformation: null },
			moveOverrides: {},
			attackerHealthPercent: 100,
			targetHealthPercent: 100,
			targetMaxHealth: 1000,
			targetEntityId: "",
			targetDamageReduction: 0,
			targetFrozen: false,
			targetBurning: false,
			targetVulnerability: 0,
			attackerBurnDebuff: 1,
			damageBuff: 0,
			partyDamageBoost: 0,
			combatStacks: 0,
			hitStacks: 0,
			daytime: false,
			hardenFist: false,
			chakraMeltdown: false,
			berserkerActive: false,
			nirvana: false,
			pvpJuggernaut: false,
			critMode: "none",
			place: "overworld",
			bleedStacks: 0,
			includeDot: true,
			includeBleedDetonation: false,
		};
	}

	function moveKey(powerId, standId) {
		return standId ? `${powerId}@${standId}` : powerId;
	}

	function hasOverrides(override) {
		return !!override && MOVE_OVERRIDE_FIELDS.some((field) => typeof override[field] === "number");
	}

	function cloneRuntime(runtime) {
		if (!runtime) return null;
		return {
			activationTillFirstHitbox: runtime.activationTillFirstHitbox ?? null,
			activationTillEndlagEnd: runtime.activationTillEndlagEnd ?? null,
			activationTillCooldownStart: runtime.activationTillCooldownStart ?? null,
			durationSeconds: runtime.durationSeconds ?? null,
			hits: (runtime.hits || []).map((hit) => Object.assign({}, hit)),
			statuses: (runtime.statuses || []).map((status) => Object.assign({}, status, { dot: status.dot ? Object.assign({}, status.dot) : status.dot })),
		};
	}

	function applyMoveOverride(config, override) {
		if (!hasOverrides(override)) return config;
		const original = {
			bossDamage: config.bossDamage ?? null,
			playerDamage: config.playerDamage ?? null,
			damageMultiplier: config.damageMultiplier ?? null,
			baseCooldown: config.baseCooldown ?? null,
			tickCount: config.runtime ? (config.runtime.hits || []).reduce((sum, hit) => sum + num(hit.count, 0), 0) : null,
			activationTillFirstHitbox: config.runtime ? config.runtime.activationTillFirstHitbox ?? null : null,
			activationTillEndlagEnd: config.runtime ? config.runtime.activationTillEndlagEnd ?? null : null,
			activationTillCooldownStart: config.runtime ? config.runtime.activationTillCooldownStart ?? null : null,
			durationSeconds: config.runtime ? config.runtime.durationSeconds ?? null : null,
			dotMultiplier: 1,
		};
		for (const field of ["bossDamage", "playerDamage", "damageMultiplier", "baseCooldown"]) {
			if (typeof override[field] === "number") config[field] = override[field];
		}
		const runtime = cloneRuntime(config.runtime) || { activationTillFirstHitbox: null, activationTillEndlagEnd: null, activationTillCooldownStart: null, durationSeconds: null, hits: [], statuses: [] };
		for (const field of ["activationTillFirstHitbox", "activationTillEndlagEnd", "activationTillCooldownStart", "durationSeconds"]) {
			if (typeof override[field] === "number") runtime[field] = override[field];
		}
		if (typeof override.tickCount === "number") {
			const damaging = runtime.hits.filter((hit) => hit.damage && hit.damage.basis !== "none");
			if (damaging.length === 0) {
				runtime.hits.push({ label: "Hit", count: override.tickCount, damage: { basis: "power", multiplier: 1 }, hitbox: null });
			} else {
				const currentTotal = damaging.reduce((sum, hit) => sum + num(hit.count, 0), 0);
				if (damaging.length === 1 || currentTotal === 0) {
					damaging[0].count = override.tickCount;
				} else {
					let remaining = override.tickCount;
					damaging.forEach((hit, index) => {
						if (index === damaging.length - 1) hit.count = Math.max(0, remaining);
						else {
							const share = Math.round((num(hit.count, 0) / currentTotal) * override.tickCount);
							hit.count = share;
							remaining -= share;
						}
					});
				}
			}
		}
		if (typeof override.dotMultiplier === "number") {
			for (const status of runtime.statuses) {
				if (status.dot) status.dot.totalMultiplier = num(status.dot.totalMultiplier, 0) * override.dotMultiplier;
			}
		}
		config.runtime = runtime;
		config.override = override;
		config.original = original;
		return config;
	}

	function getMoveConfig(data, powerId, standId, loadout) {
		const base = data.powers[powerId];
		if (!base) return null;
		const merged = Object.assign({}, base);
		merged.overrideSource = null;
		if (standId) {
			const stand = data.specials[standId];
			const override = stand && stand.universalOverrides && stand.universalOverrides[powerId];
			if (override) {
				for (const [key, value] of Object.entries(override)) {
					if (key === "Properties" && value && typeof value === "object") {
						for (const propKey of ["baseCooldown", "bossDamage", "playerDamage", "damageMultiplier"]) {
							if (typeof value[propKey] === "number") merged[propKey] = value[propKey];
						}
					} else if (typeof value === "number") {
						merged[key] = value;
					}
				}
				merged.overrideSource = standId;
			}
		}
		merged.key = moveKey(powerId, standId || null);
		merged.standId = standId || null;
		if (loadout && loadout.moveOverrides) applyMoveOverride(merged, loadout.moveOverrides[merged.key]);
		return merged;
	}

	function getChampion(data, loadout) {
		if (!loadout.championId) return null;
		if (loadout.championId === CUSTOM_ID) {
			return { id: CUSTOM_ID, displayName: "Custom champion", Boosts: (loadout.custom && loadout.custom.champion) || {}, isCustom: true };
		}
		return data.champions[loadout.championId] || null;
	}

	function getTitle(data, loadout) {
		if (!loadout.titleId) return null;
		if (loadout.titleId === CUSTOM_ID) {
			return { id: CUSTOM_ID, displayName: "Custom title", effects: (loadout.custom && loadout.custom.title) || {}, isCustom: true };
		}
		return data.titles[loadout.titleId] || null;
	}

	function getTransformation(data, loadout) {
		if (!loadout.transformationId) return null;
		if (loadout.transformationId === CUSTOM_ID) {
			return { id: CUSTOM_ID, displayName: "Custom transformation", Perks: (loadout.custom && loadout.custom.transformation) || {}, isCustom: true };
		}
		return data.transformations[loadout.transformationId] || null;
	}

	function getAccessoryConfigs(data, loadout) {
		const list = [];
		for (const id of Object.values(loadout.accessories || {})) {
			if (!id) continue;
			if (id === CUSTOM_ID) {
				list.push({ id: CUSTOM_ID, displayName: "Custom accessory", Boosts: (loadout.custom && loadout.custom.accessory) || {}, isCustom: true });
			} else if (data.accessories[id]) {
				list.push(data.accessories[id]);
			}
		}
		return list;
	}

	function damageTypesMatch(damageTypes, move) {
		if (!damageTypes) return true;
		return damageTypes[move.statType] === true || (move.specialType && damageTypes[move.specialType] === true);
	}

	function traitDamageBoost(data, loadout) {
		if (!loadout.traitId) return 0;
		if (loadout.traitId === CUSTOM_ID) return num(loadout.customTraitBoost, 0) / 100;
		const trait = data.traits[loadout.traitId];
		if (!trait) return 0;
		const tier = trait.tiers[loadout.traitTier] || trait.tiers[0];
		if (!tier) return 0;
		let boost = 0;
		for (const effect of tier.effects || []) {
			if (effect.category === "DamageBoost") boost += num(effect.modifier, 0);
		}
		return boost;
	}

	function accessoryBoosts(data, loadout) {
		const merged = { Damage: {}, SpecialDamage: {}, BossDamage: 0, PvpDamage: 0, MissingHealthDamageBoost: null, ids: [] };
		for (const config of getAccessoryConfigs(data, loadout)) {
			if (!config.Boosts) continue;
			merged.ids.push(config.id);
			const boosts = config.Boosts;
			for (const [key, value] of Object.entries(boosts.Damage || {})) merged.Damage[key] = (merged.Damage[key] || 0) + num(value, 0);
			for (const [key, value] of Object.entries(boosts.SpecialDamage || {})) merged.SpecialDamage[key] = (merged.SpecialDamage[key] || 0) + num(value, 0);
			merged.BossDamage += num(boosts.BossDamage, 0);
			merged.PvpDamage += num(boosts.PvpDamage, 0);
			merged.MissingHealthDamageBoost = merged.MissingHealthDamageBoost || boosts.MissingHealthDamageBoost || null;
		}
		return merged;
	}

	function missingHealthMultiplier(config, move, attackerHealthRatio) {
		if (!config) return 1;
		if (!damageTypesMatch(config.damageTypes, move)) return 1;
		const missing = 1 - attackerHealthRatio;
		const steps = Math.floor(missing / num(config.stepFraction, 1));
		const boost = Math.min(steps * num(config.boostPerStep, 0), num(config.maxBoost, 0));
		return 1 + Math.max(boost, 0);
	}

	function transformationSteps(data, loadout, move, champion) {
		const transformation = getTransformation(data, loadout);
		const perks = transformation && transformation.Perks;
		let multiplier = 1;
		const steps = [];
		if (perks && Array.isArray(perks.damageBoost)) {
			for (const boost of perks.damageBoost) {
				if (boost.stat === move.statType || boost.stat === "Universal") {
					multiplier = num(boost.value, 1);
					break;
				}
			}
		}
		const championTransformationBoost = champion && champion.Boosts && champion.Boosts.TransformationBoost;
		if (championTransformationBoost && transformation) {
			if (multiplier > 1) {
				multiplier += num(championTransformationBoost.existingDamageBonus, 0);
				multiplier *= num(championTransformationBoost.existingDamageMultiplier, 1);
			}
			multiplier += num(championTransformationBoost.universalDamageBonus, 0);
			multiplier *= num(championTransformationBoost.universalDamageMultiplier, 1);
		}
		if (multiplier !== 1) steps.push({ label: `Transformation damage (${transformation.displayName})`, value: multiplier, source: "transformation" });
		if (perks && perks.specialDamageBoost && move.specialType) {
			const boost = num(perks.specialDamageBoost[move.specialType], 0);
			if (boost !== 0) steps.push({ label: `Transformation special damage (${move.specialType})`, value: 1 + boost, source: "transformation" });
		}
		return steps;
	}

	function combine(steps, stacking) {
		let product = 1;
		let additive = 0;
		for (const step of steps) {
			const value = num(step.value, 1);
			if (step.kind && step.kind !== "bonus") product *= value;
			else if (stacking === "additive") additive += value - 1;
			else product *= value;
		}
		return product * (1 + additive);
	}

	function sourceSteps(data, loadout, move) {
		const steps = [];
		const champion = getChampion(data, loadout);
		const boosts = champion ? champion.Boosts || {} : {};
		const attackerHealthRatio = Math.max(0, Math.min(1, num(loadout.attackerHealthPercent, 100) / 100));
		const accessories = accessoryBoosts(data, loadout);
		const title = getTitle(data, loadout);

		function apply(label, value, source) {
			if (typeof value !== "number" || !Number.isFinite(value) || value === 1) return;
			steps.push({ label, value, source: source || "champion" });
		}

		if (champion) {
			const name = champion.displayName;
			if (boosts.Damage) {
				apply(`${name}: ${move.statType} damage`, 1 + num(boosts.Damage[move.statType], 0));
				if (move.specialType) apply(`${name}: ${move.specialType} damage`, 1 + num(boosts.Damage[move.specialType], 0));
				apply(`${name}: any damage`, 1 + num(boosts.Damage.Any, 0));
			}
			const gated = boosts.HealthGatedDamageBoost;
			if (gated) {
				const exempt = gated.exemptPowers && gated.exemptPowers[move.id];
				if (typeof exempt === "number") apply(`${name}: health-gated boost (exempt move)`, (1 + num(gated.boost, 0)) * (1 + exempt));
				else apply(`${name}: health-gated boost`, 1 + (attackerHealthRatio < num(gated.threshold, 0) ? num(gated.lowHealthBoost, 0) : num(gated.boost, 0)));
			}
			const stacking = boosts.InCombatStacking;
			if (stacking && loadout.combatStacks > 0) {
				const stacks = Math.min(loadout.combatStacks, num(stacking.maxStacks, 0));
				apply(`${name}: combat stacks (${stacks})`, 1 + stacks * num(stacking.damageBoostPerStack, 0));
			}
			if (boosts.ChakraMeltdown && loadout.chakraMeltdown && (move.statType === "Chakra" || move.specialType === "Chakra")) apply(`${name}: chakra meltdown`, 1 + num(boosts.ChakraMeltdown.damageBoost, 0));
			const moveModifier = boosts.MoveModifiers && boosts.MoveModifiers[move.id];
			if (moveModifier && typeof moveModifier.damageBoost === "number") apply(`${name}: ${move.displayName} boost`, 1 + moveModifier.damageBoost);
			if (moveModifier && typeof moveModifier.shrineDamageBoost === "number" && loadout.shrineActive) apply(`${name}: shrine boost`, 1 + moveModifier.shrineDamageBoost);
			if (boosts.SpecialModifiers) {
				const owners = (move.usedBy || []).map((u) => u.specialId);
				for (const [specialId, modifier] of Object.entries(boosts.SpecialModifiers)) {
					if (owners.includes(specialId) && modifier && num(modifier.damageBoost, 0) > 0) apply(`${name}: ${specialId} special boost`, 1 + modifier.damageBoost);
				}
			}
			const traitBoost = traitDamageBoost(data, loadout);
			if (traitBoost > 0 && loadout.traitId !== "Berserker") apply(`Trait ${loadout.traitId === CUSTOM_ID ? "(custom)" : loadout.traitId} damage`, 1 + traitBoost, "trait");
		}

		if (accessories.ids.length > 0) {
			apply("Accessories: stat damage", 1 + num(accessories.Damage[move.statType], 0), "accessory");
			if (move.specialType) apply("Accessories: special-type damage", 1 + num(accessories.Damage[move.specialType], 0), "accessory");
			apply("Accessories: any damage", 1 + num(accessories.Damage.Any, 0), "accessory");
			for (const owner of move.usedBy || []) {
				const boost = accessories.SpecialDamage[owner.specialId];
				if (typeof boost === "number") apply(`Accessories: ${owner.specialId} damage`, 1 + boost, "accessory");
			}
		}

		if (loadout.partyDamageBoost > 0) apply("Party damage boost", 1 + loadout.partyDamageBoost / 100, "party");

		if (loadout.mode !== "duel") {
			for (const step of transformationSteps(data, loadout, move, champion)) steps.push(step);
		}
		if (move.statType === "Strength" && loadout.hardenFist) apply("Harden Fist", HARDEN_FIST, "buff");

		if (champion) {
			const name = champion.displayName;
			if (boosts.LowHealthDamageBoost && damageTypesMatch(boosts.LowHealthDamageBoost.damageTypes, move) && attackerHealthRatio <= num(boosts.LowHealthDamageBoost.threshold, 0)) {
				apply(`${name}: low health damage`, 1 + num(boosts.LowHealthDamageBoost.boost, 0));
			}
			if (boosts.LowHealthBerserker && loadout.berserkerActive && damageTypesMatch(boosts.LowHealthBerserker.damageTypes, move)) apply(`${name}: berserker`, 1 + num(boosts.LowHealthBerserker.damageBoost, 0));
			if (boosts.DaytimeBoost && loadout.daytime && damageTypesMatch(boosts.DaytimeBoost.damageTypes, move)) apply(`${name}: daytime`, 1 + num(boosts.DaytimeBoost.damageBoost, 0));
			apply(`${name}: missing health`, missingHealthMultiplier(boosts.MissingHealthDamageBoost, move, attackerHealthRatio));
			if (boosts.DamageStackOnHit && loadout.hitStacks > 0) {
				const stacks = Math.min(loadout.hitStacks, num(boosts.DamageStackOnHit.maxStacks, loadout.hitStacks));
				apply(`${name}: hit stacks (${stacks})`, 1 + num(boosts.DamageStackOnHit.boostPerStack, 0) * stacks);
			}
			if (boosts.NirvanasBlessing && loadout.nirvana) apply(`${name}: Nirvana's blessing`, 1 + num(boosts.NirvanasBlessing.damageBoost, 0));
		}
		apply("Accessories: missing health", missingHealthMultiplier(accessories.MissingHealthDamageBoost, move, attackerHealthRatio), "accessory");

		if (title) {
			const statEffect = STAT_TITLE_EFFECT[move.statType];
			if (statEffect && typeof title.effects[statEffect] === "number") apply(`Title ${title.displayName}: ${move.statType} damage`, title.effects[statEffect], "title");
			const specialEffect = SPECIAL_TITLE_EFFECT[move.specialType];
			if (specialEffect && typeof title.effects[specialEffect] === "number") apply(`Title ${title.displayName}: ${move.specialType} damage`, title.effects[specialEffect], "title");
		}

		return { steps, champion, boosts, accessories, title, attackerHealthRatio };
	}

	function titleEffect(data, loadout, effect) {
		const title = getTitle(data, loadout);
		if (!title || !title.effects) return 1;
		return typeof title.effects[effect] === "number" ? title.effects[effect] : 1;
	}

	function critMultiplier(loadout, boosts, move, targetHealthRatio) {
		const config = boosts && boosts.CriticalHit;
		if (!config || loadout.critMode === "none") return { multiplier: 1, label: null };
		const typeMatch = damageTypesMatch(config.damageTypes, move);
		const specialMatch = config.specialIds && Object.keys(config.specialIds).length > 0 ? (move.usedBy || []).some((u) => config.specialIds[u.specialId]) : false;
		if (!typeMatch && !specialMatch) return { multiplier: 1, label: null };
		let multiplier = num(config.multiplier, 1);
		if (targetHealthRatio < num(config.lowHealthThreshold, 0)) multiplier *= 1 + Math.min(num(config.lowHealthCriticalBonus, 0), num(config.lowHealthMaxBonus, 0));
		if (loadout.critMode === "always") return { multiplier, label: `Critical hit (${config.multiplier}x)` };
		const chance = Math.min(1, num(config.chance, 0) + (loadout.critCombatBonus ? num(config.combatChanceBonus, 0) : 0));
		return { multiplier: 1 + chance * (multiplier - 1), label: `Critical hit (expected, ${Math.round(chance * 100)}% chance)` };
	}

	function baseValue(data, loadout, move, basis, hitMultiplier) {
		const steps = [];
		const mode = loadout.mode;
		if (mode === "duel") {
			const value = num(move.playerDamage, 0);
			steps.push({ label: "PlayerDmg (duel / tournament)", value, kind: "base" });
			return { value, steps, usesSources: false };
		}
		if (mode === "boss" || basis === "boss") {
			const value = num(move.bossDamage, 1);
			steps.push({ label: "BossDmg", value, kind: "base" });
			return { value, steps, usesSources: true };
		}
		if (basis === "flat") {
			const value = num(hitMultiplier, 0) * (num(loadout.targetMaxHealth, 1000) / 1000);
			steps.push({ label: `flat damage per 1000 target HP (${hitMultiplier})`, value, kind: "base" });
			return { value, steps, usesSources: false };
		}
		if (basis === "percentMaxHealth") {
			const value = num(hitMultiplier, 0) * num(loadout.targetMaxHealth, 1000);
			steps.push({ label: `${(hitMultiplier * 100).toFixed(1)}% of target max HP`, value, kind: "base" });
			return { value, steps, usesSources: false };
		}
		if (basis === "fixed") {
			const value = num(hitMultiplier, 0);
			steps.push({ label: "fixed damage", value, kind: "base" });
			return { value, steps, usesSources: false };
		}
		const statType = move.statType || "Strength";
		const stat = num(loadout.stats[statType], 0);
		const limit = Math.max(0, Math.min(100, num(loadout.statLimits[statType], 100))) / 100;
		const powerMultiplier = num(move.damageMultiplier, 1);
		steps.push({ label: `${statType} stat`, value: stat, kind: "base" });
		if (limit !== 1) steps.push({ label: `${statType} limit`, value: limit, kind: "base" });
		steps.push({ label: "PveDmgMultiplier", value: powerMultiplier, kind: "base" });
		return { value: stat * limit * powerMultiplier, steps, usesSources: true };
	}

	function postSteps(data, loadout, move, sources, context) {
		const steps = [];
		const mode = loadout.mode;
		const boosts = sources.boosts || {};
		const champion = sources.champion;
		const name = champion ? champion.displayName : "";
		const targetHealthRatio = Math.max(0, Math.min(1, num(loadout.targetHealthPercent, 100) / 100));
		const treatAsBoss = mode === "boss";

		function apply(label, value, kind, source) {
			if (typeof value !== "number" || !Number.isFinite(value) || value === 1) return;
			steps.push({ label, value, kind: kind || "bonus", source: source || "champion" });
		}

		if (mode === "duel") {
			apply("Accessories: PvP damage", 1 + num(sources.accessories.PvpDamage, 0), "bonus", "accessory");
			if (loadout.pvpJuggernaut) apply("Tournament juggernaut", JUGGERNAUT_MULTIPLIER, "bonus", "buff");
			if (context.bleedMultiplier) apply(`Bleed stacks (${context.bleedStacks})`, context.bleedMultiplier, "target");
			if (loadout.targetDamageReduction > 0) apply("Target PvP low-health defense", 1 - loadout.targetDamageReduction / 100, "reduction");
			return steps;
		}

		if (loadout.targetVulnerability > 0) apply("Target vulnerability", 1 + loadout.targetVulnerability / 100, "target");
		const moveModifier = boosts.MoveModifiers && boosts.MoveModifiers[move.id];
		if (moveModifier && typeof moveModifier.lowTargetHealthDamageBoost === "number" && targetHealthRatio < num(moveModifier.lowTargetHealthThreshold, 0)) {
			apply(`${name}: ${move.displayName} low target health`, 1 + moveModifier.lowTargetHealthDamageBoost);
		}
		const crit = critMultiplier(loadout, boosts, move, targetHealthRatio);
		if (crit.label) apply(crit.label, crit.multiplier, "crit");
		if (num(loadout.attackerBurnDebuff, 1) !== 1) apply("Attacker burning (intense burn)", loadout.attackerBurnDebuff, "reduction");
		if (mode !== "freepvp" && loadout.place === "dimension2") apply("Title: Dimension 2 damage", titleEffect(data, loadout, "Dimension2Damage"), "bonus", "title");
		if (loadout.damageBuff > 0) apply("DamageBuff status", 1 + loadout.damageBuff / 100, "bonus", "buff");

		if (mode === "mob" || mode === "boss") {
			if (boosts.KillableMobDamage && !treatAsBoss) apply(`${name}: killable mob damage`, 1 + boosts.KillableMobDamage);
			if (boosts.MobDamage) {
				const damageType = move.statType || move.specialType;
				apply(`${name}: mob damage (${damageType})`, 1 + num(boosts.MobDamage[damageType], 0));
			}
			const transformationBoost = boosts.TransformationBoost;
			if (treatAsBoss && transformationBoost && loadout.transformationId && typeof transformationBoost.bossDamage === "number") apply(`${name}: transformation boss damage`, 1 + transformationBoost.bossDamage);
			if (treatAsBoss && typeof boosts.BossDamage === "number") apply(`${name}: boss damage`, 1 + boosts.BossDamage);
			if (treatAsBoss && sources.accessories.BossDamage > 0) apply("Accessories: boss damage", 1 + sources.accessories.BossDamage, "bonus", "accessory");
			const lowTarget = boosts.LowTargetHealthDamageBoost;
			if (lowTarget && targetHealthRatio < num(lowTarget.threshold, 0)) apply(`${name}: low target health`, 1 + num(lowTarget.boost, 0));
			if (boosts.FrozenTargetDamageBoost && loadout.targetFrozen) apply(`${name}: frozen target`, 1 + boosts.FrozenTargetDamageBoost);
			if (context.bleedMultiplier) apply(`Bleed stacks (${context.bleedStacks})`, context.bleedMultiplier, "target");
			apply("Title: damage in dungeons", titleEffect(data, loadout, "DamageInDungeons"), "bonus", "title");
			if (treatAsBoss) {
				apply("Title: boss damage", titleEffect(data, loadout, "BossDamage"), "bonus", "title");
				if (loadout.place === "tower") apply("Title: tower boss damage", titleEffect(data, loadout, "TowerBossDamage"), "bonus", "title");
			}
			if (boosts.DungeonDamage && loadout.place === "dungeon") apply(`${name}: dungeon damage`, 1 + boosts.DungeonDamage);
			if (treatAsBoss && loadout.targetBurning && context.burnBossTakenBoost) apply("Burn: boss damage taken", 1 + context.burnBossTakenBoost, "target");
			return steps;
		}

		if (loadout.traitId === "Berserker" && loadout.berserkerActive) apply("Berserker trait", 1 + traitDamageBoost(data, loadout), "bonus", "trait");
		const lowTarget = boosts.LowTargetHealthDamageBoost;
		if (lowTarget && targetHealthRatio < num(lowTarget.threshold, 0)) apply(`${name}: low target health`, 1 + num(lowTarget.boost, 0));
		if (boosts.FrozenTargetDamageBoost && loadout.targetFrozen) apply(`${name}: frozen target`, 1 + boosts.FrozenTargetDamageBoost);
		if (context.bleedMultiplier) apply(`Bleed stacks (${context.bleedStacks})`, context.bleedMultiplier, "target");
		if (loadout.targetDamageReduction > 0) {
			let reduction = loadout.targetDamageReduction / 100;
			const ignore = boosts.IgnoreDamageReduction;
			let ignoreValue = 0;
			if (typeof ignore === "number") ignoreValue = ignore;
			else if (ignore && typeof ignore === "object") ignoreValue = num(ignore[move.statType || move.specialType], 0);
			reduction *= 1 - ignoreValue;
			apply(`Target damage reduction (${Math.round(reduction * 100)}%)`, 1 - reduction, "reduction");
		}
		return steps;
	}

	function bleedConfigFor(move, boosts) {
		if (move.appliesBleed) return { config: MOVE_BLEED, stacksPerHit: num(move.bleedStacks, 1), source: "move" };
		const championBleed = boosts && boosts.Bleed;
		if (championBleed && (move.statType === "Sword" || move.specialType === "Sword")) return { config: championBleed, stacksPerHit: 1, source: "champion" };
		return null;
	}

	function computeMove(data, loadout, move) {
		const stacking = loadout.stacking === "additive" ? "additive" : "multiplicative";
		const runtime = move.runtime;
		const hits = runtime && Array.isArray(runtime.hits) ? runtime.hits : [];
		const statuses = runtime && Array.isArray(runtime.statuses) ? runtime.statuses : [];
		const sources = sourceSteps(data, loadout, move);
		const boosts = sources.boosts || {};
		const bleed = bleedConfigFor(move, boosts);
		const burnStatus = statuses.find((s) => s.effect === "Burn" && s.data && typeof s.data.bossDamageTakenBoost === "number");
		const context = {
			bleedStacks: loadout.bleedStacks,
			bleedMultiplier: bleed && loadout.bleedStacks > 0 ? 1 + Math.min(loadout.bleedStacks, bleed.config.maxStacks) * bleed.config.damageBoostPerStack : 0,
			burnBossTakenBoost: burnStatus ? burnStatus.data.bossDamageTakenBoost : 0,
		};
		const post = postSteps(data, loadout, move, sources, context);
		const sourceMultiplier = combine(sources.steps, stacking);
		const fullBonus = combine(sources.steps.concat(post), stacking);
		const postOnly = combine(post, stacking);

		const primary = baseValue(data, loadout, move, "power", 1);
		const perHitFull = primary.value * (primary.usesSources ? fullBonus : postOnly);

		const hitResults = [];
		let totalHits = 0;
		let totalDirect = 0;
		for (const hit of hits) {
			const basis = hit.damage ? hit.damage.basis : "power";
			if (basis === "none") continue;
			const count = Math.max(0, num(hit.count, 0));
			let perHit;
			if (loadout.mode === "duel" || loadout.mode === "boss") {
				perHit = perHitFull;
			} else {
				const multiplier = num(hit.damage && hit.damage.multiplier, 1);
				const value = basis === "power" ? multiplier : num(hit.damage && hit.damage.value, multiplier);
				const base = baseValue(data, loadout, move, basis, value);
				perHit = base.value * (basis === "power" ? multiplier : 1) * (base.usesSources ? fullBonus : postOnly);
			}
			totalHits += count;
			totalDirect += perHit * count;
			hitResults.push({ hit, perHit, count, total: perHit * count, basis });
		}

		const dotResults = [];
		let totalDot = 0;
		const statScaled = num(loadout.stats[move.statType || "Strength"], 0) * (Math.max(0, Math.min(100, num(loadout.statLimits[move.statType || "Strength"], 100))) / 100) * num(move.damageMultiplier, 1);
		for (const status of statuses) {
			if (!status.dot) continue;
			if (loadout.mode === "duel" || loadout.mode === "freepvp") {
				if (status.target === "mobs") continue;
			} else if (status.target === "players") continue;
			const dot = status.dot;
			let value = 0;
			if (dot.basis === "boss") value = num(move.bossDamage, 1) * sourceMultiplier * num(dot.totalMultiplier, 0);
			else if (dot.basis === "power") value = statScaled * sourceMultiplier * num(dot.totalMultiplier, 0);
			else if (dot.basis === "flat") value = num(dot.totalMultiplier, 0) * (num(loadout.targetMaxHealth, 1000) / 1000);
			else if (dot.basis === "percentMaxHealth") value = num(dot.totalMultiplier, 0) * num(loadout.targetMaxHealth, 1000);
			else if (dot.basis === "fixed") value = num(dot.totalMultiplier, 0);
			if (loadout.mode === "boss" && loadout.targetBurning && status.effect === "Burn" && status.data && typeof status.data.bossDamageTakenBoost === "number") value *= 1 + status.data.bossDamageTakenBoost;
			dotResults.push({ status, total: value, ticks: num(dot.ticks, 1), duration: num(status.duration, 0) });
			totalDot += value;
		}

		let detonation = 0;
		if (bleed && loadout.includeBleedDetonation && totalHits > 0) {
			if (loadout.bleedStacks + totalHits * bleed.stacksPerHit > bleed.config.maxStacks) detonation = totalDirect * bleed.config.detonationMultiplier;
		}

		const total = totalDirect + (loadout.includeDot ? totalDot : 0) + detonation;
		const endlag = runtime ? num(runtime.activationTillEndlagEnd, null) : null;
		const cooldownStart = runtime ? num(runtime.activationTillCooldownStart, null) : null;
		const cooldown = num(move.baseCooldown, 0);
		const cycleTime = (cooldownStart !== null ? cooldownStart : 0) + cooldown;

		return {
			move,
			runtime,
			stacking,
			perHitBase: primary.value,
			perHitFull,
			baseSteps: primary.steps,
			sourceSteps: sources.steps,
			postSteps: post,
			bonusMultiplier: primary.usesSources ? fullBonus : postOnly,
			hits: hitResults,
			totalHits,
			totalDirect,
			dots: dotResults,
			totalDot,
			detonation,
			total,
			endlag,
			cooldownStart,
			cooldown,
			cycleTime,
			dps: endlag ? total / Math.max(endlag, 0.05) : null,
			damagePerCycle: cycleTime > 0 ? total / cycleTime : null,
			bleed,
			isOverridden: !!move.override,
		};
	}

	function simulateCombo(data, loadout, entries) {
		let time = 0;
		let totalDamage = 0;
		const cooldownReady = {};
		const rows = [];
		let bleedStacks = loadout.bleedStacks;
		let bleedDamagePool = 0;
		let lastBleedAt = null;
		for (const entry of entries) {
			const move = getMoveConfig(data, entry.powerId, entry.standId || loadout.standId, loadout);
			if (!move) continue;
			const localLoadout = Object.assign({}, loadout, { bleedStacks });
			const result = computeMove(data, localLoadout, move);
			const readyAt = cooldownReady[move.key] || 0;
			const waitForCooldown = Math.max(0, readyAt - time);
			const startAt = time + waitForCooldown;
			const endlag = result.endlag !== null ? result.endlag : 0;
			const cooldownStart = result.cooldownStart !== null ? result.cooldownStart : endlag;
			let detonation = 0;
			if (result.bleed) {
				const config = result.bleed.config;
				if (lastBleedAt !== null && startAt - lastBleedAt >= config.decayInterval) {
					bleedStacks = Math.max(0, bleedStacks - Math.floor((startAt - lastBleedAt) / config.decayInterval));
					if (bleedStacks === 0) bleedDamagePool = 0;
				}
				bleedDamagePool += result.totalDirect;
				bleedStacks += result.totalHits * result.bleed.stacksPerHit;
				lastBleedAt = startAt;
				if (bleedStacks > config.maxStacks) {
					detonation = bleedDamagePool * config.detonationMultiplier;
					bleedStacks = 0;
					bleedDamagePool = 0;
				}
			}
			const damage = result.totalDirect + (loadout.includeDot ? result.totalDot : 0) + detonation;
			totalDamage += damage;
			rows.push({ entry, move, result, startAt, waitForCooldown, endAt: startAt + endlag, damage, detonation, cumulative: totalDamage, bleedStacksAfter: bleedStacks });
			cooldownReady[move.key] = startAt + cooldownStart + result.cooldown;
			time = startAt + endlag;
		}
		return { rows, totalDamage, totalTime: time, dps: time > 0 ? totalDamage / time : null };
	}

	function exportMoveJson(move, result) {
		const runtime = move.runtime || {};
		const hits = runtime.hits || [];
		const firstHitbox = hits.find((h) => h.hitbox && Array.isArray(h.hitbox.size));
		const size = firstHitbox ? firstHitbox.hitbox.size : [null, null, null];
		return {
			id: move.id,
			name: move.displayName || move.id,
			category: move.isSpecial ? "Special" : "Power",
			type: move.Transformation ? "Transformation" : hits.length ? "Attack" : "Utility",
			damageType: move.statType,
			specialType: move.specialType || null,
			stand: move.standId || null,
			overridden: !!move.override,
			passives: {},
			attack: {
				BossDmg: move.bossDamage ?? null,
				PlayerDmg: move.playerDamage ?? null,
				PveDmgMultiplier: move.damageMultiplier ?? null,
				TickCount: result ? result.totalHits : hits.reduce((sum, h) => sum + (h.count || 0), 0),
				CooldownSeconds: move.baseCooldown ?? null,
				ActivationTillCooldownStart: runtime.activationTillCooldownStart ?? null,
				ActivationTillEndlagEnd: runtime.activationTillEndlagEnd ?? null,
				ActivationTillFirstHitbox: runtime.activationTillFirstHitbox ?? null,
				DurationSeconds: runtime.durationSeconds ?? null,
				HitboxLengthSize: size[2] ?? null,
				HitboxWidthSize: size[0] ?? null,
				HitboxHeightSize: size[1] ?? null,
				HitboxShape: firstHitbox ? firstHitbox.hitbox.shape : null,
				Hits: hits.map((h) => ({ label: h.label, count: h.count, hitbox: h.hitbox, startsAt: h.startsAt ?? null, duration: h.duration ?? null, conditions: h.conditions || null })),
				StatusesApplied: (runtime.statuses || []).map((s) => ({ effect: s.effect, label: s.label || null, target: s.target, duration: s.duration ?? null })),
				AppliesBleed: move.appliesBleed === true,
				BleedStacks: move.bleedStacks ?? null,
			},
		};
	}

	window.Engine = {
		CUSTOM_ID,
		SPECIAL_TYPES,
		MOVE_OVERRIDE_FIELDS,
		MOVE_BLEED,
		defaultLoadout,
		moveKey,
		hasOverrides,
		getMoveConfig,
		getChampion,
		getTitle,
		getTransformation,
		getAccessoryConfigs,
		computeMove,
		simulateCombo,
		exportMoveJson,
	};
})();
