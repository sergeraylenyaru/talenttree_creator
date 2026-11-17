import {AnimationMixer, LoopOnce, LoopRepeat} from 'three';

export function resolveClip(clips, mapping, state) {
  const combat = ['meleeAttack', 'rangedAttack', 'spellCast', 'hitReaction', 'hit', 'criticalHit'];
  const candidates = {
    idle: ['idle'], walk: ['walk', 'idle'], run: ['run', 'walk', 'idle'],
    walkBack: ['walkBack'], runBack: ['runBack', 'walkBack'], strafeLeft: ['strafeLeft'], strafeRight: ['strafeRight'],
    jump: ['jump', 'idle'], fall: ['fall', 'jump', 'idle']
  }[state] ?? (combat.includes(state) ? [state] : ['idle']);
  for (const key of candidates) {
    const clip = clips.find(clip => clip.name === mapping[key]);
    if (clip) return clip;
  }
  return null;
}

export function animateCharacter({root, clips, mapping}) {
  const mixer = new AnimationMixer(root);
  let current;
  let currentClip;
  return {
    get activeDuration() { return currentClip?.duration ?? 0; },
    get activeClip() { return currentClip?.name ?? null; },
    supports(state) { return Boolean(resolveClip(clips, mapping, state)); },
    update(state, dt, restart = false) {
      const clip = resolveClip(clips, mapping, state);
      if (clip !== currentClip || restart) {
        current?.fadeOut(0.16);
        current = clip ? mixer.clipAction(clip) : null;
        currentClip = clip;
        if (current) {
          const airborne = !['idle', 'walk', 'run', 'walkBack', 'runBack', 'strafeLeft', 'strafeRight'].includes(state) && clip.name !== mapping.idle;
          current.setLoop(airborne ? LoopOnce : LoopRepeat, airborne ? 1 : Infinity);
          current.clampWhenFinished = airborne;
          current.reset().fadeIn(0.16).play();
        }
      }
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    }
  };
}
