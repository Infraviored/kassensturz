// Chrome only: turns file content into a blob: URL for the service worker,
// which cannot create one itself (see bg.js).
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m.t !== 'blob') return;
  (async () => {
    const blob = m.dataUrl ? await (await fetch(m.dataUrl)).blob() : new Blob([m.content], { type: m.type });
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000); // download has long started by then
    respond({ url });
  })().catch(e => respond({ error: String(e && e.message || e) }));
  return true;
});
