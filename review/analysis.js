/* Talks to the local explanation engine directly so the review keeps the parts of its
   output that the bundled runtime discards: follow-up lines, the explanation for the
   best alternative, theme tags and perspective-aware speech. */
(function(root){
  'use strict';
  const VIEWS=['neutral','white','black'];
  const CLASS={best:'best',brilliant:'brilliant',greatFind:'great',great:'great',excellent:'excellent',good:'good',book:'book',forced:'forced',inaccuracy:'inaccuracy',mistake:'mistake',miss:'miss',blunder:'blunder'};
  const isUci=value=>typeof value==='string'&&/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value);
  const cap=text=>text?text[0].toUpperCase()+text.slice(1):text;
  const colorName=c=>c==='w'||c==='white'?'White':'Black';
  const otherColor=c=>c==='w'||c==='white'?'black':'white';
  const asColor=c=>c==='w'||c==='white'?'white':'black';

  /* ---------- engine protocol ---------- */
  async function configure(engine,view){
    if(!VIEWS.includes(view))view='neutral';
    await engine.enqueue(async()=>{
      engine.send('setoption name UserColor value '+(view==='neutral'?'NotSpecified':view));
      engine.send('setoption name PersonalSpeechForOpponentMoves value '+(view!=='neutral'));
      await engine.cmd('isready','readyok',10000);
    });
  }
  function fetchRaw(engine,moves,timeout){
    const limit=timeout||Math.min(300000,Math.max(20000,2500*moves.length));
    return engine.enqueue(async()=>{
      engine.send('position startpos'+(moves.length?' moves '+moves.join(' '):''));
      const line=await engine.waitForLinePrefix('json',()=>engine.send('fetch analysis'),limit);
      try{return JSON.parse(line.slice(5));}catch(error){throw Error('The engine returned unreadable analysis: '+error.message);}
    });
  }

  /* ---------- perspective ---------- */
  // The engine's neutral mode is already third person; this only names "the opponent"
  // and catches any stray second-person phrase so a spectator is never called "you".
  function neutralize(text,mover){
    if(typeof text!=='string'||!text)return text||'';
    const M=colorName(mover),O=colorName(otherColor(mover));
    return text
      .replace(/\b(?:the|their|your) opponent[’']s\b/gi,O+'’s').replace(/\b(?:the|their|your) opponent\b/gi,O)
      .replace(/(^|[.!?]\s+)They\b/g,'$1'+M).replace(/(^|[.!?]\s+)Their\b/g,'$1'+M+'’s')
      .replace(/\b[Yy]ou(?:’|')re\b/g,M+' is').replace(/\b[Yy]ou(?:’|')ve\b/g,M+' has').replace(/\b[Yy]ou(?:’|')ll\b/g,M+' will')
      .replace(/\b[Yy]our\b/g,M+'’s').replace(/\b[Yy]ourself\b/g,M).replace(/\b[Yy]ou\b/g,M);
  }
  // In a personal review the engine sometimes says "the opponent"; make it unambiguous.
  function personalize(text,mine){
    if(mine)return text.replace(/\b([Tt])he opponent([’']s)?\b/g,(m,t,s)=>(t==='T'?'Your':'your')+' opponent'+(s||''));
    return text.replace(/\b([Tt])he opponent[’']s\b/g,(m,t)=>t==='T'?'Your':'your')
      .replace(/\b([Tt])he opponent (has|is|was|does)\b/g,(m,t,v)=>(t==='T'?'You':'you')+' '+({has:'have',is:'are',was:'were',does:'do'}[v]))
      .replace(/\b([Tt])he opponent\b/g,(m,t)=>t==='T'?'You':'you');
  }
  function speechParts(entry,view,mover){
    const parts=[];
    for(const item of Array.isArray(entry?.speech)?entry.speech:[]){
      let text=Array.isArray(item?.sentence)?item.sentence.join(''):'';
      text=text.replace(/\s+/g,' ').trim();if(!text)continue;
      if(view==='neutral')text=neutralize(text,mover);else text=personalize(text,asColor(mover)===view);
      parts.push({text,arrows:(item.arrows||[]).filter(isUci),squares:(item.squares||[]).filter(s=>/^[a-h][1-8]$/.test(s))});
    }
    return parts;
  }
  const curated=(entry,move)=>(entry?.variationThemes||[]).some(t=>Array.isArray(t?.moves)&&t.moves[0]===move);
  function line(entry,move){
    const theme=(entry?.variationThemes||[]).find(t=>Array.isArray(t?.moves)&&t.moves[0]===move);
    // Curated follow-ups are trustworthy end to end; a raw principal variation is only
    // used for its first few plies so long engine lines cannot suggest false gains.
    let moves=theme?.moves||(entry?.eval?.pv||[]).slice(0,5);
    if(moves[0]!==move)moves=[move,...moves];
    return moves.filter(isUci).slice(0,16);
  }
  const cpOf=(entry,fallback)=>typeof entry?.eval?.cp==='number'?entry.eval.cp/100:typeof entry?.score==='number'?entry.score:fallback;

  /* Convert one raw engine result. `view` decides how speech is phrased. */
  function convert(raw,moves,view){
    const positions=Array.isArray(raw?.positions)?raw.positions:[];
    if(positions.length<moves.length+1)throw Error('The engine returned an incomplete review. Please try again.');
    const base=[],rich=[],speech=[];
    moves.forEach((uci,index)=>{
      const position=positions[index+1]||{},played=position.playedMove||{},mover=index%2?'black':'white';
      if(played.moveLan&&played.moveLan!==uci)throw Error('The engine reviewed a different move order. Please try again.');
      const parts=speechParts(played,view,mover),suggested=position.suggestedMove;
      const evaluation=cpOf(played,0),mateIn=typeof played.mateIn==='number'?played.mateIn:null;
      base.push({moveLan:uci,classification:CLASS[position.classificationName]||'good',evaluation,mateIn,
        arrows:parts[0]?.arrows||[],squares:parts[0]?.squares||[],speech:parts.map(p=>p.text).join(' ')||null});
      const best=suggested&&isUci(suggested.moveLan)&&suggested.moveLan!==uci?{moveLan:suggested.moveLan,evaluation:cpOf(suggested,evaluation),
        mateIn:typeof suggested.mateIn==='number'?suggested.mateIn:null,line:line(suggested,suggested.moveLan),curated:curated(suggested,suggested.moveLan),tags:suggested.insightsTags||[]}:null;
      rich.push({line:line(played,uci),curated:curated(played,uci),tags:played.insightsTags||[],themes:position.analysisTypes?.played||null,
        bestThemes:position.analysisTypes?.best||null,key:!!position.scenarios?.isKeyMoment,critical:!!played.isPositionCritical,best,difference:position.difference??null});
      speech.push({parts,best:best?speechParts(suggested,view,mover):[]});
    });
    const summary=[raw.gameSummary,raw.reportCard?.speech].filter(t=>typeof t==='string'&&t.trim()).map(t=>view==='neutral'?neutralize(t,'white'):t);
    return {moveAnalyses:base,rich,view:{moves:speech,summary,opening:raw.book?.name||null},
      caps:raw.CAPS||{},reportCard:raw.reportCard||{},tallies:raw.tallies||{}};
  }

  /* ---------- wording helpers ---------- */
  function words(view){
    const own=view==='white'||view==='black';
    const subject=color=>{color=asColor(color);return own?(color===view?'you':'your opponent'):colorName(color);};
    const possessive=color=>{color=asColor(color);return own?(color===view?'your':'your opponent’s'):colorName(color)+'’s';};
    return {own,subject,possessive,Subject:c=>cap(subject(c)),Possessive:c=>cap(possessive(c))};
  }
  function formatEval(value,mate,view){
    if(Number.isFinite(mate)&&mate!==null)return mate===0?'checkmate':`mate in ${Math.abs(mate)} for ${words(view).subject(mate>0?'white':'black')}`;
    if(!Number.isFinite(value))return 'roughly equal';
    const side=value>=0?'white':'black',size=Math.abs(value);
    if(size<0.3)return 'about equal';
    return `${size.toFixed(1)} pawns in ${words(view).possessive(side)} favour`;
  }
  // Score from the mover's point of view (bigger is better for the mover).
  function forMover(value,mate,mover){
    const sign=asColor(mover)==='white'?1:-1;
    if(Number.isFinite(mate)&&mate!==null&&mate!==0)return sign*(mate>0?1000-mate:-1000-mate);
    return sign*(Number(value)||0);
  }

  /* ---------- explanations ---------- */
  const lower=text=>text?text[0].toLowerCase()+text.slice(1):text;
  function strongFacts(facts,min=4,limit=2){return facts.filter(f=>f.strength>=min).slice(0,limit);}
  function sanOf(Chess,fen,uci){try{const c=new Chess(fen);return c.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'})?.san||uci;}catch{return uci;}}
  function consequence(Chess,T,fen,played,mover){
    const ref=T.refutation(Chess,fen,played.uci,played.line);if(!ref)return null;
    const moverCode=asColor(mover)==='white'?'w':'b';
    if(ref.outcome?.mate&&ref.outcome.matedColor===moverCode)return {kind:'mate',reply:ref,line:T.numbered(ref.fen,ref.outcome.sans)};
    const fact=strongFacts(ref.facts.filter(f=>['fork','pin','discovered','free-capture','winning-capture','threat','mate','forced-mate'].includes(f.kind)),5,1)[0];
    if(ref.gain&&ref.gain.value>=2&&(played.curated!==false||fact))return {kind:'material',reply:ref,gain:ref.gain,fact,line:T.numbered(ref.fen,ref.outcome.sans,6)};
    if(fact)return {kind:'tactic',reply:ref,fact};
    return null;
  }
  const HOW={fork:' with a fork',pin:' using a pin',discovered:' with a discovered attack'};
  function harmText(harm,played,mover,view,lead){
    const w=words(view),opp=w.subject(otherColor(mover)),r=harm.reply;
    if(harm.kind==='mate')return `${lead} ${played.san} allowed a forced checkmate: ${harm.line}.`;
    if(harm.kind==='material'){
      const tail=r.outcome?.sans?.length>1?`: ${harm.line}`:'';
      return `${lead} ${played.san} let ${opp} answer ${r.san} and win ${harm.gain.text}${HOW[harm.fact?.kind]||''}${tail}.`;
    }
    return `${lead} ${played.san} let ${opp} answer ${r.san}. ${harm.fact.text.replace(/^This /,'That move ').replace(/^It /,'That move ')}`;
  }
  // Skip board facts the engine's own sentence already says.
  const COVERED={'free-capture':/free|hanging|undefended|unprotected|no defend|unguarded|recaptur/i,'winning-capture':/win|captur/i,fork:/fork|double attack/i,pin:/\bpin/i,
    mate:/checkmate|mate\b/i,'forced-mate':/checkmate|mate/i,discovered:/discover/i,defends:/defend|protect|safer|danger|guard|block/i,castle:/castl/i,
    develops:/develop|into (?:the )?(?:game|play|action)|joins/i,promotion:/promot|queen/i,'stops-mate':/mate/i,threat:/attack|threat/i};
  const covered=(fact,ideas)=>COVERED[fact.kind]&&ideas.some(i=>COVERED[fact.kind].test(i.text));
  /* Why the engine's best move beats the move that was played. */
  function explainBest({Chess,Tactics:T,fen,mover,view,played,best,bestSpeech=[]}){
    const w=words(view),ideas=[];
    for(const part of bestSpeech)ideas.push({text:part.text,arrows:part.arrows.length?part.arrows:[best.uci],squares:part.squares,source:'speech'});
    const facts=T.motifs(Chess,fen,best.uci,{line:best.line,curated:best.curated!==false});
    for(const fact of strongFacts(facts,4,2))if(!covered(fact,ideas))ideas.push({text:fact.text,arrows:fact.arrows?.length?fact.arrows:[best.uci],squares:fact.squares||[]});
    if(!ideas.length){const soft=facts.find(f=>f.strength>=1&&!covered(f,ideas));if(soft)ideas.push({text:soft.text,arrows:soft.arrows?.length?soft.arrows:[best.uci],squares:[]});}
    if(played?.uci&&played.uci!==best.uci){
      const harm=consequence(Chess,T,fen,played,mover);
      if(harm)ideas.push({text:harmText(harm,played,mover,view,'In the game,'),arrows:[harm.reply.uci,...(harm.fact?.arrows||[]).slice(0,1)],squares:[]});
      const gap=forMover(best.evaluation,best.mateIn,mover)-forMover(played.evaluation,played.mateIn,mover);
      if(!harm&&gap>=0.3)ideas.push({text:`${best.san} keeps the position at ${formatEval(best.evaluation,best.mateIn,view)}, compared with ${formatEval(played.evaluation,played.mateIn,view)} after ${played.san}.`,arrows:[best.uci],squares:[]});
    }
    if(!ideas.length){
      const outcome=T.lineOutcome(Chess,fen,best.line,asColor(mover)==='white'?'w':'b');
      ideas.push({text:`There is no single tactic here; ${best.san} is simply the most accurate way to keep ${w.possessive(mover)} position healthy. The engine’s main line continues ${T.numbered(fen,outcome?.sans||[best.san])}.`,arrows:[best.uci],squares:[]});
    }
    return ideas;
  }
  /* Coaching ideas for any reviewed move (game move or explored move). */
  function explainMove({Chess,Tactics:T,fen,mover,view,move,classification,speech=[],best=null,bestSpeech=[],opening=null}){
    const w=words(view),ideas=[];
    for(const part of speech)ideas.push({text:part.text,arrows:part.arrows.length?part.arrows:[move.uci],squares:part.squares,source:'speech'});
    const bad=['inaccuracy','mistake','miss','blunder'].includes(classification);
    if(classification==='book'){if(!ideas.length)ideas.push({text:`${move.san} is a well-known opening move${opening?` in the ${opening}`:''}.`,arrows:[move.uci],squares:[]});return ideas;}
    if(classification==='brilliant'&&!ideas.some(i=>/sacrific/i.test(i.text))){
      const ref=T.refutation(Chess,fen,move.uci,move.line);
      if(ref?.gain)ideas.push({text:`This is a sacrifice: ${w.subject(otherColor(mover))} can take with ${ref.san} and win ${ref.gain.text}, but ${w.subject(mover)} ${w.own&&asColor(mover)===view?'get':'gets'} enough play in return that the position stays at ${formatEval(move.evaluation,move.mateIn,view)}.`,arrows:[move.uci,ref.uci],squares:[]});
    }
    const facts=T.motifs(Chess,fen,move.uci,{line:move.line,curated:move.curated!==false});
    for(const fact of strongFacts(facts,bad?6:4,2))if(!covered(fact,ideas))ideas.push({text:fact.text,arrows:fact.arrows?.length?fact.arrows:[move.uci],squares:fact.squares||[]});
    if(bad){const harm=consequence(Chess,T,fen,move,mover);if(harm)ideas.push({text:harmText(harm,move,mover,view,'The problem:'),arrows:[harm.reply.uci,...(harm.fact?.arrows||[]).slice(0,1)],squares:[]});}
    if(best&&best.uci!==move.uci&&(bad||classification==='good')){
      const reasons=explainBest({Chess,Tactics:T,fen,mover,view,played:null,best,bestSpeech});
      if(!bad&&/^There is no single tactic/.test(reasons[0]?.text||''))return ideas.length?ideas:[{text:`${move.san} is a reasonable move; ${best.san} was slightly more precise.`,arrows:[move.uci],squares:[]}];
      ideas.push({text:`${bad?'Better':'Slightly stronger'} was ${best.san}. ${reasons[0]?.text||''}`.trim(),arrows:[best.uci,...(reasons[0]?.arrows||[]).filter(a=>a!==best.uci).slice(0,1)],squares:reasons[0]?.squares||[]});
    }
    if(!ideas.length){
      const soft=facts[0];
      ideas.push({text:soft?soft.text:`${move.san} keeps the position at ${formatEval(move.evaluation,move.mateIn,view)}.`,arrows:[move.uci],squares:[]});
    }
    return ideas;
  }

  /* ---------- position mode (any FEN) ----------
     The explanation engine only reviews games from the starting position, so
     positions are searched with the plain UCI engine instead. */
  function searchFen(engine,fen,depth=16){
    return engine.enqueue(async()=>{
      const info={cp:null,mate:null,pv:[],depth:0},worker=engine.worker;
      const onMessage=event=>{
        const text=typeof event.data==='string'?event.data:'';
        if(!text.startsWith('info')||!text.includes(' pv '))return;
        const score=text.match(/score (cp|mate) (-?\d+)/);if(!score)return;
        if(score[1]==='cp'){info.cp=Number(score[2]);info.mate=null;}else{info.mate=Number(score[2]);info.cp=null;}
        info.depth=Number(text.match(/depth (\d+)/)?.[1])||info.depth;
        info.pv=text.slice(text.indexOf(' pv ')+4).trim().split(/\s+/).filter(isUci);
      };
      worker.addEventListener('message',onMessage);
      try{
        engine.send('position fen '+fen);
        const line=await engine.waitForLinePrefix('bestmove',()=>engine.send('go depth '+depth),120000);
        const best=line.split(/\s+/)[1];
        const white=fen.split(' ')[1]==='w'?1:-1;
        return {bestMove:isUci(best)?best:null,pv:info.pv,depth:info.depth,
          evaluation:info.cp===null?(info.mate>0?white*100:-white*100):white*info.cp/100,
          mateIn:info.mate===null?null:white*info.mate};
      }finally{worker.removeEventListener('message',onMessage);}
    });
  }
  // Rate a move by how much winning chance it gave away (from the mover's side).
  function classifyByEval(before,after,mover,isBest){
    if(isBest)return 'best';
    const toCp=e=>e.mateIn!==null&&e.mateIn!==undefined?(e.mateIn===0?Math.sign(e.evaluation)*10000:Math.sign(e.mateIn)*(10000-Math.abs(e.mateIn)*10)):e.evaluation*100;
    const sign=asColor(mover)==='white'?1:-1,win=cp=>1/(1+Math.exp(-0.00368208*cp));
    const loss=win(sign*toCp(before))-win(sign*toCp(after));
    return loss<0.02?'excellent':loss<0.05?'good':loss<0.10?'inaccuracy':loss<0.20?'mistake':'blunder';
  }
  const tidy=list=>list.map(idea=>({...idea,text:String(idea.text||'').replace(/ …\.(?=\s|$)/g,' …').replace(/\.\.(?=\s|$)/g,'.')}));
  root.PixelAnalysis={searchFen,classifyByEval,VIEWS,configure,fetchRaw,convert,neutralize,words,formatEval,forMover,explainBest:args=>tidy(explainBest(args)),explainMove:args=>tidy(explainMove(args)),sanOf,colorName,asColor,otherColor};
  if(typeof module==='object')module.exports=root.PixelAnalysis;
})(globalThis);
