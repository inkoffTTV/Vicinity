/* Режимы и связь с мессенджером: ежедневный забег (одинаковые этажи у всех за день), дуэль «друг против друга»,
   достижения → шапки и цвета (сервер: /api/v1/play/klyaksa), итоги забега в чат, рекорд в профиле.
   Запросы к серверу идут через мессенджер (Net.api), у самой игры доступа к аккаунту нет. */
let playMode='run'; // run — обычный забег (5 этажей или бесконечный), daily — ежедневный, pvp — дуэль
let dailyDay='';
let stats=null,dailyTop=null,endInfo=null,showAwards=false,titleMsg=null;
let myCos={hat:'',color:''};
const COS=new Map(); // номер игрока → {hat,color}
let runAch=new Set(),runT0=Date.now(),prevState='title',bossFight=0;
let pvp=null; // {score:{peer:n}, endT, winner, dropT, marks:[{x,y,t,kind}], round}
const utcDay=()=>new Date().toISOString().slice(0,10);
const inMessenger=()=>!!(window.Net&&Net.inFrame&&Net.self);

const ACH=[
 {id:'win',t:'Пройти 5 этажей',r:'шапка «Корона»'},
 {id:'eraser_nohit',t:'Победить Ластик без урона',r:'шапка «Ластик»'},
 {id:'floor5',t:'Дойти до 5 этажа',r:'цвет «Золото»'},
 {id:'items10',t:'Собрать 10 предметов за забег',r:'шапка «Шапочка»'},
 {id:'daily',t:'Дойти до 3 этажа в ежедневном',r:'цвет «Мята»'},
 {id:'pvp3',t:'Выиграть дуэль',r:'шапка «Рожки»'},
 {id:'merge',t:'Слиться с другом',r:'цвет «Розовый»'}];
const HATS={crown:'Корона',eraser:'Ластик',beanie:'Шапочка',horns:'Рожки',cap:'Кепка',halo:'Нимб'};
const COLORS={gold:'Золото',mint:'Мята',pink:'Розовый',sky:'Небо',black:'Чёрный'};
const CPAL={gold:{b:'#6b4a10',B:'#b8861f',h:'#fee761',H:'#fff6c0'},mint:{b:'#1a4d48',B:'#2a8a7a',h:'#5fe0c0',H:'#c8fff0'},
 pink:{b:'#6b1f45',B:'#b8457a',h:'#f58ac0',H:'#ffd0e8'},sky:{b:'#1d3a6b',B:'#3a6bb8',h:'#7fb8ff',H:'#d0e8ff'},black:{b:'#0a0a10',B:'#22202c',h:'#3a3648',H:'#6a6480'}};
const achName=id=>{const a=ACH.find(x=>x.id===id);return a?a.r:id;};

/* ================= ежедневный забег: этажи из «зерна» дня ================= */
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
const _genFloor=genFloor;
genFloor=function(){if(playMode!=='daily')return _genFloor();const r=Math.random;Math.random=mulberry32(hashStr('klyaksa:'+dailyDay+':'+level));try{return _genFloor();}finally{Math.random=r;}};

const _newGame=newGame;
newGame=function(){
 if(playMode==='pvp'&&(!window.Net||!Net.self||Net.all().length<2)){titleMsg={t:'Для дуэли нужен второй игрок',life:150};sfx('nope');return;}
 if(playMode==='daily'){dailyDay=utcDay();mode='normal';runLen='short';const r=Math.random;Math.random=mulberry32(hashStr('klyaksa-pool:'+dailyDay));try{_newGame();}finally{Math.random=r;}}
 else _newGame();
 pvp=null;bossFight=0;
 if(playMode==='pvp')pvpStart();
 else if(playMode==='daily')popup('Ежедневный забег',dailyDay+' — этажи одинаковые у всех',null,170);
 sendMode();};

/* ================= дуэль ================= */
function arenaRocks(){const out=[],add=(c,r,type)=>{for(const [a,b] of [[c,r],[COLS-1-c,r],[c,ROWS-1-r],[COLS-1-c,ROWS-1-r]])if(!out.some(k=>k.x===RX0+a*T&&k.y===RY0+b*T))out.push({x:RX0+a*T,y:RY0+b*T,w:T,h:T,type});};
 add(4,2,'eraser');add(5,2,'eraser');add(8,4,'ink');add(3,5,'tinted');return out;}
function pvpStart(){
 const r={gx:4,gy:4,type:'arena',seed:(Math.random()*1e9)|0,cleared:true,visited:true,rocks:arenaRocks(),items:[],pickups:[],trap:null,trapT:0,floorC:null,doorT:0};
 floor=linkFloor([r],r);room=r;resetWorld();enemies=[];ebul=[];team.task=null;team.bombs=3;
 pvp={score:{},endT:0,winner:0,dropT:240,marks:[],round:0};
 ev({f:'floor',d:floorWire()});pvpRound();}
function pvpRound(){pvp.round++;tears=[];ebul=[];bombs=[];fires=[];inkLines=[];
 const spots=[[RX0+24,CY],[RX1-24,CY],[CX,RY0+20],[CX,RY1-14]];
 PL.forEach((p,i)=>{if(p.mergeWith)splitMerge(p);p.dead=false;p.merged=0;p.hp=p.maxHp;p.inv=90;const s=spots[i%4];p.x=s[0];p.y=s[1];p.vx=p.vy=0;p.hist=[];});
 popup('Раунд '+pvp.round,'Кто первым возьмёт 3 раунда',null,110);S('slam');}
function pvpTick(){
 for(let i=inkLines.length-1;i>=0;i--)if(--inkLines[i].life<=0)inkLines.splice(i,1);
 // капли бьют соперников (своих — нет)
 for(let i=tears.length-1;i>=0;i--){const t=tears[i];if(!t.own)continue;
  for(const Q of PL){if(Q.dead||Q.peer===t.own||Q.inv>0)continue;
   if(Math.hypot(t.x-Q.x,t.y-(Q.y-3))<t.r+Q.r-1){if(Q.shieldUp){Q.shieldUp=false;S('shield');}else hurt(Q,t.dmg>=7?2:1);
    addFx({type:'splash',x:t.x,y:t.y,t:0,col:TEARC[t.col][1]});if(!t.pierce)tears.splice(i,1);break;}}}
 // с неба падают предметы, сердца и бомбы
 if(!pvp.endT&&--pvp.dropT<=0){pvp.dropT=ri(300,420);
  for(let k=0;k<20;k++){const x=ri(RX0+20,RX1-20),y=ri(RY0+20,RY1-16);if(overlapsRock(x,y,8))continue;
   const kind=room.items.length<3&&Math.random()<0.45?'item':Math.random()<0.6?'heart':'bomb';pvp.marks.push({x,y,t:70,kind});S('ping');break;}}
 for(let i=pvp.marks.length-1;i>=0;i--){const m=pvp.marks[i];if(--m.t>0)continue;pvp.marks.splice(i,1);
  if(m.kind==='item')room.items.push({x:m.x,y:m.y,kind:'item',it:drawItemFromPool(),price:0});else dropPickup(m.x,m.y,m.kind);
  addFx({type:'boom',x:m.x,y:m.y,t:10});burst(m.x,m.y,'#fee761',10,1.4);S('slam');shakeTo(2);}
 // раунд: остался один
 const live=PL.filter(p=>!p.dead);
 if(PL.length<2&&!pvp.winner){pvp.winner=PL[0]?PL[0].peer:-1;pvp.endT=1;}
 if(!pvp.endT&&live.length<=1){const w=live[0];
  if(w){pvp.score[w.peer]=(pvp.score[w.peer]||0)+1;if(pvp.score[w.peer]>=3)pvp.winner=w.peer;popup(fit(w.name||'Игрок',150)+' берёт раунд',scoreText(),null,130);}
  pvp.endT=150;S('task');slowT=40;}
 if(pvp.endT){for(const p of live)p.inv=Math.max(p.inv,2);if(--pvp.endT<=0){if(pvp.winner)state='win';else pvpRound();}}}
function scoreText(){const sc=p=>(pvp&&pvp.score[p.peer])||0;
 if(PL.length===2)return fit(PL[0].name||'Игрок',64)+' '+sc(PL[0])+':'+sc(PL[1])+' '+fit(PL[1].name||'Игрок',64);
 return PL.map(p=>fit(p.name||'Игрок',40)+' '+sc(p)).join(' ');}
const _coop=coop;
coop=function(){if(playMode==='pvp'&&pvp)pvpTick();else _coop();};
// последний живой в раунде не гибнет от того же взрыва — ничьих нет
const _hurt=hurt;
hurt=function(P,n){if(playMode==='pvp'&&pvp&&!P.dead&&P.hp-n<=0&&PL.every(q=>q===P||q.dead)){n=P.hp-1;if(n<=0)return;}
 const hp=P.hp;_hurt(P,n);if(P.hp<hp)P.hurtAt=frame;};

/* ================= достижения ================= */
function grant(P,id){if(!P)return;if(P.peer===SELF())addAch(id);else if(MP())Net.send({t:'ach',id},P.peer);}
function addAch(id){if(!ACH.some(a=>a.id===id)||runAch.has(id))return;runAch.add(id);
 if(stats&&stats.unlocks.includes(id))return;pop={t:'Открыто: '+achName(id),s:ACH.find(a=>a.id===id).t,icon:null,life:200,max:200};sfx('task');}
const _doMerge=doMerge;
doMerge=function(a,b){_doMerge(a,b);grant(a,'merge');grant(b,'merge');};
const _spawnBoss=spawnBoss;
spawnBoss=function(){_spawnBoss();bossFight=frame;};
const _kill=kill;
kill=function(e){_kill(e);if(e.boss&&e.type==='eraser'&&bossFight)for(const P of PL)if(!P.dead&&!(P.hurtAt>=bossFight))grant(P,'eraser_nohit');};
const _nextFloor=nextFloor;
nextFloor=function(){_nextFloor();if(level>=5)for(const P of PL)grant(P,'floor5');};

/* ================= рекорды, итоги, «поделиться» ================= */
function applyStats(r){if(!r||typeof r!=='object')return;stats=r;myCos=r.cosmetic||myCos;best=Math.max(best,r.best_floor||0);COS.set(SELF(),myCos);sendCos();}
function sendCos(to){if(MP())Net.send({t:'cos',h:myCos.hat,c:myCos.color},to);}
function loadDaily(){if(!inMessenger())return;Net.api('daily',{day:dailyDay||utcDay()}).then(r=>{dailyTop=r;}).catch(()=>{});}
function sendMode(to){if(MP()&&HOST())Net.send({t:'pm',pm:playMode,dd:dailyDay},to);}
function shareText(won){
 if(playMode==='pvp'){const w=PL.find(p=>p.peer===pvp.winner);return'🎮 Клякса, дуэль: '+(w?'победа — '+(w.name||'игрок'):'ничья')+' ('+scoreText()+')';}
 const head=playMode==='daily'?'🎮 Клякса, ежедневный забег '+dailyDay+': ':runLen==='endless'?'🎮 Клякса, бесконечный режим: ':'🎮 Клякса: ';
 return head+(won?'победа! Пройдено этажей: '+level:'дошли до '+level+' этажа')+', стёрто врагов: '+kills+(PL.length>1?', игроков: '+PL.length:'');}
function report(){
 const me=meP(),won=playMode!=='pvp'&&state==='win';
 if(me&&me.items.length>=10)runAch.add('items10');
 if(playMode!=='pvp'){if(won)runAch.add('win');if(level>=5)runAch.add('floor5');if(playMode==='daily'&&(won||level>=3))runAch.add('daily');}
 else if(pvp&&pvp.winner===SELF())runAch.add('pvp3');
 const body={floor:playMode==='pvp'?0:level,kills:playMode==='pvp'?0:kills,won,time_ms:Date.now()-runT0,ach:[...runAch]};
 if(playMode==='daily')body.daily=dailyDay;
 endInfo={sent:false,busy:false,fresh:[],text:shareText(won)};
 if(inMessenger())Net.api('result',body).then(r=>{applyStats(r);endInfo.fresh=r.fresh||[];if(playMode==='daily')loadDaily();}).catch(()=>{});}
function share(){if(!endInfo||endInfo.sent||endInfo.busy||!inMessenger())return;endInfo.busy=true;
 Net.api('share',{text:endInfo.text}).then(()=>{endInfo.sent=true;sfx('coin');}).catch(e=>{endInfo.err=e.message;sfx('nope');}).finally(()=>{endInfo.busy=false;});}
// смена состояния: начало забега и его конец
function metaFrame(){
 if(state!==prevState){const was=prevState;prevState=state;
  if(state==='play'&&was!=='pause'){runT0=Date.now();runAch=new Set();endInfo=null;}
  if((state==='over'||state==='win')&&(was==='play'||was==='pause'))report();}
 if(state==='play'){const me=meP();if(me&&me.items.length>=10)addAch('items10');}
 if(titleMsg&&--titleMsg.life<=0)titleMsg=null;}

/* ================= шапки и цвета ================= */
const CSET={};
function colorSet(c){if(!CPAL[c])return null;if(!CSET[c])CSET[c]={player:D.player.map(r=>sprPal(r,CPAL[c])),pdie:D.pdie.map(r=>sprPal(r,CPAL[c])),baby:sprPal(D.baby,CPAL[c])};return CSET[c];}
function drawHat(id,x0,top,lookX){const y=top;switch(id){
 case 'crown':px(x0+4,y-2,8,3,'#feae34');px(x0+4,y-4,2,2,'#fee761');px(x0+7,y-5,2,3,'#fee761');px(x0+10,y-4,2,2,'#fee761');px(x0+4,y,8,1,'#733e39');px(x0+7,y-1,2,1,'#e43b44');break;
 case 'eraser':px(x0+4,y-4,8,4,'#f5a3a3');px(x0+4,y-4,8,1,'#ffd1d1');px(x0+4,y-1,8,1,'#4f7cc4');px(x0+4,y,8,1,'#29447e');break;
 case 'beanie':px(x0+3,y-3,10,4,'#e43b44');px(x0+4,y-4,8,1,'#e43b44');px(x0+3,y,10,1,'#9e2835');px(x0+7,y-6,2,2,'#fff8ec');break;
 case 'horns':px(x0+2,y-2,2,3,'#e43b44');px(x0+1,y-4,2,2,'#e43b44');px(x0+1,y-5,1,1,'#ffd1d1');px(x0+12,y-2,2,3,'#e43b44');px(x0+13,y-4,2,2,'#e43b44');px(x0+14,y-5,1,1,'#ffd1d1');break;
 case 'cap':px(x0+4,y-3,8,3,'#4f7cc4');px(x0+5,y-4,6,1,'#4f7cc4');px(x0+5,y-4,6,1,'#7fa8e8');px(lookX<0?x0+1:x0+11,y-1,4,1,'#29447e');break;
 case 'halo':{const b=Math.round(Math.sin(frame*0.08));px(x0+5,y-7+b,6,1,'#fee761');px(x0+4,y-6+b,1,1,'#fee761');px(x0+11,y-6+b,1,1,'#fee761');px(x0+5,y-5+b,6,1,'#feae34');break;}}}
const cosOf=P=>COS.get(P.peer)||null;
const _drawPlayerBody=drawPlayerBody;
drawPlayerBody=function(P){const c=cosOf(P),cs=c&&colorSet(c.color);
 if(cs){const saved=PSP[P.idx];PSP[P.idx]=cs;try{_drawPlayerBody(P);}finally{PSP[P.idx]=saved;}}else _drawPlayerBody(P);
 if(!c||!HATS[c.hat]||P.dead||(P.inv>0&&Math.floor(P.inv/4)%2))return;
 const moving=Math.hypot(P.vx,P.vy)>0.25;let fi;if(P.recoil>0)fi=1;else if(moving)fi=[0,2,0,1][Math.floor(P.walkT/6)%4];else fi=Math.floor(frame/40)%2;
 drawHat(c.hat,Math.round(P.x-8),Math.round(P.y-13)+[1,2,0][fi],P.look.x);};
const HERO={};
function drawHero(fi,x,y){const c=myCos,key=(c.color||'')+fi;
 if(!HERO[key]){const cs=colorSet(c.color);if(!cs)HERO[key]=PICON[fi];else{const k=mk(16,16),g=k.getContext('2d');g.drawImage(cs.player[fi],0,0);const ey=[6,7,5][fi];for(const ex of [4,10]){g.fillStyle=PAL.w;g.fillRect(ex,ey,2,3);g.fillStyle=PAL.k;g.fillRect(ex+(ex===4?1:0),ey+1,1,2);}HERO[key]=k;}}
 // в шапке герой чуть меньше — чтобы шапка не наезжала на подзаголовок
 const hat=HATS[c.hat],s=hat?2:3,ox=hat?8:0,oy=hat?16:0;ctx.drawImage(HERO[key],x+ox,y+oy,16*s,16*s);
 if(hat){ctx.save();ctx.translate(x+ox,y+oy);ctx.scale(s,s);drawHat(c.hat,0,[1,2,0][fi],1);ctx.restore();}}
function cycleCos(kind){if(!stats){titleMsg={t:inMessenger()?'Загрузка наград…':'Награды — в Vicinity',life:90};return;}
 const list=['',...(kind==='hat'?stats.hats:stats.colors)];if(list.length<2){titleMsg={t:'Пока не открыто — N: список наград',life:120};sfx('nope');return;}
 const cur=kind==='hat'?myCos.hat:myCos.color,next=list[(list.indexOf(cur)+1)%list.length];
 myCos=Object.assign({},myCos,kind==='hat'?{hat:next}:{color:next});COS.set(SELF(),myCos);sendCos();sfx('coin');
 clearTimeout(cycleCos.t);cycleCos.t=setTimeout(()=>{Net.api('cosmetic',myCos).then(applyStats).catch(()=>{});},700);}

/* ================= экраны ================= */
const MODES=[['run','Забег'],['daily','Ежедневный'],['endless','Бесконечный'],['pvp','Дуэль']];
const modeKey=()=>playMode==='run'&&runLen==='endless'?'endless':playMode;
function drawModeLine(n){
 const host=HOST(),m=MODES.find(([k])=>k===modeKey());
 text('Режим: '+(m?m[1]:'Забег')+(host?' (1-4)':''),CX,166,'#e43b44','center','#120e17');
 text((n>1?'Игроков: '+n+' · ':'')+(mode==='classes'?'Классы':'Без классов')+(host?' (C)':''),CX,177,'#3e8948','center');}
function cosLine(){if(!inMessenger())return;const h=HATS[myCos.hat],c=COLORS[myCos.color];
 text(fit((h||'шапка')+' (H) · '+(c||'цвет')+' (G) · награды (N)',BW-8),CX,220,'#5a6988','center');}
/** Обрезать строку с «…», чтобы влезла в ширину (пиксельный шрифт широкий) */
function fit(s,w){s=String(s);if(txt(s,'#fff').width<=w)return s;while(s.length>1&&txt(s+'.','#fff').width>w)s=s.slice(0,-1);return s+'.';}
function panel(x,y,w,h){px(x,y,w,h,'rgba(18,14,23,0.86)');px(x,y,w,1,'#4a405e');}
function drawDaily(){if(modeKey()!=='daily')return;const rows=dailyTop&&dailyTop.rows||[],W=124,x=BW-W-4,y=64;panel(x,y,W,28+Math.max(0,Math.min(5,rows.length)-1)*10);text('Сегодня',x+W/2,y+3,'#fee761','center');
 if(!rows.length)text(inMessenger()?'пока никого':'нет связи',x+W/2,y+17,'#8a8296','center');
 // этаж справа; победители — золотом
 rows.slice(0,5).forEach((r,i)=>{const col=r.me?'#63c74d':'#e8e0d0',fl=String(r.floor),fw=txt(fl,col).width;text(fit(r.place+'. '+(r.name||''),W-fw-10),x+4,y+15+i*10,col);text(fl,x+W-4,y+15+i*10,r.won?'#fee761':col,'right');});}
function drawAwards(){drawOverlay(1);panel(CX-140,16,280,200);text('НАГРАДЫ',CX,22,'#fee761','center','#120e17',2);
 const have=new Set(stats?stats.unlocks:[]);ACH.forEach((a,i)=>{const y=46+i*20,ok=have.has(a.id);text((ok?'+ ':'- ')+a.t,CX-132,y,ok?'#63c74d':'#e8e0d0');text(a.r,CX-132,y+9,'#8a8296');});
 text('Standard: кепка и «Небо»',CX,190,'#9cc3ff','center');text('Ultra: нимб и «Чёрный»',CX,199,'#9cc3ff','center');text('N — закрыть',CX,208,'#5a6988','center');}
const _drawTitle=drawTitle;
drawTitle=function(){_drawTitle();drawDaily();cosLine();if(titleMsg&&!showAwards){px(0,186,BW,12,'#120e17');text(titleMsg.t,CX,188,'#fee761','center');}if(showAwards)drawAwards();};
function endExtra(y){if(!endInfo)return;
 if(endInfo.fresh.length)text(endInfo.fresh.length>1?'Открыто наград: '+endInfo.fresh.length:'Открыто: '+achName(endInfo.fresh[0]),CX,y,'#63c74d','center','#120e17');
 if(inMessenger())text(endInfo.sent?'Итоги отправлены в чат':endInfo.err?endInfo.err:'T — поделиться итогами в чат',CX,y+12,endInfo.sent?'#63c74d':'#9cc3ff','center','#120e17');}
const _drawOver=drawOver;
drawOver=function(){_drawOver();endExtra(144);};
const _drawWin=drawWin;
drawWin=function(){if(playMode!=='pvp'||!pvp){_drawWin();endExtra(140);return;}
 drawOverlay(1);panel(CX-124,36,248,150);text('ДУЭЛЬ',CX,48,'#fee761','center','#120e17',2);
 const w=PL.find(p=>p.peer===pvp.winner);text(w?fit('Победа: '+(w.name||'игрок'),236):'Соперник вышел',CX,76,'#63c74d','center','#120e17');
 PL.forEach((p,i)=>text(fit(p.name||'Игрок',190)+' — '+(pvp.score[p.peer]||0),CX,96+i*12,'#e8e0d0','center','#120e17'));
 endExtra(144);if(Math.floor(frame/30)%2===0)text('R или Enter — ещё раз',CX,170,'#fee761','center','#120e17');};
const _drawHUD=drawHUD;
drawHUD=function(){_drawHUD();if(playMode!=='pvp'||!pvp||!meP())return;px(CX-90,0,180,HUD,PAL.k);text('Дуэль · до 3',CX,3,'#e8e0d0','center');text(scoreText(),CX,13,'#fee761','center');};
const _drawRoom=drawRoom;
drawRoom=function(){_drawRoom();if(!pvp)return;for(const m of pvp.marks){const k=m.t/70,r=3+k*7;if(Math.floor(m.t/4)%2)pring(m.x,m.y,r,'#fee761');shad(m.x,m.y,Math.round(5-k*3));px(m.x,Math.round(m.y-6-k*60),2,3,m.kind==='heart'?'#e43b44':m.kind==='bomb'?'#c0cbdc':'#fee761');}};
const _draw=draw;
draw=function(){_draw();metaFrame();};

/* ================= сеть ================= */
function metaWire(){return{pm:playMode,dd:dailyDay,pv:pvp?{s:pvp.score,w:pvp.winner,r:pvp.round,m:pvp.marks.map(m=>[m.x,m.y,m.t,m.kind])}:null};}
function applyMeta(m){if(!m)return;if(m.pm==='run'||m.pm==='daily'||m.pm==='pvp')playMode=m.pm;if(typeof m.dd==='string')dailyDay=m.dd.slice(0,10);
 if(m.pv){pvp=pvp||{score:{},marks:[]};pvp.score=m.pv.s&&typeof m.pv.s==='object'?m.pv.s:{};pvp.winner=m.pv.w|0;pvp.round=m.pv.r|0;pvp.marks=(m.pv.m||[]).map(a=>({x:a[0],y:a[1],t:a[2],kind:a[3]}));}else pvp=null;}
/** Клавиши меню (true — нажатие обработано) */
function metaKey(e){
 if(showAwards){if(e.code==='KeyN'||e.code==='Escape')showAwards=false;return true;}
 if((state==='over'||state==='win')&&e.code==='KeyT'){share();return true;}
 if(state!=='title'&&state!=='wait'&&state!=='over'&&state!=='win')return false;
 if(e.code==='KeyN'&&inMessenger()){showAwards=true;return true;}
 if(e.code==='KeyH'){cycleCos('hat');return true;}
 if(e.code==='KeyG'){cycleCos('color');return true;}
 const d=['Digit1','Digit2','Digit3','Digit4'].indexOf(e.code);
 if(d>=0){if(!HOST())return true;const k=MODES[d][0];playMode=k==='endless'?'run':k;runLen=k==='endless'?'endless':'short';if(k==='daily'){dailyDay=utcDay();loadDaily();}
  sfx('coin');sendMode();if(MP())Net.send({t:'mode',m:mode,rl:runLen});return true;}
 return false;}
function metaInit(){COS.set(SELF(),myCos);if(inMessenger()){Net.api('me').then(applyStats).catch(()=>{});loadDaily();}sendCos();}
if(window.Net){
 Net.on('init',metaInit);
 Net.on('join',p=>{sendCos(p.peerId);sendMode(p.peerId);});
 Net.on('leave',p=>COS.delete(p.peerId));
 Net.on('msg',(d,from)=>{if(!d||typeof d!=='object')return;
  if(d.t==='cos')COS.set(from,{hat:HATS[d.h]?d.h:'',color:COLORS[d.c]?d.c:''});
  else if(d.t==='ach'&&!HOST()&&Net.all()[0]&&Net.all()[0].peerId===from)addAch(String(d.id));
  else if(d.t==='pm'&&!HOST()){if(d.pm==='run'||d.pm==='daily'||d.pm==='pvp')playMode=d.pm;if(typeof d.dd==='string')dailyDay=d.dd.slice(0,10);if(playMode==='daily')loadDaily();}
  else if(d.t==='hello'&&HOST())sendMode(from);});
 if(Net.self)metaInit();}
if(window.KLDBG)Object.assign(KLDBG,{meta:()=>({playMode,dailyDay,pvp,runAch:[...runAch],endInfo,cos:[...COS],stats}),setStats:applyStats,mode(m){playMode=m;},grant:id=>grant(meP(),id)});
