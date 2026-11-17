import {disposeObjects, groundLocalModel, loadLocalManifest, loadLocalModel} from './model-loader.js';
import {assetDiagnostics} from './local-arena.js';

export async function loadArenaAssets(signal, apply, report) {
  report('manifest', 'loading');
  const manifest = await loadLocalManifest(signal);
  if (!manifest) {
    report('manifest', 'fallback');
    return;
  }
  apply.manifest(manifest);
  report('manifest', 'ready');

  async function load(role, configuration, install, ground = false) {
    if (!configuration) return false;
    report(role, 'loading');
    let asset;
    try {
      asset = await loadLocalModel(configuration, signal, progress => typeof progress === 'number' ? report(role, 'loading', progress) : report(role, progress));
      signal.throwIfAborted();
      if (ground) {
        const raw = asset;
        asset = undefined; // groundLocalModel owns cleanup if alignment fails
        asset = groundLocalModel(raw, configuration);
      }
      const diagnostics = assetDiagnostics(asset, configuration);
      install(asset, configuration, diagnostics);
      asset = undefined;
      report(role, 'ready');
      return true;
    } catch (error) {
      if (asset) disposeObjects(asset.root);
      if (!signal.aborted) report(role, 'error', error.message);
      return false;
    }
  }

  await load('environment', manifest.environment, apply.environment);
  if (signal.aborted) return;
  const hero = await load('hero', manifest, apply.hero, true);
  if (signal.aborted) return;
  if (hero && manifest.weapons?.mainHand.enabled) await load('weapon', manifest.weapons.mainHand, apply.weapon);
  if (signal.aborted) return;
  const target = manifest.target;
  await load('target', target ? {...target, heightOffset: 0} : undefined, apply.target, true);
  if (!signal.aborted) report('scene', 'ready');
}
