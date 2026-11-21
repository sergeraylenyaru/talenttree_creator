"""Validation for the additive RPG character profile in class documents."""

import re

SCHOOLS = ('physical', 'fire', 'frost', 'arcane', 'nature', 'shadow', 'holy')
PRIMARY = ('strength', 'agility', 'intellect', 'stamina', 'spirit')
RATING_STATS = ('hitRating','spellHitRating','expertiseRating','critRating','hasteRating','masteryRating',
                'dodgeRating','parryRating','blockRating','spellPenetration','armorPenetration','hitChance',
                'spellHitChance','expertise','dodgeChance','parryChance','blockChance')
SECONDARY = RATING_STATS + (
    'attackPower', 'spellPower', 'healingPower', 'critChance', 'critMultiplier', 'haste', 'mastery',
    'versatility', 'armor', 'physicalResistance', 'maxHealth', 'healthRegen', 'resourceRegen',
    'movementSpeed', 'meleePower', 'rangedPower', 'spellDamage', 'cooldownRecovery'
) + tuple(school + 'Resistance' for school in SCHOOLS[1:])
ATTRIBUTES = PRIMARY + SECONDARY
SLOTS = ('head', 'shoulders', 'chest', 'wrists', 'hands', 'waist', 'legs', 'feet', 'neck', 'back',
         'ring1', 'ring2', 'trinket1', 'trinket2', 'mainHand', 'offHand', 'ranged')
ARMOR = ('cloth', 'leather', 'mail', 'plate')
MELEE = ('sword1', 'sword2', 'axe', 'mace', 'dagger', 'staff', 'wand')
RANGED = ('bow', 'crossbow', 'wand')
TWO_HANDED = ('sword2', 'staff')
TYPES = ARMOR + ('ring', 'necklace', 'trinket', 'cloak') + MELEE + ('bow', 'crossbow', 'shield')
MODIFIERS = ('damage', 'healing', 'cooldown', 'cost', 'castTime', 'maxStacks', 'resourceGain', 'duration', 'period', 'procChance')
PROC_EVENTS = (
    'castStarted', 'castCompleted', 'attackHit', 'projectileHit', 'attackMissed', 'projectileMissed',
    'damage', 'healing', 'critical', 'periodicDamage', 'periodicHealing', 'statusApplied', 'statusExpired',
    'absorbed', 'resourceGained', 'resourceSpent', 'autoHit', 'cooldownCompleted',
    'incomingDamage','criticalHeal','criticalDamage','statusStacked','channelTick','targetDefeated','dodge','parry','block','dispelled'
)


def record(value, keys, message):
    if not isinstance(value, dict) or set(value) - set(keys):
        raise ValueError(message)


def bounded(value, lo, hi):
    return type(value) in (int, float) and lo <= value <= hi


def integer(value, lo, hi):
    return type(value) is int and lo <= value <= hi


def text(value, lo, hi):
    return isinstance(value, str) and lo <= len(value.strip()) and len(value) <= hi


def identifier(value):
    return isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value))


def collection(values, maximum, needs_id=True):
    if not isinstance(values, list) or len(values) > maximum or any(not isinstance(value, dict) for value in values):
        raise ValueError('Invalid RPG collection')
    if needs_id:
        ids = [value.get('id') for value in values]
        if not all(map(identifier, ids)) or len(ids) != len(set(ids)):
            raise ValueError('Invalid or duplicate RPG identifier')
    return values


def stat_map(value, lo):
    record(value, ATTRIBUTES, 'Invalid character statistic')
    if any(not bounded(n, max(-1, lo) if key == 'critChance' else lo, 1 if key == 'critChance' else 1e8)
           for key, n in value.items()):
        raise ValueError('Invalid character stat value')


def types_for(slot):
    if slot == 'mainHand':
        return MELEE
    if slot == 'ranged':
        return RANGED
    if slot == 'offHand':
        return tuple(kind for kind in MELEE if kind not in TWO_HANDED) + ('shield',)
    if slot == 'neck':
        return ('necklace',)
    if slot == 'back':
        return ('cloak',)
    if slot.startswith('ring'):
        return ('ring',)
    if slot.startswith('trinket'):
        return ('trinket',)
    return ARMOR


def validate_item(item):
    record(item, ('id', 'name', 'description', 'icon', 'level', 'quality', 'type', 'slot', 'armor',
                  'minDamage', 'maxDamage', 'speed', 'stats', 'requiredLevel','requiredClass','setId', 'disabled', 'roll'), 'Invalid item fields')
    slot, kind = item.get('slot'), item.get('type')
    if (not identifier(item.get('id')) or not text(item.get('name'), 1, 100)
            or not text(item.get('description', ''), 0, 3000) or not identifier(item.get('icon'))
            or slot not in SLOTS or kind not in types_for(slot)
            or item.get('quality') not in ('common', 'uncommon', 'rare', 'epic', 'legendary')
            or not integer(item.get('level'), 1, 1000)):
        raise ValueError('Check item identity, slot and quality')
    if ('disabled' in item and type(item['disabled']) is not bool
            or not integer(item.get('requiredLevel', 1), 1, 1000)
            or not bounded(item.get('armor', 0), 0, 1e8)):
        raise ValueError('Invalid item requirement or armor')
    if ('setId' in item and not identifier(item['setId'])
            or 'requiredClass' in item and item['requiredClass'] not in ('warrior','paladin','hunter','rogue','priest','shaman','mage','warlock','druid','deathknight')):
        raise ValueError('Invalid item class or set')
    stat_map(item.get('stats', {}), -1e8)
    if 'roll' in item:
        rolled=item['roll']
        record(rolled,('seed','spread','baseStats'),'Invalid item roll')
        if not integer(rolled.get('seed'),0,4294967295) or not bounded(rolled.get('spread'),0,1):
            raise ValueError('Invalid item roll')
        stat_map(rolled.get('baseStats'),-1e8)
    if kind in MELEE + RANGED:
        lo, hi = item.get('minDamage'), item.get('maxDamage')
        if not bounded(lo, 0, 1e8) or not bounded(hi, lo, 1e8) or not bounded(item.get('speed'), .4, 30):
            raise ValueError('Check weapon damage and speed')
    elif set(item) & {'minDamage', 'maxDamage', 'speed'}:
        raise ValueError('Only weapons have attack speed and damage')


def validate_build(document, build, talents):
    record(build, talents, 'Invalid saved talents')
    if any(not integer(rank, 0, talents[key]['maxRank']) for key, rank in build.items()):
        raise ValueError('Invalid saved talent rank')
    if sum(build.values()) > document['budget']:
        raise ValueError('Saved build exceeds talent budget')
    for branch in document['branches']:
        for talent in branch['talents']:
            if not build.get(talent['id']):
                continue
            if talent.get('requiredLevel',1) > document.get('rpg',{}).get('level',1):
                raise ValueError('Saved build violates talent level requirement')
            req = talent.get('requires')
            prior = sum(build.get(other['id'], 0) for other in branch['talents'] if other['row'] < talent['row'])
            if prior < talent['row'] * document['rowCost'] or req and build.get(req) != talents[req]['maxRank']:
                raise ValueError('Saved build violates talent dependencies')


def validate_rpg(document, resources):
    if 'rpg' not in document:
        return
    profile = document['rpg']
    record(profile, ('version', 'level', 'primaryBudget', 'attributes', 'formulas', 'items', 'equipped', 'restrictions',
                     'hasteUses', 'autoSlot', 'resources', 'bonuses', 'procs', 'builds', 'incoming', 'seed',
                     'testDuration', 'combatRules','states','trainingMode','setBonuses','progression'), 'Invalid RPG profile fields')
    if type(profile.get('version')) is not int or profile['version'] != 1:
        raise ValueError('Unsupported RPG profile version')
    if (not integer(profile.get('level', 1), 1, 1000)
            or not integer(profile.get('seed', 0), 0, 4294967295)
            or not bounded(profile.get('testDuration', 1), 1, 3600)):
        raise ValueError('Invalid character level or test settings')
    resources = set(resources) - {'health'}
    talents = {talent['id']: talent for branch in document['branches'] for talent in branch['talents']}
    abilities = {ability['id']: ability for ability in document['abilities']}
    stats = profile.get('attributes', {})
    stat_map(stats, 0)
    if 'primaryBudget' in profile:
        budget = profile['primaryBudget']
        if not integer(budget, 0, 500_000_000):
            raise ValueError('Недопустимый бюджет характеристик')
        points = [stats.get(key, 0) for key in PRIMARY]
        if any(not integer(point, 0, 100_000_000) for point in points):
            raise ValueError('Распредели характеристики целыми очками')
        if sum(points) > budget:
            raise ValueError('Превышен бюджет базовых характеристик')
    formula_targets = SECONDARY + tuple('resource:' + key for key in resources)
    if 'progression' in profile:
        growth=profile['progression']
        record(growth,('baseLevel','healthPerLevel','attributesPerLevel','resourcePerLevel'),'Invalid level progression')
        if not integer(growth.get('baseLevel'),1,1000) or not bounded(growth.get('healthPerLevel',0),0,1e5):
            raise ValueError('Invalid progression level or health')
        record(growth.get('attributesPerLevel',{}),PRIMARY,'Invalid progression statistic')
        record(growth.get('resourcePerLevel',{}),set(resources)-{'health'},'Invalid progression resource')
        if any(not bounded(value,0,1e5) for values in (growth.get('attributesPerLevel',{}),growth.get('resourcePerLevel',{})) for value in values.values()):
            raise ValueError('Invalid progression amount')
    for formula in collection(profile.get('formulas', []), 64, False):
        record(formula, ('from', 'to', 'factor'), 'Invalid formula fields')
        if formula.get('from') not in PRIMARY or formula.get('to') not in formula_targets or not bounded(formula.get('factor'), -10000, 10000):
            raise ValueError('Invalid scaling formula')
    library = {}
    for item in collection(profile.get('items', []), 128):
        validate_item(item)
        library[item['id']] = item
    restrictions = profile.get('restrictions', {})
    record(restrictions, ('types', 'dualWield'), 'Invalid item restrictions')
    allowed = restrictions.get('types', [])
    haste = profile.get('hasteUses', [])
    if (not isinstance(allowed, list) or any(kind not in TYPES for kind in allowed) or len(allowed) != len(set(allowed))
            or type(restrictions.get('dualWield', False)) is not bool
            or not isinstance(haste, list) or any(kind not in ('swing', 'cast', 'channel', 'gcd', 'cooldown', 'rune', 'periodic') for kind in haste)
            or len(haste) != len(set(haste)) or profile.get('autoSlot', 'mainHand') not in ('mainHand', 'ranged')):
        raise ValueError('Invalid restrictions or attack settings')

    if profile.get('trainingMode','normal') not in ('normal','dps','hps','survival','rotation','resource','ability'):
        raise ValueError('Invalid training mode')
    if 'states' in profile:
        record(profile['states'], ('form','stance','aspect','seal','mode'), 'Invalid class state')
        if any(not text(value,1,60) for value in profile['states'].values()):
            raise ValueError('Invalid class state')
    combat_rules = profile.get('combatRules')
    if combat_rules is not None:
        record(combat_rules, ('version','classId','targetLevel','ratingScale','position'), 'Invalid combat rules')
        if (combat_rules.get('version') not in ('talentforge-v1','cataclysm-4.3.4')
                or combat_rules.get('classId') not in ('warrior','paladin','hunter','rogue','priest','shaman','mage','warlock','druid','deathknight')
                or 'targetLevel' in combat_rules and not integer(combat_rules['targetLevel'],1,1000)
                or 'ratingScale' in combat_rules and not bounded(combat_rules['ratingScale'],.000001,1000)
                or combat_rules.get('position','front') not in ('front','behind')):
            raise ValueError('Invalid combat rules')

    def validate_gear(mapping):
        record(mapping, SLOTS, 'Invalid equipment slots')
        for slot, item_id in mapping.items():
            item = library.get(item_id) if isinstance(item_id, str) else None
            if not item or item.get('disabled') or item['slot'] != slot:
                raise ValueError('Equipped item is missing, disabled or in the wrong slot')
            if item.get('requiredClass') and item['requiredClass'] != profile.get('combatRules', {}).get('classId'):
                raise ValueError('Item class requirement')
            if allowed and item['type'] not in allowed or item.get('requiredLevel', 1) > profile.get('level', 1):
                raise ValueError('Equipped item does not satisfy class restrictions')
            if slot == 'offHand':
                primary = mapping.get('mainHand')
                if not isinstance(primary, (str, type(None))) or library.get(primary, {}).get('type') in TWO_HANDED:
                    raise ValueError('A two-handed weapon occupies the off hand')
                if item['type'] != 'shield' and not restrictions.get('dualWield'):
                    raise ValueError('Dual wield is disabled')

    validate_gear(profile.get('equipped', {}))
    rules = profile.get('resources', {})
    record(rules, resources, 'Unknown class resource')
    for resource in rules.values():
        record(resource, ('regen', 'outOfCombatRegen', 'decay', 'onHit', 'onCrit','rune','recharge'), 'Invalid resource rule')
        if any((type(value) is not bool if key == 'rune' else not bounded(value, .25 if key == 'recharge' else 0, 120 if key == 'recharge' else 1e6))
               for key, value in resource.items()):
            raise ValueError('Invalid resource amount')

    sets = {}
    for bonus in collection(profile.get('setBonuses', []),32):
        record(bonus,('id','name','setId','pieces','stats'),'Invalid set bonus')
        if not identifier(bonus.get('setId')) or not text(bonus.get('name'),1,100) or not integer(bonus.get('pieces'),1,17):
            raise ValueError('Invalid set bonus')
        stat_map(bonus.get('stats', {}),-1e8)
        sets[bonus['id']] = bonus

    def validate_owner(owner):
        record(owner, ('kind', 'id', 'rank'), 'Invalid passive owner')
        owner_id, kind = owner.get('id'), owner.get('kind')
        if not isinstance(owner_id, str):
            raise ValueError('Invalid passive source reference')
        valid = ((kind == 'talent' and owner_id in talents)
                 or (kind == 'ability' and owner_id in abilities)
                 or (kind == 'passive' and abilities.get(owner_id, {}).get('kind') == 'passive')
                 or (kind == 'set' and owner_id in sets)
                 or (kind == 'item' and owner_id in library))
        if not valid or 'rank' in owner and (kind != 'talent' or not integer(owner['rank'], 1, talents[owner_id]['maxRank'])):
            raise ValueError('Invalid passive source reference')

    for bonus in collection(profile.get('bonuses', []), 64):
        record(bonus, ('id', 'owner', 'spell', 'stat', 'amount','state'), 'Invalid passive or talent bonus')
        validate_owner(bonus.get('owner'))
        if 'state' in bonus:validate_state_condition(bonus['state'])
        if (bonus.get('stat') not in ATTRIBUTES + MODIFIERS or not bounded(bonus.get('amount'), -100, 10000)
                or 'spell' in bonus and (not isinstance(bonus['spell'], str) or bonus['spell'] not in abilities
                                         or bonus['stat'] not in MODIFIERS)):
            raise ValueError('Invalid bonus statistic or ability')
    for proc in collection(profile.get('procs', []), 48):
        if 'state' in proc:validate_state_condition(proc['state'])
        record(proc, ('id', 'owner', 'name', 'event', 'chance', 'cooldown', 'every', 'condition',
                     'spell', 'effect', 'cost','chain','priority','charges','sourceAbilityId','school','attackType','consecutive','state'), 'Invalid proc fields')
        if ('consecutive' in proc and type(proc['consecutive']) is not bool
                or 'chain' in proc and type(proc['chain']) is not bool
                or 'priority' in proc and not integer(proc['priority'],0,1000)
                or 'charges' in proc and not integer(proc['charges'],1,1000)
                or 'sourceAbilityId' in proc and proc['sourceAbilityId'] not in abilities
                or 'school' in proc and proc['school'] not in SCHOOLS
                or 'attackType' in proc and proc['attackType'] not in ('auto','direct','periodic')):
            raise ValueError('Invalid proc limits')
        validate_owner(proc.get('owner'))
        spell = abilities.get(proc['spell']) if isinstance(proc.get('spell'), str) else None
        if (not text(proc.get('name'), 1, 100) or proc.get('event') not in PROC_EVENTS
                or not bounded(proc.get('chance'), 0, 1) or not bounded(proc.get('cooldown'), 0, 3600)
                or not integer(proc.get('every', 1), 1, 100) or not spell
                or not any(effect['id'] == proc.get('effect') for effect in spell.get('combatEffects', []))):
            raise ValueError('Invalid proc trigger or effect reference')
        if 'condition' in proc:
            condition = proc['condition']
            record(condition, ('type', 'value', 'resource'), 'Invalid proc condition')
            kind, value = condition.get('type'), condition.get('value')
            valid = (
                kind in ('playerBelow', 'dummyBelow') and bounded(value, 0, 100)
                or kind == 'critical' and value is True
                or kind in ('playerStatus', 'dummyStatus') and text(value, 1, 100)
                or kind == 'resourceAbove' and isinstance(condition.get('resource'), str)
                and condition['resource'] in resources and bounded(value, 0, 1e8)
                or kind == 'school' and value in SCHOOLS
                or kind == 'weapon' and value in TYPES
            )
            if not valid:
                raise ValueError('Invalid proc condition value')
        if 'cost' in proc:
            cost = proc['cost']
            record(cost, ('resourceId', 'amount', 'unit'), 'Invalid proc cost')
            if (not isinstance(cost.get('resourceId'), str) or cost['resourceId'] not in resources
                    or not bounded(cost.get('amount'), 0, 100 if cost.get('unit') == 'percent' else 1e8)
                    or cost.get('unit') not in ('points', 'count', 'percent')):
                raise ValueError('Invalid proc resource cost')
    for build in collection(profile.get('builds', []), 24):
        record(build, ('id', 'name', 'talents', 'equipped', 'primaryBranchId', 'combatSnapshot'), 'Invalid saved build')
        if not text(build.get('name'), 1, 100):
            raise ValueError('Invalid build name')
        if 'combatSnapshot' in build:
            saved = build['combatSnapshot']
            if (not isinstance(saved, dict) or saved.get('version') != 1 or not isinstance(saved.get('rpg'),dict)
                    or saved['rpg'].get('builds') != [] or saved.get('build',{}) != build.get('talents')
                    or saved['rpg'].get('equipped',{}) != build.get('equipped')):
                raise ValueError('Invalid detached build snapshot')
            continue
        if build.get('primaryBranchId', '') not in [''] + [branch['id'] for branch in document['branches']]:
            raise ValueError('Invalid saved specialization')
        validate_build(document, build.get('talents'), talents)
        validate_gear(build.get('equipped'))
    if 'incoming' in profile:
        hit = profile['incoming']
        record(hit, ('school', 'amount','canCrit','critChance','critMultiplier','interval'), 'Invalid incoming damage test')
        if 'interval' in hit and not bounded(hit['interval'],.25,120):
            raise ValueError('Invalid incoming interval')
        if ('canCrit' in hit and type(hit['canCrit']) is not bool
                or 'critChance' in hit and not bounded(hit['critChance'],0,1)
                or 'critMultiplier' in hit and not bounded(hit['critMultiplier'],1,10)):
            raise ValueError('Invalid incoming critical settings')
        if hit.get('school') not in SCHOOLS or not bounded(hit.get('amount'), 1, 1e8):
            raise ValueError('Invalid incoming damage test')


def validate_state_condition(state):
    record(state,('key','value'),'Invalid class state condition')
    if state.get('key') not in ('form','stance','aspect','seal','mode') or not text(state.get('value'),1,60):
        raise ValueError('Invalid class state condition')
