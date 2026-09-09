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

	const MOVE_BLEED = { damageBoostPerStack: 0.02, decayInterval: 2, detonationMultiplier: 0.5, maxStacks: 30 };
	const HARDEN_FIST = 1.15;
	const JUGGERNAUT_MULTIPLIER = 1.5;

	function num(value, fallback) {
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	}

	function defaultLoadout() {
		return {
			mode: "boss",
			stats: { Strength: 1e6, Chakra: 1e6, Sword: 1e6 },
			statLimits: { Strength: 100, Chakra: 100, Sword: 100 },
			championId: "",
			traitId: "",
			traitTier: 0,
			titleId: "",
			accessories: {},
			transformationId: "",
			standId: "",
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

	function getMoveConfig(data, powerId, standId) {
		const base = data.powers[powerId];
		if (!base) return null;
		const merged = Object.assign({}, base, { Properties: Object.assign({}, base.Properties || {}) });
		merged.overrideSource = null;
		if (standId) {
			const stand = data.specials[standId];
			const override = stand && stand.universalOverrides && stand.universalOverrides[powerId];
			if (override) {
				for (const [key, value] of Object.entries(override)) {
					if (key === "Properties" && value && typeof value === "object") {
						Object.assign(merged.Properties, value);
						for (const propKey of ["baseCooldown", "bossDamage", "playerDamage", "damageMultiplier"]) {
							if (typeof value[propKey] === "number") merged[propKey] = value[propKey];
						}
					} else {
						merged[key] = value;
					}
				}
				merged.overrideSource = standId;
			}
		}
		return merged;
	}

	function damageTypesMatch(damageTypes, move) {
		if (!damageTypes) return true;
		return damageTypes[move.statType] === true || (move.specialType && damageTypes[move.specialType] === true);
	}

	function traitDamageBoost(data, loadout) {
		if (!loadout.traitId) return 0;
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
		for (const id of Object.values(loadout.accessories || {})) {
			const config = id && data.accessories[id];
			if (!config || !config.Boosts) continue;
			merged.ids.push(id);
			const boosts = config.Boosts;
			for (const [key, value] of Object.entries(boosts.Damage || {})) merged.Damage[key] = (merged.Damage[key] || 0) + value;
			for (const [key, value] of Object.entries(boosts.SpecialDamage || {})) merged.SpecialDamage[key] = (merged.SpecialDamage[key] || 0) + value;
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

	function transformationDamageMultiplier(data, loadout, move, champion) {
		const transformation = loadout.transformationId && data.transformations[loadout.transformationId];
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
		if (multiplier !== 1) steps.push({ label: `Transformation damage (${transformation.displayName})`, value: multiplier });
		let specialMultiplier = 1;
		if (perks && perks.specialDamageBoost && move.specialType) {
			const boost = perks.specialDamageBoost[move.specialType];
			if (typeof boost === "number" && boost !== 0) {
				specialMultiplier = 1 + boost;
				steps.push({ label: `Transformation special damage (${move.specialType})`, value: specialMultiplier });
			}
		}
		return { multiplier: multiplier * specialMultiplier, steps };
	}

	function buffMultiplier(data, loadout, move) {
		const steps = [];
		let multiplier = 1;
		const champion = loadout.championId ? data.champions[loadout.championId] : null;
		const boosts = champion ? champion.Boosts || {} : {};
		const attackerHealthRatio = Math.max(0, Math.min(1, num(loadout.attackerHealthPercent, 100) / 100));
		const accessories = accessoryBoosts(data, loadout);

		function apply(label, value) {
			if (typeof value !== "number" || !Number.isFinite(value) || value === 1) return;
			multiplier *= value;
			steps.push({ label, value });
		}

		if (champion) {
			if (boosts.Damage) {
				const stat = num(boosts.Damage[move.statType], 0);
				const special = move.specialType ? num(boosts.Damage[move.specialType], 0) : 0;
				const any = num(boosts.Damage.Any, 0);
				apply(`${champion.displayName}: ${move.statType} damage`, 1 + stat);
				if (move.specialType) apply(`${champion.displayName}: ${move.specialType} damage`, 1 + special);
				apply(`${champion.displayName}: any damage`, 1 + any);
			}
			const gated = boosts.HealthGatedDamageBoost;
			if (gated) {
				const exempt = gated.exemptPowers && gated.exemptPowers[move.id];
				if (typeof exempt === "number") {
					apply(`${champion.displayName}: health-gated boost (exempt move)`, (1 + num(gated.boost, 0)) * (1 + exempt));
				} else {
					const boost = attackerHealthRatio < num(gated.threshold, 0) ? num(gated.lowHealthBoost, 0) : num(gated.boost, 0);
					apply(`${champion.displayName}: health-gated boost`, 1 + boost);
				}
			}
			const stacking = boosts.InCombatStacking;
			if (stacking && loadout.combatStacks > 0) {
				apply(`${champion.displayName}: combat stacks (${Math.min(loadout.combatStacks, stacking.maxStacks)})`, 1 + Math.min(loadout.combatStacks, num(stacking.maxStacks, 0)) * num(stacking.damageBoostPerStack, 0));
			}
			if (boosts.ChakraMeltdown && loadout.chakraMeltdown && (move.statType === "Chakra" || move.specialType === "Chakra")) {
				apply(`${champion.displayName}: chakra meltdown`, 1 + num(boosts.ChakraMeltdown.damageBoost, 0));
			}
			const moveModifier = boosts.MoveModifiers && boosts.MoveModifiers[move.id];
			if (moveModifier && typeof moveModifier.damageBoost === "number") {
				apply(`${champion.displayName}: ${move.displayName} boost`, 1 + moveModifier.damageBoost);
			}
			if (moveModifier && typeof moveModifier.shrineDamageBoost === "number" && loadout.shrineActive) {
				apply(`${champion.displayName}: shrine boost`, 1 + moveModifier.shrineDamageBoost);
			}
			const specialModifiers = boosts.SpecialModifiers;
			if (specialModifiers) {
				for (const [specialId, modifier] of Object.entries(specialModifiers)) {
					const owners = (move.usedBy || []).map((u) => u.specialId);
					if (owners.includes(specialId) && modifier && typeof modifier.damageBoost === "number" && modifier.damageBoost > 0) {
						apply(`${champion.displayName}: ${specialId} special boost`, 1 + modifier.damageBoost);
					}
				}
			}
			const traitBoost = traitDamageBoost(data, loadout);
			if (traitBoost > 0 && loadout.traitId !== "Berserker") apply(`Trait ${loadout.traitId} damage`, 1 + traitBoost);
		}

		if (accessories.ids.length > 0) {
			apply("Accessories: stat damage", 1 + num(accessories.Damage[move.statType], 0));
			if (move.specialType) apply("Accessories: special-type damage", 1 + num(accessories.Damage[move.specialType], 0));
			apply("Accessories: any damage", 1 + num(accessories.Damage.Any, 0));
			for (const owner of move.usedBy || []) {
				const boost = accessories.SpecialDamage[owner.specialId];
				if (typeof boost === "number") apply(`Accessories: ${owner.specialId} damage`, 1 + boost);
			}
		}

		if (loadout.partyDamageBoost > 0) apply("Party damage boost", 1 + loadout.partyDamageBoost / 100);

		if (loadout.mode !== "duel") {
			const transformation = transformationDamageMultiplier(data, loadout, move, champion);
			for (const step of transformation.steps) steps.push(step);
			multiplier *= transformation.multiplier;
		}

		if (move.statType === "Strength" && loadout.hardenFist) apply("Harden Fist", HARDEN_FIST);

		if (champion && boosts.LowHealthDamageBoost && damageTypesMatch(boosts.LowHealthDamageBoost.damageTypes, move)) {
			if (attackerHealthRatio <= num(boosts.LowHealthDamageBoost.threshold, 0)) {
				apply(`${champion.displayName}: low health damage`, 1 + num(boosts.LowHealthDamageBoost.boost, 0));
			}
		}
		if (champion && boosts.LowHealthBerserker && loadout.berserkerActive && damageTypesMatch(boosts.LowHealthBerserker.damageTypes, move)) {
			apply(`${champion.displayName}: berserker`, 1 + num(boosts.LowHealthBerserker.damageBoost, 0));
		}
		if (champion && boosts.DaytimeBoost && loadout.daytime && damageTypesMatch(boosts.DaytimeBoost.damageTypes, move)) {
			apply(`${champion.displayName}: daytime`, 1 + num(boosts.DaytimeBoost.damageBoost, 0));
		}
		if (champion) apply(`${champion.displayName}: missing health`, missingHealthMultiplier(boosts.MissingHealthDamageBoost, move, attackerHealthRatio));
		apply("Accessories: missing health", missingHealthMultiplier(accessories.MissingHealthDamageBoost, move, attackerHealthRatio));
		if (champion && boosts.DamageStackOnHit && loadout.hitStacks > 0) {
			const stacks = Math.min(loadout.hitStacks, num(boosts.DamageStackOnHit.maxStacks, loadout.hitStacks));
			apply(`${champion.displayName}: hit stacks (${stacks})`, 1 + num(boosts.DamageStackOnHit.boostPerStack, 0) * stacks);
		}
		if (champion && boosts.NirvanasBlessing && loadout.nirvana) {
			apply(`${champion.displayName}: Nirvana's blessing`, 1 + num(boosts.NirvanasBlessing.damageBoost, 0));
		}

		return { multiplier, steps, champion, boosts, accessories, attackerHealthRatio };
	}

	function titleMultiplier(data, loadout, move) {
		const title = loadout.titleId && data.titles[loadout.titleId];
		if (!title) return { multiplier: 1, steps: [] };
		const steps = [];
		let multiplier = 1;
		const statEffect = STAT_TITLE_EFFECT[move.statType];
		if (statEffect && typeof title.effects[statEffect] === "number") {
			multiplier *= title.effects[statEffect];
			steps.push({ label: `Title ${title.displayName}: ${move.statType} damage`, value: title.effects[statEffect] });
		}
		const specialEffect = SPECIAL_TITLE_EFFECT[move.specialType];
		if (specialEffect && typeof title.effects[specialEffect] === "number") {
			multiplier *= title.effects[specialEffect];
			steps.push({ label: `Title ${title.displayName}: ${move.specialType} damage`, value: title.effects[specialEffect] });
		}
		return { multiplier, steps, title };
	}

	function titleEffect(data, loadout, effect) {
		const title = loadout.titleId && data.titles[loadout.titleId];
		if (!title) return 1;
		return typeof title.effects[effect] === "number" ? title.effects[effect] : 1;
	}

	function critMultiplier(loadout, boosts, move, targetHealthRatio) {
		const config = boosts && boosts.CriticalHit;
		if (!config || loadout.critMode === "none") return { multiplier: 1, label: null };
		const typeMatch = damageTypesMatch(config.damageTypes, move);
		const specialMatch = config.specialIds && Object.keys(config.specialIds).length > 0
			? (move.usedBy || []).some((u) => config.specialIds[u.specialId])
			: false;
		if (!typeMatch && !specialMatch) return { multiplier: 1, label: null };
		let multiplier = num(config.multiplier, 1);
		if (targetHealthRatio < num(config.lowHealthThreshold, 0)) {
			multiplier *= 1 + Math.min(num(config.lowHealthCriticalBonus, 0), num(config.lowHealthMaxBonus, 0));
		}
		if (loadout.critMode === "always") return { multiplier, label: `Critical hit (${config.multiplier}x)` };
		const chance = Math.min(1, num(config.chance, 0) + (loadout.critCombatBonus ? num(config.combatChanceBonus, 0) : 0));
		const expected = 1 + chance * (multiplier - 1);
		return { multiplier: expected, label: `Critical hit (expected, ${Math.round(chance * 100)}% chance)` };
	}

	function baseDamage(data, loadout, move, basis, hitMultiplier) {
		const buff = buffMultiplier(data, loadout, move);
		const title = titleMultiplier(data, loadout, move);
		const steps = [];
		let value = 0;
		const mode = loadout.mode;

		if (mode === "duel") {
			value = num(move.playerDamage, 0);
			steps.push({ label: "PlayerDmg (duel / tournament)", value });
			return { value, steps, buff, title };
		}
		if (mode === "boss") {
			value = num(move.bossDamage, 1);
			steps.push({ label: "BossDmg", value });
			for (const step of buff.steps) steps.push(step);
			for (const step of title.steps) steps.push(step);
			value *= buff.multiplier * title.multiplier;
			return { value, steps, buff, title };
		}

		if (basis === "boss") {
			value = num(move.bossDamage, 1) * buff.multiplier * title.multiplier;
			steps.push({ label: "BossDmg", value: num(move.bossDamage, 1) });
			for (const step of buff.steps) steps.push(step);
			for (const step of title.steps) steps.push(step);
			return { value, steps, buff, title };
		}
		if (basis === "flat") {
			value = num(hitMultiplier, 0) * (num(loadout.targetMaxHealth, 1000) / 1000);
			steps.push({ label: `flat damage per 1000 target HP (${hitMultiplier})`, value });
			return { value, steps, buff, title, isAbsolute: true };
		}
		if (basis === "percentMaxHealth") {
			value = num(hitMultiplier, 0) * num(loadout.targetMaxHealth, 1000);
			steps.push({ label: `${(hitMultiplier * 100).toFixed(1)}% of target max HP`, value });
			return { value, steps, buff, title, isAbsolute: true };
		}
		if (basis === "fixed") {
			value = num(hitMultiplier, 0);
			steps.push({ label: "fixed damage", value });
			return { value, steps, buff, title, isAbsolute: true };
		}

		const statType = move.statType || "Strength";
		const stat = num(loadout.stats[statType], 0);
		const limit = Math.max(0, Math.min(100, num(loadout.statLimits[statType], 100))) / 100;
		value = stat;
		steps.push({ label: `${statType} stat`, value: stat });
		if (limit !== 1) {
			value *= limit;
			steps.push({ label: `${statType} limit`, value: limit });
		}
		for (const step of buff.steps) steps.push(step);
		value *= buff.multiplier;
		const powerMultiplier = num(move.damageMultiplier, 1);
		value *= powerMultiplier;
		steps.push({ label: "PveDmgMultiplier", value: powerMultiplier });
		for (const step of title.steps) steps.push(step);
		value *= title.multiplier;
		return { value, steps, buff, title };
	}

	function postMultipliers(data, loadout, move, buff, title, context) {
		const steps = [];
		let multiplier = 1;
		const mode = loadout.mode;
		const boosts = buff.boosts || {};
		const champion = buff.champion;
		const targetHealthRatio = Math.max(0, Math.min(1, num(loadout.targetHealthPercent, 100) / 100));
		const treatAsBoss = mode === "boss";

		function apply(label, value) {
			if (typeof value !== "number" || !Number.isFinite(value) || value === 1) return;
			multiplier *= value;
			steps.push({ label, value });
		}

		if (mode === "duel") {
			apply("Accessories: PvP damage", 1 + num(buff.accessories.PvpDamage, 0));
			if (loadout.pvpJuggernaut) apply("Tournament juggernaut", JUGGERNAUT_MULTIPLIER);
			if (context.bleedMultiplier) apply(`Bleed stacks (${context.bleedStacks})`, context.bleedMultiplier);
			if (loadout.targetDamageReduction > 0) apply("Target PvP low-health defense", 1 - loadout.targetDamageReduction / 100);
			return { multiplier, steps };
		}

		if (loadout.targetVulnerability > 0) apply("Target vulnerability", 1 + loadout.targetVulnerability / 100);
		const moveModifier = boosts.MoveModifiers && boosts.MoveModifiers[move.id];
		if (moveModifier && typeof moveModifier.lowTargetHealthDamageBoost === "number" && targetHealthRatio < num(moveModifier.lowTargetHealthThreshold, 0)) {
			apply(`${champion.displayName}: ${move.displayName} low target health`, 1 + moveModifier.lowTargetHealthDamageBoost);
		}
		const crit = critMultiplier(loadout, boosts, move, targetHealthRatio);
		if (crit.label) apply(crit.label, crit.multiplier);
		if (num(loadout.attackerBurnDebuff, 1) !== 1) apply("Attacker burning (intense burn)", loadout.attackerBurnDebuff);
		if (mode !== "freepvp" && loadout.place === "dimension2") apply("Title: Dimension 2 damage", titleEffect(data, loadout, "Dimension2Damage"));
		if (loadout.damageBuff > 0) apply("DamageBuff status", 1 + loadout.damageBuff / 100);

		if (mode === "mob" || mode === "boss") {
			if (boosts.KillableMobDamage && !treatAsBoss) apply(`${champion.displayName}: killable mob damage`, 1 + boosts.KillableMobDamage);
			if (boosts.MobDamage) {
				const damageType = move.statType || move.specialType;
				apply(`${champion.displayName}: mob damage (${damageType})`, 1 + num(boosts.MobDamage[damageType], 0));
				if (move.specialType && boosts.MobDamage[move.specialType] && move.statType) {
					/* server only reads statType or specialType (first truthy), so nothing extra here */
				}
			}
			const transformationBoost = boosts.TransformationBoost;
			if (treatAsBoss && transformationBoost && loadout.transformationId && typeof transformationBoost.bossDamage === "number") {
				apply(`${champion.displayName}: transformation boss damage`, 1 + transformationBoost.bossDamage);
			}
			if (treatAsBoss && typeof boosts.BossDamage === "number") apply(`${champion.displayName}: boss damage`, 1 + boosts.BossDamage);
			if (treatAsBoss && buff.accessories.BossDamage > 0) apply("Accessories: boss damage", 1 + buff.accessories.BossDamage);
			const lowTarget = boosts.LowTargetHealthDamageBoost;
			if (lowTarget && targetHealthRatio < num(lowTarget.threshold, 0)) apply(`${champion.displayName}: low target health`, 1 + num(lowTarget.boost, 0));
			if (boosts.FrozenTargetDamageBoost && loadout.targetFrozen) apply(`${champion.displayName}: frozen target`, 1 + boosts.FrozenTargetDamageBoost);
			if (context.bleedMultiplier) apply(`Bleed stacks (${context.bleedStacks})`, context.bleedMultiplier);
			apply("Title: damage in dungeons", titleEffect(data, loadout, "DamageInDungeons"));
			if (treatAsBoss) {
				apply("Title: boss damage", titleEffect(data, loadout, "BossDamage"));
				if (loadout.place === "tower") apply("Title: tower boss damage", titleEffect(data, loadout, "TowerBossDamage"));
			}
			if (boosts.DungeonDamage && loadout.place === "dungeon") apply(`${champion.displayName}: dungeon damage`, 1 + boosts.DungeonDamage);
			if (treatAsBoss && loadout.targetBurning && context.burnBossTakenBoost) apply("Burn: boss damage taken", 1 + context.burnBossTakenBoost);
			return { multiplier, steps };
		}

		if (loadout.traitId === "Berserker" && loadout.berserkerActive) apply("Berserker trait", 1 + traitDamageBoost(data, loadout));
		const lowTarget = boosts.LowTargetHealthDamageBoost;
		if (lowTarget && targetHealthRatio < num(lowTarget.threshold, 0)) apply(`${champion.displayName}: low target health`, 1 + num(lowTarget.boost, 0));
		if (boosts.FrozenTargetDamageBoost && loadout.targetFrozen) apply(`${champion.displayName}: frozen target`, 1 + boosts.FrozenTargetDamageBoost);
		if (context.bleedMultiplier) apply(`Bleed stacks (${context.bleedStacks})`, context.bleedMultiplier);
		if (loadout.targetDamageReduction > 0) {
			let reduction = loadout.targetDamageReduction / 100;
			const ignore = boosts.IgnoreDamageReduction;
			let ignoreValue = 0;
			if (typeof ignore === "number") ignoreValue = ignore;
			else if (ignore && typeof ignore === "object") ignoreValue = num(ignore[move.statType || move.specialType], 0);
			reduction *= 1 - ignoreValue;
			apply(`Target damage reduction (${Math.round(reduction * 100)}%)`, 1 - reduction);
		}
		return { multiplier, steps };
	}

	function bleedConfigFor(move, boosts) {
		if (move.appliesBleed) return { config: MOVE_BLEED, stacksPerHit: num(move.bleedStacks, 1), source: "move" };
		const championBleed = boosts && boosts.Bleed;
		if (championBleed && (move.statType === "Sword" || move.specialType === "Sword")) return { config: championBleed, stacksPerHit: 1, source: "champion" };
		return null;
	}

	function computeMove(data, loadout, move) {
		const runtime = move.runtime;
		const hits = runtime && Array.isArray(runtime.hits) ? runtime.hits : [];
		const statuses = runtime && Array.isArray(runtime.statuses) ? runtime.statuses : [];
		const primary = baseDamage(data, loadout, move, "power", 1);
		const buff = primary.buff;
		const boosts = buff.boosts || {};
		const bleed = bleedConfigFor(move, boosts);
		const burnStatus = statuses.find((s) => s.effect === "Burn" && s.data && typeof s.data.bossDamageTakenBoost === "number");
		const context = {
			bleedStacks: loadout.bleedStacks,
			bleedMultiplier: bleed && loadout.bleedStacks > 0 ? 1 + Math.min(loadout.bleedStacks, bleed.config.maxStacks) * bleed.config.damageBoostPerStack : 0,
			burnBossTakenBoost: burnStatus ? burnStatus.data.bossDamageTakenBoost : 0,
		};
		const post = postMultipliers(data, loadout, move, buff, primary.title, context);

		const hitResults = [];
		let totalHits = 0;
		let totalDirect = 0;
		for (const hit of hits) {
			const basis = hit.damage ? hit.damage.basis : "power";
			if (basis === "none") continue;
			const count = Math.max(0, num(hit.count, 0));
			let perHit = 0;
			let base;
			if (loadout.mode === "duel" || loadout.mode === "boss") {
				base = baseDamage(data, loadout, move, "power", 1);
				perHit = base.value;
			} else {
				const multiplier = num(hit.damage && hit.damage.multiplier, 1);
				const value = basis === "power" ? multiplier : num(hit.damage && hit.damage.value, multiplier);
				base = baseDamage(data, loadout, move, basis, value);
				perHit = basis === "power" ? base.value * multiplier : base.value;
			}
			perHit *= post.multiplier;
			totalHits += count;
			totalDirect += perHit * count;
			hitResults.push({ hit, perHit, count, total: perHit * count, basis });
		}

		const dotResults = [];
		let totalDot = 0;
		for (const status of statuses) {
			if (!status.dot) continue;
			if (loadout.mode === "duel" || loadout.mode === "freepvp") {
				if (status.target === "mobs") continue;
			} else if (status.target === "players") continue;
			const dot = status.dot;
			let value = 0;
			if (dot.basis === "boss") {
				value = num(move.bossDamage, 1) * buff.multiplier * primary.title.multiplier * num(dot.totalMultiplier, 0);
			} else if (dot.basis === "power") {
				const powerValue = baseDamage(data, loadout, move, "power", 1);
				const statValue = loadout.mode === "duel" || loadout.mode === "boss"
					? statScaled(data, loadout, move, buff, primary.title)
					: powerValue.value;
				value = statValue * num(dot.totalMultiplier, 0);
			} else if (dot.basis === "flat") {
				value = num(dot.totalMultiplier, 0) * (num(loadout.targetMaxHealth, 1000) / 1000);
			} else if (dot.basis === "percentMaxHealth") {
				value = num(dot.totalMultiplier, 0) * num(loadout.targetMaxHealth, 1000);
			} else if (dot.basis === "fixed") {
				value = num(dot.totalMultiplier, 0);
			}
			if (loadout.mode === "boss" && loadout.targetBurning && status.effect === "Burn" && status.data && typeof status.data.bossDamageTakenBoost === "number") {
				value *= 1 + status.data.bossDamageTakenBoost;
			}
			dotResults.push({ status, total: value, ticks: num(dot.ticks, 1), duration: num(status.duration, 0) });
			totalDot += value;
		}

		let detonation = 0;
		if (bleed && loadout.includeBleedDetonation && totalHits > 0) {
			const stacksAdded = totalHits * bleed.stacksPerHit;
			if (loadout.bleedStacks + stacksAdded > bleed.config.maxStacks) {
				detonation = totalDirect * bleed.config.detonationMultiplier;
			}
		}

		const total = totalDirect + (loadout.includeDot ? totalDot : 0) + detonation;
		const endlag = runtime ? num(runtime.activationTillEndlagEnd, null) : null;
		const cooldownStart = runtime ? num(runtime.activationTillCooldownStart, null) : null;
		const cooldown = num(move.baseCooldown, 0);
		const cycleTime = (cooldownStart !== null ? cooldownStart : 0) + cooldown;

		return {
			move,
			runtime,
			perHitBase: primary.value,
			baseSteps: primary.steps,
			postSteps: post.steps,
			postMultiplier: post.multiplier,
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
			confidence: runtime ? runtime.confidence : "none",
		};
	}

	function statScaled(data, loadout, move, buff, title) {
		const statType = move.statType || "Strength";
		const stat = num(loadout.stats[statType], 0);
		const limit = Math.max(0, Math.min(100, num(loadout.statLimits[statType], 100))) / 100;
		return stat * limit * buff.multiplier * num(move.damageMultiplier, 1) * title.multiplier;
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
			const move = getMoveConfig(data, entry.powerId, entry.standId || loadout.standId);
			if (!move) continue;
			const localLoadout = Object.assign({}, loadout, { bleedStacks });
			const result = computeMove(data, localLoadout, move);
			const readyAt = cooldownReady[move.id] || 0;
			const waitForCooldown = Math.max(0, readyAt - time);
			const startAt = time + waitForCooldown;
			const endlag = result.endlag !== null ? result.endlag : 0;
			const cooldownStart = result.cooldownStart !== null ? result.cooldownStart : endlag;
			let detonation = 0;
			if (result.bleed) {
				const config = result.bleed.config;
				if (lastBleedAt !== null && startAt - lastBleedAt >= config.decayInterval) {
					const decayed = Math.floor((startAt - lastBleedAt) / config.decayInterval);
					bleedStacks = Math.max(0, bleedStacks - decayed);
					if (bleedStacks === 0) bleedDamagePool = 0;
				}
				const stacksAdded = result.totalHits * result.bleed.stacksPerHit;
				bleedDamagePool += result.totalDirect;
				bleedStacks += stacksAdded;
				lastBleedAt = startAt;
				if (bleedStacks > config.maxStacks) {
					detonation = bleedDamagePool * config.detonationMultiplier;
					bleedStacks = 0;
					bleedDamagePool = 0;
				}
			}
			const damage = result.totalDirect + (loadout.includeDot ? result.totalDot : 0) + detonation;
			totalDamage += damage;
			rows.push({
				entry,
				move,
				result,
				startAt,
				waitForCooldown,
				endAt: startAt + endlag,
				damage,
				detonation,
				cumulative: totalDamage,
				bleedStacksAfter: bleedStacks,
			});
			cooldownReady[move.id] = startAt + cooldownStart + result.cooldown;
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
		defaultLoadout,
		getMoveConfig,
		computeMove,
		simulateCombo,
		exportMoveJson,
		buffMultiplier,
		MOVE_BLEED,
	};
})();
