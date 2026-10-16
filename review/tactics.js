/* Position-checked chess explanations.
   Every claim made here is verified on the board (and, where it matters, along the
   engine's follow-up line). When nothing can be verified, callers fall back to the
   engine's own speech or to an evaluation-based sentence. */
(function(root){
  'use strict';
  const VALUE={p:1,n:3,b:3,r:5,q:9,k:0};
  const NAME={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};
  const FILES='abcdefgh';
  const other=color=>color==='w'?'b':'w';
  const sq=(f,r)=>f>=0&&f<8&&r>=0&&r<8?FILES[f]+(r+1):null;
  const fr=s=>[s.charCodeAt(0)-97,Number(s[1])-1];
  const ROOK_DIRS=[[1,0],[-1,0],[0,1],[0,-1]],BISHOP_DIRS=[[1,1],[1,-1],[-1,1],[-1,-1]];
  const KNIGHT=[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
  const KING=[...ROOK_DIRS,...BISHOP_DIRS];
  const dirsFor=type=>type==='r'?ROOK_DIRS:type==='b'?BISHOP_DIRS:type==='q'?KING:[];
  const isUci=value=>typeof value==='string'&&/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value);

  function make(Chess,fen){try{return new Chess(fen);}catch{return null;}}
  function play(chess,uci){
    if(!isUci(uci))return null;
    try{return chess.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'});}catch{return null;}
  }
  function pieceAt(chess,square){const p=square?chess.get(square):null;return p?{...p,square}:null;}
  function material(chess){
    const total={w:0,b:0};
    for(const row of chess.board())for(const p of row)if(p)total[p.color]+=VALUE[p.type];
    return total;
  }
  // Squares attacked by the piece on `from` (pseudo-legal, like chess.js attackers()).
  function attacksFrom(chess,from){
    const piece=pieceAt(chess,from);if(!piece)return [];
    const [f,r]=fr(from),out=[];
    if(piece.type==='p'){const d=piece.color==='w'?1:-1;for(const df of [-1,1]){const s=sq(f+df,r+d);if(s)out.push(s);}return out;}
    if(piece.type==='n'||piece.type==='k'){for(const [df,dr] of piece.type==='n'?KNIGHT:KING){const s=sq(f+df,r+dr);if(s)out.push(s);}return out;}
    for(const [df,dr] of dirsFor(piece.type)){
      for(let k=1;k<8;k++){const s=sq(f+df*k,r+dr*k);if(!s)break;out.push(s);if(pieceAt(chess,s))break;}
    }
    return out;
  }
  const defenders=(chess,square,color)=>{try{return chess.attackers(square,color);}catch{return [];}};
  const cheapest=(chess,squares)=>Math.min(...squares.map(s=>VALUE[pieceAt(chess,s)?.type]??99));
  // Pieces of `victim` colour that `attacker` colour can win: undefended, or attacked by something cheaper.
  function threats(chess,attacker){
    const victim=other(attacker),out=[];
    for(const row of chess.board())for(const p of row){
      if(!p||p.color!==victim||p.type==='k')continue;
      const atk=defenders(chess,p.square,attacker);if(!atk.length)continue;
      const def=defenders(chess,p.square,victim),low=cheapest(chess,atk);
      if(!def.length||low<VALUE[p.type])out.push({square:p.square,type:p.type,value:VALUE[p.type],by:atk.sort((a,b)=>VALUE[pieceAt(chess,a).type]-VALUE[pieceAt(chess,b).type])[0]});
    }
    return out.sort((a,b)=>b.value-a.value);
  }
  // Walk a follow-up line and report how material changed for `color`. A line that
  // stops in the middle of an exchange is scored as if the recapture happens.
  function lineOutcome(Chess,fen,line,color,maxPlies=24){
    const chess=make(Chess,fen);if(!chess)return null;
    const start=material(chess),sans=[],moves=[];let mate=false;
    for(const uci of (line||[]).slice(0,maxPlies)){const move=play(chess,uci);if(!move)break;sans.push(move.san);moves.push(move);if(chess.isCheckmate()){mate=true;break;}}
    const end=material(chess);let gain=(end[color]-start[color])-(end[other(color)]-start[other(color)]);
    const lost={w:[],b:[]};for(const m of moves)if(m.captured)lost[m.color==='w'?'b':'w'].push(m.captured);
    const last=moves.at(-1);
    if(last&&last.captured&&!mate){
      // The line stopped right after a capture: count the capturer as lost only if the
      // reply can actually win it (undefended, or attacked by something cheaper).
      const piece=pieceAt(chess,last.to),value=VALUE[piece?.type]||0,hits=defenders(chess,last.to,chess.turn());
      if(hits.length&&(!defenders(chess,last.to,last.color).length||cheapest(chess,hits)<value)){
        const net=defenders(chess,last.to,last.color).length?value-cheapest(chess,hits):value;
        gain+=last.color===color?-net:net;if(net>=value)lost[last.color].push(piece?.type);
      }
    }
    return {gain,mate,sans,moves,lost,fen:chess.fen(),matedColor:mate?chess.turn():null};
  }
  const article=t=>t==='q'?'the queen':t==='p'?'a pawn':'a '+NAME[t];
  function itemList(types){
    const counts={};for(const t of types)counts[t]=(counts[t]||0)+1;
    return listing(Object.entries(counts).sort((a,b)=>VALUE[b[0]]-VALUE[a[0]]).map(([t,n])=>n===1?article(t):`${n===2?'two':n} ${NAME[t]}s`));
  }
  function describeGain(outcome,color){
    if(!outcome||outcome.gain<1)return null;
    const won=[...outcome.lost[other(color)]].filter(Boolean),gave=[...outcome.lost[color]].filter(Boolean);
    for(const t of [...gave]){const i=won.indexOf(t);if(i>=0){won.splice(i,1);gave.splice(gave.indexOf(t),1);}}
    if(!won.length)return {text:`material (+${outcome.gain})`,value:outcome.gain};
    if(won.length===1&&gave.length===1&&won[0]==='r'&&['n','b'].includes(gave[0]))return {text:'the exchange (a rook for a minor piece)',value:outcome.gain};
    return {text:itemList(won)+(gave.length?` for ${itemList(gave)}`:''),value:outcome.gain};
  }
  function numbered(fen,sans,limit=6){
    const parts=fen.split(' '),white=parts[1]==='w';let number=Number(parts[5])||1;const out=[];
    sans.slice(0,limit).forEach((san,i)=>{const isWhite=white?i%2===0:i%2===1;if(isWhite)out.push(`${number}.${san}`);else{out.push(i===0?`${number}…${san}`:san);number++;}});
    return out.join(' ')+(sans.length>limit?' …':'');
  }
  const label=(type,square)=>`the ${NAME[type]} on ${square}`;
  const listing=items=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+' and '+items.at(-1);

  /* Inspect one move. Returns verified facts, strongest first. */
  function motifs(Chess,fen,uci,{line=null,curated=true}={}){
    const before=make(Chess,fen);if(!before)return [];
    const color=before.turn(),enemy=other(color),after=make(Chess,fen),move=play(after,uci);
    if(!move)return [];
    const facts=[],to=move.to,moved=pieceAt(after,to),movedValue=VALUE[moved.type];
    const outcome=lineOutcome(Chess,fen,line&&line[0]===uci?line:[uci,...(line||[])],color);
    const gain=describeGain(outcome,color);
    if(after.isCheckmate()){facts.push({kind:'mate',strength:10,text:'This is checkmate: the king is in check and has no legal way out.',arrows:[uci]});return facts;}
    if(curated&&outcome?.mate&&outcome.matedColor===enemy)facts.push({kind:'forced-mate',strength:9,text:`This starts a forced checkmate: ${numbered(fen,outcome.sans)}.`,arrows:outcome.moves.slice(0,2).map(m=>m.from+m.to)});
    // Mate threat parried: could the opponent mate in one if it were their turn?
    if(!before.inCheck()){
      const mateThreat=mateInOne(Chess,fen,enemy);
      if(mateThreat&&!mateInOne(Chess,after.fen(),enemy))facts.push({kind:'stops-mate',strength:8,text:`This stops the threat of ${mateThreat.san}, which would have been checkmate.`,arrows:[mateThreat.from+mateThreat.to]});
    }
    // Capturing something that was free or worth more than the capturer.
    if(move.captured){
      const recapture=defenders(after,to,enemy).length>0,capValue=VALUE[move.captured];
      if(!recapture&&capValue>=1)facts.push({kind:'free-capture',strength:capValue>=3?7:4,text:`This takes ${label(move.captured,to)}, which had no defender.`,arrows:[uci]});
      else if(capValue>VALUE[move.piece]&&gain)facts.push({kind:'winning-capture',strength:6,text:`This captures ${label(move.captured,to)} with a less valuable ${NAME[move.piece]}, so even after the recapture ${capValue-VALUE[move.piece]>=2?'it comes out ahead':'it gains material'}.`,arrows:[uci]});
    }
    // Forks: the moved piece attacks two or more targets that cannot all be saved.
    const targets=attacksFrom(after,to).map(s=>pieceAt(after,s)).filter(p=>p&&p.color===enemy)
      .filter(p=>p.type==='k'||VALUE[p.type]>movedValue||(!defenders(after,p.square,enemy).length&&VALUE[p.type]>=3));
    if(targets.length>=2&&(!outcome||outcome.gain>=0)){
      const names=targets.sort((a,b)=>(b.type==='k'?99:VALUE[b.type])-(a.type==='k'?99:VALUE[a.type])).map(p=>p.type==='k'?'the king':label(p.type,p.square));
      const fork=moved.type==='n'?'knight fork':moved.type==='p'?'pawn fork':'double attack';
      facts.push({kind:'fork',strength:gain?8:5,text:`This creates a ${fork}, attacking ${listing(names)} at the same time${gain?(targets[0].type==='k'?` — the king has to step away, and ${gain.text} is lost`:` — both cannot be saved, so it wins ${gain.text}`):''}.`,arrows:targets.map(p=>to+p.square)});
    }
    // A single direct attack on something valuable.
    if(!facts.some(f=>f.kind==='fork')&&!after.isCheckmate()){
      const hit=attacksFrom(after,to).map(s=>pieceAt(after,s)).filter(p=>p&&p.color===enemy&&p.type!=='k'&&VALUE[p.type]>=3&&(VALUE[p.type]>movedValue||!defenders(after,p.square,enemy).length))
        .sort((a,b)=>VALUE[b.type]-VALUE[a.type])[0];
      const enemyHits=defenders(after,to,enemy),safe=!enemyHits.length||(defenders(after,to,color).length&&cheapest(after,enemyHits)>=movedValue);
      const lostIt=hit&&outcome?.lost[enemy]?.includes(hit.type)&&gain;
      if(hit&&(safe||lostIt)){
        facts.push({kind:'threat',strength:lostIt?6:3,text:`It attacks ${label(hit.type,hit.square)}${lostIt?', and that piece cannot be saved':''}.`,arrows:[to+hit.square]});
      }
    }
    // Discovered attacks: a line piece behind the moved piece now hits something.
    for(const row of after.board())for(const p of row){
      if(!p||p.color!==color||!['b','r','q'].includes(p.type)||p.square===to)continue;
      const [pf,pr]=fr(p.square),[mf,mr]=fr(move.from);
      const df=Math.sign(mf-pf),dr=Math.sign(mr-pr);
      if(!dirsFor(p.type).some(([a,b])=>a===df&&b===dr))continue;
      if(!(df===0||dr===0||Math.abs(mf-pf)===Math.abs(mr-pr)))continue;
      let blocked=false;for(let k=1;;k++){const s=sq(pf+df*k,pr+dr*k);if(!s||s===move.from)break;if(pieceAt(before,s)){blocked=true;break;}}
      if(blocked)continue;
      for(let k=1;k<8;k++){
        const s=sq(pf+df*k,pr+dr*k);if(!s)break;const hit=pieceAt(after,s);if(!hit)continue;
        if(hit.color===enemy&&(hit.type==='k'||VALUE[hit.type]>VALUE[p.type]||(!defenders(after,s,enemy).length&&VALUE[hit.type]>=3))){
          const what=hit.type==='k'?'a discovered check':'a discovered attack';
          facts.push({kind:'discovered',strength:hit.type==='k'?7:6,text:hit.type==='k'?`Moving the ${NAME[move.piece]} uncovers a discovered check from ${label(p.type,p.square)}.`:`Moving the ${NAME[move.piece]} uncovers a discovered attack: ${label(p.type,p.square)} now hits ${label(hit.type,s)}.`,arrows:[p.square+s]});
        }
        break;
      }
    }
    // Pins created by the move.
    for(const row of after.board())for(const p of row){
      if(!p||p.color!==color||!['b','r','q'].includes(p.type))continue;
      for(const [df,dr] of dirsFor(p.type)){
        const [pf,pr]=fr(p.square);let first=null;
        for(let k=1;k<8;k++){
          const s=sq(pf+df*k,pr+dr*k);if(!s)break;const hit=pieceAt(after,s);if(!hit)continue;
          if(!first){if(hit.color!==enemy||hit.type==='k')break;first=hit;continue;}
          if(hit.color===enemy&&VALUE[first.type]>=3&&(hit.type==='k'||(['r','q'].includes(hit.type)&&VALUE[hit.type]>VALUE[first.type]))){
            if(!wasPinned(before,p,first,hit)&&(p.square===to||isOnLine(move.from,p.square,s))&&!attacksFrom(after,first.square).includes(p.square))
              facts.push({kind:'pin',strength:hit.type==='k'?6:5,text:`This pins ${label(first.type,first.square)} to ${hit.type==='k'?'the king':label(hit.type,s)}${hit.type==='k'?', so it cannot legally move':', so moving it would lose the '+NAME[hit.type]}.`,arrows:[p.square+s]});
          }
          break;
        }
      }
    }
    // Defence: removing a threat that existed before the move.
    const threatBefore=threats(before,enemy).filter(t=>t.value>=3);
    if(threatBefore.length){
      const threatAfter=threats(after,enemy);
      const saved=threatBefore.filter(t=>!threatAfter.some(a=>a.type===t.type&&(a.square===t.square||(t.square===move.from&&a.square===to))));
      if(saved.length&&(!outcome||outcome.gain>=0)){const t=saved[0];facts.push({kind:'defends',strength:5,text:t.square===move.from?`This moves ${label(t.type,t.square)} out of danger; it was attacked by the ${NAME[pieceAt(before,t.by).type]} on ${t.by}.`:`This protects ${label(t.type,t.square)}, which was under attack from the ${NAME[pieceAt(before,t.by).type]} on ${t.by}.`,arrows:[t.by+t.square]});}
    }
    if(move.promotion)facts.push({kind:'promotion',strength:6,text:`The pawn promotes to a ${NAME[move.promotion]}.`,arrows:[uci]});
    endgame(after,before,move,color,facts);
    // Only a curated follow-up is trusted to show a lasting material gain.
    if(curated&&gain&&!facts.some(f=>/winning|falls|free|forced-mate|mate/.test(f.kind+f.text)))
      facts.push({kind:'material',strength:5,text:`With best play this wins ${gain.text}: ${numbered(fen,outcome.sans)}.`,arrows:outcome.moves.slice(0,2).map(m=>m.from+m.to)});
    if(after.inCheck()&&!facts.some(f=>f.kind==='discovered'))facts.push({kind:'check',strength:2,text:'It gives check, so the reply is forced to deal with it.',arrows:[uci]});
    positional(before,after,move,color,facts,fen);
    return facts.sort((a,b)=>b.strength-a.strength);
  }
  function isOnLine(square,a,b){
    const [sf,sr]=fr(square),[af,ar]=fr(a),[bf,br]=fr(b);
    const cross=(bf-af)*(sr-ar)-(br-ar)*(sf-af);
    return cross===0&&Math.min(af,bf)<=sf&&sf<=Math.max(af,bf)&&Math.min(ar,br)<=sr&&sr<=Math.max(ar,br);
  }
  function wasPinned(before,slider,first,back){
    const a=pieceAt(before,slider.square),b=pieceAt(before,first.square),c=pieceAt(before,back.square);
    if(!a||!b||!c||a.type!==slider.type||a.color!==slider.color||b.type!==first.type||c.type!==back.type)return false;
    const [sf,sr]=fr(slider.square),[ff,frr]=fr(first.square),df=Math.sign(ff-sf),dr=Math.sign(frr-sr);
    for(let k=1;k<8;k++){const s=sq(sf+df*k,sr+dr*k);if(!s||s===first.square)break;if(pieceAt(before,s))return false;}
    return true;
  }
  function withTurn(Chess,fen,color){
    const parts=fen.split(' ');if(parts[1]===color)return make(Chess,fen);
    parts[1]=color;parts[3]='-';return make(Chess,parts.join(' '));
  }
  function mateInOne(Chess,fen,color){
    const chess=withTurn(Chess,fen,color);if(!chess||isKingAttacked(chess,other(color)))return null;
    for(const m of chess.moves({verbose:true})){
      const test=make(Chess,chess.fen());if(!test)continue;
      try{test.move(m.san);}catch{continue;}
      if(test.isCheckmate())return m;
    }
    return null;
  }
  function isKingAttacked(chess,color){
    for(const row of chess.board())for(const p of row)if(p&&p.type==='k'&&p.color===color)return defenders(chess,p.square,other(color)).length>0;
    return false;
  }
  function passedPawns(chess,color){
    const out=[],dir=color==='w'?1:-1;
    for(const row of chess.board())for(const p of row){
      if(!p||p.type!=='p'||p.color!==color)continue;
      const [f,r]=fr(p.square);let passed=true;
      for(let rr=r+dir;rr>=0&&rr<8&&passed;rr+=dir)for(const ff of [f-1,f,f+1]){const s=sq(ff,rr),q=s&&pieceAt(chess,s);if(q&&q.type==='p'&&q.color!==color){passed=false;break;}}
      if(passed)out.push(p.square);
    }
    return out;
  }
  function isEndgame(chess){
    let heavy=0,queens=0;for(const row of chess.board())for(const p of row)if(p&&!['p','k'].includes(p.type)){heavy+=VALUE[p.type];if(p.type==='q')queens++;}
    return heavy<=14||(queens===0&&heavy<=20);
  }
  const dist=(a,b)=>{const [af,ar]=fr(a),[bf,br]=fr(b);return Math.max(Math.abs(af-bf),Math.abs(ar-br));};
  function endgame(after,before,move,color,facts){
    if(!isEndgame(before))return;
    if(move.piece==='k'){
      for(const [owner,verb] of [[color,'supports'],[other(color),'stops']]){
        for(const pawn of passedPawns(before,owner)){
          if(dist(move.to,pawn)<dist(move.from,pawn)&&dist(move.to,pawn)<=3){
            facts.push({kind:'endgame-king',strength:4,text:owner===color?`The king walks toward the passed pawn on ${pawn} to escort it forward — in endgames the king is an attacking piece.`:`The king heads toward the passed pawn on ${pawn} to stop it before it can promote.`,arrows:[move.from+move.to],squares:[pawn]});
            return;
          }
        }
      }
    }
    if(move.piece==='p'&&passedPawns(before,color).includes(move.from)){
      const rank=Number(move.to[1]),left=color==='w'?8-rank:rank-1;
      facts.push({kind:'passed-pawn',strength:4,text:`This pushes the passed pawn; it is now ${left} ${left===1?'step':'steps'} from promotion and must be watched constantly.`,arrows:[move.from+move.to]});
    }
  }
  function positional(before,after,move,color,facts,fen){
    const ply=(Number(fen.split(' ')[5])-1)*2+(color==='b'?1:0);
    if(move.flags?.includes('k')||move.flags?.includes('q')){facts.push({kind:'castle',strength:3,text:'Castling tucks the king away from the centre and brings the rook toward the middle of the board.',arrows:[move.from+move.to]});return;}
    const home=color==='w'?'1':'8';
    if(ply<30&&['n','b'].includes(move.piece)&&move.from[1]===home&&!move.captured)
      facts.push({kind:'develops',strength:2,text:`This develops the ${NAME[move.piece]} from its starting square, bringing another piece into play.`,arrows:[move.from+move.to]});
    if(move.piece==='r'){
      const file=move.to[0];let own=false,their=false;
      for(let r=1;r<=8;r++){const p=pieceAt(after,file+r);if(p?.type==='p')p.color===color?own=true:their=true;}
      if(!own)facts.push({kind:'open-file',strength:2,text:`The rook takes the ${their?'half-open':'open'} ${file}-file, where it has room to work.`,arrows:[move.from+move.to]});
    }
    const centre=['d4','d5','e4','e5'],count=chess=>centre.reduce((n,s)=>n+defenders(chess,s,color).length,0);
    if(count(after)-count(before)>=1&&(centre.includes(move.to)||['c','d','e','f'].includes(move.to[0]))&&ply<40)
      facts.push({kind:'centre',strength:1,text:'It adds control over the central squares, which gives the pieces more room.',arrows:[]});
  }

  /* Threats left by a move: what the opponent's best reply does. */
  function refutation(Chess,fen,uci,line){
    const after=make(Chess,fen);if(!after||!play(after,uci))return null;
    const reply=(line&&line[0]===uci?line[1]:line?.[0]);if(!isUci(reply))return null;
    const replyFacts=motifs(Chess,after.fen(),reply,{line:(line&&line[0]===uci?line.slice(1):line)});
    const outcome=lineOutcome(Chess,after.fen(),(line&&line[0]===uci?line.slice(1):line),after.turn());
    const test=make(Chess,after.fen()),move=play(test,reply);
    return move?{fen:after.fen(),san:move.san,uci:reply,facts:replyFacts,outcome,gain:describeGain(outcome,after.turn())}:null;
  }
  root.PixelTactics={motifs,refutation,lineOutcome,describeGain,numbered,threats,material,attacksFrom,passedPawns,VALUE,NAME};
  if(typeof module==='object')module.exports=root.PixelTactics;
})(globalThis);
