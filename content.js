(() => {
  const channel = 'pixel:reviewBridge';
  const id = () => location.pathname.match(/\/(?:game|analysis\/game)\/(?:live\/|daily\/)?(\d+)/)?.[1] || null;
  const themeNames = ['board-style-image', 'board-style-coordinate-color-light', 'board-style-coordinate-color-dark', 'board-style-highlight-color',
    ...['wp','wn','wb','wr','wq','wk','bp','bn','bb','br','bq','bk'].map(piece => 'piece-set-' + piece),
    ...['move-self','move-opponent','capture','move-self-check','move-opponent-check','castle','promote','game-end','game-draw'].map(sound => 'sound-set-mp3-' + sound)];
  function cleanUrl(value) {
    const url = value.match(/url\(["']?([^"')]+)/)?.[1];
    if (!url) return null;
    try { const parsed = new URL(url, location.href); return parsed.protocol === 'https:' && /(^|\.)(chess\.com|chesscomfiles\.com)$/.test(parsed.hostname) ? parsed.href : null; }
    catch { return null; }
  }
  function captureTheme() {
    const styles = getComputedStyle(document.documentElement), theme = {};
    for (const name of themeNames) {
      const raw = styles.getPropertyValue('--theme-' + name).trim();
      theme[name] = name.includes('color') ? (/^#[0-9a-f]{3,8}$/i.test(raw) ? raw : null) : cleanUrl(raw);
    }
    // Any other theme variables (Chess.com names its background ones --theme-background-*).
    for (const source of [styles, getComputedStyle(document.body)]) {
      for (let i = 0; i < source.length; i++) {
        const prop = source[i];
        if (!prop.startsWith('--theme-') || !/background/.test(prop)) continue;
        const raw = source.getPropertyValue(prop).trim(), key = prop.slice(8);
        if (/url\(/.test(raw)) theme[key.includes('image') ? key : key + '-image'] ??= cleanUrl(raw);
        else if (/^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$/i.test(raw)) theme[key.includes('color') ? key : key + '-color'] ??= raw;
      }
    }
    // Fall back to what the page actually paints behind everything.
    const body = getComputedStyle(document.body);
    const painted = cleanUrl(body.backgroundImage || '');
    theme['background-image'] = theme['background-image'] || theme['background-style-image'] || painted || null;
    const color = body.backgroundColor;
    if (!theme['background-color'] && /^rgba?\(/.test(color) && !/,\s*0\)$/.test(color)) theme['background-color'] = color;
    const boardImage = cleanUrl(getComputedStyle(document.querySelector('wc-chess-board') || document.body).backgroundImage || '');
    if (!theme['board-style-image'] && boardImage) theme['board-style-image'] = boardImage;
    if (theme['piece-set-wp']) chrome.storage.local.set({'pixel.review.theme': theme}).catch(() => {});
  }
  function rememberAccount(username) {
    if (typeof username !== 'string' || !/^[a-z0-9_-]{3,25}$/i.test(username)) return;
    chrome.storage.local.set({'pixel.review.account': {username, savedAt: Date.now()}}).catch(() => {});
  }
  function captureGame() {
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {window.removeEventListener('message', receive); resolve({id: id()});}, 2000);
      function receive(event) {
        if (event.source !== window || event.data?.channel !== channel || event.data?.type !== 'response' || event.data?.requestId !== requestId) return;
        clearTimeout(timer); window.removeEventListener('message', receive);
        rememberAccount(event.data.account);
        const players = {};
        for (const row of document.querySelectorAll('.player-component')) {
          const username = row.querySelector('[data-test-element="user-tagline-username"]')?.textContent?.trim();
          if (!username) continue;
          // Chess.com marks flags with either a two-letter or a numeric country class.
          const flagNode = row.querySelector('.cc-country-flag-component, .country-flags-component, [class*="country-flags"]');
          const flagClass = [...(flagNode?.classList || [])].map(name => name.match(/^country-(?:flags?-component-)?([a-z]{2}|\d{1,4})$/i)?.[1]).find(Boolean);
          const flair = row.querySelector('.flair-rpc-component')?.src;
          const avatar = row.querySelector('.cc-avatar-img')?.src;
          const color = row.querySelector('[player-color="1"]') ? 'white' : row.querySelector('[player-color="2"]') ? 'black' : null;
          if (color) players[color] = {username, countryCode:flagClass ? String(flagClass).toUpperCase() : null, flair:flair && cleanPlayerUrl(flair), avatar:avatar && cleanPlayerUrl(avatar)};
        }
        if (event.data.game && Object.keys(players).length) event.data.game.players = players;
        resolve({...event.data, id: id()});
      }
      window.addEventListener('message', receive);
      window.postMessage({channel, type: 'request', requestId}, '*');
    });
  }
  function cleanPlayerUrl(value) {
    try { const url = new URL(value, location.href); return url.protocol === 'https:' && /(^|\.)(chess\.com|chesscomfiles\.com)$/.test(url.hostname) ? url.href : null; }
    catch { return null; }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== 'pixel:capture') return;
    captureTheme(); captureGame().then(respond); return true;
  });
  let shownFor = null, checking = false, accountChecked = false;
  async function check() {
    if (checking) return; checking = true;
    try {
      captureTheme();
      const gameId = id(), existing = document.getElementById('pixel-review-offer');
      if (!gameId) {existing?.remove(); shownFor = null; if (!accountChecked) {accountChecked = true; captureGame().catch(() => {});} return;}
      const data = await captureGame();
      if (!data.ended || !data.game) {existing?.remove(); shownFor = null; return;}
      if (shownFor === gameId && existing) return;
      existing?.remove(); shownFor = gameId;
      const button = document.createElement('button');
      button.id = 'pixel-review-offer'; button.textContent = 'Review with pixel';
      Object.assign(button.style, {position:'fixed',right:'20px',bottom:'20px',zIndex:'2147483647',background:'#81b64c',color:'#fff',border:'0',borderRadius:'8px',padding:'11px 18px',font:'700 15px Arial,sans-serif',boxShadow:'0 4px 18px #0007',cursor:'pointer'});
      button.onclick = () => chrome.runtime.sendMessage({type:'pixel:openReview',id:gameId,game:data.game});
      document.body.append(button);
    } finally {checking = false;}
  }
  const debounced = (() => {let timer; return () => {clearTimeout(timer); timer=setTimeout(check, 900);};})();
  new MutationObserver(debounced).observe(document.documentElement, {childList:true,subtree:true});
  addEventListener('popstate', debounced); setInterval(check, 5000); check();
})();
