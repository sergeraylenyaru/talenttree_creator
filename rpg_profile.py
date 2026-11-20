"""Validation for the additive RPG character profile in class documents."""

import re

SCHOOLS = ('physical', 'fire', 'frost', 'arcane', 'nature', 'shadow', 'holy')
PRIMARY = ('strength', 'agility', 'intellect', 'stamina', 'spirit')
SECONDARY = (
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
MODIFIERS = ('damage', 'healing', 'cooldown', 'resourceGain', 'duration', 'period', 'procChance')
PROC_EVENTS = (
    'castStarted', 'castCompleted', 'attackHit', 'projectileHit', 'attackMissed', 'projectileMissed',
    'damage', 'healing', 'critical', 'periodicDamage', 'periodicHealing', 'statusApplied', 'statusExpired',
    'absorbed', 'resourceGained', 'resourceSpent', 'autoHit', 'cooldownCompleted'
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
                  'minDamage', 'maxDamage', 'speed', 'stats', 'requiredLevel', 'disabled'), 'Invalid item fields')
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
    stat_map(item.get('stats', {}), -1e8)
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
            req = talent.get('requires')
            prior = sum(build.get(other['id'], 0) for other in branch['talents'] if other['row'] < talent['row'])
            if prior < talent['row'] * document['rowCost'] or req and build.get(req) != talents[req]['maxRank']:
                raise ValueError('Saved build violates talent dependencies')


def validate_rpg(document, resources):
    if 'rpg' not in document:
        return
    profile = document['rpg']
    record(profile, ('version', 'level', 'attributes', 'formulas', 'items', 'equipped', 'restrictions',
                     'hasteUses', 'autoSlot', 'resources', 'bonuses', 'procs', 'builds', 'incoming', 'seed',
                     'testDuration'), 'Invalid RPG profile fields')
    if type(profile.get('version')) is not int or profile['version'] != 1:
        raise ValueError('Unsupported RPG profile version')
    if (not integer(profile.get('level', 1), 1, 1000)
            or not integer(profile.get('seed', 0), 0, 4294967295)
            or not bounded(profile.get('testDuration', 1), 1, 3600)):
        raise ValueError('Invalid character level or test settings')
    resources = set(resources) - {'health'}
    talents = {talent['id']: talent for branch in document['branches'] for talent in branch['talents']}
    abilities = {ability['id']: ability for ability in document['abilities']}
    stat_map(profile.get('attributes', {}), 0)
    formula_targets = SECONDARY + tuple('resource:' + key for key in resources)
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
            or not isinstance(haste, list) or any(kind not in ('swing', 'cast', 'channel', 'gcd', 'cooldown') for kind in haste)
            or len(haste) != len(set(haste)) or profile.get('autoSlot', 'mainHand') not in ('mainHand', 'ranged')):
        raise ValueError('Invalid restrictions or attack settings')

    def validate_gear(mapping):
        record(mapping, SLOTS, 'Invalid equipment slots')
        for slot, item_id in mapping.items():
            item = library.get(item_id) if isinstance(item_id, str) else None
            if not item or item.get('disabled') or item['slot'] != slot:
                raise ValueError('Equipped item is missing, disabled or in the wrong slot')
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
        record(resource, ('regen', 'decay', 'onHit', 'onCrit'), 'Invalid resource rule')
        if any(not bounded(value, 0, 1e6) for value in resource.values()):
            raise ValueError('Invalid resource amount')

    def validate_owner(owner):
        record(owner, ('kind', 'id', 'rank'), 'Invalid passive owner')
        owner_id, kind = owner.get('id'), owner.get('kind')
        if not isinstance(owner_id, str):
            raise ValueError('Invalid passive source reference')
        valid = ((kind == 'talent' and owner_id in talents)
                 or (kind == 'passive' and abilities.get(owner_id, {}).get('kind') == 'passive')
                 or (kind == 'item' and owner_id in library))
        if not valid or 'rank' in owner and (kind != 'talent' or not integer(owner['rank'], 1, talents[owner_id]['maxRank'])):
            raise ValueError('Invalid passive source reference')

    for bonus in collection(profile.get('bonuses', []), 64):
        record(bonus, ('id', 'owner', 'spell', 'stat', 'amount'), 'Invalid passive or talent bonus')
        validate_owner(bonus.get('owner'))
        if (bonus.get('stat') not in ATTRIBUTES + MODIFIERS or not bounded(bonus.get('amount'), -100, 10000)
                or 'spell' in bonus and (not isinstance(bonus['spell'], str) or bonus['spell'] not in abilities
                                         or bonus['stat'] not in MODIFIERS)):
            raise ValueError('Invalid bonus statistic or ability')
    for proc in collection(profile.get('procs', []), 48):
        record(proc, ('id', 'owner', 'name', 'event', 'chance', 'cooldown', 'every', 'condition',
                     'spell', 'effect', 'cost'), 'Invalid proc fields')
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
        record(build, ('id', 'name', 'talents', 'equipped', 'primaryBranchId'), 'Invalid saved build')
        if not text(build.get('name'), 1, 100):
            raise ValueError('Invalid build name')
        if build.get('primaryBranchId', '') not in [''] + [branch['id'] for branch in document['branches']]:
            raise ValueError('Invalid saved specialization')
        validate_build(document, build.get('talents'), talents)
        validate_gear(build.get('equipped'))
    if 'incoming' in profile:
        hit = profile['incoming']
        record(hit, ('school', 'amount'), 'Invalid incoming damage test')
        if hit.get('school') not in SCHOOLS or not bounded(hit.get('amount'), 1, 1e8):
            raise ValueError('Invalid incoming damage test')
