import STTApi from "./index";
import CONFIG from "./CONFIG";
import { CrewAvatarDTO, CrewData, CrewDTO, PlayerCharacterDTO, SkillData, CrewActionDTO, CrewEquipmentSlotData } from './DTO'

export interface BuffStat {
	multiplier: number;
	percent_increase: number;
};

export function calculateBuffConfig(): { [index: string]: BuffStat } {
	const skills = Object.keys(CONFIG.SKILLS);
	const buffs = ['core', 'range_min', 'range_max'];

	const buffConfig: { [index: string]: BuffStat } = {};

	for(let skill of skills) {
		for(let buff of buffs) {
			buffConfig[`${skill}_${buff}`] = {
				multiplier: 1,
				percent_increase: 0
			};
		}
	}

	for(let buff of STTApi.playerData.character.crew_collection_buffs.concat(STTApi.playerData.character.starbase_buffs)) {
		if (buffConfig[buff.stat]) {
			if (buff.operator === 'percent_increase') {
				buffConfig[buff.stat].percent_increase += buff.value;
			} else if (buff.operator === "multiplier") {
				buffConfig[buff.stat].multiplier = buff.value;
			} else {
				console.warn(`Unknown buff operator '${buff.operator }' for '${buff.stat}'.`);
			}
		}
	}

	return buffConfig;
}

function crewToRoster(dto: CrewDTO) : CrewData {
	let voyage_score = 0;
	let gauntlet_score = 0;
	let skillData : {[sk: string] : SkillData } = {};
	for (let skill in CONFIG.SKILLS) {
		let sdto = dto.skills[skill];
		if (!sdto) {
			sdto = {
				core: 0,
				range_min: 0,
				range_max: 0
			};
		}
		let profAvg = (sdto.range_max + sdto.range_min) / 2;
		let sd: SkillData = {
			core: sdto.core,
			min: sdto.range_min,
			max: sdto.range_max,
			voy: sdto.core + profAvg
		};
		skillData[skill] = sd;
		voyage_score += skillData[skill].voy || 0;
		gauntlet_score += profAvg;
	}

	let equipment_slots : CrewEquipmentSlotData[] = dto.equipment_slots as CrewEquipmentSlotData[];

	equipment_slots.forEach((equipment) => {
		equipment.have = false;
	});

	dto.equipment.forEach(equipment => {
		equipment_slots[equipment[0]].have = true;
	});

	let traits = dto.traits.concat(dto.traits_hidden).map((trait) => STTApi.getTraitName(trait)).join();
	let rawTraits = dto.traits.concat(dto.traits_hidden);

	// Replace "nonhuman" with "alien" to make the search easier
	let nh = rawTraits.indexOf('nonhuman');
	if (nh > -1) {
		rawTraits.splice(nh, 1, 'alient');
	}

	return {
		id: dto.archetype_id,
		avatar_id: dto.archetype_id,
		crew_id: dto.id,
		symbol: dto.symbol,
		name: dto.name,
		short_name: dto.short_name,
		portrait: dto.portrait,
		full_body: dto.full_body,

		buyback: dto.in_buy_back_state,
		frozen: 0,
		isExternal: false,
		expires_in: dto.expires_in,
		status: {
			frozen: 0,
			buyback: dto.in_buy_back_state,
			expires_in: dto.expires_in,
			active: !dto.in_buy_back_state,
			external: false,
		},

		rarity: dto.rarity,
		max_rarity: dto.max_rarity,
		level: dto.level,
		max_level: dto.max_level,
		favorite: dto.favorite,
		flavor: dto.flavor,
		active_id: dto.active_id,
		action: dto.action,
		ship_battle: dto.ship_battle,

		traits,
		rawTraits,
		equipment_slots,
		skills: skillData,

		voyage_score,
		gauntlet_score,
		usage_value: 0
	};
}

export function buildCrewDataAll(allcrew: CrewDTO[]): CrewData[] {
	let rosterAll: CrewData[] = [];
	let dupeChecker = new Set<string>();
	allcrew.forEach((crew: CrewDTO) => {
		// Sometimes duplicates can sneak into our allcrew list, filter them out, but keep
		// if at a different level or rarity
		let key = crew.symbol + '.' + crew.level + '.' + crew.rarity;
		if (dupeChecker.has(key)) {
			return;
		}

		dupeChecker.add(key);

		let avatar = STTApi.getCrewAvatarBySymbol(crew.symbol);
		if (!avatar) {
			console.error(`Could not find the crew avatar for (all crew entry) archetype_id ${crew.archetype_id}`);
			return;
		}
		STTApi.applyBuffConfig(crew);
		let rosterEntry = crewToRoster(crew);
		rosterEntry.isExternal = true;
		rosterEntry.status.external = true;

		rosterEntry.archetypes = crew.archetypes;

		rosterAll.push(rosterEntry);
	});

	for (let crew of rosterAll) {
		// Populate default icons (if they're already cached)
		crew.iconUrl = STTApi.imageProvider.getCrewCached(crew, false);
		crew.iconBodyUrl = STTApi.imageProvider.getCrewCached(crew, true);
	}

	return rosterAll;
}

// Build CrewData[] from player.character CrewDTO[] and frozen immortal data
export async function buildCrewData(character: PlayerCharacterDTO): Promise<CrewData[]> {
	let roster: CrewData[] = [];

	// Add all the crew in the active roster
	character.crew.forEach((crew) => {
		const avatar = STTApi.getCrewAvatarById(crew.archetype_id);
		if (!avatar) {
			console.error(`Could not find the crew avatar for archetype_id ${crew.archetype_id}`);
			return;
		}

		let rosterEntry = crewToRoster(crew);
		roster.push(rosterEntry);
	});

	// Now add all the frozen crew
	if (character.stored_immortals && character.stored_immortals.length > 0) {
		// Use the cache wherever possible
		// TODO: does DB ever change the stats of crew? If yes, we may need to ocasionally clear the cache - perhaps based on record's age
		let frozenPromises: Promise<CrewData>[] = [];

		character.stored_immortals.forEach((imm) => {
			const avatar = STTApi.getCrewAvatarById(imm.id);
			if (!avatar) {
				console.error(`Could not find the crew avatar for frozen archetype_id ${imm.id}`);
				return;
			}
			//let rosterEntry = getDefaultsInner(avatar);
			//roster.push(rosterEntry);

			frozenPromises.push(loadFrozen(avatar.symbol, imm.quantity));
		});

		await Promise.all(frozenPromises).then(datas => roster.splice(roster.length, 0, ...datas));
	}

	for (let crew of roster) {
		// Populate default icons (if they're already cached)
		crew.iconUrl = STTApi.imageProvider.getCrewCached(crew, false);
		crew.iconBodyUrl = STTApi.imageProvider.getCrewCached(crew, true);
	}

	// collects usage_value field for the given skill over the entire roster
	function collect(skillField: string, extField: string, max:number):void {
		let filtered = roster.filter(c => !c.buyback);
		if (extField) {
			filtered = filtered.filter((c) => c.skills[skillField][extField] > 0)
				.sort((a, b) => b.skills[skillField][extField] - a.skills[skillField][extField]);
		}
		else {
			filtered = filtered.filter((c: any) => c[skillField] > 0)
				.sort((a: any, b: any) => b[skillField] - a[skillField]);
		}
		for (let i = 0; i < max && i < filtered.length; ++i) {
			// allow frozen items to be exported but not count towards top-10
			let c = filtered[i];
			if (c.frozen > 0)
				++max;
			let value = c.usage_value;
			if (c.usage_value === undefined) {
				c.usage_value = 1;
			}
			else {
				c.usage_value++;
			}
		}
	}

	for (let sk in CONFIG.SKILLS) {
		collect(sk, 'core', 6);
		collect(sk, 'max', 3);
		collect(sk, 'voy', 9);
	}
	collect('voyage_score', '', 9);
	collect('gauntlet_score', '', 9);

	return roster;
}

async function loadFrozen(crewSymbol: string, frozenCount: number): Promise<CrewData> {
	let crew : CrewDTO | undefined = undefined;
	let entry = await STTApi.immortals.where('symbol').equals(crewSymbol).first();
	if (entry) {
		//console.info('Found ' + crewSymbol + ' in the immortalized crew cache');
		STTApi.applyBuffConfig(entry.crew);
		crew = entry.crew;
	} else {
		crew = await STTApi.loadFrozenCrewData(crewSymbol);

		// We don't need to await, as this is just populating a cache and can be done whenever
		STTApi.immortals.put({
			symbol: crewSymbol,
			crew: crew
		});
	}

	let roster = crewToRoster(crew);
	if (!roster.crew_id) {
		// frozen crew don't have a unique id, so supply one; make it less than one to distinguish internally
		roster.crew_id = Math.random();
	}

	roster.frozen = frozenCount;
	roster.status.frozen = frozenCount;
	roster.status.active = false;
	roster.status.buyback = false;
	roster.level = 100;
	roster.rarity = roster.max_rarity;

	return roster;
}

export function formatCrewStats(crew: CrewData): string {
	let result = '';
	for (let skillName in CONFIG.SKILLS) {
		let skill = crew.skills[skillName];

		if (skill && skill.core && (skill.core > 0)) {
			result += `${CONFIG.SKILLS_SHORT[skillName]} (${Math.floor(skill.core + (skill.min + skill.max) / 2)}) `;
		}
	}
	return result;
}
