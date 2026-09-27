// Background only saves files into Downloads/<folder>/ (content scripts can't use downloads API).
//
// Firefox: the background page creates blob: URLs itself.
// Chrome: the service worker cannot, so src-chrome/offscreen-client.js provides
// blobUrlViaOffscreen(), loaded before this file by src-chrome/sw.js.
async function toUrl(m) {
  if (typeof URL.createObjectURL !== 'function') return blobUrlViaOffscreen(m);
  const blob = m.dataUrl ? await (await fetch(m.dataUrl)).blob() : new Blob([m.content], { type: m.type });
  return URL.createObjectURL(blob);
}

chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m.t === 'show') { chrome.downloads.show(m.id); return; }
  if (m.t !== 'save') return;
  toUrl(m)
    .then(url => chrome.downloads.download({ url, filename: m.folder + '/' + m.name, conflictAction: 'uniquify', saveAs: false }))
    .then(id => respond({ ok: true, id }), e => respond({ ok: false, err: String(e && e.message || e) }));
  return true;
});

// toolbar button: open the receipt list
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'https://www.lidl.de/mre/purchase-history?client_id=GermanyEcommerceClient&country_code=de&language=de-DE&page=1' });
});
