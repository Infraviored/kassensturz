// Chrome only. A service worker has no URL.createObjectURL, and data: URLs are
// capped at 2 MB, which the summary files of a big export exceed. So the content
// goes to an offscreen document (offscreen.js) that returns a blob: URL.
let offscreenReady = null;
function ensureOffscreen() {
  offscreenReady = offscreenReady || (async () => {
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!existing.length) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Create blob: URLs for downloads' });
    }
  })().catch(e => { offscreenReady = null; throw e; });
  return offscreenReady;
}

async function blobUrlViaOffscreen(m) {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ t: 'blob', dataUrl: m.dataUrl, content: m.content, type: m.type });
  if (!r || !r.url) throw new Error('offscreen document: ' + (r && r.error || 'no URL returned'));
  return r.url;
}
