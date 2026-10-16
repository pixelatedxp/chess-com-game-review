(function(root){
  'use strict';
  function position(fen){
    const pieces={}; let index=0;
    for(const char of fen.split(' ')[0]){
      if(char==='/')continue;
      if(/\d/.test(char)){index+=Number(char);continue;}
      pieces[String.fromCharCode(97+index%8)+(8-Math.floor(index/8))]=(char===char.toUpperCase()?'w':'b')+char.toLowerCase();index++;
    }
    return pieces;
  }
  function coordinates(square,flipped=false){const x=square.charCodeAt(0)-97,y=8-Number(square[1]);return flipped?[7-x,7-y]:[x,y];}
  const HIGHLIGHT={brilliant:'#5bd6bd',great:'#9dc5e2',best:'#a6d36d',excellent:'#a6d36d',good:'#a9c773',book:'#f1d777',inaccuracy:'#f5dc75',mistake:'#f4ad72',miss:'#f0857f',blunder:'#ed8075'};
  // Classification icons available as images.
  const BADGES=new Set(['brilliant','great','best','excellent','good','book','inaccuracy','mistake','miss','blunder']);
  function createRenderer(board){
    let previous=null,previousFlipped=false;
    const svg=(tag,attributes)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);return node;};
    const element=(tag,className)=>{const node=document.createElement(tag);node.className=className;return node;};
    // Pair every piece with where it was before, so forward, backward and jumps all animate.
    function origins(before,after,uci){
      const result=new Map(),freed=Object.entries(before).filter(([square,piece])=>after[square]!==piece);
      const used=new Set();
      if(uci&&after[uci.slice(2,4)]){const from=uci.slice(0,2);if(before[from]&&!used.has(from)){result.set(uci.slice(2,4),from);used.add(from);}}
      for(const [square,piece] of Object.entries(after)){
        if(before[square]===piece||result.has(square))continue;
        const [x,y]=coordinates(square);let best=null,bestDistance=99;
        for(const [from,old] of freed){
          if(old!==piece||used.has(from))continue;const [fx,fy]=coordinates(from),distance=Math.max(Math.abs(fx-x),Math.abs(fy-y));
          if(distance<bestDistance){best=from;bestDistance=distance;}
        }
        if(best){result.set(square,best);used.add(best);}
      }
      return result;
    }
    function draw({fen,uci='',classification='',flipped=false,theme={},arrows=[],manualArrows=[],selectedSquare='',label='',
      coordinates:showCoordinates=true,highlight=true,animate=180,badges=true,legal=[],hidePiece='',hoverSquare='',squares=[],check='',skipAnimationFor=''}){
      const bounds=board.getBoundingClientRect(),current=position(fen);
      board.style.setProperty('--move-highlight',HIGHLIGHT[classification]||'#f1d777');
      const moved=previous&&previousFlipped===flipped&&animate>0&&!matchMedia('(prefers-reduced-motion: reduce)').matches?origins(previous,current,uci):new Map();
      board.replaceChildren();
      const legalBySquare=new Map(legal.map(item=>[item.square,item]));
      for(let screen=0;screen<64;screen++){
        const index=flipped?63-screen:screen,rank=8-Math.floor(index/8),file=String.fromCharCode(97+index%8),square=file+rank;
        const cell=element('div','square'+((Math.floor(index/8)+index%8)%2?' dark':'')); cell.dataset.square=square;
        if(highlight&&uci&&(square===uci.slice(0,2)||square===uci.slice(2,4)))cell.classList.add('highlight');
        if(square===selectedSquare)cell.classList.add('selected-square');
        if(square===hoverSquare)cell.classList.add('hover-square');
        if(squares.includes(square))cell.classList.add('coach-square');
        if(square===check)cell.classList.add('check-square');
        if(showCoordinates&&screen%8===0){const coord=element('span','coordinate');coord.textContent=rank;cell.append(coord);}
        if(showCoordinates&&screen>=56){const coord=element('span','coordinate file-coordinate');coord.textContent=file;cell.append(coord);}
        const target=legalBySquare.get(square);
        if(target)cell.append(element('span',target.capture?'legal-capture':'legal-dot'));
        board.append(cell);
      }
      for(const [square,piece] of Object.entries(current)){
        const [x,y]=coordinates(square,flipped),img=element('img','piece');
        img.src=theme['piece-set-'+piece]||'assets/theme/'+piece+'.png';img.alt='';img.draggable=false;img.dataset.square=square;img.dataset.piece=piece;
        img.onerror=()=>{img.onerror=null;img.src='assets/theme/'+piece+'.png';};
        img.style.left=x*12.5+'%';img.style.top=y*12.5+'%';
        if(square===hidePiece)img.classList.add('dragging-source');
        board.append(img);
        const from=moved.get(square);
        if(from&&square!==skipAnimationFor){
          const [fx,fy]=coordinates(from,flipped),dx=(fx-x)*bounds.width/8,dy=(fy-y)*bounds.height/8;
          if(Math.abs(dx)+Math.abs(dy)>2)img.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:animate,easing:'ease-out'});
        }
      }
      if(badges&&uci&&BADGES.has(classification)){const [x,y]=coordinates(uci.slice(2,4),flipped),badge=element('img','board-badge');badge.src='../icons/cls-'+classification+'.png';badge.alt=classification;badge.style.left=(x===7?97.5:(x+1)*12.5)+'%';badge.style.top=y*12.5+'%';board.append(badge);}
      const all=[...arrows.map(uci=>({uci,color:'#f5b93e'})),...manualArrows.map(uci=>({uci,color:'#6cc9e8'}))].filter(item=>/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(item.uci));
      if(all.length){
        const layer=svg('svg',{viewBox:'0 0 800 800',class:'board-arrows','aria-hidden':'true'});
        for(const {uci:arrow,color} of all){
          const [fx,fy]=coordinates(arrow.slice(0,2),flipped),[tx,ty]=coordinates(arrow.slice(2,4),flipped);
          const start={x:fx*100+50,y:fy*100+50},end={x:tx*100+50,y:ty*100+50};
          const knight=Math.abs(fx-tx)*Math.abs(fy-ty)===2;
          const corner=knight?(Math.abs(fx-tx)===1?{x:start.x,y:end.y}:{x:end.x,y:start.y}):null;
          const previousPoint=corner||start,dx=end.x-previousPoint.x,dy=end.y-previousPoint.y,length=Math.hypot(dx,dy)||1;
          const ux=dx/length,uy=dy/length,tip={x:end.x-ux*10,y:end.y-uy*10},base={x:tip.x-ux*47,y:tip.y-uy*47};
          const path=svg('path',{d:`M ${start.x} ${start.y} ${corner?`L ${corner.x} ${corner.y} `:''}L ${base.x} ${base.y}`,fill:'none',stroke:color,'stroke-width':21,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.82});
          const head=svg('polygon',{points:`${tip.x},${tip.y} ${base.x-uy*29},${base.y+ux*29} ${base.x+uy*29},${base.y-ux*29}`,fill:color,opacity:.9});
          layer.append(path,head);
        }
        board.append(layer);
      }
      board.setAttribute('aria-label',label||'Chess position');previous=current;previousFlipped=flipped;
    }
    return {draw,reset(){previous=null;}};
  }
  // Captured pieces and material balance, derived from a FEN.
  const START={p:8,n:2,b:2,r:2,q:1},VALUES={p:1,n:3,b:3,r:5,q:9};
  function material(fen){
    const counts={w:{p:0,n:0,b:0,r:0,q:0},b:{p:0,n:0,b:0,r:0,q:0}};
    for(const piece of Object.values(position(fen)))if(piece[1]!=='k')counts[piece[0]][piece[1]]++;
    const missing={};
    for(const color of ['w','b']){
      const c=counts[color],promoted=['n','b','r','q'].reduce((n,t)=>n+Math.max(0,c[t]-START[t]),0);
      missing[color]={p:Math.max(0,START.p-c.p-promoted)};
      for(const t of ['n','b','r','q'])missing[color][t]=Math.max(0,START[t]-c[t]);
    }
    const points=color=>Object.entries(counts[color]).reduce((n,[t,k])=>n+VALUES[t]*k,0);
    return {captured:{w:missing.b,b:missing.w},advantage:points('w')-points('b')};
  }
  root.PixelReviewBoard={position,coordinates,createRenderer,material};
  if(typeof module==='object')module.exports=root.PixelReviewBoard;
})(globalThis);
