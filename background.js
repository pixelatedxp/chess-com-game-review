const REVIEW_URL = chrome.runtime.getURL('review/index.html');
const pendingKey = 'pixel.review.pending';
const gameIdFromUrl = value => {
  try { return new URL(value).pathname.match(/\/(?:game|analysis\/game)\/(?:live\/|daily\/)?(\d+)/)?.[1] || null; }
  catch { return null; }
};
async function openReview({game, id, importOnly = false} = {}) {
  if (game && id && /^\d+$/.test(id)) {
    await chrome.storage.local.set({[pendingKey]: {id, game, savedAt: Date.now()}});
    await chrome.tabs.create({url: REVIEW_URL + '?game=' + encodeURIComponent(id)});
  } else await chrome.tabs.create({url: REVIEW_URL});
}
chrome.action.onClicked.addListener(async tab => {
  if (tab.url?.startsWith('https://www.chess.com/') && !/\/(?:analysis|game)\/game\//.test(tab.url)) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {type: 'pixel:capture'});
      if (response?.game?.pgn && response?.ended) return openReview({game: response.game, id: response.id});
    } catch {}
  }
  await openReview();
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'pixel:openReview') return;
  openReview(message).then(() => respond({ok: true}), error => respond({error: error.message}));
  return true;
});
