/*
    StarTrekTimelinesSpreadsheet - A tool to help with crew management in Star Trek Timelines
    Copyright (c) 2017 - 2018 IAmPicard

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
import { NetworkInterface } from './NetworkInterface';
import { NetworkFetch } from './NetworkFetch';
import { DexieCache, QuestsTable, EquipmentTable, ImmortalsDB, ConfigTable, WikiImageTable } from './Cache';
import { IChallengeSuccess } from './MissionCrewSuccess';
import { matchCrew, calculateBuffConfig, BuffStat } from './CrewTools';
import { MinimalComplement } from './MinimalComplement';
import { mergeDeep } from './ObjectMerge';
import { ImageCache, ImageProvider, WikiImageProvider, AssetImageProvider, ServerImageProvider, ImageProviderChain, FileImageCache } from './';
import { NeededEquipmentClass, EquipNeedFilter, EquipNeed } from './EquipmentTools';
import Dexie from 'dexie';
import CONFIG from './CONFIG';
import Moment from 'moment';
import { PlayerDTO, ItemArchetypeDTO, PlatformConfigDTO, CrewAvatar, ServerConfigDTO, ShipSchematicDTO, CrewData, ShipDTO, MissionDTO, CrewDTO, SkillDTO } from './DTO';

export * from './DTO';

export class STTApiClass {
	private _accessToken: string | undefined;
	private _net: NetworkInterface;
	private _playerData?: { player: PlayerDTO; item_archetype_cache: { archetypes: ItemArchetypeDTO[]; id: number; }; };
	private _starbaseData: any;
	private _fleetMemberInfo: any;
	private _cache: DexieCache;
	private _buffConfig: { [index: string]: BuffStat };
	private _neededEquipment: NeededEquipmentClass;

	public platformConfig?: { config: PlatformConfigDTO; };
	public crewAvatars: CrewAvatar[];
	public serverConfig?: { config: ServerConfigDTO; };;
	public shipSchematics: ShipSchematicDTO[];
	public fleetData: any;
	public roster: CrewData[];
	public ships: ShipDTO[];
	public missions: MissionDTO[];
	public missionSuccess!: IChallengeSuccess[];
	public minimalComplement?: MinimalComplement;
	public imageProvider!: ImageProvider;
	public inWebMode: boolean;
	public allcrew!: CrewData[];

	public serverAddress: string = 'http://localhost/';

	// Used with Moment when adding an offset. Does not need to be used when
	// doing a fresh request for data such as for gauntlet or voyage status
	public lastSync: Moment.Moment = Moment();

	constructor() {
		this.refreshEverything(true);
		this._net = new NetworkFetch();
		this._neededEquipment = new NeededEquipmentClass();

		// TODO: Dexie uses IndexedDB, so doesn't work in plain node.js without polyfill - should the caching be an interface?
		this._cache = new DexieCache('sttcache');

		this.inWebMode = false;
		this._buffConfig = {};
		this.allcrew = [];
	}

	setWebMode(webMode: boolean, keepServerAddress: boolean) {
		this.inWebMode = webMode;

		if (this.inWebMode) {
			// In web mode, we don't hardcode the server, but simply load from the domain root
			if (!keepServerAddress) {
				this.serverAddress = '/';
			}

			this._net.setProxy(this.serverAddress + 'proxy');
			this.imageProvider = new ServerImageProvider(this.serverAddress);
		}
		else {
			let cache : ImageCache = new FileImageCache();
			this.imageProvider = new ImageProviderChain(cache, new AssetImageProvider(cache), new WikiImageProvider());
		}
	}

	async refreshEverything(logout: boolean) {
		this.crewAvatars = [];
		this.serverConfig = undefined;
		this._playerData = undefined;
		this.platformConfig = undefined;
		this.shipSchematics = [];
		this._starbaseData = null;
		this.fleetData = null;
		this._fleetMemberInfo = null;
		this.roster = [];
		this.ships = [];
		this.missions = [];
		this.missionSuccess = [];
		this.minimalComplement = undefined;

		if (logout) {
			this._accessToken = undefined;

			if (this._cache) {
				await this._cache.config
					.where('key')
					.equals('autoLogin')
					.delete();
				await this._cache.config
					.where('key')
					.equals('accessToken')
					.delete();
			}
		}
	}

	get networkHelper(): NetworkInterface {
		return this._net;
	}

	get quests(): Dexie.Table<QuestsTable, number> {
		return this._cache.quests;
	}

	get equipmentCache(): Dexie.Table<EquipmentTable, string> {
		return this._cache.equipment;
	}

	get immortals(): Dexie.Table<ImmortalsDB, string> {
		return this._cache.immortals;
	}

	get wikiImages(): Dexie.Table<WikiImageTable, string> {
		return this._cache.wikiImages;
	}

	get config(): Dexie.Table<ConfigTable, string> {
		return this._cache.config;
	}

	get loggedIn(): boolean {
		return this._accessToken != null;
	}

	get playerData(): PlayerDTO {
		return this._playerData!.player;
	}

	get itemArchetypeCache(): { archetypes: ItemArchetypeDTO[]; } {
		return this._playerData!.item_archetype_cache;
	}

	get fleetMembers(): any {
		return this._fleetMemberInfo.members;
	}

	get fleetSquads(): any {
		return this._fleetMemberInfo.squads;
	}

	get starbaseRooms(): any {
		return this._starbaseData[0].character.starbase_rooms;
	}

	getTraitName(trait: string): string {
		return this.platformConfig!.config.trait_names[trait] ? this.platformConfig!.config.trait_names[trait] : trait;
	}

	getShipTraitName(trait: string): string {
		return this.platformConfig!.config.ship_trait_names[trait] ? this.platformConfig!.config.ship_trait_names[trait] : trait;
	}

	getCrewAvatarById(id: number): CrewAvatar | undefined {
		return this.crewAvatars.find((avatar: CrewAvatar) => avatar.id === id);
	}

	getCrewAvatarBySymbol(symbol: string): CrewAvatar | undefined {
		return this.crewAvatars.find((avatar: CrewAvatar) => avatar.symbol === symbol);
	}

	async login(username: string, password: string, autoLogin: boolean): Promise<any> {
		let data = await this._net.post_proxy(CONFIG.URL_PLATFORM + 'oauth2/token', {
			username: username,
			password: password,
			client_id: CONFIG.CLIENT_ID,
			grant_type: 'password'
		});

		if (data.error_description) {
			throw new Error(data.error_description);
		} else if (data.access_token) {
			return this._loginWithAccessToken(data.access_token, autoLogin);
		} else {
			throw new Error('Invalid data for login!');
		}
	}

	async loginWithCachedAccessToken(): Promise<boolean> {
		let entry = await this._cache.config
			.where('key')
			.equals('autoLogin')
			.first();
		if (entry && entry.value === true) {
			entry = await this._cache.config
				.where('key')
				.equals('accessToken')
				.first();
			if (entry && entry.value) {
				this._accessToken = entry.value;
				return true;
			} else {
				return false;
			}
		} else {
			return false;
		}
	}

	private async _loginWithAccessToken(access_token: string, autoLogin: boolean): Promise<void> {
		this._accessToken = access_token;

		/*await*/ this._cache.config.put({
			key: 'autoLogin',
			value: autoLogin
		});

		if (autoLogin) {
			/*await*/ this._cache.config.put({
				key: 'accessToken',
				value: access_token
			});
		}
	}

	async loginWithFacebook(facebookAccessToken: string, facebookUserId: string, autoLogin: boolean): Promise<any> {
		let data = await this._net.post_proxy(CONFIG.URL_PLATFORM + 'oauth2/token', {
			'third_party.third_party': 'facebook',
			'third_party.access_token': facebookAccessToken,
			'third_party.uid': facebookUserId,
			client_id: CONFIG.CLIENT_ID,
			grant_type: 'third_party'
		});

		if (data.error_description) {
			throw new Error(data.error_description);
		} else if (data.access_token) {
			return this._loginWithAccessToken(data.access_token, autoLogin);
		} else {
			throw new Error('Invalid data for login!');
		}
	}

	async executeGetRequest(resourceUrl: string, qs: any = {}): Promise<any> {
		if (this._accessToken === undefined) {
			throw new Error('Not logged in!');
		}

		return this._net.get_proxy(
			CONFIG.URL_SERVER + resourceUrl,
			Object.assign({ client_api: CONFIG.CLIENT_API_VERSION, access_token: this._accessToken }, qs)
		);
	}

	async executeGetRequestWithUpdates(resourceUrl: string, qs: any = {}): Promise<any> {
		if (this._accessToken === undefined) {
			throw new Error('Not logged in!');
		}

		return this._net
			.get_proxy(
				CONFIG.URL_SERVER + resourceUrl,
				Object.assign({ client_api: CONFIG.CLIENT_API_VERSION, access_token: this._accessToken }, qs)
			)
			.then((data: any) => this.applyUpdates(data));
	}

	async executePostRequest(resourceUrl: string, qs: any): Promise<any> {
		if (this._accessToken === undefined) {
			throw new Error('Not logged in!');
		}

		return this._net.post_proxy(
			CONFIG.URL_SERVER + resourceUrl,
			Object.assign({ client_api: CONFIG.CLIENT_API_VERSION }, qs),
			this._accessToken
		);
	}

	async executePostRequestWithUpdates(resourceUrl: string, qs: any = {}): Promise<any> {
		if (this._accessToken === undefined) {
			throw new Error('Not logged in!');
		}

		return this._net
			.post_proxy(CONFIG.URL_SERVER + resourceUrl, Object.assign({ client_api: CONFIG.CLIENT_API_VERSION }, qs), this._accessToken)
			.then((data: any) => this.applyUpdates(data));
	}

	async loadServerConfig(): Promise<void> {
		let data = await this.executeGetRequest('config', {
			platform: 'WebGLPlayer',
			device_type: 'Desktop',
			client_version: CONFIG.CLIENT_VERSION,
			platform_folder: CONFIG.CLIENT_PLATFORM
		});

		this.serverConfig = data;
	}

	async loadCrewArchetypes(): Promise<void> {
		let data = await this.executeGetRequest('character/get_avatar_crew_archetypes');
		if (data.crew_avatars) {
			this.crewAvatars = data.crew_avatars as CrewAvatar[];
		} else {
			throw new Error('Invalid data for crew avatars!');
		}
	}

	async loadPlatformConfig(): Promise<void> {
		let data = await this.executeGetRequest('config/platform');
		this.platformConfig = data;
	}

	async loadPlayerData(): Promise<void> {
		let data = await this.executeGetRequest('player');
		if (data.player) {
			this._playerData = data;

			this.lastSync = Moment();

			// After loading player data, we can calculate the buff config for collections and starbase
			this._buffConfig = calculateBuffConfig();
		} else {
			throw new Error('Invalid data for player!');
		}
	}

	async resyncPlayerCurrencyData(): Promise<void> {
		// this code reloads minimal stuff to update the player information and merge things back in
		let data = await this.executeGetRequest('player/resync_currency');
		if (data.player) {
			this._playerData!.player = mergeDeep(this._playerData!.player, data.player);
		} else {
			throw new Error('Invalid data for player!');
		}
	}

	async resyncInventory(): Promise<{ player: PlayerDTO }> {
		// TODO: we should sync this data back into _playerData.player somehow (but we're adding too much stuff onto it now to work, like iconUrls, immortals, etc.)
		let data = await this.executeGetRequest('player/resync_inventory');
		if (data.player) {
			return data;
		} else {
			throw new Error('Invalid data for player!');
		}
	}

	async loadShipSchematics(): Promise<void> {
		let data = await this.executeGetRequest('ship_schematic');
		if (data.schematics) {
			this.shipSchematics = data.schematics;
		} else {
			throw new Error('Invalid data for ship schematics!');
		}
	}

	async loadFrozenCrew(symbol: string): Promise<CrewDTO> {
		let data = await this.executePostRequest('stasis_vault/immortal_restore_info', { symbol: symbol });
		if (data.crew) {
			return data.crew as CrewDTO;
		} else {
			throw new Error('Invalid data for frozen crew!');
		}
	}

	async sellCrew(id: number): Promise<any> {
		return this.executePostRequestWithUpdates('crew/sell', { id: id });
	}

	async sellManyCrew(ids: number[]): Promise<any> {
		return this.executePostRequestWithUpdates('crew/sell_many', { ids: ids });
	}

	async warpQuest(id: number, mastery_level: number, factor: number): Promise<any> {
		let data = await this.executeGetRequest('quest/warp', { id, mastery_level, factor });
		if (data) {
			return this.applyUpdates(data);
		} else {
			throw new Error('Invalid data for quest warp!');
		}
	}

	async loadFleetMemberInfo(guildId: string): Promise<void> {
		let data = await this.executePostRequest('fleet/complete_member_info', { guild_id: guildId });
		if (data) {
			this._fleetMemberInfo = data;
		} else {
			throw new Error('Invalid data for fleet member info!');
		}
	}

	async loadFleetData(guildId: string): Promise<void> {
		let data = await this.executeGetRequest('fleet/' + guildId);
		if (data.fleet) {
			this.fleetData = data.fleet;
		} else {
			throw new Error('Invalid data for fleet!');
		}
	}

	async loadStarbaseData(guildId: string): Promise<void> {
		let data = await this.executeGetRequest('starbase/get');
		if (data) {
			this._starbaseData = data;
		} else {
			throw new Error('Invalid data for starbase!');
		}
	}

	async inspectPlayer(playerId: string): Promise<any> {
		let data = await this.executeGetRequest('player/inspect/' + playerId);
		if (data.player) {
			return data.player;
		} else {
			throw new Error('Invalid data for player!');
		}
	}

	// getGithubReleases(): Promise<any> {
	// 	return this._net.get(CONFIG.URL_GITHUBRELEASES, {});
	// }

	async refreshRoster(): Promise<void> {
		// TODO: need to reload icon urls as well
		this.roster = await matchCrew(this._playerData!.player.character);
	}

	async applyUpdates(data: any): Promise<any[]> {
		if (!data) {
			return [];
		}

		if (Array.isArray(data)) {
			let ephemerals: any[] = [];
			for (let val of data) {
				let e = await this.applyUpdates(val);
				ephemerals = ephemerals.concat(e);
			}

			return ephemerals;
		} else {
			if (!data.action) {
				console.log(`Not sure what message this is; should we be updating something: '${data}'`);
				return [data];
			}

			if (data.action === 'update') {
				if (data.player) {
					this._playerData!.player = mergeDeep(this._playerData!.player, data.player);
				}

				if (data.character) {
					this._playerData!.player.character = mergeDeep(this._playerData!.player.character, data.character);
				}

				if (data.event) {
					if(this._playerData!.player.character.events && this._playerData!.player.character.events.length === 1) {
						this._playerData!.player.character.events[0] = mergeDeep(this._playerData!.player.character.events[0], data.event);
					}
				}
			} else if (data.action === 'delete') {
				// TODO
				// For example, data.character.items, array with objects with just the id property in them

				if (data.character) {
					let pc :any = this._playerData!.player.character; // remove type info to allow object indexing
					for (let prop in data.character) {
						if (Array.isArray(data.character[prop]) && Array.isArray(pc[prop])) {
							for (let item of data.character[prop]) {
								pc[prop] = pc[prop].filter((itm: any) => itm.id !== item.id);
							}
						}
					}
				} else if (
					data.event &&
					data.event.content.gather_pool &&
					data.event.content.gather_pool.length === 1 &&
					data.event.content.gather_pools[0].adventures &&
					data.event.content.gather_pools[0].adventures.length === 1
				) {
					this._playerData!.player.character.events[0].content.gather_pools[0].adventures = this._playerData!.player.character.events[0].content.gather_pools[0].adventures.filter(
						(itm) => itm.id !== data.event.content.gather_pools[0].adventures[0].id
					);
				} else {
					console.warn('Delete not applied; data is most likely stale; user should refresh');
				}
			} else if (data.action === 'ephemeral') {
				return [data];
			} else {
				console.log(`Unknown data action '${data.action}' not applied. Data is most likely stale; user should refresh`);
			}

			return [];
		}
	}

	/// Takes the raw stats from a crew and applies the current player buff config (useful for imported crew)
	applyBuffConfig(crew: CrewDTO): void {
		const getMultiplier = (skill: string, stat: string) => {
			return this._buffConfig[`${skill}_${stat}`].multiplier + this._buffConfig[`${skill}_${stat}`].percent_increase;
		};

		for (let skill in crew.base_skills) {
			let cs: any = crew.skills;
			let css: SkillDTO = cs[skill];
			let cb: any = crew.base_skills;
			let cbs: SkillDTO = cb[skill];

			if (!cbs) {
				continue;
			}

			css.core = Math.round(cbs.core * getMultiplier(skill, 'core'));
			css.range_min = Math.round(cbs.range_min * getMultiplier(skill, 'range_min'));
			css.range_max = Math.round(cbs.range_max * getMultiplier(skill, 'range_max'));
		}
	}

	getNeededEquipment(filters: EquipNeedFilter, limitCrew: number[]): EquipNeed[] {
		return this._neededEquipment.filterNeededEquipment(filters, limitCrew);
	}

	getEquipmentManager() : NeededEquipmentClass {
		return this._neededEquipment;
	}
}
