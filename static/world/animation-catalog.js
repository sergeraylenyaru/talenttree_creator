let catalog;

export function localAnimationNames() {
  catalog ??= discover().catch(() => []);
  return catalog;
}

async function discover() {
  const manifest = await fetch('/local-world-assets/manifest.json');
  if (!manifest.ok) return [];
  const {model} = await manifest.json();
  if (typeof model !== 'string' || !model.startsWith('character/')) return [];
  const path = model.split('/').map(encodeURIComponent).join('/');
  const response = await fetch('/local-world-assets/' + path + '?animations=1');
  if (!response.ok) return [];
  const {animations} = await response.json();
  return animations;
}
