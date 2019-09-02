import 'react-table/react-table.css';

import React from 'react';
import { Image, ImageFit } from 'office-ui-fabric-react/lib/Image';
import { Label } from 'office-ui-fabric-react/lib/Label';
import { Icon } from 'office-ui-fabric-react/lib/Icon';
import { IconButton, DefaultButton } from 'office-ui-fabric-react/lib/Button';
import { HoverCard } from 'office-ui-fabric-react/lib/HoverCard';
import { TooltipHost } from 'office-ui-fabric-react/lib/Tooltip';
import { Checkbox } from 'office-ui-fabric-react/lib/Checkbox';

import ReactTable, { SortingRule, Column } from 'react-table';
import { isMobile } from 'react-device-detect';

import { SkillCell } from './SkillCell';
import { ActiveCrewDialog } from './ActiveCrewDialog';
import { ItemDisplay } from '../ItemDisplay';

import STTApi, { CONFIG, RarityStars } from '../../api';
import { CrewData, ItemArchetypeDTO } from '../../api/STTApi';

export interface CrewListProps {
	data: CrewData[];
	sortColumn: string;
	selectedIds?: Set<number>;
	filterText?: string;
	onSelectionChange?: (sel:Set<number>) => void;
	groupRarity?: boolean;
	showBuyback?: boolean;
	compactMode?: boolean;
	duplicatelist?: boolean;
	embedded?: boolean;
}

interface CrewListState {
	items: CrewData[];
	selection: Set<number>;
	sorted: SortingRule[];
	active: {
		activeId?: number;
		name?: string;
	}
}

export class CrewList extends React.Component<CrewListProps, CrewListState> {

	static defaultProps = {
		sortColumn: 'max_rarity',
	};

	constructor(props:CrewListProps) {
		super(props);

		this.state = {
			items: props.data,
			sorted: [{ id: props.sortColumn, desc: false }],
			selection: props.selectedIds ? props.selectedIds : new Set(),
			active: { }
		};

		this._showActiveDialog = this._showActiveDialog.bind(this);
		this._onRenderExpandedCard = this._onRenderExpandedCard.bind(this);
		this._onRenderCompactCard = this._onRenderCompactCard.bind(this);
		this._onSelectionChange = this._onSelectionChange.bind(this);
		this._isSelected = this._isSelected.bind(this);
	}

	componentWillReceiveProps(nextProps:CrewListProps) {
		if (nextProps.data !== this.state.items) {
			this.setState({ items: nextProps.data });
		}

		if (nextProps.selectedIds !== this.state.selection) {
			this.setState({ selection: nextProps.selectedIds ? nextProps.selectedIds : new Set() });
		}
	}

	_onSelectionChange(id:any, isChecked:boolean | undefined) {
		this.setState((prevState, props) => {
			let selection = prevState.selection;

			if (isChecked) {
				selection.add(id);
			} else {
				selection.delete(id);
			}

			if (props.onSelectionChange) {
				props.onSelectionChange(selection);
			}

			return { selection };
		});
	}

	_isSelected(id:number) {
		return this.state.selection && this.state.selection.has(id);
	}

	_onRenderCompactCard(item:CrewData) {
		return <div className="ui items">
			<div className="item">
				<img src={item.iconBodyUrl} height={180} />
				<div className="content" style={{ padding: '12px' }}>
					<div className="header">{item.name}</div>
					<div className="meta">{item.flavor}</div>
					<div className="description">Traits: {item.traits.replace(new RegExp(',', 'g'), ', ')}</div>
					<span style={{ fontSize: '0.8rem' }}>id: {item.id}, symbol:{item.symbol}</span>
				</div>
			</div>
		</div>;
	}

	_onRenderExpandedCard(item:CrewData) {
		let equipment : {e?: ItemArchetypeDTO, have?: boolean }[] = [];
		item.equipment_slots.forEach(es => {
			equipment.push(
				{
					e: STTApi.itemArchetypeCache.archetypes.find(equipment => equipment.id === es.archetype),
					have: es.have
				}
			);
		});

		let eqTable;
		if (equipment && equipment.length > 0) {
			eqTable = (<div>
				<h4 className="ui header">Equipment</h4>
				<table><tbody>
					<tr>
						{
							equipment.map((eq, ix) => {
								if (eq.e) {
									return (<td key={eq.e.name + ix}>
										<ItemDisplay src={eq.e.iconUrl || ''} size={100} maxRarity={eq.e.rarity} rarity={eq.e.rarity} />
										<span style={{ fontSize: '0.8rem', color: eq.have ? "" : "red" }}>{eq.e.name}</span>
									</td>);
								}
								else {
									return <td></td>;
								}
							})
						}
					</tr></tbody>
				</table>
			</div>);
		}

		return (
			<div style={{ padding: '10px' }}>
				{eqTable}
				<h4 className="ui header">Ship abilitiy '{item.action.name}'</h4>
				<Label>Accuracy +{item.ship_battle.accuracy}  Crit Bonus +{item.ship_battle.crit_bonus}  {item.ship_battle.crit_chance && <span>Crit Rating +{item.ship_battle.crit_chance}  </span>}Evasion +{item.ship_battle.evasion}</Label>
				<Label>Increase {CONFIG.CREW_SHIP_BATTLE_BONUS_TYPE[item.action.bonus_type]} by {item.action.bonus_amount}</Label>
				{item.action.penalty && <Label>Decrease {CONFIG.CREW_SHIP_BATTLE_BONUS_TYPE[item.action.penalty.type]} by {item.action.penalty.amount}</Label>}

				{item.action.ability && <Label>Ability: {CONFIG.CREW_SHIP_BATTLE_ABILITY_TYPE[item.action.ability.type].replace('%VAL%', item.action.ability.amount)} {(item.action.ability.condition > 0) && <span>Trigger: {CONFIG.CREW_SHIP_BATTLE_TRIGGER[item.action.ability.condition]}</span>}</Label>}
				<Label>Duration: {item.action.duration}s  Cooldown: {item.action.cooldown}s  Initial Cooldown: {item.action.initial_cooldown}s  </Label>
				{item.action.limit && <Label>Limit: {item.action.limit} uses per battle</Label>}

				{this.renderChargePhases(item.action.charge_phases)}
			</div>
		);
	}

	renderChargePhases(charge_phases: any) {
		if (!charge_phases) {
			return <span />;
		} else {
			let phases :any[] = [];
			charge_phases.forEach((cp:any, idx:number) => {
				let phaseDescription = `Charge time: ${cp.charge_time}s`;

				if (cp.ability_amount) {
					phaseDescription += `  Ability amount: ${cp.ability_amount}`;
				}

				if (cp.bonus_amount) {
					phaseDescription += `  Bonus amount: ${cp.bonus_amount}`;
				}

				if (cp.duration) {
					phaseDescription += `  Duration: ${cp.duration}s`;
				}

				if (cp.cooldown) {
					phaseDescription += `  Cooldown: ${cp.cooldown}s`;
				}

				phases.push(<Label key={idx}>{phaseDescription}</Label>);
			});

			return (<div>
				<h4 className="ui header">Charge phases</h4>
				<div>
					{phases}
				</div>
			</div>);
		}
	}

	render() {
		let { items, sorted } = this.state;
		let pivotBy : string[] = [];

		if (this.props.groupRarity) {
			pivotBy = ['max_rarity'];
		}

		let columns = this._getColumns(this.props.duplicatelist, this.props.showBuyback, this.props.compactMode, pivotBy.length > 0);

		if (this.props.filterText) {
			items = items.filter(i => this._filterCrew(i, this.props.filterText!.toLowerCase()))
		}

		return (
			<div className={this.props.embedded ? 'embedded-crew-grid' : 'data-grid'} data-is-scrollable='true'>
				<ReactTable
					data={items}
					columns={columns}
					defaultPageSize={(items.length <= 50) ? items.length : 50}
					pageSize={(items.length <= 50) ? items.length : 50}
					sorted={sorted}
					onSortedChange={sorted => this.setState({ sorted })}
					showPagination={(items.length > 50)}
					showPageSizeOptions={false}
					className="-striped -highlight"
					style={(!this.props.embedded && (items.length > 50)) ? { height: 'calc(100vh - 88px)' } : {}}
					pivotBy={pivotBy}
					getTrProps={(s:any, r:any) => {
						return {
							style: {
								opacity: (r && r.original && r.original.isExternal) ? "0.5" : "inherit"
							}
						};
					}}
					getTdProps={(s: any, r: any) => {
						return this.props.compactMode ? { style: { padding: "2px 3px" } } : {};
					}}
				/>
				<ActiveCrewDialog activeId={this.state.active.activeId} name={this.state.active.name} />
			</div>
		);
	}

	_getColumns(duplicatelist?: boolean, showBuyBack?: boolean, compactMode?: boolean, pivotRarity?: boolean) {
		let _columns : Column<CrewData>[] = [];

		if (duplicatelist) {
			_columns.push({
				id: 'airlock',
				Header: 'Airlock',
				minWidth: 100,
				maxWidth: 100,
				resizable: false,
				style: { marginTop: 15 },
				Cell: (cell) => {
					let crew:CrewData = cell.original;

					if (crew.crew_id)
						return (<div><Checkbox label='Airlock'
							checked={this._isSelected(crew.crew_id)}
							onChange={(ev, isChecked) => this._onSelectionChange(crew.crew_id, isChecked)} />
							{(crew.buyback && crew.expires_in === null) &&
							<TooltipHost content={`${crew.short_name} is stuck in the airlock. You need to contact DB support to release them!`} calloutProps={{ gapSpace: 0 }}>
							<p style={{color:'red'}}>ERROR!</p>
						</TooltipHost>}
							</div>);
					else
						return <span />;
				}
			});
		}

		if (pivotRarity) {
			_columns.push({
				id: 'max_rarity',
				Header: 'Rarity',
				accessor: (obj) => CONFIG.RARITIES[obj.max_rarity].name,
				minWidth: 150,
				maxWidth: 150,
				resizable: false,
				Cell: (cell) => <span />
			});
		}

		_columns.push({
			id: 'icon',
			Header: '',
			minWidth: compactMode ? 28 : 60,
			maxWidth: compactMode ? 28 : 60,
			resizable: false,
			accessor: 'name',
			Cell: (cell) => {
				if (cell && cell.original) {
					return <Image src={cell.original.iconUrl} width={compactMode ? 22 : 50} height={compactMode ? 22 : 50} imageFit={ImageFit.contain} shouldStartVisible={true} />;
				} else {
					return <span />;
				}
			},
			Aggregated: (row) => <span />
		});

		if (!isMobile) {
			_columns.push({
				id: 'short_name',
				Header: 'Name',
				minWidth: 90,
				maxWidth: 110,
				resizable: true,
				accessor: 'short_name',
				Cell: (cell) => {
					if (cell && cell.original) {
						return <a href={'https://stt.wiki/wiki/' + cell.original.name.split(' ').join('_')} target='_blank'>{cell.original.short_name}</a>;
					} else {
						return <span />;
					}
				},
				Aggregated: (row) => <span />
			});
		}

		_columns.push({
				id: 'name',
				Header: 'Full name',
				minWidth: 110,
				maxWidth: 190,
				resizable: true,
				accessor: 'name',
			Cell: (cell) => {
					if (cell && cell.original) {
						return <HoverCard id="nameHoverCard"
							expandingCardProps={{
								compactCardHeight: 180,
								expandedCardHeight: 420,
								renderData: cell.original,
								onRenderExpandedCard: this._onRenderExpandedCard,
								onRenderCompactCard: this._onRenderCompactCard,
								styles: { root: { width: '520px' } }
							}}
							instantOpenOnClick={true}>
							<span>{cell.original.name}</span>
						</HoverCard>;
					} else {
						return <span />;
					}
				},
				Aggregated: (row) => <span />
			},
			{
				id: 'usage_value',
				Header: 'Value',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'usage_value',
				Cell: (cell) => cell.original ? <div className='skill-stats-div'>{cell.original.usage_value}</div> : <span />,
				aggregate: (vals) => vals.reduce((a:any, b:any) => (a || 0) + (b || 0), 0) / vals.length,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'level',
				Header: 'Level',
				minWidth: 40,
				maxWidth: 45,
				resizable: false,
				accessor: 'level',
				aggregate: (vals) => vals.reduce((a:any, b:any) => a + b, 0) / vals.length,
				Aggregated: (row) => <span>{Math.floor(row.value)}</span>
			},
			{
				id: 'rarity',
				Header: 'Rarity',
				// Sort all by max fusion level, then fractional part by current fusion level
				accessor: (obj) => obj.max_rarity + (obj.rarity / obj.max_rarity),
				minWidth: 75,
				maxWidth: 85,
				resizable: false,
				Cell: (cell) => {
					if (cell && cell.original) {
						return <RarityStars min={1} max={cell.original.max_rarity} value={cell.original.rarity ? cell.original.rarity : null} />;
					} else {
						return <span />;
					}
				},
				Aggregated: (row) => <span />
			});

		if (!isMobile) {
			_columns.push({
				id: 'favorite',
				Header: () => <Icon iconName='FavoriteStar' />,
				minWidth: 30,
				maxWidth: 30,
				style: { paddingLeft: 0, paddingRight: 0, textAlign: 'center' },
				resizable: false,
				accessor: 'favorite',
				Cell: (cell) => {
					if (cell && cell.original && cell.value) {
						return <TooltipHost content={`You marked ${cell.original.short_name} as favorite in the game`} calloutProps={{ gapSpace: 0 }}>
							<Icon iconName='FavoriteStar' />
						</TooltipHost>;
					} else {
						return <span />;
					}
				},
				Aggregated: (row) => <span />
			},
			{
				id: 'frozen',
				Header: () => <Icon iconName='Snowflake' />,
				minWidth: 30,
				maxWidth: 30,
				style: { paddingLeft: 0, paddingRight: 0, textAlign: 'center' },
				resizable: false,
				accessor: 'frozen',
				Cell: (cell: any) => {
					if (cell && cell.value && cell.original) {
						return <TooltipHost content={`You have ${(cell.value === 1) ? 'one copy' : `${cell.value} copies`} of ${cell.original.short_name} frozen (cryo-d)`} calloutProps={{ gapSpace: 0 }}>
							{cell.value > 1 ? cell.value : ''}<Icon iconName='Snowflake' />
						</TooltipHost>;
					} else {
						return <span />;
					}
				},
				aggregate: (vals) => vals.map((v:any) => v ? 1 : 0).reduce((a:any, b:any) => a + b, 0),
				Aggregated: (row) => <span>{Math.floor(row.value)}</span>
			});
		}

		// TODO: add global setting / toggle for turning off buy-back crew
		if (!duplicatelist && showBuyBack) {
			_columns.push({
				id: 'buyback',
				Header: () => <Icon iconName='EmptyRecycleBin' />,
				minWidth: 30,
				maxWidth: 30,
				style: { paddingLeft: 0, paddingRight: 0, textAlign: 'center' },
				resizable: false,
				accessor: 'buyback',
				Cell: (cell) => {
					if (cell && cell.value && cell.original) {
						return <TooltipHost content={`This copy of ${cell.original.short_name} was dismissed and is available for buyback for a limited time`} calloutProps={{ gapSpace: 0 }}>
							<Icon iconName='EmptyRecycleBin' />
						</TooltipHost>;
					} else {
						return <span />;
					}
				},
				Aggregated: (row) => <span />
			});
		}

		if (!isMobile) {
			_columns.push({
				id: 'active_id',
				Header: () => <Icon iconName='Balloons' />,
				minWidth: 30,
				maxWidth: 30,
				style: { paddingLeft: 0, paddingRight: 0, textAlign: 'center' },
				resizable: false,
				accessor: 'active_id',
				Cell: (cell) => {
					if (cell && cell.original && cell.original.active_id) {
						if (compactMode) {
							let isShuttle = false;
							STTApi.playerData.character.shuttle_adventures.forEach((shuttle) => {
								if (shuttle.shuttles[0].id === cell.original.active_id) {
									isShuttle = true;
								}
							});
							return isShuttle ? 'S' : 'V';
						}
						return <IconButton iconProps={{ iconName: 'Balloons' }} title='Active engagement' onClick={() => this._showActiveDialog(cell.original.active_id, cell.original.name)} />;
					} else {
						return <span />;
					}
				},
				aggregate: (vals) => vals.map((v:any) => v ? 1 : 0).reduce((a:any, b:any) => a + b, 0),
				Aggregated: (row) => <span>{Math.floor(row.value)}</span>
			});
		}

		// Compute an average aggregate, only including nonzero values
		let aggAvg = (vals: any) => {
			let nonzeros = vals.reduce((a: any, b: any) => a + ((b || 0) > 0 ? 1 : 0), 0);
			return vals.reduce((a: any, b: any) => (a || 0) + (b || 0), 0) / nonzeros;
		}

		_columns.push({
			id: 'command_skill',
			Header: 'COM',
			minWidth: 50,
			maxWidth: 70,
			resizable: true,
			accessor: 'command_skill_core',
			Cell: (cell) => cell.original ? <SkillCell skill={cell.original.command_skill} compactMode={compactMode} /> : <span />,
			aggregate: aggAvg,
			Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
		},
			{
				id: 'diplomacy_skill',
				Header: 'DIP',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'diplomacy_skill_core',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.diplomacy_skill} compactMode={compactMode} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'engineering_skill',
				Header: 'ENG',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'engineering_skill_core',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.engineering_skill} compactMode={compactMode} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'medicine_skill',
				Header: 'MED',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'medicine_skill_core',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.medicine_skill} compactMode={compactMode} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'science_skill',
				Header: 'SCI',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'science_skill_core',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.science_skill} compactMode={compactMode} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'security_skill',
				Header: 'SEC',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'security_skill_core',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.security_skill} compactMode={compactMode} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'command_skill_prof',
				Header: 'Com+',
				minWidth: 70,
				maxWidth: 100,
				resizable: true,
				accessor: 'command_skill.max',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.command_skill} compactMode={compactMode} proficiency={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg max)</span>
			},
			{
				id: 'diplomacy_skill_prof',
				Header: 'Dip+',
				minWidth: 70,
				maxWidth: 100,
				resizable: true,
				accessor: 'diplomacy_skill.max',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.diplomacy_skill} compactMode={compactMode} proficiency={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg max)</span>
			},
			{
				id: 'engineering_skill_prof',
				Header: 'Eng+',
				minWidth: 70,
				maxWidth: 100,
				resizable: true,
				accessor: 'engineering_skill.max',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.engineering_skill} compactMode={compactMode} proficiency={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg max)</span>
			},
			{
				id: 'medicine_skill_prof',
				Header: 'Med+',
				minWidth: 70,
				maxWidth: 100,
				resizable: true,
				accessor: 'medicine_skill.max',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.medicine_skill} compactMode={compactMode} proficiency={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg max)</span>
			},
			{
				id: 'science_skill_prof',
				Header: 'Sci+',
				minWidth: 70,
				maxWidth: 100,
				resizable: true,
				accessor: 'science_skill.max',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.science_skill} compactMode={compactMode} proficiency={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg max)</span>
			},
			{
				id: 'security_skill_prof',
				Header: 'Sec+',
				minWidth: 70,
				maxWidth: 100,
				resizable: true,
				accessor: 'security_skill.max',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.security_skill} compactMode={compactMode} proficiency={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg max)</span>
			},
			{
				id: 'command_skill_voy',
				Header: 'Com++',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'command_skill_voy',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.command_skill} compactMode={compactMode} combined={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'diplomacy_skill_voy',
				Header: 'Dip++',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'diplomacy_skill_voy',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.diplomacy_skill} compactMode={compactMode} combined={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'engineering_skill_voy',
				Header: 'Eng++',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'engineering_skill_voy',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.engineering_skill} compactMode={compactMode} combined={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'medicine_skill_voy',
				Header: 'Med++',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'medicine_skill_voy',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.medicine_skill} compactMode={compactMode} combined={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'science_skill_voy',
				Header: 'Sci++',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'science_skill_voy',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.science_skill} compactMode={compactMode} combined={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'security_skill_voy',
				Header: 'Sec++',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'security_skill_voy',
				Cell: (cell) => cell.original ? <SkillCell skill={cell.original.security_skill} compactMode={compactMode} combined={true} /> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'voyage_score',
				Header: 'VOY',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'voyage_score',
				Cell: (cell) => cell.original ? <div className='skill-stats-div'>{cell.original.voyage_score}</div> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'gauntlet_score',
				Header: 'Gauntlet',
				minWidth: 50,
				maxWidth: 70,
				resizable: true,
				accessor: 'gauntlet_score',
				Cell: (cell) => cell.original ? <div className='skill-stats-div'>{cell.original.gauntlet_score}</div> : <span />,
				aggregate: aggAvg,
				Aggregated: (row) => <span>{Math.floor(row.value)} (avg)</span>
			},
			{
				id: 'traits',
				Header: 'Traits',
				minWidth: 140,
				resizable: true,
				accessor: 'traits',
				Cell: (cell) => cell.original ? <div style={compactMode ? { overflow: 'hidden', textOverflow: 'ellipsis', height: '22px' } : { whiteSpace: 'normal', height: '50px' }}>{cell.original.traits.replace(/,/g, ', ')}</div> : <span />,
				aggregate: (vals) => 0,
				Aggregated: (row) => <span />
			});

		return _columns;
	}

	_filterCrew(crew:CrewData, searchString:string) {
		return searchString.split(';').some(segment => {
			if (segment.trim().length == 0) return false;
			return segment.split(' ').every(text => {
				if (text.trim().length == 0) return false;
				// search the name first
				if (crew.name.toLowerCase().indexOf(text) > -1) {
					return true;
				}

				// now search the traits
				if (crew.traits.toLowerCase().indexOf(text) > -1) {
					return true;
				}

				// now search the raw traits
				if (crew.rawTraits.find(trait => trait.toLowerCase().indexOf(text) > -1)) {
					return true;
				}

				return false;
			});
		});
	}

	_showActiveDialog(activeId:any, name:string) {
		this.setState({active: { activeId, name}});
	}
}
