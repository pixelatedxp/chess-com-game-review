(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const {Chess,Engine}=PixelReviewRuntime;
  const A=PixelAnalysis,T=PixelTactics,S=PixelReviewSettings;
  const makeEngine=mode=>new Engine({mode,fetchEngineSource:()=>fetch(chrome.runtime.getURL('engine/explanation-engine.js')).then(response=>{if(!response.ok)throw Error('Local engine file is missing.');return response.text();}),workerFactory:(_blob,wasm)=>new Worker(chrome.runtime.getURL('engine/explanation-engine.js')+'#'+encodeURIComponent(wasm))});
  const service=PixelLocalReview.create({Chess,storage:chrome.storage.local,createEngine:()=>makeEngine('rich')});
  const labels={brilliant:'Brilliant',great:'Great',best:'Best',excellent:'Excellent',good:'Good',book:'Book',forced:'Forced',inaccuracy:'Inaccuracy',mistake:'Mistake',miss:'Miss',blunder:'Blunder'};
  const colors={brilliant:'#25c6a7',great:'#7ba9ca',best:'#81b64c',excellent:'#81b64c',good:'#91b16f',book:'#d4a278',forced:'#a2b58d',inaccuracy:'#f3c342',mistake:'#ff9f51',miss:'#ff6960',blunder:'#fa402d'};
  const BAD=new Set(['inaccuracy','mistake','miss','blunder']);
  const classificationIcon=cls=>'../icons/cls-'+(cls==='forced'||!labels[cls]?'good':cls)+'.png';
  const coaches=[['david','David'],['anna','Anna'],['botezsisters','Botez Sisters'],['calvin','Calvin'],['canty','Canty'],['danny','Danny'],['drwolf','Dr. Wolf'],['hikaru','Hikaru'],['judit','Judit'],['levy','Levy'],['magnus','Magnus'],['mittens','Mittens'],['ruben','Ruben'],['sloane','Sloane'],['tania','Tania'],['vishy','Vishy']];
  const coachNames=Object.fromEntries(coaches);
  const PIECES=['wp','wn','wb','wr','wq','wk','bp','bn','bb','br','bq','bk'];
  const SOUNDS=['move-self','move-opponent','capture','move-self-check','move-opponent-check','castle','promote','game-end','game-draw'];
  const SPEED={slow:300,normal:180,fast:90},AUTOPLAY={slow:1800,normal:1100,fast:600};

  let record=null,settings={...S.DEFAULTS},captured={},theme={},view='neutral',account='',run=0,gameId=new URLSearchParams(location.search).get('game');
  let root=null,main=[],cur=null,anchor=null,nodeSeq=0,flipped=false,pageView='overview',manualArrows=new Map();
  let explainingId=null,explanationStep=0,playTimer=null,followTimer=null,soundOn=true,coach='david';
  let branchEngine=null,branchView=null,branchStarting=null,viewJob=null,pointer=null,drag=null,promotion=null;
  const renderer=PixelReviewBoard.createRenderer($('board'));
  if(!PixelLocalReview.validId(gameId))gameId=null;
  const safeUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&/(^|\.)(chess\.com|chesscomfiles\.com)$/.test(url.hostname)?url.href:null;}catch{return null;}};
  const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined&&text!==null)element.textContent=text;if(className)element.className=className;return element;};
  const article=word=>/^[aeiou]/i.test(word)?'an':'a';
  function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
  function busy(value){$('busy').hidden=!value;$('analyze').disabled=value;$('pgn-file').disabled=value;}

  /* ---------- perspective ---------- */
  function headerName(color){return record?.game.headers[color==='white'?'White':'Black']||'';}
  function resolveView(){
    if(settings.perspective!=='auto')return settings.perspective;
    const me=(settings.username||account||'').toLowerCase();
    if(me&&record){for(const color of ['white','black'])if(headerName(color).toLowerCase()===me)return color;}
    return 'neutral';
  }
  const viewLabel=()=>view==='neutral'?'both players':view==='white'?`White${headerName('white')?` (${headerName('white')})`:''}`:`Black${headerName('black')?` (${headerName('black')})`:''}`;
  function viewData(){const views=record?.analysis.views||{};return views[view]||null;}
  const W=()=>A.words(view);

  /* ---------- sounds ---------- */
  function audioFor(san,mover){
    if(!soundOn||!san)return;
    const self=view==='neutral'?mover==='white':mover===view;
    let name=self?'move-self':'move-opponent';
    if(san.includes('#'))name='game-end';else if(san.includes('+'))name=self?'move-check':'move-opponent-check';
    else if(san.includes('x'))name='capture';else if(san.startsWith('O-O'))name='castle';else if(san.includes('='))name='promote';
    // Checks use Chess.com's standard check sound for both sides (the opponent-check file is a different clunk).
    if(name==='move-opponent-check')name='move-check';
    const remote=settings.usePieceSet&&!['move-check','capture','castle'].includes(name)?safeUrl(theme['sound-set-mp3-'+name]):null,local='assets/sound/'+name+'.mp3';
    const audio=new Audio(remote||local);audio.volume=.75;
    if(remote)audio.onerror=()=>{audio.onerror=null;audio.src=local;audio.play().catch(()=>{});};
    audio.play().catch(()=>{});
  }
  /* ---------- coach picker ---------- */
  function setCoach(value){
    coach=coachNames[value]?value:'david';const name=coachNames[coach],src='assets/coaches/coach'+coach+'.png';
    for(const id of ['overview','move']){$(id+'-avatar').src=src;$(id+'-avatar').alt=name;$(id+'-coach-name').textContent=name;}
    for(const button of $('coach-grid').querySelectorAll('.coach-choice'))button.setAttribute('aria-selected',String(button.dataset.coach===coach));
    chrome.storage.local.set({'pixel.review.coach':coach}).catch(()=>{});
  }
  function showCoachMenu(open){$('coach-menu').hidden=!open;for(const id of ['overview-coach-name','move-coach-name'])$(id).setAttribute('aria-expanded',String(open));if(open)$('coach-menu').querySelector('.coach-choice[aria-selected=true]')?.focus();}
  function buildCoachMenu(){
    const grid=$('coach-grid');grid.replaceChildren();
    for(const [id,name] of coaches){const button=node('button',null,'coach-choice'),img=node('img');button.type='button';button.dataset.coach=id;button.setAttribute('aria-selected','false');img.src='assets/coaches/coach'+id+'.png';img.alt='';button.append(img,node('span',name));button.onclick=()=>{setCoach(id);showCoachMenu(false);$(pageView==='overview'?'overview-coach-name':'move-coach-name').focus();};grid.append(button);}
  }

  /* ---------- move tree ---------- */
  function makeNode(parent,props){const item={id:++nodeSeq,parent,children:[],next:null,main:false,analysis:null,pending:false,...props};if(parent)parent.children.push(item);return item;}
  function buildTree(){
    nodeSeq=0;root=makeNode(null,{ply:0,fen:record.game.fens[0],main:true});main=[root];
    for(let i=1;i<=record.game.moves.length;i++)main.push(makeNode(main[i-1],{ply:i,fen:record.game.fens[i],uci:record.game.moves[i-1],san:record.game.san[i-1],main:true}));
    cur=root;anchor=null;
  }
  // Ply counted from the start of the game, so positions that begin mid-game number correctly.
  const absPly=item=>item.ply+(record?.game.plyOffset||0);
  const mover=item=>absPly(item)%2?'white':'black';
  const isPos=()=>!!record?.game.position;
  const mainAncestor=item=>{let n=item;while(n&&!n.main)n=n.parent;return n||root;};
  function pathMoves(item){const out=[];for(let n=item;n&&n.parent;n=n.parent)out.unshift(n.uci);return out;}
  function analysisOf(item){
    if(!item||item===root)return null;
    if(isPos())return item.analysis||null;
    if(!item.main)return item.analysis&&item.analysisView===view?item.analysis:null;
    const i=item.ply-1,base=record.analysis.moveAnalyses[i],rich=record.analysis.rich?.[i],speech=viewData()?.moves?.[i];
    if(!base)return null;
    const parts=speech?.parts||(base.speech&&view==='neutral'?[{text:A.neutralize(base.speech,mover(item)),arrows:base.arrows||[],squares:base.squares||[]}]:[]);
    return {classification:base.classification,evaluation:base.evaluation,mateIn:base.mateIn,parts,best:rich?.best||null,bestParts:speech?.best||[],line:rich?.line||[item.uci],curated:rich?.curated,ready:!!speech};
  }
  function bestOf(item){return item.bestFor&&item.parent===item.bestFor.parent?item.bestFor:null;}
  function evalOf(item){
    if(item===root&&isPos())return root.search?{value:root.search.mateIn===0?root.search.evaluation:root.search.mateIn!==null?(root.search.mateIn>0?100:-100):root.search.evaluation,mate:root.search.mateIn}:null;
    if(!item||item===root)return {value:main[1]?Number(record.analysis.moveAnalyses[0]?.evaluation)||0:0,mate:null};
    const a=analysisOf(item);if(!a)return null;
    if(Number.isFinite(a.mateIn)&&a.mateIn!==null){
      if(a.mateIn===0)return {value:item.fen.split(' ')[1]==='b'?100:-100,mate:0};
      return {value:a.mateIn>0?100:-100,mate:a.mateIn};
    }
    return {value:Number(a.evaluation)||0,mate:null};
  }
  function formatEval(value,mate){return Number.isFinite(mate)&&mate!==null?(mate===0?'#':`M${Math.abs(mate)}`):`${value>=0?'+':''}${value.toFixed(2)}`;}
  function sanOf(fen,uci){return A.sanOf(Chess,fen,uci);}
  function ideasFor(item){
    const a=analysisOf(item);if(!a)return [];
    const key=view+'|'+(a.ready?'r':'p');if(item.ideas?.key===key)return item.ideas.list;
    const fen=item.parent.fen,moverColor=mover(item);
    let list=[];
    try{
      const played=bestOf(item);
      if(played){
        const pa=analysisOf(played);
        list=A.explainBest({Chess,Tactics:T,fen,mover:moverColor,view,bestSpeech:a.parts,
          best:{uci:item.uci,san:item.san,line:a.line,curated:a.curated,evaluation:a.evaluation,mateIn:a.mateIn},
          played:pa?{uci:played.uci,san:played.san,line:pa.line,curated:pa.curated,evaluation:pa.evaluation,mateIn:pa.mateIn}:null});
      }else{
        const best=a.best?{uci:a.best.moveLan,san:sanOf(fen,a.best.moveLan),line:a.best.line,curated:a.best.curated,evaluation:a.best.evaluation,mateIn:a.best.mateIn}:null;
        list=A.explainMove({Chess,Tactics:T,fen,mover:moverColor,view,classification:a.classification,speech:a.parts,best,bestSpeech:a.bestParts,opening:viewData()?.opening,
          move:{uci:item.uci,san:item.san,line:a.line,curated:a.curated,evaluation:a.evaluation,mateIn:a.mateIn}});
      }
    }catch(error){console.warn('Explanation failed',error);}
    if(!list.length)list=[{text:fallbackText(item,a),arrows:[item.uci],squares:[]}];
    item.ideas={key,list};return list;
  }
  function fallbackText(item,a){
    const cls=labels[a?.classification]||'move';
    if(item.san?.includes('#'))return 'Checkmate ends the game.';
    return `${item.san} is rated ${cls.toLowerCase()} by the local engine.`;
  }
  /* Ensure an explored move has engine feedback in the current perspective. */
  async function getBranchEngine(){
    if(branchEngine&&branchView===view)return branchEngine;
    if(branchStarting&&branchView===view)return branchStarting;
    branchEngine?.destroy();branchEngine=null;branchView=view;
    const wanted=view;
    branchStarting=(async()=>{
      const engine=makeEngine('rich');await engine.init();
      const white=Number(record.game.headers.WhiteElo),black=Number(record.game.headers.BlackElo);
      if(white>0&&black>0)await engine.setRatings(white,black);
      await A.configure(engine,wanted);
      if(branchView!==wanted){engine.destroy();throw Object.assign(Error('Perspective changed'),{name:'AbortError'});}
      branchEngine=engine;return engine;
    })();
    try{return await branchStarting;}finally{branchStarting=null;}
  }
  /* ---------- position mode: plain engine search for any FEN ---------- */
  let posEngine=null,posSearches=new Map();
  function getPosEngine(){
    if(!posEngine)posEngine=(async()=>{const engine=makeEngine('uci');await engine.init();return engine;})();
    return posEngine.catch(error=>{posEngine=null;throw error;});
  }
  function terminal(fen){
    try{const chess=new Chess(fen);
      if(chess.isCheckmate())return {bestMove:null,pv:[],evaluation:chess.turn()==='w'?-100:100,mateIn:0};
      if(chess.isGameOver())return {bestMove:null,pv:[],evaluation:0,mateIn:null};}catch{}
    return null;
  }
  const searchDepth=()=>S.DEPTHS[settings.engineDepth]||S.DEPTHS.standard;
  function searchPosition(fen){
    const key=searchDepth()+'|'+fen;
    if(!posSearches.has(key)){
      const depth=searchDepth(),done=terminal(fen),promise=done?Promise.resolve(done):getPosEngine().then(engine=>A.searchFen(engine,fen,depth));
      promise.catch(()=>{if(posSearches.get(key)===promise)posSearches.delete(key);});posSearches.set(key,promise);
    }
    return posSearches.get(key);
  }
  // Depth changed: drop cached searches so positions are re-analysed at the new depth.
  function clearPositionAnalysis(){
    posSearches=new Map();
    if(!root)return;
    for(const item of walk(root)){item.search=null;item.analysis=null;item.ideas=null;}
  }
  async function ensurePosition(item){
    if(!item||item.pending||(item.search&&(item===root||item.analysis?.searched)))return;
    item.pending=true;const currentRecord=record;
    try{
      const own=await searchPosition(item.fen);if(record!==currentRecord)return;item.search=own;
      if(item!==root){
        const before=item.parent.search||(item.parent.search=await searchPosition(item.parent.fen));if(record!==currentRecord)return;
        const isBest=before.bestMove===item.uci||own.mateIn===0;
        let cls=A.classifyByEval(before,own,mover(item),isBest);
        // Brilliant: a (near-)best move that gives up material, when the side wasn't already winning easily.
        if(['best','excellent','good'].includes(cls)&&own.mateIn!==0){
          const ref=T.refutation(Chess,item.parent.fen,item.uci,[item.uci,...own.pv].slice(0,8));
          const moverScore=A.forMover(before.evaluation,before.mateIn,mover(item));
          if(ref?.gain&&ref.gain.value>=2&&moverScore<5)cls='brilliant';
        }
        item.analysis={classification:bestOf(item)&&cls!=='brilliant'?'best':cls,evaluation:own.evaluation,mateIn:own.mateIn,parts:[],
          best:before.bestMove&&!isBest?{moveLan:before.bestMove,evaluation:before.evaluation,mateIn:before.mateIn,line:before.pv.slice(0,8),curated:true}:null,
          bestParts:[],line:[item.uci,...own.pv].slice(0,8),curated:true,ready:true,searched:true};
        item.analysisView=view;item.ideas=null;
      }
    }catch(error){
      if(record!==currentRecord)return;
      status('The engine could not analyse this position: '+error.message,true);
      if(item!==root&&!item.analysis)item.analysis={classification:'good',evaluation:0,mateIn:null,parts:[{text:`${item.san} was played. The engine could not analyse it.`,arrows:[],squares:[]}],best:null,bestParts:[],line:[item.uci],ready:true,searched:true};
    }finally{item.pending=false;}
    if(record===currentRecord){renderMoves();if(item===cur||item===cur.parent){renderCoach();drawBoard();}}
  }
  async function ensureAnalysis(item){
    if(isPos()){ensurePosition(item);return;}
    if(!item||item.main||item===root)return;
    if(item.analysis&&item.analysisView===view)return;
    if(item.pending===view)return;
    item.pending=view;const wanted=view,currentRecord=record;
    try{
      const engine=await getBranchEngine(),moves=pathMoves(item);
      const raw=await A.fetchRaw(engine,moves,60000);
      if(record!==currentRecord||wanted!==view)return;
      const converted=A.convert(raw,moves,wanted),i=moves.length-1,base=converted.moveAnalyses[i],rich=converted.rich[i],speech=converted.view.moves[i];
      item.analysis={classification:bestOf(item)?'best':base.classification,evaluation:base.evaluation,mateIn:base.mateIn,parts:speech.parts,best:rich.best,bestParts:speech.best,line:rich.line,curated:rich.curated,ready:true};
      item.analysisView=wanted;item.ideas=null;
    }catch(error){
      if(error?.name==='AbortError'||record!==currentRecord)return;
      item.analysis={classification:'good',evaluation:evalOf(item.parent)?.value||0,mateIn:null,parts:[{text:`${item.san} was played. The engine could not review this line: ${error.message}`,arrows:[],squares:[]}],best:null,bestParts:[],line:[item.uci],ready:true,failed:true};
      item.analysisView=wanted;branchEngine?.destroy();branchEngine=null;
    }finally{if(item.pending===wanted)item.pending=false;}
    if(record===currentRecord){renderMoves();if(item===cur){renderCoach();drawBoard();}}
  }

  /* ---------- theme and settings ---------- */
  function applyTheme(){
    const rootEl=document.documentElement,board=$('board');
    const useBoard=settings.useBoardTheme;
    rootEl.style.setProperty('--light',(useBoard&&theme['board-style-coordinate-color-light'])||'#ebecd0');
    rootEl.style.setProperty('--dark',(useBoard&&theme['board-style-coordinate-color-dark'])||'#739552');
    rootEl.style.setProperty('--highlight',(useBoard&&theme['board-style-highlight-color'])||'#ffff33');
    board.style.backgroundImage='url("assets/theme/board.png")';board.style.backgroundSize='100% 100%';board.classList.add('theme-image');
    const boardImage=useBoard&&safeUrl(theme['board-style-image']);
    if(boardImage){const probe=new Image();probe.onload=()=>{if(settings.useBoardTheme)board.style.backgroundImage=`url("${boardImage}")`;};probe.src=boardImage;}
    const background=settings.useBackground&&safeUrl(theme['background-image']),bgColor=settings.useBackground&&theme['background-color'];
    document.body.classList.toggle('chesscom-background',!!background);
    document.body.style.backgroundColor=bgColor||'';
    if(background){const probe=new Image();probe.onload=()=>{if(settings.useBackground)document.body.style.backgroundImage=`url("${background}")`;};probe.src=background;}
    else document.body.style.backgroundImage='';
    $('eval-fill').parentElement.classList.toggle('eval-hidden',!settings.evalBar);
    for(const id of ['top-captured','bottom-captured'])$(id).hidden=!settings.captured;
  }
  function pieceTheme(){
    if(settings.usePieceSet)return theme;
    const out={};for(const piece of PIECES)out['piece-set-'+piece]='assets/theme/'+piece+'.png';return out;
  }
  async function changeSetting(key,value){
    settings=S.sanitize({...settings,[key]:value});await S.save(chrome.storage.local,settings);
    if(key==='sounds'){soundOn=settings.sounds;syncSoundButton();}
    if(key==='explainMode'&&value==='manual')explainingId=null;
    if(key==='engineDepth'&&isPos()){
      clearPositionAnalysis();
      if(record){renderMoves();renderCoach();drawBoard();void ensurePosition(cur);void ensurePosition(root);}
      dialog.sync();return;
    }
    if(key==='perspective'||key==='username'){await updateView();return;}
    applyTheme();if(record){renderPlayers();renderMoves();renderCoach();drawBoard();}
    dialog.sync();
  }
  function syncSoundButton(){$('voice-toggle').style.opacity=soundOn?'1':'.4';$('voice-toggle').setAttribute('aria-pressed',String(soundOn));}
  async function updateView({initial=false}={}){
    if(!record)return;
    const next=resolveView(),changed=next!==view;view=next;
    if(changed||initial){flipped=view==='black';renderer.reset();for(const item of walk(root))item.ideas=null;}
    renderOverviewPerspective();
    if(record){display(record,{keepPosition:!initial});if(!isPos()&&!viewData())loadViewData();}
    dialog.sync();
  }
  function* walk(item){if(!item)return;yield item;for(const child of item.children)yield* walk(child);}
  async function loadViewData(){
    const target=record,wanted=view;
    if(viewJob?.view===wanted&&viewJob.record===target)return viewJob.promise;
    const label=wanted==='neutral'?'both players':wanted;
    status(record.version===1?'Adding detailed explanations to this review…':`Rewriting the coach’s comments for ${label}…`);
    const promise=service.addView(target,wanted,{onProgress:p=>{if(record===target&&view===wanted)status(`Rewriting the coach’s comments for ${label}… ${p}%`);}})
      .then(()=>{if(record===target){status('');if(view===wanted){for(const item of walk(root))item.ideas=null;renderAll();}}})
      .catch(error=>{if(error?.name!=='AbortError')status('Could not update the explanations: '+error.message,true);})
      .finally(()=>{if(viewJob?.promise===promise)viewJob=null;});
    viewJob={view:wanted,record:target,promise};
    return promise;
  }
  function renderOverviewPerspective(){
    const line=$('perspective-line');if(!line)return;
    line.replaceChildren(node('span',`Reviewing as ${viewLabel()}`));
    const change=node('button','Change','link-button');change.type='button';change.onclick=()=>dialog.open();line.append(change);
  }

  /* ---------- board ---------- */
  function legalTargets(square){
    if(!square||!settings.legalMoves)return [];
    try{return new Chess(cur.fen).moves({square,verbose:true}).map(m=>({square:m.to,capture:!!m.captured}));}catch{return [];}
  }
  function kingInCheck(fen){
    try{const chess=new Chess(fen);if(!chess.inCheck())return '';const color=chess.turn();for(const row of chess.board())for(const p of row)if(p&&p.type==='k'&&p.color===color)return p.square;}catch{}
    return '';
  }
  function currentIdeas(){return explaining(cur)?ideasFor(cur):null;}
  const explaining=item=>!!item&&item!==root&&pageView==='moves'&&(settings.explainMode==='always'||explainingId===item.id)&&!!analysisOf(item);
  function drawBoard({skipAnimationFor=''}={}){
    if(!record)return;
    const item=cur,a=analysisOf(item),ideas=currentIdeas();
    let arrows=[],squares=[];
    if(ideas){const idea=ideas[Math.min(explanationStep,ideas.length-1)];arrows=idea?.arrows||[];squares=idea?.squares||[];}
    else if(isPos()&&item===root&&settings.coachArrows&&item.search?.bestMove)arrows=[item.search.bestMove];
    else if(pageView==='moves'&&settings.coachArrows&&a){
      if(bestOf(item))arrows=ideasFor(item)[0]?.arrows||[item.uci];else arrows=a.parts?.[0]?.arrows||[];
    }
    const cls=bestOf(item)?'best':a?.classification||'';
    const played=bestOf(item);
    renderer.draw({fen:item.fen,uci:item.uci||'',classification:cls,flipped,theme:pieceTheme(),arrows:settings.coachArrows||ideas?arrows:[],
      manualArrows:manualArrows.get(item.fen)||[],selectedSquare:pointer?.selected||'',coordinates:settings.coordinates,highlight:settings.highlightLastMove,
      animate:settings.animations?SPEED[settings.animationSpeed]:0,badges:settings.moveBadges,legal:legalTargets(pointer?.selected),squares,check:kingInCheck(item.fen),
      hidePiece:drag?.moved?drag.from:'',skipAnimationFor,
      label:played?`Best alternative ${item.san} instead of ${played.san}`:!item.main?`Explored line after ${item.san}`:item.ply?`Position after ${item.san}`:'Starting position'});
    const score=evalOf(item)||evalOf(item.parent)||{value:0,mate:null};
    $('evaluation').textContent=Number.isFinite(score.mate)&&score.mate!==null?(score.mate===0?'#':`M${Math.abs(score.mate)}`):Math.abs(score.value).toFixed(1);
    $('eval-fill').style.height=(50+Math.tanh(score.value/5)*49)+'%';
    const bar=$('eval-fill').parentElement;bar.classList.toggle('flipped',flipped);bar.classList.toggle('black-winning',score.value<0);bar.setAttribute('aria-valuenow',String(Math.max(-10,Math.min(10,score.value))));bar.setAttribute('aria-valuetext',formatEval(score.value,score.mate));
  }
  function svg(tag,attrs){const element=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))element.setAttribute(key,value);return element;}
  function mainEval(ply){const item=main[ply];return evalOf(item)?.value||0;}
  function graphPoints(){return record.analysis.moveAnalyses.map((_,index)=>[(index+1)/record.game.moves.length*640,50-Math.tanh(mainEval(index+1)/5)*48]);}
  function drawGraph(element,showCursor){
    element.parentElement.hidden=isPos();if(isPos()||!record.game.moves.length){element.replaceChildren();return;}
    const points=graphPoints(),length=record.game.moves.length;element.replaceChildren();
    element.append(svg('polygon',{points:'0,100 0,50 '+points.map(point=>point.join(',')).join(' ')+' 640,100',fill:'#eeeeec'}));
    element.append(svg('line',{x1:0,y1:50,x2:640,y2:50,stroke:'#aaa','stroke-width':1}));
    record.analysis.moveAnalyses.forEach((move,index)=>{if(['brilliant','great','mistake','miss','blunder'].includes(move.classification))element.append(svg('circle',{cx:points[index][0],cy:points[index][1],r:4,fill:colors[move.classification]}));});
    if(showCursor){const ply=mainAncestor(cur).ply;element.append(svg('line',{x1:ply/length*640,y1:0,x2:ply/length*640,y2:100,stroke:'#81b64c','stroke-width':3}));}
  }

  /* ---------- overview ---------- */
  function gameRating(color){const value=record.analysis.reportCard?.[color]?.effectiveElo;return Number.isFinite(value)&&value>0?Math.round(value):'—';}
  function tallyRows(){
    const white={},black={};record.analysis.moveAnalyses.forEach((move,index)=>{const counts=index%2?black:white;counts[move.classification]=(counts[move.classification]||0)+1;});
    $('tallies').replaceChildren();
    for(const cls of ['brilliant','great','book','best','excellent','good','inaccuracy','mistake','miss','blunder']){
      if(!white[cls]&&!black[cls]&&!['brilliant','great','best','excellent','mistake','miss','blunder'].includes(cls))continue;
      const row=node('div',null,'stat-row');const icon=node('img',undefined,'stat-icon');icon.src=classificationIcon(cls);icon.alt=labels[cls];row.append(node('span',labels[cls]),node('strong',white[cls]||0),icon,node('strong',black[cls]||0));
      for(const strong of row.querySelectorAll('strong'))strong.style.color=colors[cls];$('tallies').append(row);
    }
    $('phases').replaceChildren();
    for(const [name,start,end] of [['Opening',0,.25],['Tactics',.25,.5],['Strategy',.5,.75],['Endgame',.75,1]]){
      const first=Math.floor(start*record.game.moves.length),slice=record.analysis.moveAnalyses.slice(first,Math.ceil(end*record.game.moves.length));
      const score=color=>{
        const moves=slice.filter((_,index)=>(first+index)%2===(color==='white'?0:1));
        const weight={brilliant:2,great:1.5,best:1,excellent:.75,good:.4,book:.3,forced:.3,inaccuracy:-.75,mistake:-1.25,miss:-1.75,blunder:-2.5};
        return moves.length?moves.reduce((total,move)=>total+(weight[move.classification]??0),0)/moves.length:0;
      };
      const phaseIcon=value=>value>=1.7?'brilliant':value>=1.05?'best':value>=.62?'excellent':value>=.12?'good':value>=-.55?'inaccuracy':value>=-1.2?'mistake':value>=-1.9?'miss':'blunder';
      const whiteIcon=phaseIcon(score('white')),blackIcon=phaseIcon(score('black')),row=node('div',null,'stat-row phase-row');
      const left=node('img',undefined,'phase-icon');left.src=classificationIcon(whiteIcon);left.alt=labels[whiteIcon];const right=node('img',undefined,'phase-icon');right.src=classificationIcon(blackIcon);right.alt=labels[blackIcon];row.append(node('span',name),left,node('span','', 'stat-icon'),right);$('phases').append(row);
    }
  }
  function overviewMessage(){
    const summary=viewData()?.summary?.[0];if(summary)return summary;
    const headers=record.game.headers,termination=String(headers.Termination||'').toLowerCase(),result=headers.Result||'*',w=W();
    const winner=result==='1-0'?'white':result==='0-1'?'black':null;
    if(termination.includes('stalemate'))return 'The game ends in stalemate. Let’s look at how it got there.';
    if(result==='1/2-1/2')return 'This game ends in a draw. Let’s find the turning points.';
    if(winner&&w.own)return winner===view?'Nice win! Let’s see where you built the advantage.':'A tough game. Let’s find where it turned against you.';
    if(winner)return `${A.colorName(winner)} wins this game. Let’s see where the advantage was built.`;
    return w.own?'Your game is ready. Let’s review the moves together.':'This game is ready. Let’s review the moves together.';
  }

  /* ---------- players, clocks, captured pieces ---------- */
  function renderCaptured(holder,colorCode,info){
    holder.replaceChildren();if(!settings.captured)return;
    const set=pieceTheme();
    for(const type of ['p','b','n','r','q']){
      const count=info.captured[colorCode][type];if(!count)continue;
      const group=node('span',null,'captured-group');group.dataset.type=type;
      for(let i=0;i<count;i++){const img=node('img',null,'captured-piece');const piece=(colorCode==='w'?'b':'w')+type;img.src=set['piece-set-'+piece]||'assets/theme/'+piece+'.png';img.alt='';img.onerror=()=>{img.onerror=null;img.src='assets/theme/'+piece+'.png';};group.append(img);}
      holder.append(group);
    }
    const lead=colorCode==='w'?info.advantage:-info.advantage;
    if(lead>0)holder.append(node('span','+'+lead,'material-advantage'));
    const names={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen'};
    const list=Object.entries(info.captured[colorCode]).filter(([,n])=>n).map(([t,n])=>`${n} ${names[t]}${n>1?'s':''}`).join(', ');
    holder.setAttribute('aria-label',(list?`Captured ${list}`:'No captures')+(lead>0?`, ahead by ${lead}`:''));
  }
  function renderPlayers(){
    const headers=record.game.headers,result=headers.Result||'*';
    const seconds=Number(String(headers.TimeControl||'').split('+')[0]);
    const clockTime=value=>Number.isFinite(value)&&value>=0?`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`:'';
    const ply=mainAncestor(cur).ply,info=PixelReviewBoard.material(cur.fen);
    for(const [slot,color] of [['top',flipped?'White':'Black'],['bottom',flipped?'Black':'White']]){
      const lower=color.toLowerCase();
      $(slot+'-name').textContent=headers[color]||color;$(slot+'-rating').textContent=headers[color+'Elo']?'('+headers[color+'Elo']+')':'';
      const you=view===lower&&W().own&&settings.perspective==='auto';$(slot+'-name').title=you?'You':'';
      const elapsed=record.game.clocks?.[ply]?.[lower];
      const clock=clockTime(elapsed??(Number.isFinite(seconds)&&seconds>0?seconds:null));
      const resultBox=$(slot+'-result'),clockIcon=$(slot+'-clock-icon'),clockText=$(slot+'-clock');
      const fallback=result==='1/2-1/2'?'½':result==='*'?'':((result==='1-0')===(color==='White')?'1':'0');
      const initial=record.game.clocks?.[0]?.[lower]??seconds;
      const stage=clock&&Number.isFinite(initial)&&initial>0?Math.min(3,Math.max(0,Math.floor((1-(elapsed??initial)/initial)*4))):0;
      clockText.textContent=clock||fallback;clockIcon.hidden=!clock;resultBox.dataset.clockStage=String(stage);
      resultBox.style.visibility=clock||fallback?'':'hidden';
      resultBox.setAttribute('aria-label',clock?`${color} clock: ${clock}`:`${color} result: ${fallback}`);
      const details=PixelReviewAvatars.details(record,lower),flag=$(slot+'-flag'),flair=$(slot+'-flair');
      const code=details.countryCode?.toLowerCase()||'';
      flag.textContent='';flag.dataset.country=code&&PixelFlagCodes.has(code)?code:'xx';flag.title=code?(countryName(code)||code.toUpperCase()):'';flag.hidden=!code;
      flag.setAttribute('aria-label',flag.title||'');
      flair.hidden=!details.flair;if(details.flair){flair.onerror=()=>{flair.hidden=true;};flair.src=details.flair;}
      PixelReviewAvatars.render($(slot+'-player').querySelector('.avatar'),record,lower);
      renderCaptured($(slot+'-captured'),lower[0],info);
    }
    for(const color of ['white','black']){
      const holder=$(color+'-player-avatar');PixelReviewAvatars.render(holder,record,color);holder.title=record.game.headers[color==='white'?'White':'Black']||color;
      $(color+'-player-name').textContent=record.game.headers[color==='white'?'White':'Black']||color;
    }
  }
  const regionNames=(()=>{try{return new Intl.DisplayNames(['en'],{type:'region'});}catch{return null;}})();
  function countryName(code){if(code==='xx')return 'International';try{return /^x/.test(code)?null:regionNames?.of(code.toUpperCase());}catch{return null;}}

  /* ---------- move list (with explored lines) ---------- */
  function moveButton(item,{showNumber=false,inline=false}={}){
    const button=node('button',null,inline?'move variation-move':'move');button.type='button';button.dataset.node=item.id;
    const a=analysisOf(item),cls=bestOf(item)?'best':(a||item.analysis)?.classification;
    button.dataset.classification=cls||'';
    if(showNumber){const n=Math.ceil(absPly(item)/2);button.append(node('span',absPly(item)%2?`${n}.`:`${n}…`,'variation-number'));}
    if(cls){const img=node('img');img.src=classificationIcon(cls);img.alt='';button.append(img);}
    else if(item.pending){button.append(node('span','','move-pending'));}
    const san=item.san,pieceCode={N:'n',B:'b',R:'r',Q:'q',K:'k'}[san[0]];
    if(pieceCode){const piece=node('img');piece.className='move-piece';const code=(absPly(item)%2?'w':'b')+pieceCode;piece.src=pieceTheme()['piece-set-'+code]||`assets/theme/${code}.png`;piece.alt='';piece.onerror=()=>{piece.src=`assets/theme/${code}.png`;piece.onerror=null;};button.append(piece);}
    button.append(node('span',pieceCode?san.slice(1):san,'san'));
    button.title=`${san}${cls?' · '+(labels[cls]||cls):''}${item.main?'':' · explored'}`;
    if(item===cur)button.classList.add('selected');
    button.onclick=()=>{stopAll();go(item,{sound:true});};
    return button;
  }
  function renderLine(container,start){
    container.append(moveButton(start,{showNumber:true,inline:true}));
    continueLine(container,start);
  }
  // Follow a line's first continuation; other choices appear in brackets, like a PGN.
  function continueLine(container,item){
    let needNumber=false;
    while(item){
      const [continuation,...alternatives]=item.children;
      if(!continuation)return;
      container.append(moveButton(continuation,{showNumber:absPly(continuation)%2===1||needNumber,inline:true}));needNumber=false;
      for(const alt of alternatives){const sub=node('span',null,'subvariation');sub.append('(');renderLine(sub,alt);sub.append(')');container.append(sub);needNumber=true;}
      item=continuation;
    }
  }
  function renderMoves(){
    const list=$('moves');list.replaceChildren();
    if(!record)return;
    let pending=[];
    const flush=()=>{for(const alt of pending){const block=node('div',null,'variation');renderLine(block,alt);list.append(block);}pending=[];};
    // Lines played from the starting position itself (position mode) come first.
    if(main.length===1)pending.push(...root.children.filter(child=>!child.main));
    for(let index=1;index<main.length;index++){
      const item=main[index],ply=absPly(item),white=ply%2===1;
      if(white)list.append(node('span',`${(ply+1)/2}.`,'move-number'));
      else if(index===1){list.append(node('span',`${ply/2}.`,'move-number'));list.append(node('span','…','move-spacer'));}
      list.append(moveButton(item));
      pending.push(...item.parent.children.filter(child=>!child.main));
      if(!white||index===main.length-1){if(white)list.append(node('span','','move-spacer'));flush();}
    }
    flush();
    if(isPos()&&main.length===1&&!root.children.length)list.append(node('p','Play a move on the board, press Best for the engine’s move, or Follow-up to watch its main line.','moves-hint'));
    list.querySelector('.selected')?.scrollIntoView({block:'nearest'});
  }

  /* ---------- coach panel ---------- */
  function renderCoach(){
    if(!record)return;
    const item=cur,a=analysisOf(item),played=bestOf(item),w=W();
    const cls=played?'best':a?.classification||'good';
    $('coach-badge').src=classificationIcon(cls);$('coach-badge').hidden=item===root;
    const ideas=currentIdeas();
    if(ideas)explanationStep=Math.min(explanationStep,ideas.length-1);
    let heading,text;
    if(item===root&&isPos()){
      const side=item.fen.split(' ')[1]==='w'?'White':'Black',search=item.search;
      heading=`${side} to move`;
      if(!search)text='The engine is looking at this position…';
      else if(!search.bestMove)text=search.mateIn===0?`${side} has been checkmated.`:'The game is over in this position.';
      else{
        const san=sanOf(item.fen,search.bestMove);
        const reasons=A.explainBest({Chess,Tactics:T,fen:item.fen,mover:side.toLowerCase(),view,played:null,best:{uci:search.bestMove,san,line:search.pv.slice(0,8),curated:true,evaluation:search.evaluation,mateIn:search.mateIn}});
        const first=reasons[0]?.text||'';
        text=`The engine’s best move here is ${san} (${formatEval(search.evaluation,search.mateIn)}).`+(first&&!/^There is no single tactic/.test(first)?' '+first:'');
      }
    }
    else if(item===root){heading='Starting position';text=overviewMessage();}
    else if(!a){heading=`Reviewing ${item.san}…`;text=item.pending||!item.main?'The coach is looking at this move…':'Loading the coach’s comments…';}
    else if(item.main&&!a.ready&&!played){heading=`${item.san} is ${article(cls)} ${(labels[cls]||cls).toLowerCase()} move`;text=`Updating the coach’s comments for ${viewLabel()}…`;}
    else if(ideas){heading=`${played?`Why ${item.san} is best`:`Explaining ${item.san}`} · ${explanationStep+1}/${ideas.length}`;text=ideas[explanationStep]?.text||'';}
    else if(played){heading=`${item.san} is best`;const list=ideasFor(item);text=list.slice(0,settings.explanationDetail==='coach'?1:2).map(i=>i.text).join(' ');}
    else{
      heading=cls==='best'?`${item.san} is best`:`${item.san} is ${article(cls)} ${(labels[cls]||cls).toLowerCase()} move`;
      const speech=(a.parts||[]).map(p=>p.text).join(' ');
      let extra='';
      if((settings.explanationDetail==='detailed'||isPos())&&a.ready!==false){const list=ideasFor(item),firstOwn=list.find(i=>i.source!=='speech');if(firstOwn&&(!speech||BAD.has(cls)||/fork|pin|discover|checkmate|wins|free|undefended/i.test(firstOwn.text)))extra=firstOwn.text;}
      text=[speech,extra].filter(Boolean).join(' ')||fallbackText(item,a);
    }
    $('move-heading').textContent=heading;$('explanation').textContent=text;
    const score=evalOf(item);$('move-eval').textContent=score?formatEval(score.value,score.mate):'…';
    const inMain=item.main,always=settings.explainMode==='always';
    const showBest=(item===root&&isPos())?!!item.search?.bestMove:!!a&&!played&&!!a.best&&!['book','best','brilliant','great','forced'].includes(cls);
    const manualExplain=!!ideas&&!always;
    $('explain').hidden=item===root||!a||!!ideas||cls==='book';
    $('best').hidden=manualExplain||!showBest;
    $('next').hidden=manualExplain||!inMain||item.ply>=main.length-1;
    $('follow').hidden=manualExplain||(isPos()?!(item.search?.pv?.length):(inMain||!a||(a.line||[]).length<2));
    $('resume').hidden=manualExplain||inMain||(isPos()&&main.length===1&&item===root);
    $('explain-back').hidden=!ideas;$('explain-forward').hidden=!ideas;$('got-it').hidden=!manualExplain;
    if(ideas){$('explain-back').disabled=explanationStep===0;$('explain-forward').disabled=explanationStep>=ideas.length-1;}
    $('back-overview').hidden=pageView==='overview'||isPos();
    const end=lineEnd(item);
    $('previous').disabled=item===root;$('first').disabled=item===root;$('forward').disabled=!(item.next||item.children[0]);$('last').disabled=end===item;
    const message=$('branch-message');
    if(inMain){message.hidden=true;message.textContent='';}
    else{const base=mainAncestor(item),depth=depthFrom(item,base);message.hidden=false;
      const back=isPos()&&main.length===1?'Resume returns to the starting position':'Resume returns to the game';
      message.textContent=played?`Showing the best move instead of ${played.san} · play any move to keep exploring · ${back}`:`Exploring ${depth} ${depth===1?'move':'moves'} ${isPos()&&main.length===1?'from the starting position':'away from the game'} · ${back}`;}
  }
  const depthFrom=(item,base)=>{let n=0;for(let x=item;x&&x!==base;x=x.parent)n++;return n;};
  function lineEnd(item){let n=item;while(n.next||n.children[0])n=n.next||n.children[0];return n;}

  /* ---------- navigation ---------- */
  function stopAll(){stopPlay();stopFollow();}
  function go(item,{sound=false,skipAnimationFor=''}={}){
    if(!record||!item)return;
    const old=cur;cur=item;
    if(item.parent)item.parent.next=item;
    if(old!==item){explanationStep=0;if(settings.explainMode!=='always')explainingId=null;}
    pointer=null;cancelPromotion();
    if(pageView!=='moves'&&item!==root)showView('moves');
    renderPlayers();renderMoves();renderCoach();drawBoard({skipAnimationFor});drawGraph($('graph'),true);
    if(sound&&old!==item&&item.parent===old)audioFor(item.san,mover(item));
    ensureAnalysis(item);
  }
  const forward=()=>{const nextItem=cur.next||cur.children[0];if(nextItem)go(nextItem,{sound:true});};
  const back=()=>{if(cur.parent)go(cur.parent);};
  function resume(){stopAll();go(anchor&&anchor.main?anchor:mainAncestor(cur));}
  function showView(next){pageView=next;$('overview').hidden=next!=='overview';$('move-view').hidden=next!=='moves';$('back-overview').hidden=next==='overview';}
  function child(item,uci){
    let found=item.children.find(c=>c.uci===uci);
    if(found)return found;
    const chess=new Chess(item.fen),move=chess.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||undefined});
    found=makeNode(item,{ply:item.ply+1,fen:chess.fen(),uci:move.from+move.to+(move.promotion||''),san:move.san,main:false});
    return found;
  }
  function play(from,to,promo,{dragged=false}={}){
    let chess;try{chess=new Chess(cur.fen);}catch{return false;}
    const legal=chess.moves({square:from,verbose:true}).filter(m=>m.to===to);if(!legal.length)return false;
    if(legal.some(m=>m.promotion)&&!promo){askPromotion(from,to,chess.turn(),dragged);return true;}
    const move=legal.find(m=>!m.promotion||m.promotion===promo)||legal[0];
    const uci=move.from+move.to+(move.promotion||'');
    if(cur.main&&!cur.children.find(c=>c.uci===uci)?.main)anchor=cur;
    stopAll();manualArrows.delete(cur.fen);
    go(child(cur,uci),{sound:true,skipAnimationFor:dragged?move.to:''});
    return true;
  }
  /* Best: show the engine's choice instead of the current move, as a real line you can continue. */
  function showBest(){
    if(isPos()&&cur===root){const best=root.search?.bestMove;if(best){stopAll();go(child(root,best),{sound:true});}return;}
    const item=cur,a=analysisOf(item);if(!a?.best||!item.parent)return;
    if(item.main)anchor=item;
    stopAll();
    const alt=child(item.parent,a.best.moveLan);
    alt.bestFor=item;alt.ideas=null;
    // The review already knows why this move is best, so show it straight away.
    if(!alt.main&&(!alt.analysis||alt.analysisView!==view)){
      alt.analysis={classification:'best',evaluation:a.best.evaluation,mateIn:a.best.mateIn,parts:a.bestParts||[],best:null,bestParts:[],line:a.best.line||[alt.uci],curated:a.best.curated,ready:true};
      alt.analysisView=view;
    }
    go(alt,{sound:true});
  }
  /* Follow-up: play out the engine's line from here, one move at a time. */
  function showFollowUp(){
    const a=analysisOf(cur);const line=isPos()?(cur.search?.pv||[]).slice(0,8):(a?.line||[]).slice(1,9);if(!line.length)return;
    stopAll();let item=cur;const chain=[];
    for(const uci of line){try{item=child(item,uci);chain.push(item);}catch{break;}}
    if(!chain.length)return;
    let index=0;go(chain[index++],{sound:true});
    followTimer=setInterval(()=>{if(index>=chain.length||cur!==chain[index-1]){stopFollow();return;}go(chain[index++],{sound:true});},Math.max(650,AUTOPLAY[settings.autoplaySpeed]*.8));
  }
  function stopFollow(){if(followTimer){clearInterval(followTimer);followTimer=null;}}
  function setPlayIcon(playing){$('play').querySelector('path').setAttribute('d',playing?'M5 4h5v16H5zm9 0h5v16h-5z':'M7 4v16l13-8z');}
  function stopPlay(){if(playTimer){clearInterval(playTimer);playTimer=null;}setPlayIcon(false);}

  /* ---------- pointer: click, drag, arrows ---------- */
  function squareAt(event){const rect=$('board').getBoundingClientRect(),x=Math.floor((event.clientX-rect.left)/rect.width*8),y=Math.floor((event.clientY-rect.top)/rect.height*8);if(x<0||x>7||y<0||y>7)return null;return String.fromCharCode(97+(flipped?7-x:x))+(flipped?y+1:8-y);}
  function canMove(square){try{const chess=new Chess(cur.fen),piece=chess.get(square);return !!piece&&piece.color===chess.turn();}catch{return false;}}
  function isLegal(from,to){try{return new Chess(cur.fen).moves({square:from,verbose:true}).some(m=>m.to===to);}catch{return false;}}
  function setHover(square){
    for(const cell of $('board').querySelectorAll('.hover-square'))cell.classList.remove('hover-square');
    if(square)$('board').querySelector(`.square[data-square="${square}"]`)?.classList.add('hover-square');
  }
  function boardPointerDown(event){
    if(!record||promotion)return;
    const square=squareAt(event);if(!square)return;
    event.preventDefault();
    if(event.button===2){pointer={...(pointer||{}),arrowFrom:square};$('board').setPointerCapture(event.pointerId);return;}
    if(event.button!==0)return;
    if(manualArrows.get(cur.fen)?.length){manualArrows.delete(cur.fen);}
    const selected=pointer?.selected;
    if(selected&&selected!==square&&isLegal(selected,square)){pointer=null;play(selected,square);return;}
    if(canMove(square)){
      $('board').setPointerCapture(event.pointerId);
      drag={from:square,x:event.clientX,y:event.clientY,moved:false,ghost:null,wasSelected:selected===square,pointerId:event.pointerId};
      pointer={selected:square};drawBoard();
    }else{pointer=null;drawBoard();}
  }
  function startGhost(event){
    const source=$('board').querySelector(`.piece[data-square="${drag.from}"]`);if(!source)return;
    const rect=$('board').getBoundingClientRect(),size=rect.width/8,ghost=source.cloneNode();
    ghost.className='drag-ghost';Object.assign(ghost.style,{width:size+'px',height:size+'px',left:'0',top:'0'});
    document.body.append(ghost);drag.ghost=ghost;drag.size=size;source.classList.add('dragging-source');moveGhost(event);
  }
  function moveGhost(event){if(drag?.ghost)drag.ghost.style.transform=`translate(${event.clientX-drag.size/2}px,${event.clientY-drag.size/2}px)`;}
  function boardPointerMove(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>4){drag.moved=true;startGhost(event);}
    if(drag.moved){moveGhost(event);setHover(squareAt(event));}
  }
  function endDrag(){drag?.ghost?.remove();const was=drag;drag=null;setHover(null);return was;}
  function boardPointerUp(event){
    if(!record)return;
    if(pointer?.arrowFrom&&event.button===2){
      const to=squareAt(event),from=pointer.arrowFrom;delete pointer.arrowFrom;
      if(to&&from!==to){const list=manualArrows.get(cur.fen)||[],arrow=from+to;manualArrows.set(cur.fen,list.includes(arrow)?list.filter(item=>item!==arrow):[...list,arrow]);}
      drawBoard();return;
    }
    const was=endDrag();if(!was)return;
    const to=squareAt(event);
    if(was.moved){
      if(to&&to!==was.from&&isLegal(was.from,to)){pointer=null;play(was.from,to,undefined,{dragged:true});return;}
      pointer={selected:was.from};drawBoard();return;
    }
    if(was.wasSelected){pointer=null;drawBoard();}
  }
  function boardPointerCancel(){if(endDrag()){drawBoard();}}
  /* Promotion picker */
  function askPromotion(from,to,color,dragged){
    cancelPromotion();
    const picker=node('div',null,'promotion-picker'),[x,y]=PixelReviewBoard.coordinates(to,flipped);
    picker.style.left=x*12.5+'%';const downward=y===0;picker.style.top=downward?'0':'50%';picker.classList.toggle('upward',!downward);
    const set=pieceTheme();
    for(const type of ['q','n','r','b']){
      const button=node('button',null,'promotion-choice');button.type='button';button.setAttribute('aria-label','Promote to '+{q:'queen',n:'knight',r:'rook',b:'bishop'}[type]);
      const img=node('img');img.src=set['piece-set-'+color+type]||`assets/theme/${color}${type}.png`;img.alt='';button.append(img);
      button.onclick=event=>{event.stopPropagation();cancelPromotion();play(from,to,type,{dragged});};
      picker.append(button);
    }
    const close=node('button','×','promotion-cancel');close.type='button';close.setAttribute('aria-label','Cancel promotion');close.onclick=event=>{event.stopPropagation();cancelPromotion();drawBoard();};picker.append(close);
    promotion={picker};$('board').parentElement.append(picker);
    const rect=$('board').getBoundingClientRect(),wrap=$('board').parentElement.getBoundingClientRect();
    picker.style.left=(rect.left-wrap.left+x*rect.width/8)+'px';picker.style.width=rect.width/8+'px';
    picker.style.top=(downward?rect.top-wrap.top:rect.top-wrap.top+rect.height/2)+'px';
    picker.querySelector('button').focus();
  }
  function cancelPromotion(){promotion?.picker.remove();promotion=null;}

  /* ---------- review display ---------- */
  function renderAll(){if(!record)return;renderPlayers();renderMoves();renderCoach();drawBoard();drawGraph($('overview-graph'),false);drawGraph($('graph'),true);$('overview-message').textContent=overviewMessage();tallyRows();renderOverviewPerspective();}
  function display(value,{keepPosition=false}={}){
    const same=record===value;
    if(record&&!same){branchEngine?.destroy();branchEngine=null;branchView=null;}
    if(!value.game.clocks?.length)value.game.clocks=PixelLocalReview.clockTimeline(value.game.pgn,value.game.moves.length,value.game.headers.TimeControl);
    record=value;
    if(!same||!keepPosition){buildTree();manualArrows=new Map();explainingId=null;showView('overview');view=resolveView();flipped=view==='black';renderer.reset();}
    $('review').hidden=false;$('import-panel').hidden=true;
    if(isPos()&&(!same||!keepPosition)){flipped=view==='black'||(view==='neutral'&&value.game.startFen.split(' ')[1]==='b');showView('moves');}
    for(const color of ['white','black']){const accuracy=value.analysis.CAPS?.[color]?.all;$(color+'-accuracy').textContent=Number.isFinite(accuracy)?accuracy.toFixed(1):'—';}
    $('white-rating').textContent=gameRating('white');$('black-rating').textContent=gameRating('black');
    $('game-result').textContent=value.game.headers.Result==='*'?'':`Result: ${value.game.headers.Result}`+(viewData()?.opening?` · ${viewData().opening}`:'');
    renderAll();
    if(isPos()){if(!same){status('');}ensureAnalysis(cur);if(cur!==root)ensureAnalysis(root);return;}
    if(!same){
      status(value.cacheWarning||'',!!value.cacheWarning);
      if(!viewData())loadViewData();
      void PixelReviewAvatars.load(value).then(async players=>{if(record!==value)return;value.game.players=players;renderPlayers();const key=PixelLocalReview.key(value.id),saved=(await chrome.storage.local.get(key))[key];if(saved?.savedAt===value.savedAt)await chrome.storage.local.set({[key]:{...saved,game:{...saved.game,players}}});}).catch(()=>{});
    }
  }

  /* ---------- import ---------- */
  const pathId=value=>String(value||'').split(/[?#]/)[0].replace(/\/+$/,'').split('/').pop();
  async function gameCallback(id,kinds){
    let response,last;
    for(const kind of kinds){
      const attempt=await fetch(`https://www.chess.com/callback/${kind}/game/${id}`,{credentials:'include'});
      if(attempt.ok||attempt.status===401||attempt.status===403){response=attempt;break;}
      last=attempt;
    }
    if(!response||!response.ok)throw Error(`Chess.com blocked this game link (HTTP ${(response||last).status}). Download its PGN on Chess.com and paste it here.`);
    return response.json();
  }
  async function pgnFromLink(raw){
    const text=String(raw).trim();
    let url;try{url=new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text)?text:'https://'+text);}catch{throw Error('Enter a valid Chess.com game link.');}
    if(!/(^|\.)chess\.com$/.test(url.hostname))throw Error('Enter a Chess.com game link.');
    const match=url.pathname.match(/\/(?:analysis\/game|game)\/(?:(live|daily)\/)?(\d+)/);
    if(!match)throw Error('This link does not contain a Chess.com game ID.');
    const [,kind,id]=match;
    const info=await gameCallback(id,kind?[kind]:['live','daily']),game=info.game;
    if(!game?.isFinished)throw Error('That game has not finished yet.');
    const username=info.players?.bottom?.color==='white'?info.players.bottom.username:info.players?.top?.username;
    if(!username)throw Error('Could not find this game’s player archive. Paste its PGN instead.');
    const date=new Date((game.endTime||Date.now()/1000)*1000),year=date.getUTCFullYear(),month=String(date.getUTCMonth()+1).padStart(2,'0');
    const archive=await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/${year}/${month}`,{credentials:'omit'});
    if(!archive.ok)throw Error('The public game archive is unavailable. Paste the game PGN instead.');
    const data=await archive.json(),item=data.games?.find(entry=>pathId(entry.url)===id);
    if(!item?.pgn)throw Error('This game is not in the public archive yet. Paste its PGN instead.');
    const players={};
    for(const player of Object.values(info.players||{})){
      if(!['white','black'].includes(player?.color)||!player.username)continue;
      players[player.color]={username:player.username,avatar:PixelReviewAvatars.photoUrl(player.avatarUrl),
        countryCode:PixelCountryCodes[String(player.countryId)]?.toUpperCase()||null,
        flair:PixelReviewAvatars.photoUrl(player.flair?.images?.svg)};
    }
    return {id,pgn:item.pgn,players};
  }
  function viewForInput(input){
    if(settings.perspective!=='auto')return settings.perspective;
    const me=(settings.username||account||'').toLowerCase();if(!me)return 'neutral';
    let headers={};try{const chess=new Chess();if(input.pgn)chess.loadPgn(input.pgn);headers={...chess.getHeaders(),...(input.headers||{})};}catch{}
    if(String(headers.White||input.players?.white?.username||'').toLowerCase()===me)return 'white';
    if(String(headers.Black||input.players?.black?.username||'').toLowerCase()===me)return 'black';
    return 'neutral';
  }
  async function analyze(input,id){
    const token=++run;busy(true);status('Preparing the local engine…');
    try{
      const actual=id||'import-'+crypto.randomUUID();
      const value=await service.review(actual,{input,view:viewForInput(input),onProgress:progress=>{if(token!==run)return;$('busy').querySelector('progress').value=progress;status(`Analyzing moves on your device… ${progress}%`);}});
      if(token!==run)return;gameId=actual;history.replaceState(null,'','?game='+encodeURIComponent(actual));display(value);
    }catch(error){if(token===run){status(error.message,true);$('import-panel').hidden=false;}}
    finally{if(token===run)busy(false);}
  }
  function openPosition(text){
    try{
      const game=PixelLocalReview.normalizePosition(Chess,text);
      if(record)record=null;posSearches=new Map();
      const value={version:2,id:'position-'+crypto.randomUUID(),savedAt:Date.now(),game,analysis:{moveAnalyses:[],rich:[],views:{},CAPS:{},reportCard:{},tallies:{}}};
      history.replaceState(null,'',location.pathname);status('');display(value);
    }catch(error){status('Could not read that position: '+error.message,true);}
  }
  async function importGame(){
    const link=$('game-link').value.trim(),pgn=$('pgn').value.trim();
    if(!link&&PixelLocalReview.isPositionInput(pgn)){openPosition(pgn);return;}
    try{
      if(link){busy(true);status('Finding that game in the public archive…');const found=await pgnFromLink(link);busy(false);return analyze({pgn:found.pgn,players:found.players},found.id);}
      if(!pgn)throw Error('Paste a game link or PGN first.');return analyze({pgn});
    }catch(error){busy(false);status(error.message,true);}
  }

  /* ---------- wiring ---------- */
  const dialog=S.createDialog({host:document.body,getValues:()=>settings,onChange:(key,value)=>{void changeSetting(key,value);},
    onReset:()=>{const keepName=settings.username;settings={...S.DEFAULTS,username:keepName};void S.save(chrome.storage.local,settings).then(()=>{soundOn=settings.sounds;syncSoundButton();updateView();applyTheme();});},
    detectedUsername:()=>account});
  $('analyze').onclick=importGame;$('game-link').onkeydown=event=>{if(event.key==='Enter')importGame();};
  $('pgn-file').onchange=async()=>{const file=$('pgn-file').files[0];if(!file)return;if(file.size>500000){status('Choose a PGN smaller than 500 KB.',true);return;}$('pgn').value=await file.text();};
  $('cancel').onclick=()=>{++run;service.cancel();busy(false);status('Review cancelled. You can try again.');$('import-panel').hidden=false;};
  $('start-review').onclick=()=>{showView('moves');go(main[1]||root);};
  $('back-overview').onclick=()=>{stopAll();explainingId=null;showView('overview');renderCoach();drawBoard();};
  $('next').onclick=()=>{stopAll();const nextItem=main[mainAncestor(cur).ply+1];if(nextItem)go(nextItem,{sound:true});};
  $('forward').onclick=()=>{stopAll();forward();};$('previous').onclick=()=>{stopAll();back();};
  $('first').onclick=()=>{stopAll();go(root);};$('last').onclick=()=>{stopAll();go(lineEnd(cur));};
  $('resume').onclick=resume;$('best').onclick=showBest;$('follow').onclick=showFollowUp;
  $('explain').onclick=()=>{if(!record||cur===root)return;explainingId=cur.id;explanationStep=0;renderCoach();drawBoard();};
  $('got-it').onclick=()=>{explainingId=null;explanationStep=0;renderCoach();drawBoard();};
  $('explain-back').onclick=()=>{explanationStep=Math.max(0,explanationStep-1);renderCoach();drawBoard();};
  $('explain-forward').onclick=()=>{const count=currentIdeas()?.length||1;explanationStep=Math.min(count-1,explanationStep+1);renderCoach();drawBoard();};
  const flipBoard=()=>{flipped=!flipped;renderer.reset();renderPlayers();drawBoard();};
  $('flip').onclick=flipBoard;$('flip-top').onclick=flipBoard;$('settings-open').onclick=()=>dialog.open();
  $('new-game').onclick=()=>{stopAll();$('review').hidden=true;$('import-panel').hidden=false;status('');$('game-link').focus();};
  $('download').onclick=()=>{if(!record)return;const blob=new Blob([record.game.pgn],{type:'application/x-chess-pgn'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='pixel-game-review.pgn';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('play').onclick=()=>{if(playTimer){stopPlay();return;}if(!record)return;stopFollow();if(!(cur.next||cur.children[0]))go(cur.main?root:mainAncestor(cur));setPlayIcon(true);
    playTimer=setInterval(()=>{const nextItem=cur.next||cur.children[0];if(!nextItem){stopPlay();return;}go(nextItem,{sound:true});},AUTOPLAY[settings.autoplaySpeed]);};
  $('voice-toggle').onclick=()=>{void changeSetting('sounds',!soundOn);};
  for(const id of ['overview-coach-name','move-coach-name'])$(id).onclick=()=>showCoachMenu($('coach-menu').hidden);
  $('close-coach-menu').onclick=()=>showCoachMenu(false);
  document.addEventListener('pointerdown',event=>{
    if(!$('coach-menu').hidden&&!event.target.closest('#coach-menu, .coach-name'))showCoachMenu(false);
    if(promotion&&!event.target.closest('.promotion-picker')){cancelPromotion();drawBoard();}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('coach-menu').hidden){showCoachMenu(false);$(pageView==='overview'?'overview-coach-name':'move-coach-name').focus();}else if(promotion){cancelPromotion();drawBoard();}}});
  const board=$('board');
  board.addEventListener('pointerdown',boardPointerDown);board.addEventListener('pointermove',boardPointerMove);board.addEventListener('pointerup',boardPointerUp);
  board.addEventListener('pointercancel',boardPointerCancel);board.addEventListener('lostpointercapture',()=>{if(drag){boardPointerCancel();}});
  board.addEventListener('contextmenu',event=>event.preventDefault());
  for(const id of ['graph','overview-graph'])$(id).onclick=event=>{if(!record)return;stopAll();const rect=event.currentTarget.getBoundingClientRect();go(main[Math.max(0,Math.min(main.length-1,Math.round((event.clientX-rect.left)/rect.width*record.game.moves.length)))]);};
  document.addEventListener('keydown',event=>{
    if(/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)||!record||dialog.isOpen()||$('review').hidden)return;
    const actions={ArrowLeft:back,ArrowRight:forward,ArrowUp:()=>go(root),ArrowDown:()=>go(lineEnd(cur)),Home:()=>go(root),End:()=>go(lineEnd(cur))};
    if(actions[event.key]){event.preventDefault();stopAll();actions[event.key]();}
  });
  window.addEventListener('resize',()=>{if(promotion){cancelPromotion();drawBoard();}});
  addEventListener('pagehide',()=>{stopAll();service.cancel();branchEngine?.destroy();posEngine?.then(engine=>engine.destroy()).catch(()=>{});});
  chrome.storage.onChanged?.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes['pixel.review.theme']){loadTheme(changes['pixel.review.theme'].newValue);applyTheme();if(record){renderPlayers();renderMoves();drawBoard();}}
    if(changes['pixel.review.account']){account=String(changes['pixel.review.account'].newValue?.username||'');if(settings.perspective==='auto'&&!settings.username)updateView();dialog.sync();}
  });
  function loadTheme(userTheme){
    theme={};
    for(const piece of PIECES)theme['piece-set-'+piece]='assets/theme/'+piece+'.png';
    for(const [key,value] of Object.entries(userTheme||{})){
      if(typeof value!=='string')continue;
      if(/color/.test(key)?/^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$/i.test(value):safeUrl(value))theme[key]=value;
    }
  }
  (async()=>{
    try{
      buildCoachMenu();
      const saved=await chrome.storage.local.get(['pixel.review.theme','pixel.review.coach','pixel.review.account']);
      settings=await S.load(chrome.storage.local);soundOn=settings.sounds;syncSoundButton();
      account=String(saved['pixel.review.account']?.username||'');
      loadTheme(saved['pixel.review.theme']);setCoach(saved['pixel.review.coach']||'david');applyTheme();
      if(!gameId){$('import-panel').hidden=false;status('Paste a PGN or Chess.com game link to start.');return;}
      status('Loading the saved review…');
      try{
        const cached=await service.read(gameId);if(cached){status('');display(cached);return;}
        const pending=(await chrome.storage.local.get('pixel.review.pending'))['pixel.review.pending'];
        if(pending?.id===gameId&&Date.now()-pending.savedAt<600000){await chrome.storage.local.remove('pixel.review.pending');await analyze(pending.game,gameId);return;}
        $('import-panel').hidden=false;status('Paste the game PGN or Chess.com link to analyze it.');
      }catch(error){$('import-panel').hidden=false;status(error.message,true);}
    }catch(error){$('review').hidden=true;$('import-panel').hidden=false;status(`Could not start the review: ${error.message}`,true);}
  })();
})();
