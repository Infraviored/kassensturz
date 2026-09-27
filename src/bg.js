// Background only saves files into Downloads/<folder>/ (content scripts can't use downloads API).
async function toUrl(m) {
  if (m.dataUrl) {
    if (typeof URL.createObjectURL !== 'function') return m.dataUrl; // Chrome service worker
    return URL.createObjectURL(await (await fetch(m.dataUrl)).blob()); // Firefox
  }
  return typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(new Blob([m.content], { type: m.type }))
    : 'data:' + m.type + ';charset=utf-8,' + encodeURIComponent(m.content);
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
