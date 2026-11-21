"""Backward-compatible validation of declarative combat control effects."""
CONTROL_TYPES = ('stun','root','slow','fear','silence','disarm','interrupt','knockback','immunity')
DISPEL_TYPES = ('magic','curse','poison','disease')
ADVANCED_TYPES = ('control','dispel','cooldown','state')


def aura_metadata(effect):
    if ('dispelType' in effect and effect['dispelType'] not in DISPEL_TYPES
            or 'removable' in effect and type(effect['removable']) is not bool
            or 'breakOnDamage' in effect and type(effect['breakOnDamage']) is not bool):
        raise ValueError('Проверь боевые эффекты')


def validate_advanced_effect(effect):
    def number(key, minimum, maximum):
        return type(effect.get(key)) in (int, float) and minimum <= effect[key] <= maximum
    kind = effect['type']
    if kind == 'state':
        fields = {'key','value'}
        valid = (effect.get('key') in ('form','stance','aspect','seal','mode')
                 and isinstance(effect.get('value'), str) and 1 <= len(effect['value']) <= 60)
    elif kind == 'control':
        fields = {'name','target','controlType','duration','drGroup','dispelType','removable','breakOnDamage','amount','school'}
        group = effect.get('drGroup', '')
        import re
        valid = (effect.get('controlType') in CONTROL_TYPES and effect.get('target') in ('player','dummy')
                 and isinstance(effect.get('name'), str) and 1 <= len(effect['name'].strip()) <= 100
                 and number('duration', .25, 300) and ('drGroup' not in effect or isinstance(group, str)
                     and re.fullmatch(r'[A-Za-z0-9_-]{1,60}', group))
                 and ('amount' not in effect or number('amount', 0, 100))
                 and ('school' not in effect or effect['school'] in ('physical','fire','frost','arcane','nature','shadow','holy')))
    elif kind == 'dispel':
        fields = {'target','dispelType','count'}
        valid = (effect.get('target') in ('player','dummy') and effect.get('dispelType') in DISPEL_TYPES
                 and type(effect.get('count')) is int and 1 <= effect['count'] <= 32)
    else:
        fields = {'abilityId','seconds','reset','charges'}
        valid = (isinstance(effect.get('abilityId'), str) and 1 <= len(effect['abilityId']) <= 200
                 and number('seconds',0,3600) and type(effect.get('reset')) is bool
                 and ('charges' not in effect or type(effect['charges']) is int and 0 <= effect['charges'] <= 10))
    if not valid or set(effect) - fields - {'id','type','trigger'}:
        raise ValueError('Проверь боевые эффекты')
    aura_metadata(effect)
