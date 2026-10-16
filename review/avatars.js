// Public player pictures are independent of the local analysis engine.
(function(root){
  'use strict';
  function photoUrl(value){
    if(typeof value!=='string')return null;
    try{const url=new URL(value);return url.protocol==='https:'&&
      /(^|\.)(chess\.com|chesscomfiles\.com)$/.test(url.hostname)?url.href:null;}catch{return null;}
  }
  function cached(record,color){
    const player=record.game.players?.[color],name=record.game.headers[color==='white'?'White':'Black'];
    return player?.username?.toLowerCase()===name?.toLowerCase()?player:null;
  }
  const capturedPlayers={
    masoodexists:{countryCode:'PK',flair:'assets/flairs/brilliant.svg'},
    fripser:{countryCode:'CH'}
  };
  function countryCode(value){
    const text=String(value||'');
    // Chess.com sometimes reports a numeric country id instead of an ISO code.
    if(/^\d{1,4}$/.test(text))return root.PixelCountryCodes?.[text]?.toUpperCase()||null;
    const code=text.match(/(?:^|\/country\/)([a-z]{2})$/i)?.[1];
    return code?.toUpperCase()||null;
  }
  function details(record,color){
    const name=record.game.headers[color==='white'?'White':'Black']||'';
    const captured=capturedPlayers[name.toLowerCase()]||{};
    const player=cached(record,color)||{};
    return {countryCode:countryCode(player.countryCode||player.country)||captured.countryCode||null,
      flair:photoUrl(player.flair)||captured.flair||null};
  }
  async function load(record,fetchProfile=fetch){
    const players={...record.game.players};
    const site=record.game.headers.Site||'';
    // Numeric game IDs come from the Chess.com review handoff. Do not look up
    // similarly named accounts for unrelated imported games.
    if(!/^\d+$/.test(record.id)&&!/(^|\b)chess\.com(?:\b|\/)/i.test(site))return players;
    await Promise.all(['white','black'].map(async color=>{
      const username=record.game.headers[color==='white'?'White':'Black'];
      const existing=cached(record,color);
      if(typeof username!=='string'||!/^[a-z0-9_-]{3,25}$/i.test(username)||(existing?.avatar&&existing?.countryCode))return;
      try{
        const response=await fetchProfile('https://api.chess.com/pub/player/'+encodeURIComponent(username.toLowerCase()),
          {credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});
        if(!response.ok)return;
        const profile=await response.json();players[color]={...existing,username,avatar:existing?.avatar||photoUrl(profile.avatar),countryCode:existing?.countryCode||countryCode(profile.country)};
      }catch{/* Missing pictures never block a review. */}
    }));
    return players;
  }
  // A local copy of Chess.com's grey default avatar, so it works offline too.
  const DEFAULT_AVATAR=typeof document==='undefined'?'assets/avatars/default.svg':new URL('assets/avatars/default.svg',document.baseURI).href;
  function render(container,record,color){
    const name=record.game.headers[color==='white'?'White':'Black']||color;
    const bundled={fripser:'assets/avatars/fripser.png',masoodexists:'assets/avatars/masoodexists.png'}[name.toLowerCase()];
    // Players without a picture get Chess.com's own default avatar, like on the site.
    const remote=photoUrl(cached(record,color)?.avatar),url=remote||bundled||DEFAULT_AVATAR,key=color+'|'+name+'|'+url;
    if(container.dataset.player===key)return;
    container.dataset.player=key;container.textContent='';
    const fallback=()=>{container.textContent=color==='white'?'♙':'♟';container.setAttribute('aria-label',name);};
    if(!url){fallback();return;}
    container.removeAttribute('aria-label');
    const img=document.createElement('img');img.alt=name+"’s profile picture";img.referrerPolicy='no-referrer';img.src=url;
    container.classList.toggle('default-avatar',url===DEFAULT_AVATAR);
    const onError=()=>{
      if(container.dataset.player!==key)return;
      const current=img.getAttribute('src');
      const next=remote&&bundled&&current===remote?bundled:current!==DEFAULT_AVATAR?DEFAULT_AVATAR:null;
      if(next){container.classList.toggle('default-avatar',next===DEFAULT_AVATAR);img.addEventListener('error',onError,{once:true});img.src=next;}
      else{container.classList.remove('default-avatar');img.remove();fallback();}
    };
    img.addEventListener('error',onError,{once:true});container.append(img);
  }
  root.PixelReviewAvatars={load,render,photoUrl,details};
  if(typeof module==='object')module.exports=root.PixelReviewAvatars;
})(globalThis);
