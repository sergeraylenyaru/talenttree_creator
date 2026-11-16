import {AnimationMixer, LoopOnce, LoopRepeat} from 'three';

export function resolveClip(clips, mapping, state) {
  const candidates = {
    idle: ['idle'], walk: ['walk', 'idle'], run: ['run', 'walk', 'idle'],
    jump: ['jump', 'idle'], fall: ['fall', 'jump', 'idle']
  }[state] ?? ['idle'];
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
    update(state, dt) {
      const clip = resolveClip(clips, mapping, state);
      if (clip !== currentClip) {
        current?.fadeOut(0.16);
        current = clip ? mixer.clipAction(clip) : null;
        currentClip = clip;
        if (current) {
          const airborne = (state === 'jump' || state === 'fall') && clip.name !== mapping.idle;
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
