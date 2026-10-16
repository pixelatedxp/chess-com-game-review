(() => {
  const channel = 'pixel:reviewBridge';
  // The signed-in Chess.com account, so reviews of your own games can address you.
  function signedInUser() {
    try {
      for (const value of [window.context?.user?.username, window.chesscom?.context?.user?.username, window.chesscom?.user?.username]) {
        if (typeof value === 'string' && /^[a-z0-9_-]{3,25}$/i.test(value)) return value;
      }
    } catch {}
    return null;
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.channel !== channel || event.data?.type !== 'request') return;
    const reply = result => window.postMessage({channel, type: 'response', requestId: event.data.requestId, account: signedInUser(), ...result}, '*');
    try {
      const game = document.querySelector('wc-chess-board')?.game;
      if (!game) return reply({error: 'The Chess.com board is not ready.'});
      const pgn = typeof game.getPGN === 'function' ? game.getPGN() : game.pgn;
      const result = typeof game.getResult === 'function' ? game.getResult() : game.result;
      let moves;
      if (!pgn) {
        for (const method of ['getRawLines', 'getCurrentFullLine', 'getLine']) {
          if (typeof game[method] !== 'function') continue;
          const value = game[method]();
          const candidate = Array.isArray(value?.[0]) ? value[0] : value;
          if (Array.isArray(candidate) && candidate.length > (moves?.length || 0)) moves = candidate;
        }
      }
      const ucis = moves?.map(move => move.from + move.to + (move.promotion || ''));
      reply({game: pgn ? {pgn} : ucis?.length ? {moves: ucis, headers: {Result: result || '*'}} : null,
        ended: !!(game.gameOver || (result && result !== '*')), result: result || '*'});
    } catch (error) { reply({error: error.message}); }
  });
})();
