/* Local full-game review. Shared by the in-game summary and the review tab. */
(function (root) {
  'use strict';
  const VERSION = 2;
  const prefix = 'pixel.localReview.v1.';
  const key = id => prefix + String(id);
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  function clockTimeline(pgn, length, timeControl) {
    const initialSeconds = Number(String(timeControl || '').split('+')[0]);
    if (typeof pgn !== 'string' || !Number.isFinite(initialSeconds) || initialSeconds <= 0) return [];
    const stamps = [...pgn.matchAll(/\[%clk\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?\]/g)];
    if (stamps.length !== length) return [];
    const current = {white:initialSeconds, black:initialSeconds}, clocks = [{...current}];
    stamps.forEach((stamp, index) => {
      current[index % 2 ? 'black' : 'white'] = Number(stamp[1]) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]);
      clocks.push({...current});
    });
    return clocks;
  }

  function normalizeGame(Chess, input) {
    const board = new Chess();
    if (typeof input?.pgn === 'string' && input.pgn.trim()) {
      if (input.pgn.length > 500000) throw Error('This PGN is too large. Import one game at a time.');
      board.loadPgn(input.pgn);
    } else if (Array.isArray(input?.moves)) {
      if (input.moves.length > 1200) throw Error('This game is too long to review.');
      for (const move of input.moves) {
        if (typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw Error('Invalid game moves. Import the PGN instead.');
        board.move({from:move.slice(0,2), to:move.slice(2,4), promotion:move[4]});
      }
    } else throw Error('The game moves are not available on this page. Open local review and import its PGN.');
    const history = board.history({verbose:true});
    if (!history.length) throw Error('No moves found. Import a PGN containing the game.');
    if (history.length > 1200) throw Error('This game is too long to review.');
    if (history[0].before !== startFen) throw Error('Local review currently supports standard games from the starting position.');
    if (Number.isInteger(input.expectedPly) && history.length !== input.expectedPly) throw Error('Only part of this game is loaded. Import its complete PGN.');
    const headers = {...board.getHeaders(), ...input.headers};
    const clocks = clockTimeline(input.pgn, history.length, headers.TimeControl);
    return {headers, pgn:board.pgn(), moves:history.map(m=>m.from+m.to+(m.promotion||'')),
      san:history.map(m=>m.san), fens:[history[0].before,...history.map(m=>m.after)], clocks,
      players:input.players || {}};
  }

  // Build the stored analysis from a converted engine result (see analysis.js).
  // A board set up from a FEN (pasted directly or via a PGN [FEN] header), with or without moves.
  const fenPattern = /^\s*([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+\s+[wb]\s+(-|[KQkq]{1,4})\s+(-|[a-h][36])(\s+\d+\s+\d+)?\s*$/;
  function isPositionInput(text) {
    if (typeof text !== 'string') return false;
    if (fenPattern.test(text)) return true;
    const fen = text.match(/\[FEN\s+"([^"]+)"\]/i)?.[1];
    return !!fen && fen.trim() !== startFen;
  }
  function normalizePosition(Chess, text) {
    let board, headers = {};
    if (fenPattern.test(text)) {
      const parts = text.trim().split(/\s+/);
      if (parts.length === 4) parts.push('0', '1');
      board = new Chess(parts.join(' '));
      headers = {SetUp:'1', FEN:board.fen()};
    } else {
      board = new Chess();
      board.loadPgn(text);
      headers = {...board.getHeaders()};
    }
    const history = board.history({verbose:true});
    const start = history.length ? history[0].before : board.fen();
    if (history.length > 1200) throw Error('This line is too long to analyse.');
    for (const color of ['White','Black']) if (!headers[color] || headers[color] === '?') headers[color] = color;
    const parts = start.split(' '), plyOffset = (Number(parts[5]) - 1 || 0) * 2 + (parts[1] === 'b' ? 1 : 0);
    return {headers, pgn:board.pgn(), moves:history.map(m=>m.from+m.to+(m.promotion||'')), san:history.map(m=>m.san),
      fens:[start, ...history.map(m=>m.after)], clocks:[], players:{}, startFen:start, plyOffset, position:true};
  }

  function makeAnalysis(game, converted, view) {
    const result = converted;
    if (!Array.isArray(result?.moveAnalyses) || result.moveAnalyses.length !== game.moves.length ||
        result.moveAnalyses.some((m,i)=>m.moveLan !== game.moves[i])) {
      throw Error('The engine returned an incomplete review. Please try again.');
    }
    return {CAPS:result.caps, reportCard:result.reportCard, annotatedPgn:game.pgn,
      positions:result.moveAnalyses.map((m,i)=>({color:i%2?'black':'white', classificationName:m.classification==='great'?'greatFind':m.classification,
        playedMove:{moveLan:m.moveLan, eval:{cp:m.evaluation*100}, mateIn:m.mateIn}})),
      moveAnalyses:result.moveAnalyses, rich:result.rich, views:{[view]:result.view}, tallies:result.tallies};
  }

  function create({Chess, createEngine, storage, getGame, Analysis = root.PixelAnalysis}) {
    let active = null;
    async function read(id) {
      if (!validId(String(id))) return null;
      const data = (await storage.get(key(id)))[key(id)];
      // Version 1 reviews are still shown; their explanations are rebuilt on demand.
      return (data?.version === VERSION || data?.version === 1) && data.game && data.analysis ? data : null;
    }
    async function save(record) {
      // Keep a bounded cache; never remove other extension settings.
      const all = await storage.get(null);
      const records = Object.entries(all).filter(([k])=>k.startsWith(prefix) && k!==key(record.id))
        .sort((a,b)=>(b[1]?.savedAt||0)-(a[1]?.savedAt||0));
      let bytes = JSON.stringify(record).length * 2;
      const remove = [];
      records.forEach(([k,v],i)=>{bytes+=JSON.stringify(v).length*2;if(i>=9||bytes>4500000) remove.push(k);});
      if(remove.length) await storage.remove(remove);
      await storage.set({[key(record.id)]:record});
    }
    function cancel() {
      const job = active;
      if (!job) return;
      active = null;
      job.cancelled = true;
      job.engine?.destroy();
      job.reject(Object.assign(Error('Review cancelled'), {name:'AbortError'}));
    }
    async function withJob(work) {
      cancel();
      let reject;
      const aborted = new Promise((_,r)=>{reject=r;});
      const job = {cancelled:false, engine:null, reject}; active=job;
      const assertActive = ()=>{if(job.cancelled) throw Object.assign(Error('Review cancelled'), {name:'AbortError'});};
      let timer;
      try {
        return await Promise.race([aborted, new Promise((_,r)=>{timer=setTimeout(()=>{
          job.cancelled=true; job.engine?.destroy(); r(Error('Local review timed out. Try again or import a shorter game.'));
        },300000);}), work(job, assertActive)]);
      } finally {clearTimeout(timer);job.engine?.destroy();if(active===job) active=null;}
    }
    async function startEngine(job, game, view, assertActive) {
      const engine = job.engine = createEngine(); await engine.init(); assertActive();
      const white = Number(game.headers.WhiteElo), black = Number(game.headers.BlackElo);
      if (white>0 && black>0) await engine.setRatings(white,black);
      await Analysis.configure(engine, view); assertActive();
      return engine;
    }
    async function review(id, {input, view='neutral', onProgress=()=>{}, singlePass=false}={}) {
      id = String(id);
      if (!validId(id)) throw Error('Invalid game identifier.');
      return withJob(async (job, assertActive) => {
        onProgress(0);
        const game = normalizeGame(Chess, input || await getGame(id)); assertActive(); onProgress(5);
        const engine = await startEngine(job, game, view, assertActive); onProgress(10);
        let raw;
        // Growing portions keep the progress bar honest; the engine caches earlier positions.
        const batchSize = singlePass ? game.moves.length : Math.max(4, Math.ceil(game.moves.length / 4));
        for (let end = Math.min(batchSize, game.moves.length); ; end = Math.min(end + batchSize, game.moves.length)) {
          raw = await Analysis.fetchRaw(engine, game.moves.slice(0,end)); assertActive();
          if (!Array.isArray(raw?.positions) || raw.positions.length < end + 1) throw Error('The engine returned an incomplete review. Please try again.');
          if (end === game.moves.length) break;
          onProgress(10 + Math.floor(85 * end / game.moves.length));
        }
        onProgress(95);
        const analysis = makeAnalysis(game, Analysis.convert(raw, game.moves, view), view); assertActive();
        const record = {version:VERSION, id, savedAt:Date.now(), game, analysis};
        try {await save(record);} catch {record.cacheWarning='Review finished, but could not be saved. Download the PGN before closing.';}
        assertActive(); onProgress(100); return record;
      });
    }
    // Re-phrase an existing review for another perspective (or upgrade an old review).
    async function addView(record, view, {onProgress=()=>{}}={}) {
      return withJob(async (job, assertActive) => {
        onProgress(5);
        const engine = await startEngine(job, record.game, view, assertActive); onProgress(15);
        const raw = await Analysis.fetchRaw(engine, record.game.moves); assertActive(); onProgress(90);
        const converted = Analysis.convert(raw, record.game.moves, view);
        const analysis = record.analysis;
        analysis.views = {...(analysis.views||{}), [view]:converted.view};
        if (!Array.isArray(analysis.rich)) analysis.rich = converted.rich;
        if (record.version !== VERSION) {
          analysis.moveAnalyses = converted.moveAnalyses; analysis.CAPS = converted.caps; analysis.reportCard = converted.reportCard; analysis.tallies = converted.tallies;
          record.version = VERSION;
        }
        try {await save(record);} catch {}
        onProgress(100); return record;
      });
    }
    return {read,review,addView,cancel,save};
  }

  function requestGame(id, target=window) {
    return new Promise((resolve,reject)=>{
      const requestId = crypto.randomUUID();
      const cleanup=()=>{clearTimeout(timer);target.removeEventListener('message',receive);};
      const receive=event=>{
        if(event.source!==target || event.data?.type!=='pixel:localReviewGame' || event.data.requestId!==requestId) return;
        cleanup();event.data.error?reject(Error(event.data.error)):resolve(event.data.game);
      };
      const timer=setTimeout(()=>{cleanup();reject(Error('The board did not provide its moves. Open local review and import the PGN.'));},5000);
      target.addEventListener('message',receive);
      target.postMessage({type:'pixel:localReviewRequest',requestId,gameId:String(id)},'*');
    });
  }
  root.PixelLocalReview = {create, normalizeGame, normalizePosition, isPositionInput, makeAnalysis, requestGame, key, validId, clockTimeline};
  if(typeof module==='object') module.exports=root.PixelLocalReview;
})(globalThis);
