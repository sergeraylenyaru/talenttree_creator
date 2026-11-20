"""Custom class fixture; the browser tests load the separate real arena models."""
import json
from pathlib import Path


def document():
    doc = json.loads((Path(__file__).parent / 'fixtures' / 'training-grounds.json').read_text())
    fire, heal, _, passive = doc['abilities']
    doc["abilities"][2]["icon"] = "forge-frost"
    fire.update(name='Cinder Lance', icon='forge-ember', learningMode='talent', talentId='fire-talent', cooldown=0, range=18,
                resourceCosts=[{'resourceId': 'mana', 'amount': 10, 'unit': 'percent'}],
                presentation={'delivery': 'ranged', 'projectile': 'straight', 'projectileSpeed': 8, 'impact': 'fire'})
    damage = {**fire['combatEffects'][0], 'scalingStat': 'spellPower', 'coefficient': 1}
    fire['combatEffects'] = [
        damage, {**damage, 'id': 'burn', 'baseAmount': 10, 'coefficient': .5, 'duration': 4, 'interval': 1, 'snapshot': True},
        {'id': 'exposed', 'type': 'status', 'trigger': 'onHit', 'name': 'Exposed', 'icon': 'forge-ember',
         'target': 'dummy', 'stat': 'magicalTaken', 'amount': 25, 'duration': 6},
    ]
    heal.update(name='Aegis', icon='forge-light', cast=0, cooldown=0, resourceCosts=[],
                presentation={'targeting': 'self', 'delivery': 'ranged'})
    heal.pop('resource', None)
    heal.pop('resourceType', None)
    heal['combatEffects'] = [
        {'id': 'ward', 'type': 'shield', 'trigger': 'onCast', 'name': 'Aegis Ward', 'icon': 'forge-light',
         'amount': 80, 'coefficient': 1, 'priority': 20, 'fraction': 1, 'duration': 6},
        {'id': 'veil', 'type': 'shield', 'trigger': 'onCast', 'name': 'Aegis Veil', 'amount': 0,
         'coefficient': 0, 'priority': 1, 'fraction': .2, 'duration': 6},
        {'id': 'power', 'type': 'status', 'trigger': 'onCast', 'name': 'Kindled', 'icon': 'forge-ember',
         'target': 'player', 'stat': 'spellPower', 'amount': 50, 'duration': 6},
        {**heal['combatEffects'][0], 'duration': 4, 'interval': 1, 'baseAmount': 25, 'canCrit': False},
    ]
    passive.update(name='Kindling', icon='forge-nature', combatEffects=[
        {'id': 'insight', 'type': 'status', 'trigger': 'onCast', 'name': 'Insight',
         'target': 'player', 'stat': 'spellPower', 'amount': 10, 'duration': 5},
        {'id': 'spark', 'type': 'resource', 'trigger': 'onCast', 'resourceId': 'mana', 'unit': 'points', 'amount': 5},
    ])
    doc['rpg'] = {
        'version': 1, 'seed': 13, 'attributes': {'intellect': 20, 'stamina': 10, 'critChance': .25},
        'formulas': [{'from': 'intellect', 'to': 'spellPower', 'factor': 2},
                     {'from': 'stamina', 'to': 'maxHealth', 'factor': 10},
                     {'from': 'intellect', 'to': 'resource:mana', 'factor': 2}],
        'incoming': {'school': 'fire', 'amount': 200}, 'resources': {'mana': {'onHit': 2, 'onCrit': 3}},
        'procs': [{'id': 'kindling', 'owner': {'kind': 'passive', 'id': 'passive'}, 'name': 'Kindling Surge',
                   'event': 'damage', 'chance': 1, 'cooldown': 1, 'every': 1,
                   'condition': {'type': 'school', 'value': 'fire'}, 'spell': 'passive', 'effect': 'spark'}],
    }
    return doc
