// One retained arena per dialog; replacement always requires an explicit choice.
const sessions=new WeakMap();
export function heldTrainingSession(dialog){return sessions.get(dialog);}
export function registerTrainingSession(dialog,session){sessions.set(dialog,session);}
export function forgetTrainingSession(dialog,session){if(sessions.get(dialog)===session)sessions.delete(dialog);}
export function disposeTrainingSession(dialog){sessions.get(dialog)?.dispose();}
export function rekeyTrainingSession(dialog,from,to){const current=sessions.get(dialog);if(current?.key===from)current.key=to;}
export function trainingSessionSnapshot(dialog){return sessions.get(dialog)?.inspect();}
