/* Review settings: defaults, persistence and the settings dialog. */
(function(root){
  'use strict';
  const STORAGE_KEY='pixel.review.settings';
  // Search depth (plies) for positions analysed from a FEN.
  const DEPTHS=Object.freeze({quick:10,standard:16,deep:22,deeper:28});
  const DEFAULTS=Object.freeze({
    perspective:'auto',username:'',
    useBackground:true,useBoardTheme:true,usePieceSet:true,
    coordinates:true,animations:true,animationSpeed:'normal',
    sounds:true,highlightLastMove:true,legalMoves:true,moveBadges:true,
    captured:true,evalBar:true,coachArrows:true,
    explanationDetail:'detailed',explainMode:'manual',autoplaySpeed:'normal',engineDepth:'standard'
  });
  const SECTIONS=[
    {title:'Review',items:[
      {key:'perspective',type:'select',label:'Review perspective',help:'Automatic reviews your own games as you and everyone else’s games as White and Black.',
        options:[['auto','Automatic'],['white','White'],['black','Black'],['neutral','Both players']]},
      {key:'engineDepth',type:'select',label:'Engine depth',help:'How far the engine searches when you analyse a FEN position. Deeper is more accurate but slower.',
        options:[['quick','Quick (depth 10)'],['standard','Standard (depth 16)'],['deep','Deep (depth 22)'],['deeper','Deeper (depth 28)']]},
      {key:'username',type:'text',label:'Your Chess.com username',help:'Used by Automatic to recognise your games. Filled in for you when you are signed in to Chess.com.',placeholder:'Not detected yet'},
      {key:'explanationDetail',type:'select',label:'Coach explanations',help:'Detailed adds board-checked reasons (forks, pins, threats, material) to the coach’s comment.',
        options:[['detailed','Detailed'],['coach','Coach comment only']]},
      {key:'explainMode',type:'select',label:'Explain button',help:'“Every move” keeps the step-by-step explanation open as you move through the game.',
        options:[['manual','Only the move I click'],['always','Every move']]},
      {key:'coachArrows',type:'toggle',label:'Coach arrows on the board'},
      {key:'autoplaySpeed',type:'select',label:'Auto-play speed',options:[['slow','Slow'],['normal','Normal'],['fast','Fast']]}
    ]},
    {title:'Board',items:[
      {key:'useBoardTheme',type:'toggle',label:'Use my Chess.com board'},
      {key:'usePieceSet',type:'toggle',label:'Use my Chess.com pieces'},
      {key:'useBackground',type:'toggle',label:'Use my Chess.com background'},
      {key:'coordinates',type:'toggle',label:'Show coordinates'},
      {key:'highlightLastMove',type:'toggle',label:'Highlight last move'},
      {key:'legalMoves',type:'toggle',label:'Show legal moves'},
      {key:'moveBadges',type:'toggle',label:'Move classification icons on the board'},
      {key:'evalBar',type:'toggle',label:'Evaluation bar'},
      {key:'captured',type:'toggle',label:'Captured pieces and material'}
    ]},
    {title:'Movement and sound',items:[
      {key:'animations',type:'toggle',label:'Piece animations'},
      {key:'animationSpeed',type:'select',label:'Animation speed',options:[['slow','Slow'],['normal','Normal'],['fast','Fast']],dependsOn:'animations'},
      {key:'sounds',type:'toggle',label:'Move sounds'}
    ]}
  ];
  function sanitize(value){
    const out={...DEFAULTS};
    if(!value||typeof value!=='object')return out;
    for(const section of SECTIONS)for(const item of section.items){
      const v=value[item.key];
      if(item.type==='toggle'&&typeof v==='boolean')out[item.key]=v;
      else if(item.type==='select'&&item.options.some(([key])=>key===v))out[item.key]=v;
      else if(item.type==='text'&&typeof v==='string')out[item.key]=v.trim().slice(0,40);
    }
    return out;
  }
  async function load(storage){
    const saved=await storage.get([STORAGE_KEY,'pixel.review.sound']);
    const value=sanitize(saved[STORAGE_KEY]);
    // Carry over the old speaker-button preference.
    if(!saved[STORAGE_KEY]&&saved['pixel.review.sound']===false)value.sounds=false;
    return value;
  }
  function save(storage,value){return storage.set({[STORAGE_KEY]:sanitize(value)}).catch(()=>{});}

  /* Builds the dialog once; `onChange(key,value)` fires for every edit. */
  function createDialog({host,getValues,onChange,onReset,detectedUsername=()=>''}){
    const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
    const overlay=el('div','settings-overlay');overlay.hidden=true;
    const dialog=el('div','settings-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','settings-title');
    const header=el('div','settings-header'),title=el('h2',null,'Settings');title.id='settings-title';
    const close=el('button','settings-close','×');close.type='button';close.setAttribute('aria-label','Close settings');
    header.append(title,close);
    const nav=el('nav','settings-nav'),body=el('div','settings-body'),footer=el('div','settings-footer');
    const reset=el('button','settings-reset','Reset to defaults');reset.type='button';
    const done=el('button','primary settings-done','Done');done.type='button';
    footer.append(reset,done);
    const controls=new Map();let activeSection=0;
    SECTIONS.forEach((section,index)=>{
      const tab=el('button','settings-tab',section.title);tab.type='button';tab.dataset.index=index;
      tab.onclick=()=>show(index);nav.append(tab);
      const panel=el('section','settings-section');panel.dataset.index=index;
      const heading=el('h3',null,section.title);panel.append(heading);
      for(const item of section.items){
        const row=el('label','settings-row'),text=el('span','settings-text'),name=el('span','settings-label',item.label);text.append(name);
        if(item.help)text.append(el('small','settings-help',item.help));
        let control;
        if(item.type==='toggle'){
          control=el('input','settings-switch');control.type='checkbox';control.setAttribute('role','switch');
          control.onchange=()=>onChange(item.key,control.checked);
        }else if(item.type==='select'){
          control=el('select','settings-select');
          for(const [value,label] of item.options){const option=el('option',null,label);option.value=value;control.append(option);}
          control.onchange=()=>onChange(item.key,control.value);
        }else{
          control=el('input','settings-input');control.type='text';control.maxLength=40;control.spellcheck=false;control.autocomplete='off';
          control.onchange=()=>onChange(item.key,control.value.trim());
        }
        control.dataset.key=item.key;row.append(text,control);panel.append(row);controls.set(item.key,{control,item,row});
      }
      body.append(panel);
    });
    dialog.append(header,el('div','settings-main'),footer);dialog.querySelector('.settings-main').append(nav,body);
    overlay.append(dialog);host.append(overlay);
    function show(index){
      activeSection=index;
      for(const tab of nav.children)tab.setAttribute('aria-current',String(Number(tab.dataset.index)===index));
      for(const panel of body.children)panel.hidden=Number(panel.dataset.index)!==index;
    }
    function sync(){
      const values=getValues();
      for(const [key,{control,item,row}] of controls){
        if(item.type==='toggle')control.checked=!!values[key];else control.value=values[key]??'';
        if(item.type==='text')control.placeholder=detectedUsername()?`Detected: ${detectedUsername()}`:item.placeholder||'';
        if(item.dependsOn){const enabled=!!values[item.dependsOn];control.disabled=!enabled;row.classList.toggle('disabled',!enabled);}
      }
    }
    let returnFocus=null;
    function open(){returnFocus=document.activeElement;sync();show(activeSection);overlay.hidden=false;nav.children[activeSection].focus();}
    function hide(){overlay.hidden=true;returnFocus?.focus?.();}
    close.onclick=hide;done.onclick=hide;reset.onclick=()=>{onReset();sync();};
    overlay.addEventListener('pointerdown',event=>{if(event.target===overlay)hide();});
    overlay.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.stopPropagation();hide();}
      if(event.key==='Tab'){const items=[...dialog.querySelectorAll('button,select,input')].filter(n=>!n.disabled&&n.offsetParent);const first=items[0],last=items.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    });
    return {open,hide,sync,isOpen:()=>!overlay.hidden};
  }
  root.PixelReviewSettings={DEFAULTS,DEPTHS,SECTIONS,sanitize,load,save,createDialog,STORAGE_KEY};
  if(typeof module==='object')module.exports=root.PixelReviewSettings;
})(globalThis);
