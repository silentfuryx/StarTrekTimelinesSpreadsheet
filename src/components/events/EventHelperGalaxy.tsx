import React from 'react';

import { Item, Image, List, Accordion, Icon, AccordionTitleProps } from 'semantic-ui-react';

import { ItemDisplay } from '../../utils/ItemDisplay';

import STTApi, { CONFIG, RarityStars, getItemDetailsLink } from '../../api';
import { EventDTO, EventGatherPoolAdventureDTO, EVENT_TYPES, ItemArchetypeDTO, ItemData, CrewData, ItemArchetypeDemandDTO } from '../../api/DTO';
import { EventCrewBonusTable } from './EventHelperPage';
import ReactTable, { Column, SortingRule } from 'react-table';
import { MissionCostDetails } from '../../api/EquipmentTools';

interface ItemDemand {
   equipment: ItemArchetypeDTO;
   bestCrewChance: number;
   calcSlot: CalcSlot;
   craftCost: number;
   have: number;
   itemDemands: ItemDemandData[];
}

interface ItemDemandData {
   rd: ItemArchetypeDemandDTO;
   archetype?: ItemArchetypeDTO;
   item?: ItemData;
   item_name?: string;
   item_quantity?: number;
   cost?: number;
}

interface EquipListItem {
   equip: ItemArchetypeDTO;
   have: ItemData | undefined;
   itemDemands: ItemDemandData[];
   bestCrew: BonusCrew[];
}

interface BonusCrew {
   crew: CrewData;
   crew_id: number;
   skills: { [sk:string]:number };
   total: number;
   chance: number;
   text?: string;
   value?: string;
   image?: string;
}

interface CalcSlot {
   bestCrew: BonusCrew[];
   skills: string[];
   type?: string;
}

interface FarmListItem {
   archetype: ItemArchetypeDTO;
   item?: ItemData;
   uses: string;
   sources: (MissionCostDetails & { chance: number; quotient: number; title: string })[]
}

// Compute craft success chance based on formula steepness, challenge rating, etc.
function calcChance(skillValue: number) {
   let midpointOffset = skillValue / STTApi.serverConfig!.config.craft_config.specialist_challenge_rating;
   let val = Math.floor(
      100 /
      (1 +
         Math.exp(
            -STTApi.serverConfig!.config.craft_config.specialist_chance_formula.steepness *
            (midpointOffset - STTApi.serverConfig!.config.craft_config.specialist_chance_formula.midpoint)
            ))
      );
   return Math.min(val / 100, STTApi.serverConfig!.config.craft_config.specialist_maximum_success_chance);
   // const cc = STTApi.serverConfig!.config.craft_config;
   // let midpointOffset = skillValue / cc.specialist_challenge_rating;
   // let val = Math.floor(100 / (1 + Math.exp(cc.specialist_chance_formula.steepness * (midpointOffset - cc.specialist_chance_formula.midpoint))));
   // return Math.min(val / 100, cc.specialist_maximum_success_chance);
};

function processArchetype(arch: ItemArchetypeDTO | undefined, bestCrew: BonusCrew[]) : ItemDemand | undefined {
   if (!arch || !arch.recipe || !arch.recipe.jackpot) {
      return undefined;
   }

   let skills = arch.recipe.jackpot.skills;

   let calcSlot: CalcSlot = {
      bestCrew: bestCrew.map(bc => { return {...bc}}),
      skills: []
   };

   if (skills.length === 1) {
      // AND or single
      calcSlot.skills = skills[0].split(',');
      if (calcSlot.skills.length === 1) {
         calcSlot.type = 'SINGLE';
         calcSlot.bestCrew.forEach((c) => {
            c.total = c.skills[calcSlot.skills[0]];
         });
      } else {
         calcSlot.type = 'AND';
         calcSlot.bestCrew.forEach((c) => {
            c.total = Math.floor((c.skills[calcSlot.skills[0]] + c.skills[calcSlot.skills[1]]) / 2);
         });
      }
   } else {
      // OR
      calcSlot.type = 'OR';
      calcSlot.skills = skills;
      calcSlot.bestCrew.forEach((c) => {
         c.total = Math.max(c.skills[calcSlot.skills[0]], c.skills[calcSlot.skills[1]]);
      });
   }

   let seen = new Set<number>();
   calcSlot.bestCrew = calcSlot.bestCrew.filter((c) => c.total > 0).filter((c) => (seen.has(c.crew_id) ? false : seen.add(c.crew_id)));

   calcSlot.bestCrew.forEach(c => c.chance = calcChance(c.total));
   if (arch.recipe.jackpot.trait_bonuses) {
      for (let trait in arch.recipe.jackpot.trait_bonuses) {
         let tv = arch.recipe.jackpot.trait_bonuses[trait];
         calcSlot.bestCrew.forEach(c => {
            if (c.crew.rawTraits.includes(trait)) {
               c.chance += tv;
            }
         });
      }
   }

   calcSlot.bestCrew.sort((a, b) => a.chance - b.chance);
   calcSlot.bestCrew = calcSlot.bestCrew.reverse();

   let bestCrewChance = calcSlot.bestCrew[0].chance;

   calcSlot.bestCrew.forEach((c) => {
      c.text = `${c.crew.name} (${c.total})`;
      c.value = c.crew.symbol;
      c.image = c.crew.iconUrl;
      c.chance = Math.floor(Math.min(c.chance, 1) * 100);
   });

   bestCrewChance = calcSlot.bestCrew[0].chance;//Math.floor(Math.min(bestCrewChance, 1) * 100);

   let itemDemands: { rd: ItemArchetypeDemandDTO, archetype?: ItemArchetypeDTO, item?: ItemData }[] = [];
   for (let rd of arch.recipe.demands) {
      const item = STTApi.items.find(item => item.archetype_id === rd.archetype_id);
      const archetype = STTApi.itemArchetypeCache.archetypes.find(arch => arch.id === rd.archetype_id);
      itemDemands.push({
         rd,
         archetype,
         item
      });
   }

   let have = STTApi.items.find(item => item.archetype_id === arch!.id);

   let craftCost = 0;
   if (arch.type === 3) {
      craftCost = STTApi.serverConfig!.config.craft_config.cost_by_rarity_for_component[arch.rarity].amount;
   } else if (arch.type === 2) {
      craftCost = STTApi.serverConfig!.config.craft_config.cost_by_rarity_for_equipment[arch.rarity].amount;
   } else {
      console.warn('Equipment of unknown type', arch);
   }

   return {
      equipment: arch,
      bestCrewChance,
      calcSlot,
      craftCost,
      have: have ? have.quantity : 0,
      itemDemands
   };
}

function getRosterWithBonuses(crew_bonuses: { [crew_symbol: string]: number }): BonusCrew[] {
   // TODO: share some of this code with Shuttles
   let sortedRoster: BonusCrew[] = [];
   STTApi.roster.forEach(crew => {
      if (crew.buyback) { // || crew.frozen > 0 || crew.active_id) {
         return;
      }

      let bonus = 1;
      if (crew_bonuses[crew.symbol]) {
         bonus = crew_bonuses[crew.symbol];
      }

      let skills: { [sk: string]: number } = {};
      for (let sk in CONFIG.SKILLS) {
         skills[sk] = crew.skills[sk].core * bonus;
      }

      sortedRoster.push({
         crew,
         crew_id: crew.id,
         skills,
         total: 0,
         chance: 0
      });
   });

   return sortedRoster;
}

const GalaxyStat = (props: {
   value: number | string,
   label: string,
   classAdd?: string
}) => {
   let value = props.value;
   if (typeof value === 'number') {
      value = Math.trunc(value * 100) / 100;
   }
   return <div className={`${props.classAdd ? props.classAdd : ''} ui tiny statistic`}>
      <div className="label" style={{ color: 'unset' }}>{props.label}</div>
      <div className="value" style={{ color: props.classAdd || 'unset' }}>{value}</div>
   </div>;
}

export const GalaxyEvent = (props: {
   event: EventDTO;
}) => {
   let [activeIndex, setActiveIndex] = React.useState(-1);

   let crew_bonuses = [];
   let eventEquip: EquipListItem[] = [];
   let farmList: FarmListItem[] = [];
   let currEvent: EventDTO = props.event;

   if (!props.event ||
      !props.event.content ||
      props.event.content.content_type !== EVENT_TYPES.GATHER ||
      !props.event.content.gather_pools
   ) {
      return <span />;
   }

   const adventures = currEvent.content.gather_pools.length > 0 ? currEvent.content.gather_pools[0].adventures : [];
   const rewards = currEvent.content.gather_pools.length > 0 ? currEvent.content.gather_pools[0].rewards : [];

   const bonusCrew: BonusCrew[] = getRosterWithBonuses(currEvent!.content.crew_bonuses!);
   for (let cb in currEvent.content.crew_bonuses!) {
      let avatar = STTApi.getCrewAvatarBySymbol(cb);
      if (!avatar) {
         continue;
      }

      crew_bonuses.push({
         avatar,
         bonus: currEvent.content.crew_bonuses![cb],
         iconUrl: STTApi.imageProvider.getCrewCached(avatar, false)
      });
   }

   // Look through all archetypes for items that apply to the event (i.e. the ones with jackpot)
   for (let arch of STTApi.itemArchetypeCache.archetypes) {
      if (arch.recipe && arch.recipe.jackpot && arch.recipe.jackpot.trait_bonuses) {
         const demand = processArchetype(arch, [...bonusCrew])!;
         //TODO: re-use demand instead of this additional DTO; ALSO re-use calculation and dont do it more than once
         let itemDemands: ItemDemandData[] = [];
         for (let rd of arch.recipe.demands) {
            let item = STTApi.items.find(item => item.archetype_id === rd.archetype_id);
            let arc = STTApi.itemArchetypeCache.archetypes.find(a => a.id === rd.archetype_id)!;

            itemDemands.push({
               rd,
               archetype: arc,
               item,
               item_name: item ? item.name : arc ? arc.name : '',
               item_quantity: item ? item.quantity : 0,
               cost: item ? (item.sources.length == 0 ? 0 : item.sources.sort((a, b) => b.quotient - a.quotient)[0].quotient) : undefined,
            });
         }

         let have = STTApi.items.find(item => item.archetype_id === arch.id);

         eventEquip.push({
            equip: arch,
            have,
            itemDemands,
            bestCrew: demand.calcSlot.bestCrew,
         });
      }
   }

   let farmingList = new Map<number,string>();
   eventEquip.forEach(e =>
      e.itemDemands.forEach(id => {
         if (farmingList.has(id.rd.archetype_id)) {
            farmingList.set(id.rd.archetype_id, farmingList.get(id.rd.archetype_id)! + ',' + id.rd.count + 'x');
         } else {
            farmingList.set(id.rd.archetype_id, '' + id.rd.count + 'x');
         }
      })
   );

   farmingList.forEach((v, k) => {
      let archetype = STTApi.itemArchetypeCache.archetypes.find(a => a.id === k)!;

      const item = STTApi.items.find(item => item.archetype_id === k)!;
      farmList.push({
         archetype,
         item,
         uses: v,
         sources: item ? (item.sources ?? []) : []
      });
   });

   // TODO: compare with future galaxy events
   let toSave = farmList.map(fl => ({ equipment_id: fl.archetype.id, equipment_symbol: fl.archetype.symbol, uses: fl.uses }));
   //console.log(toSave);

   function _handleClick(titleProps: AccordionTitleProps) {
      const { index } = titleProps;
      //const { activeIndex } = this.state;
      const newIndex = activeIndex === index ? -1 : index as number;

      //this.setState({ activeIndex: newIndex });
      setActiveIndex(newIndex);
   }

   const vpCurr = currEvent.victory_points ?? 0;
   const vpTopThresh = currEvent.threshold_rewards[currEvent.threshold_rewards.length-1].points;
   let rareArchetypeId : number | undefined = undefined;
   let rareArchetype = undefined;
   let rareTurninCount = undefined;
   {
      const gos = adventures.filter(ad => ad.golden_octopus);
      if (gos.length > 0) {
         const go = gos[0];
         rareArchetypeId = go.demands[0].archetype_id;
         rareTurninCount = go.demands[0].count;
         //rareArchetype = STTApi.itemArchetypeCache.archetypes.find(a => a.id === rareArchetypeId);
      }
   }
   const rareItem = STTApi.items.find(item => item.archetype_id === rareArchetypeId);
   let rareCount = 0;
   if (rareItem) {
      rareCount = rareItem.quantity;
   }
   let vpPerTurnin = undefined;
   if (rewards.length > 0) {
      vpPerTurnin = rewards[0].quantity;
   }

   let rawTurninsToGo = undefined;
   if (vpPerTurnin) {
      rawTurninsToGo = (vpTopThresh - vpCurr) / vpPerTurnin;
   }
   let rareVP = undefined;
   if (rareTurninCount && vpPerTurnin) {
      let rareTurninCountLeft = rareTurninCount;
      //if (currEvent.opened_phase === 2) {
         rareVP = 0;
         //TODO: test this before turnins have occurred
         // if (vpPerTurnin === 125 && rareTurninCountLeft > 0) {
         //    rareVP += 125 * 1;
         //    rareTurninCountLeft -= 1;
         // }
         // if (vpPerTurnin === 415 && rareTurninCountLeft > 0) {
         //    let times = 3;
         //    rareTurninCountLeft -= times;
         //    if (rareTurninCountLeft < 0) {
         //       times = times + rareTurninCountLeft;
         //    }
         //    rareVP += 415 * times;
         //    rareTurninCountLeft -= times;
         // }
         rareVP = rareCount / rareTurninCount * 4850; // 4850 for 15x rare turnins
      //}
   }

   let turninsIncludingRares = 0;
   if (rareVP && vpPerTurnin) {
      turninsIncludingRares = (vpTopThresh - vpCurr - rareVP) / vpPerTurnin;
   }

   return (
      <div>
         <h3>Galaxy event: {currEvent.name}</h3>
         <div>
            <GalaxyStat label="Current VP" value={vpCurr} />
            <GalaxyStat label="Current Rares" value={rareCount ?? 'unknown'} />
            <GalaxyStat label="VP from Rares" value={rareVP ?? 'unknown'} />
         </div>
         {vpTopThresh > vpCurr && <div>
            <GalaxyStat label="Top Threshold VP" value={vpTopThresh} />
            <GalaxyStat label="Turnins without Rares" value={rawTurninsToGo ?? 'unknown'} />
            <GalaxyStat label="Turnins with Rares" value={turninsIncludingRares ?? 'unknown'} />
         </div>}

         <Accordion>
            <Accordion.Title active={activeIndex === 2} index={2} onClick={(e, titleProps) => _handleClick(titleProps)}>
               <Icon name='dropdown' />
               Crew bonuses
            </Accordion.Title>
            <Accordion.Content active={activeIndex === 2}>
               <List horizontal>
                  {crew_bonuses.map(cb => (
                     <List.Item key={cb.avatar.symbol}>
                        <Image avatar src={cb.iconUrl} />
                        <List.Content>
                           <List.Header>{cb.avatar.name}</List.Header>
                           Bonus level {cb.bonus}x
                        </List.Content>
                     </List.Item>
                  ))}
               </List>
            </Accordion.Content>
            <Accordion.Title active={activeIndex === 3} index={3} onClick={(e, titleProps) => _handleClick(titleProps)}>
               <Icon name='dropdown' />
               Owned Crew Bonus Table
            </Accordion.Title>
            <Accordion.Content active={activeIndex === 3}>
               <EventCrewBonusTable bonuses={currEvent.content.crew_bonuses!} />
            </Accordion.Content>
            <Accordion.Title active={activeIndex === 1} index={1} onClick={(e, titleProps) => _handleClick(titleProps)}>
               <Icon name='dropdown' />
               Event equipment requirements {eventEquip.length == 0 && '(Pending event start)'}
            </Accordion.Title>
            <Accordion.Content active={activeIndex === 1}>
               <div style={{ display: 'flex', flexDirection: 'column' }}>
               {eventEquip.map(e => {
                  const advs = adventures.filter(ad => ad.demands.some(d => d.archetype_id === e.equip.id));
                  const adv = advs.length > 0 ? advs[0] : undefined;
                  return <div key={e.equip.id} style={{display: 'inline-flex', marginBottom: '15px'}}>
                     <h3>
                        <ItemDisplay src={e.equip.iconUrl ?? ''} style={{ display: 'inline' }}
                           size={30} maxRarity={e.equip.rarity} rarity={e.equip.rarity} />
                        {e.equip.name}
                        {adv && <span style={{fontStyle: 'italic'}}> - {adv.name}</span>}
                     </h3>
                     <div style={{ display: 'flex', flexDirection: 'column', marginLeft: '10px' }}>{e.itemDemands.map((id, index) => {
                        if (!id.archetype) {
                           return <span key={index} ><ItemDisplay src={''}
                              style={{display: 'inline', fontWeight: 'bold', color: 'red' }}
                              size={25} maxRarity={0} rarity={0} />UNKNOWN-NEEDED x{id.rd.count} (have 0)&nbsp;</span>;
                        }

                        let styleCost = {};
                        let styleCount = {};
                        let cost = id.cost ?? 0;
                        cost = Math.round(cost * 100) / 100;
                        let costStr = String(cost);
                        if (cost <= 0) {
                           costStr = '';
                        }
                        if (costStr.length > 0 && cost < 0.07) {
                           styleCost = {
                              fontWeight: cost < 0.07 ? 'bold' : 'normal',
                              color: cost < 0.07 ? 'red' : ''
                           };
                        }
                        if (!id.item_quantity || id.item_quantity < 50) {
                           styleCount = {
                              fontWeight: 'bold',
                              color: 'red'
                           };
                        }

                        return <span key={id.item_name}>
                           <ItemDisplay src={id.archetype.iconUrl ?? ''} style={{ display: 'inline' }}
                              size={25} maxRarity={id.archetype.rarity} rarity={id.archetype.rarity} />
                           {id.item_name} x{id.rd.count} <span style={styleCount}>(have {id.item_quantity})</span> <span
                           style={styleCost}>(cost: {costStr})</span>&nbsp;</span>;
                        }
                     )}</div>
                     <div style={{display: 'flex', flexDirection: 'column', marginLeft: '10px'}}>Best crew: {e.bestCrew.slice(0, 3).map(bc => {
                        const isOccupied = bc.crew.frozen > 0 || bc.crew.active_id;
                        return <span key={bc.crew.crew_id} style={{ fontStyle: isOccupied ? 'italic' : 'normal' }}>
                           <img src={bc.crew.iconUrl} width='25' height='25' />&nbsp;
                           {bc.crew.name}&nbsp;({bc.chance}%)
                           {bc.crew.frozen > 0 && <span> Frozen!</span>}
                           {bc.crew.active_id && <span> Active!</span>}
                           </span>;
                        })}
                     </div>
                  </div>;
               })}
               </div>
            </Accordion.Content>
            <Accordion.Title active={activeIndex === 0} index={0} onClick={(e, titleProps) => _handleClick(titleProps)}>
               <Icon name='dropdown' />
               Farming list for Galaxy event {farmList.length == 0 && '(Pending event start)'}
            </Accordion.Title>
            <Accordion.Content active={activeIndex === 0}>
               <FarmList farmList={farmList} />
            </Accordion.Content>
         </Accordion>
      </div>
   );
}

const FarmList = (props: {
   farmList: FarmListItem[]
}) => {
   const [sorted, setSorted] = React.useState([{ id: 'quantity', desc: false }] as SortingRule[]);
   const MAX_PAGE_SIZE = 20;
   let columns = buildColumns();

   return <div className='data-grid' data-is-scrollable='true'>
         <ReactTable
            data={props.farmList}
            columns={columns}
            defaultPageSize={props.farmList.length <= MAX_PAGE_SIZE ? props.farmList.length : MAX_PAGE_SIZE}
            pageSize={props.farmList.length <= MAX_PAGE_SIZE ? props.farmList.length : MAX_PAGE_SIZE}
            sorted={sorted}
            onSortedChange={sorted => setSorted(sorted)}
            showPagination={props.farmList.length > MAX_PAGE_SIZE}
            showPageSizeOptions={false}
            className='-striped -highlight'
            style={props.farmList.length > MAX_PAGE_SIZE ? { height: 'calc(80vh - 88px)' } : {}}
         />
      </div>;

   function buildColumns() {
      let cols: Column<FarmListItem>[] = [
         {
            id: 'icon',
            Header: '',
            minWidth: 50,
            maxWidth: 50,
            resizable: false,
            sortable: false,
            accessor: (fli) => fli.archetype.name,
            Cell: (cell) => {
               let item : FarmListItem = cell.original;
               return <ItemDisplay src={item.archetype.iconUrl!} size={30} maxRarity={item.archetype.rarity} rarity={item.archetype.rarity}
               // onClick={() => this.setState({ replicatorTarget: found })}
               />;
            }
         },
         {
            id: 'name',
            Header: 'Name',
            minWidth: 130,
            maxWidth: 180,
            resizable: true,
            accessor: (fli) => fli.archetype.name,
            Cell: (cell) => {
               let item: FarmListItem = cell.original;
               return (
                  <a href={getItemDetailsLink(item.archetype)} target='_blank'>
                     {item.archetype.name}
                  </a>
               );
            }
         },
         {
            id: 'rarity',
            Header: 'Rarity',
            accessor: (fli) => fli.archetype.rarity,
            minWidth: 80,
            maxWidth: 80,
            resizable: false,
            Cell: (cell) => {
               let item: FarmListItem = cell.original;
               return <RarityStars min={1} max={item.archetype.rarity} value={item.archetype.rarity} />;
            }
         },
         {
            id: 'quantity',
            Header: 'Have',
            minWidth: 50,
            maxWidth: 80,
            resizable: true,
            accessor: (fli:FarmListItem) => fli.item ? fli.item.quantity : 0,
         },
         {
            id: 'uses',
            Header: 'Uses',
            minWidth: 50,
            maxWidth: 50,
            resizable: true,
            accessor: 'uses',
         },
         {
            id: 'cost',
            Header: 'Farming Cost',
            minWidth: 50,
            maxWidth: 50,
            resizable: true,
            accessor: (fli) => fli.sources.length == 0 ? 0 : fli.sources.sort((a,b) => b.quotient - a.quotient)[0].quotient,
         },
         {
            id: 'sources',
            Header: 'Sources',
            minWidth: 400,
            maxWidth: 1000,
            resizable: true,
            sortable: false,
            Cell: (cell) => {
               let item: FarmListItem = cell.original;
               if (item.sources.length == 0) return '';
               return item.sources.sort((a,b) => b.quotient - a.quotient)
                  .map((src, idx, all) => src.title + (idx === all.length-1 ? '' : ', '));
            }
         }
      ];
      return cols;
   }
}
