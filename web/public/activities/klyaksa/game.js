// Клякса: подвал тетрадки — совместная версия для «Активностей» Vicinity (до 4 игроков).
// Графика, звук и данные — из оригинальной игры; логика переписана для игры вместе (см. «сетевая игра»).
(()=>{
'use strict';
const cv=document.getElementById('c'),ctx=cv.getContext('2d'),stage=document.getElementById('stage');
const BW=336,BH=232,HUD=24,T=16,COLS=19,ROWS=11;
const RX0=16,RY0=HUD+16,RX1=RX0+COLS*T,RY1=RY0+ROWS*T,CX=(RX0+RX1)/2,CY=(RY0+RY1)/2,TRANS=20;
cv.width=BW;cv.height=BH;
function fit(){const aw=stage.clientWidth-8,ah=stage.clientHeight-8;let s=Math.min(aw/BW,ah/BH);if(s>=2)s=Math.floor(s);s=Math.max(0.5,s);cv.style.width=Math.round(BW*s)+'px';cv.style.height=Math.round(BH*s)+'px';}
addEventListener('resize',fit);fit();
const TAU=Math.PI*2,rnd=(a,b)=>a+Math.random()*(b-a),ri=(a,b)=>Math.floor(rnd(a,b+1)),pick=a=>a[Math.floor(Math.random()*a.length)],clamp=(v,a,b)=>v<a?a:v>b?b:v;
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const DIR={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};

/* ================= палитра и спрайты ================= */
const PAL={k:'#120e17',K:'#2a2433',b:'#1d2b53',B:'#29447e',h:'#4f7cc4',H:'#9cc3ff',w:'#fff8ec',W:'#d8cfbd',r:'#e43b44',R:'#9e2835',P:'#ff8e8e',y:'#feae34',Y:'#fee761',o:'#f77622',g:'#63c74d',G:'#3e8948',D:'#265c42',v:'#b55088',V:'#68386c',u:'#7a5bd6',a:'#8b9bb4',A:'#5a6988',l:'#c0cbdc',n:'#8f563b',N:'#5d3a28',c:'#2ce8f5',C:'#0099db',e:'#f5a3a3',E:'#e07a7a',f:'#5b7fc0',F:'#3f5a96',i:'#8fb0e8',t:'#e4a672',T:'#b86f50',p:'#f4ecd8',s:'#eadfc6',L:'#a9c4e8',m:'#e8a0a0'};
function mk(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function spr(rows){const w=Math.max(...rows.map(r=>r.length)),h=rows.length,c=mk(w,h),g=c.getContext('2d');for(let y=0;y<h;y++){const r=rows[y];for(let x=0;x<r.length;x++){const col=PAL[r[x]];if(col){g.fillStyle=col;g.fillRect(x,y,1,1);}}}return c;}
function flip(c){const o=mk(c.width,c.height),g=o.getContext('2d');g.translate(c.width,0);g.scale(-1,1);g.drawImage(c,0,0);return o;}
const WHC=new Map();
function white(c){let o=WHC.get(c);if(!o){o=mk(c.width,c.height);const g=o.getContext('2d');g.drawImage(c,0,0);g.globalCompositeOperation='source-in';g.fillStyle='#fff8ec';g.fillRect(0,0,o.width,o.height);WHC.set(c,o);}return o;}

const D={
player:[[
'................','.....kkkkkk.....','...kkbbbbbbkk...','..kbbBBBBBBbbk..','.kbBBhHBBBBBBbk.','.kbBhHBBBBBBBbk.','kbBBhBBBBBBBBBbk','kbBBBBBBBBBBBBbk',
'kbBBBBBBBBBBBBbk','kbBBBBBBBBBBBBbk','kbbBBBBBBBBBBbbk','.kbbBBBBBBBBbbk.','.kbbbbbbbbbbbbk.','..kkbbkbbkbbkk..','....kk.kk.kk....','................'],[
'................','................','.....kkkkkk.....','...kkbbbbbbkk...','..kbbBBBBBBbbk..','.kbBhHBBBBBBBbk.','kbBhHBBBBBBBBBbk','kbBBhBBBBBBBBBbk',
'kbBBBBBBBBBBBBbk','kbBBBBBBBBBBBBbk','kbbBBBBBBBBBBbbk','kbbbBBBBBBBBbbbk','.kbbbbbbbbbbbbk.','.kkbbbkbbkbbbkk.','...kkk.kk.kkk...','................'],[
'......kkkk......','....kkbbbbkk....','...kbBBBBBBbk...','..kbBhHBBBBBbk..','..kbhHBBBBBBbk..','.kbBhBBBBBBBBbk.','.kbBBBBBBBBBBbk.','.kbBBBBBBBBBBbk.',
'.kbBBBBBBBBBBbk.','.kbBBBBBBBBBBbk.','.kbbBBBBBBBBbbk.','..kbbBBBBBBbbk..','..kbbbbbbbbbbk..','...kkbkbbkbkk...','.....k.kk.k.....','................']],
pdie:[[
'................','................','................','................','................','.....kkkkkk.....','...kkbbbbbbkk...','..kbBBBBBBBBbk..',
'.kbBhBBBBBBBBbk.','kbBBBBBBBBBBBBbk','kbBBBBBBBBBBBBbk','kbbBBBBBBBBBBbbk','.kbbbbbbbbbbbbk.','kkkbbkbbbkbbkkkk','..kk.kk.kk.kk...','................'],[
'................','................','................','................','................','................','................','................',
'................','...kkkkkkkkkk...','.kkbbbbbbbbbbkk.','kbbBBBBBBBBBBbbk','kbBBhBBBBBBBBBbk','.kkbbbbbbbbbbkk.','...kkkkkkkkkk...','................']],
fly:[[
'..ll...ll..','.lwwl.lwwl.','.lwwlklwwl.','..llkkkll..','...krkrk...','...kkkkk...','....k.k....','...........'],[
'...........','...........','...kkkkk...','.llkkkkkll.','lwwlrkrlwwl','lwwlkkklwwl','.ll.k.k.ll.','...........']],
walker:[[
'.....kkkk.....','...kkrrrrkk...','..krrPPrrrrk..','.krPPrrrrrrrk.','.krPrrrrrrrrk.','krrrrrrrrrrrrk','krrrrrrrrrrrrk','krrrrrrrrrrrrk',
'kRrrrrrrrrrrRk','.kRRrrrrrrRRk.','..kkRRkRRkkk..','....kk..kk....'],[
'..............','.....kkkk.....','..kkkrrrrkkk..','.krrPPrrrrrrk.','krPPrrrrrrrrrk','krPrrrrrrrrrrk','krrrrrrrrrrrrk','krrrrrrrrrrrrk',
'kRrrrrrrrrrrRk','kRRrrrrrrrrRRk','.kkRRkRRkRRkk.','..kk.kk.kk.kk.']],
turret:[
'....kkkkk....','..kkwwwwwkk..','.kwwwwwwwwwk.','.kwwrwwwwwwk.','kwwwwwwwwrwwk','kwwwwwwwwwwwk','kwrwwwwwwwwwk','kwwwwwwwwwwwk',
'kwwwwwwwrwwwk','.kwwwwwwwwwk.','.kwwwwwwwwwk.','..kkwwwwwkk..','....kkkkk....'],
dasher:[[
'....kkkkkk....','..kkgggggGkk..','.kggYggggggGk.','kgYYggggggggGk','kgggggggggggGk','kgggggggggggGk','kGgggggggggGGk','.kGGgggggGGGk.',
'..kkGGkGGkkk..','...kk.kk.kk...','..............'],[
'..............','....kkkkkk....','..kkgggggGkk..','.kggYggggggGk.','kgYYggggggggGk','kgggggggggggGk','kGgggggggggGGk','.kGGgggggGGGk.',
'..kkGGGGGGkk..','..kk.kk.kk.kk.','..............']],
splitter:[
'......kkkkkk......','....kkvvvvvvkk....','...kvvPvvvvvvvk...','..kvPPvvvvvvvvvk..','.kvPvvvvvvvvvvvvk.','.kvvvvvvvvvvvvvvk.','kvvvvvvvvvvvvvvvvk','kvvvvvvvvvvvvvvvvk',
'kvvvvvvvvvvvvvvvvk','kVvvvvvvvvvvvvvvVk','.kVvvvvvvvvvvvvVk.','.kVVvvvvvvvvvvVVk.','..kkVVVkVVkVVVkk..','....kkk.kk.kkk....','..................'],
mini:['...kkkk...','.kkvvvvkk.','kvPvvvvvvk','kvvvvvvvvk','kvvvvvvvvk','kVvvvvvvVk','.kVVvvVVk.','..kk.kkk..'],
baby:['...kkkk...','.kkbbbbkk.','kbhBBBBBbk','kbBBBBBBbk','kbBBBBBBbk','kbbBBBBbbk','.kkbbbbkk.','..kk.kkk..'],
eraser:['................','.kkkkkkkkkkkkkk.','kPPPPPPPPPkiiiik','kPPPPPPPPPkiiiik','keeeeeeeeekffffk','keeeeeeeeekffffk','keeeeewweekffffk','keeeeeeeeekffffk',
'keeeeeeeeekffffk','keeeeeeeeekffffk','keeeeeeeeekffffk','kEEEEEEEEEkFFFFk','kEEEEEEEEEkFFFFk','.kkkkkkkkkkkkkk.','.KKKKKKKKKKKKKK.','................'],
tinted:['................','.kkkkkkkkkkkkkk.','kPPPPPPPPPkiiiik','kPPPPPPPPPkiiiik','keeeeeeeeekffffk','keeyeeeyeekffffk','keeeyeyeeekffffk','keeeeyeeeekffffk',
'keeeyeyeeekffffk','keeyeeeyeekffffk','keeeeeeeeekffffk','kEEEEEEEEEkFFFFk','kEEEEEEEEEkFFFFk','.kkkkkkkkkkkkkk.','.KKKKKKKKKKKKKK.','................'],
inkpot:['................','.....kkkkkk.....','.....kAAAAk.....','....kkkkkkkk....','...kbbbbbbbbk...','..kbhbbbbbbbbk..','..kbhbbbbbbbbk..','..kbbbbbbbbbbk..',
'..kbbbbbbbbbbk..','..kbbbbbbbbbbk..','..kbbbbbbbbbbk..','..kBBBBBBBBBBk..','...kkkkkkkkkk...','...KKKKKKKKKK...','................','................'],
heart:['.kk...kk.','krrk.krrk','krPrkrrrk','krrrrrrrk','.krrrrrk.','..krrrk..','...krk...','....k....'],
heartE:['.kk...kk.','kAAk.kAAk','kAAAkAAAk','kAAAAAAAk','.kAAAAAk.','..kAAAk..','...kAk...','....k....'],
coin:[['..kkk..','.kyYyk.','kyYyyyk','kyYyyyk','kyyyyyk','.kyyyk.','..kkk..'],['..kkk..','.kYyyk.','.kYyyk.','.kYyyk.','.kyyyk.','.kyyyk.','..kkk..'],['...k...','..kYk..','..kyk..','..kyk..','..kyk..','..kyk..','...k...']],
bomb:[['......y..','.....kY..','....kk...','..kkkkk..','.kAAAAAk.','kAlAAAAAk','kAlAAAAAk','kAAAAAAAk','.kAAAAAk.','..kkkkk..'],['.......Y.','.....ky..','....kk...','..kkkkk..','.kAAAAAk.','kAlAAAAAk','kAlAAAAAk','kAAAAAAAk','.kAAAAAk.','..kkkkk..']],
pedestal:['..kkkkkkkkkkkkkk..','.krrrrrrrrrrrrrrk.','.kwwwwwwwwwwwwwRk.','.kRRRRRRRRRRRRRRk.','kkkkkkkkkkkkkkkkkk','kffffffffffffffffk','kwwwwwwwwwwwwwwwFk','kFFFFFFFFFFFFFFFFk','.kkkkkkkkkkkkkkkk.'],
skull:['.www.','wkwkw','wwwww','.w.w.','.www.'],
star:['..Y..','.YYY.','YYYYY','.Y.Y.','Y...Y'],
shoes:['..kkkk....kkkk..','.kwrrrk..kwrrrk.','.kkkkkk..kkkkkk.'],
glasses:['.kkkk..kkkk.','kAccAkkAccAk','kAcCAk.AcCAk','.kkkk..kkkk.'],
maghat:['kk....kk','kl....lk','kr....rk','kr....rk','kRr..rRk','.kRrrRk.','..kkkk..'],
horn:['.l.','.l.','kak','kak','klk','kkk'],
flames:[['..r....r..','.ryr..ryr.','.ryYrryYr.','..rrrrrr..'],['...r..r...','..ryrryr..','.ryYyyYyr.','..rrrrrr..']],
clip:['.lll.','l...a','l.a.a','l.a.a','l.a.a','l.a.a','l...a','.aaa.'],
doodles:[['...a...','...a...','aaaaaaa','.aaaaa.','..aaa..','.aa.aa.','.a...a.'],['.aaaaa.','a.....a','a.a.a.a','a.....a','a.aaa.a','a.....a','.aaaaa.'],
 ['mmmmm..','m......','mmmm...','....m..','....m..','m...m..','.mmm...'],['....a..','.....a.','aaaaaaa','.....a.','....a..'],['.mm.mm.','mmmmmmm','mmmmmmm','.mmmmm.','..mmm..','...m...']],
items:{
 coffee:[['.....a...a......','......a...a.....','.....a...a......','................','..kkkkkkkkk.....','..kwwwwwwwk.....','..kwNNNNNwkkk...','..kwwwwwwwk.k...','..kwwrwwwwk.k...','..kwrrrwwwkkk...','..kwwrwwwwk.....','...kwwwwwk......','.kkkkkkkkkkk....','.kWWWWWWWWWk....','..kkkkkkkkk.....','................'],
  ['......a...a.....','.....a...a......','......a...a.....','................','..kkkkkkkkk.....','..kwwwwwwwk.....','..kwNNNNNwkkk...','..kwwwwwwwk.k...','..kwwrwwwwk.k...','..kwrrrwwwkkk...','..kwwrwwwwk.....','...kwwwwwk......','.kkkkkkkkkkk....','.kWWWWWWWWWk....','..kkkkkkkkk.....','................']],
 pepper:[['.........kk.....','........kGk.....','.......kGGk.....','......kkGkk.....','.....krrkk......','....krPrrk......','...krPrrrk......','...krrrrk.......','..krrrrrk.......','..krrrrk........','.krrrrRk........','.krrrRk.........','krrrRk..........','krRRk...........','.kkk............','................']],
 sneakers:[['................','................','................','....kkkk........','...kwrrwk.......','...kwrrwk.......','...kwrrwkk......','...kwwwwrrkk....','..kwwwwwrrrrkk..','..krrwwwwwrrrrk.','..krrrrwwwwrrrk.','..kwwwwwwwwwwwk.','..kAAAAAAAAAAAk.','...kkkkkkkkkkk..','................','................']],
 binoc:[['................','................','...kkkk..kkkk...','..kAAAAkkAAAAk..','..kAllAkkAllAk..','..kAAAAkkAAAAk..','..kAAAAAAAAAAk..','..kAAAAkkAAAAk..','.kAAAAAkkAAAAAk.','.kAkkkAkkAkkkAk.','.kAkccAkkAkccAk.','.kAkCcAkkAkCcAk.','.kAkkkAkkAkkkAk.','..kkkkk..kkkkk..','................','................']],
 pie:[['................','......kk.kk.....','.....krrkrrk....','......krrrk.....','....kkkkkkkk....','..kktYttYttYkk..','.ktYttYttYttttk.','.kttttttttttttk.','.ktttttttttttnk.','.kTttttttttttnk.','..kTTTTTTTTnnk..','....kkkkkkkk....','................','................','................','................']],
 triple:[['................','...k...k...k....','..kyk.kyk.kyk...','..kyk.kyk.kyk...','..kyk.kyk.kyk...','..kykkkykkkyk...','...kyyyyyyyk....','....kkkykkk.....','......kyk.......','......kyk.......','......knk.......','......knk.......','......knk.......','......knk.......','......kkk.......','................']],
 magnet:[['................','...kkk....kkk...','...kwk....kwk...','...klk....klk...','...kkk....kkk...','...krk....krk...','...krk....krk...','...krk....krk...','...krRk..kRrk...','....krRkkRrk....','....kkrRRrkk....','......kkkk......','................','................','................','................']],
 awl:[['..............k.','.............klk','............kak.','...........kak..','..........kak...','.........kak....','........kak.....','.......kkkk.....','......knnkk.....','.....knnNk......','....knnNk.......','...knnNk........','..knnNk.........','.knnNk..........','.kNNk...........','..kk............']],
 dumbbell:[['................','................','................','................','................','.kkk........kkk.','kAAAk......kAAAk','kAlAkkkkkkkkAlAk','kAlAaaaaaaaaAlAk','kAAAkkkkkkkkAAAk','kAAAk......kAAAk','.kkk........kkk.','................','................','................','................']],
 battery:[['................','......kkkk......','......klak......','....kkkkkkkk....','....kYYYYYYk....','....kYYkYYYk....','....kYkkkYYk....','....kYYkYYYk....','....kYYYYYYk....','....kkkkkkkk....','....kAAAAAAk....','....kAlAAAAk....','....kAlAAAAk....','....kAAAAAAk....','....kkkkkkkk....','................']],
 kit:[['................','................','.....kkkkkk.....','.....k....k.....','..kkkkkkkkkkkk..','..kwwwwwwwwwwk..','..kwwwwrrwwwwk..','..kwwwwrrwwwwk..','..kwwrrrrrrwwk..','..kwwrrrrrrwwk..','..kwwwwrrwwwwk..','..kwwwwrrwwwwk..','..kWWWWWWWWWWk..','..kkkkkkkkkkkk..','................','................']],
 tracer:[['................','................','..........kkkk..','.........kYYYYk.','........kYwwwYk.','.......kYwwwwYk.','......kyYwwwYk..','.....kyyYYYYk...','....koyyyykk....','...kooyyk.......','..koook.........','.kook...........','.kk.............','................','................','................'],
  ['................','................','..........kkkk..','.........kYYYYk.','........kYwwwYk.','.......kYwwwwYk.','......kyYwwwYk..','.....kyyYYYYk...','....kryyyykk....','...krroyk.......','..krrok.........','.krok...........','.kk.............','................','................','................']],
 clip:[['................','......llll......','.....l....a.....','.....l.aa.a.....','.....l.a.aa.....','.....l.a..a.....','.....l.a..a.....','.....l.a..a.....','.....l.a..a.....','.....l.a..a.....','.....l.a..a.....','.....l.a.a......','.....l..a.......','......aa........','................','................']],
 baby:[['................','................','................','.....kkkkkk.....','....kbbbbbbk....','...kbhBBBBBbk...','...kbBwkBwkbk...','...kbBBBBBBbk...','...kbBBrrBBbk...','...kbbBBBBbbk...','....kkbkkbkk....','................','................','................','................','................']],
 compass:[['................','......kkkk......','....kkllllkk....','...klwwwwwwlk...','..klwwwrwwwwlk..','..klwwwrrwwwlk..','.klwwwwrkwwwwlk.','.klwwwwkkwwwwlk.','.klwwwwkAwwwwlk.','..klwwwAAwwwlk..','..klwwwwAwwwlk..','...klwwwwwwlk...','....kkllllkk....','......kkkk......','................','................']]
}};
const SP={};
SP.player=D.player.map(spr);SP.pdie=D.pdie.map(spr);SP.fly=D.fly.map(spr);SP.walker=D.walker.map(spr);SP.turret=spr(D.turret);SP.dasher=D.dasher.map(spr);
SP.splitter=spr(D.splitter);SP.mini=spr(D.mini);SP.baby=spr(D.baby);SP.rocks={eraser:spr(D.eraser),tinted:spr(D.tinted),ink:spr(D.inkpot)};
SP.heart=spr(D.heart);SP.heartE=spr(D.heartE);{const c=D.coin.map(spr);SP.coin=[c[0],c[1],c[2],flip(c[1])];}SP.bomb=D.bomb.map(spr);SP.pedestal=spr(D.pedestal);
SP.skull=spr(D.skull);SP.star=spr(D.star);SP.shoes=spr(D.shoes);SP.glasses=spr(D.glasses);SP.maghat=spr(D.maghat);SP.horn=spr(D.horn);SP.flames=D.flames.map(spr);SP.clip=spr(D.clip);
SP.doodles=D.doodles.map(spr);SP.items={};for(const k in D.items)SP.items[k]=D.items[k].map(spr);
function blobFrames(rx,ry,cols,n){const out=[];for(let f=0;f<n;f++){const ph=f/n*TAU,w=rx*2+5,h=ry*2+8,cx=w/2,cy=ry+2,c=mk(w,h),g=c.getContext('2d'),grid=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=(x+0.5-cx)/rx,dy=(y+0.5-cy)/ry,a=Math.atan2(dy,dx),wob=1+Math.sin(a*3+ph)*0.07+Math.sin(a*5-ph*2)*0.04;let inn=dx*dx+dy*dy<wob*wob;
  if(!inn)for(const [dxp,len] of [[-0.55,3+Math.round(Math.sin(ph)*1.2)],[0.12,4+Math.round(Math.cos(ph)*1.5)],[0.6,2+Math.round(Math.sin(ph+1))]]){const xx=Math.round(cx+dxp*rx);if(x===xx||x===xx+1){const by=cy+Math.sqrt(Math.max(0,1-dxp*dxp))*ry;if(y>=by-2&&y<by+len)inn=true;}}
  grid[y*w+x]=inn?1:0;}
 const at=(x,y)=>x<0||y<0||x>=w||y>=h?0:grid[y*w+x];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(!at(x,y))continue;const edge=!at(x-1,y)||!at(x+1,y)||!at(x,y-1)||!at(x,y+1);let col;
  if(edge)col=PAL.k;else{const dx=(x+0.5-cx)/rx,dy=(y+0.5-cy)/ry;if(dx*0.7+dy<-0.72&&dx*dx+dy*dy<0.75)col=cols.hi;else if(dy>0.5)col=cols.dk;else col=cols.base;}
  g.fillStyle=col;g.fillRect(x,y,1,1);}
 out.push(c);}return out;}
SP.blot=blobFrames(17,14,{base:PAL.r,dk:PAL.R,hi:PAL.P},8);

/* ================= пиксельный текст ================= */
const FONT='8px "Press Start 2P", monospace',TXT=new Map();
function hexRGB(h){return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}
function txt(s,col){const key=col+'|'+s;let c=TXT.get(key);if(c)return c;c=mk(8,10);let g=c.getContext('2d');g.font=FONT;const w=Math.max(1,Math.ceil(g.measureText(s).width)+1);c.width=w;c.height=10;g=c.getContext('2d');g.font=FONT;g.textBaseline='top';g.fillStyle='#ffffff';g.fillText(s,0,0);
 try{const d=g.getImageData(0,0,w,10),a=d.data,[r,gg,b]=hexRGB(col);for(let i=0;i<a.length;i+=4){if(a[i+3]>100){a[i]=r;a[i+1]=gg;a[i+2]=b;a[i+3]=255;}else a[i+3]=0;}g.putImageData(d,0,0);}catch(e){}
 if(TXT.size>600)TXT.clear();TXT.set(key,c);return c;}
function text(s,x,y,col,align,sh,k){s=String(s);k=k||1;const c=txt(s,col),w=c.width*k,dx=Math.round(align==='center'?x-w/2:align==='right'?x-w:x),dy=Math.round(y);if(sh){const d=txt(s,sh);ctx.drawImage(d,dx+k,dy+k,d.width*k,d.height*k);}ctx.drawImage(c,dx,dy,w,c.height*k);return w;}
if(document.fonts&&document.fonts.load){document.fonts.load(FONT).then(()=>TXT.clear()).catch(()=>{});document.fonts.ready.then(()=>TXT.clear()).catch(()=>{});}

/* ================= звук ================= */
let AC=null,muted=false;try{muted=localStorage.getItem('klyaksa_mute')==='1';}catch(e){}
function actx(){if(!AC){try{const C=window.AudioContext||window.webkitAudioContext;if(C)AC=new C();}catch(e){AC=null;}}if(AC&&AC.state==='suspended')AC.resume().catch(()=>{});return AC;}
function tone(f,d,type,vol,slide,delay){const a=actx();if(!a)return;const t0=a.currentTime+(delay||0),o=a.createOscillator(),g=a.createGain();o.type=type||'square';o.frequency.setValueAtTime(f,t0);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(40,f+slide),t0+d);g.gain.setValueAtTime(0.0001,t0);g.gain.exponentialRampToValueAtTime(vol||0.03,t0+0.01);g.gain.exponentialRampToValueAtTime(0.0001,t0+d);o.connect(g);g.connect(a.destination);o.start(t0);o.stop(t0+d+0.05);}
function noise(d,vol,freq){const a=actx();if(!a)return;const n=Math.max(1,Math.floor(a.sampleRate*d)),b=a.createBuffer(1,n,a.sampleRate),ch=b.getChannelData(0);let last=0;for(let i=0;i<n;i++){if(i%3===0)last=Math.random()*2-1;ch[i]=last*(1-i/n);}const s=a.createBufferSource();s.buffer=b;const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=freq||1200;const g=a.createGain();g.gain.value=vol||0.06;s.connect(f);f.connect(g);g.connect(a.destination);s.start();}
let lastS={};
function sfx(k){if(muted)return;const now=performance.now();if(lastS[k]&&now-lastS[k]<35)return;lastS[k]=now;try{switch(k){
 case 'shoot':tone(560,0.07,'square',0.022,-240);break;
 case 'baby':tone(800,0.05,'square',0.012,-200);break;
 case 'hit':noise(0.05,0.05,2600);break;
 case 'kill':noise(0.14,0.07,900);tone(230,0.14,'square',0.025,-160);break;
 case 'hurt':tone(330,0.3,'sawtooth',0.045,-250);noise(0.15,0.05,700);break;
 case 'door':tone(180,0.18,'triangle',0.05,260);break;
 case 'slam':noise(0.12,0.09,320);tone(90,0.12,'square',0.035,-30);break;
 case 'item':[523,659,784,1047,1319].forEach((f,i)=>tone(f,0.13,'square',0.028,0,i*0.07));break;
 case 'coin':tone(1320,0.05,'square',0.028);tone(1760,0.12,'square',0.028,0,0.05);break;
 case 'heart':tone(520,0.12,'triangle',0.05,320);break;
 case 'bombget':tone(300,0.08,'square',0.03,200);break;
 case 'fuse':tone(1900,0.02,'square',0.008);break;
 case 'boom':noise(0.6,0.16,520);tone(110,0.5,'sine',0.09,-70);break;
 case 'boss':tone(140,0.7,'sawtooth',0.05,-80);tone(70,0.7,'square',0.03,-30,0.1);break;
 case 'eshot':tone(260,0.08,'square',0.016,-90);break;
 case 'trap':[440,370,311,262,196].forEach((f,i)=>tone(f,0.14,'triangle',0.05,0,i*0.08));break;
 case 'buy':tone(880,0.06,'square',0.03);tone(1320,0.1,'square',0.03,0,0.06);break;
 case 'nope':tone(150,0.12,'square',0.03);break;
 case 'charge':tone(200,0.3,'sawtooth',0.04,320);break;
 case 'stun':noise(0.22,0.12,420);break;
 case 'start':[262,330,392,523].forEach((f,i)=>tone(f,0.12,'square',0.03,0,i*0.08));break;
}}catch(e){}}

/* ================= данные игры ================= */
const DEF={fly:{r:4,hp:3,spd:0.62,fly:1,blood:'#2a2433'},walker:{r:6,hp:8,spd:0.42,blood:'#e43b44'},turret:{r:6,hp:10,spd:0,blood:'#9e2835',heavy:1},dasher:{r:6,hp:9,spd:0.34,blood:'#3e8948'},
 splitter:{r:8,hp:13,spd:0.3,blood:'#b55088'},mini:{r:4,hp:4,spd:0.72,blood:'#b55088'},blot:{r:16,hp:110,spd:0.32,blood:'#e43b44',heavy:1,boss:1},eraser:{r:14,hp:130,spd:0.38,blood:'#e07a7a',heavy:1,boss:1}};
const FLOOR_NAMES=['Подвал тетрадки','Глубины пенала','Дно портфеля','Учительская','Архив двоек'];
const BOSS_NAMES={blot:['Великая Клякса','Красная Ручка','Пятно-Переросток'],eraser:['Ластик-Тиран','Резиновый Громила']};
const ITEMS=[
 {id:'coffee',name:'Чёрный кофе',desc:'Стреляешь чаще',apply:p=>{p.rate=Math.max(5,p.rate*0.75);}},
 {id:'pepper',name:'Жгучий перец',desc:'Урон выше',apply:p=>{p.dmg+=1.2;p.tearCol='pepper';}},
 {id:'sneakers',name:'Кеды',desc:'Бегаешь быстрее',apply:p=>{p.speed+=0.25;}},
 {id:'binoc',name:'Бинокль',desc:'Стреляешь дальше',apply:p=>{p.range+=45;}},
 {id:'pie',name:'Пирожок',desc:'Плюс одно сердце',apply:p=>{if(p.maxHp<24){p.maxHp+=2;}p.hp=Math.min(p.maxHp,p.hp+2);}},
 {id:'triple',name:'Трезубец',desc:'Тройной выстрел',apply:p=>{p.triple=true;p.rate*=1.15;}},
 {id:'magnet',name:'Магнит',desc:'Капли летят за врагами',apply:p=>{p.homing=true;p.tearCol='magnet';}},
 {id:'awl',name:'Шило',desc:'Капли прошивают врагов',apply:p=>{p.pierce=true;}},
 {id:'dumbbell',name:'Гантеля',desc:'Крупные тяжёлые капли',apply:p=>{p.dmg+=0.8;p.size=Math.min(4,p.size+1);p.shotSpeed=Math.max(1.8,p.shotSpeed-0.15);}},
 {id:'battery',name:'Батарейка',desc:'Быстрые искрящие капли',apply:p=>{p.shotSpeed+=0.9;p.rate=Math.max(5,p.rate*0.9);p.tearCol='battery';}},
 {id:'kit',name:'Аптечка',desc:'Полное лечение',apply:p=>{if(p.maxHp<24)p.maxHp+=1;p.hp=p.maxHp;}},
 {id:'tracer',name:'Трассер',desc:'Капли оставляют огненный след',apply:p=>{p.tracer=true;p.tearCol='tracer';}},
 {id:'clip',name:'Скрепка',desc:'Кружит рядом и ловит пули',apply:p=>{p.clips=Math.min(3,p.clips+1);}},
 {id:'baby',name:'Клякса-малыш',desc:'Стреляет вместе с тобой',apply:p=>{p.babies=Math.min(3,p.babies+1);p.babyCD.push(0);}},
 {id:'compass',name:'Компас',desc:'Вся карта этажа видна',apply:p=>{p.compass=true;}}
];
const ITEMm={};ITEMS.forEach(i=>ITEMm[i.id]=i);
const TEARC={ink:['#1d2b53','#4f7cc4','#29447e'],pepper:['#9e2835','#ff8e8e','#e43b44'],magnet:['#68386c','#b55088','#7a5bd6'],battery:['#feae34','#fee761','#2ce8f5'],tracer:['#f77622','#fee761','#feae34'],enemy:['#9e2835','#ff8e8e','#e43b44']};

/* ================= сетевая игра: игроки, ведущий, события ================= */
// Ведущий (первый вошедший) считает всю игру и 20 раз в секунду рассылает снимок; остальные шлют
// нажатия и рисуют снимки, плавно подтягивая позиции. Звуки, брызги и кляксы на полу — событиями.
const MP=()=>!!(window.Net&&Net.self&&Net.peers.length>0);
const HOST=()=>!window.Net||!Net.self||Net.isHost();
const SELF=()=>window.Net&&Net.self?Net.self.peerId:0;
let EV=[];
const ev=e=>{if(MP()&&HOST())EV.push(e);};
function S(k){sfx(k);ev({f:'s',k});}

/* цвета клякс игроков: синяя (как в оригинале), зелёная, фиолетовая, оранжевая */
const PCOL=[null,{b:'#1e4d2b',B:'#2f7a3f',h:'#63c74d',H:'#b6f0a0'},{b:'#4a2370',B:'#7a3ea8',h:'#c070d8',H:'#f0b8ff'},{b:'#6b2e10',B:'#b8561f',h:'#f7a050',H:'#ffd8b0'}];
const PINK=['#1d2b53','#1e4d2b','#4a2370','#6b2e10'];
function sprPal(rows,over){if(!over)return spr(rows);const w=Math.max(...rows.map(r=>r.length)),h=rows.length,c=mk(w,h),g=c.getContext('2d');for(let y=0;y<h;y++){const r=rows[y];for(let x=0;x<r.length;x++){const col=over[r[x]]||PAL[r[x]];if(col){g.fillStyle=col;g.fillRect(x,y,1,1);}}}return c;}
const PSP=PCOL.map(o=>({player:D.player.map(r=>sprPal(r,o)),pdie:D.pdie.map(r=>sprPal(r,o)),baby:sprPal(D.baby,o)}));
PCOL.forEach((o,i)=>{if(i)TEARC['ink'+i]=[o.b,o.h,o.B];});

/* шрифт: кириллица — отдельный файл; грузим её явно и сбрасываем кеш надписей, когда шрифт готов */
if(document.fonts&&document.fonts.load){document.fonts.load(FONT,'КЛЯКСА этаж Ёё').then(()=>TXT.clear()).catch(()=>{});if(document.fonts.addEventListener)document.fonts.addEventListener('loadingdone',()=>TXT.clear());}

/* ================= состояние ================= */
let state='title',level=1,floor=null,room=null,PL=[],enemies=[],tears=[],ebul=[],fires=[],bombs=[],fx=[],parts=[],pop=null,hint=null,shake=0,frame=0,kills=0,itemPool=[],trans=null,fadeT=0,bossName='',hintCD=0;
let team={coins:0,bombs:1},overT=0,eid=1;
let best=0;try{best=+localStorage.getItem('klyaksa_best')||0;}catch(e){}
let isTouch=!!(window.matchMedia&&matchMedia('(pointer:coarse)').matches);
const K={},sticks={move:{id:null,ox:0,oy:0,vx:0,vy:0},shoot:{id:null,ox:0,oy:0,vx:0,vy:0}};
/** Нажатия игроков: свои — с клавиатуры, чужие — по сети (ведущему) */
const INPUT=new Map();let localBombs=0;
const has=(p,id)=>p.items.includes(id);
const meP=()=>PL.find(p=>p.peer===SELF())||PL[0]||null;
function newPlayer(peer,idx,name){return{peer,idx,name:name||'',x:CX,y:CY,r:6,vx:0,vy:0,hp:6,maxHp:6,speed:1.35,dmg:3.5,rate:22,range:120,shotSpeed:2.8,size:2,cool:0,inv:0,triple:false,homing:false,pierce:false,tracer:false,clips:0,babies:0,babyCD:[],compass:false,
 tearCol:idx?'ink'+idx:'ink',look:{x:0,y:1},recoil:0,items:[],walkT:0,blinkT:120,hist:[],dead:false,deathT:0,clipHit:new Map(),bombSeen:0};}
function drawItemFromPool(){if(!itemPool.length)itemPool=['coffee','pepper','pie','kit','dumbbell','sneakers','binoc'].slice();return ITEMm[itemPool.splice(Math.floor(Math.random()*itemPool.length),1)[0]];}
function popup(t,s,icon,life){pop={t,s,icon,life:life||170,max:life||170};ev({f:'pop',t,s,i:icon?icon.__id:null,l:life||170});}
function showHint(t,peer){if(peer&&peer!==SELF()){ev({f:'hint',t,to:peer});return;}if(hintCD>0)return;hint={t,life:90};hintCD=40;}
/* значок предмета для всплывашки по сети */
for(const k in SP.items)SP.items[k][0].__id=k;

/** Игроки по составу комнаты: у ведущего — все из Net (или один в одиночной игре) */
function syncRoster(){const list=window.Net&&Net.self?Net.all():[{peerId:0,name:''}];
 const keep=PL.filter(p=>list.some(q=>q.peerId===p.peer));
 for(const q of list)if(!keep.some(p=>p.peer===q.peerId)){const used=new Set(keep.map(p=>p.idx));let idx=0;while(used.has(idx)&&idx<3)idx++;const p=newPlayer(q.peerId,idx,q.name);p.bombSeen=(INPUT.get(q.peerId)||{b:0}).b;if(state==='play'&&room){p.x=CX+ri(-10,10);p.y=CY+ri(-6,6);p.inv=90;}keep.push(p);}
 for(const p of keep){const q=list.find(x=>x.peerId===p.peer);if(q)p.name=q.name||p.name;}
 PL=keep.sort((a,b)=>a.idx-b.idx);}

/* ================= генерация ================= */
function genRocks(){const rocks=[];if(Math.random()<0.2)return rocks;const seen=new Set(),n=ri(2,6);
 for(let i=0;i<n;i++){const c=ri(0,7),r=ri(0,3),type=Math.random()<0.75?'eraser':'ink';
  for(const [a,b] of [[c,r],[COLS-1-c,r],[c,ROWS-1-r],[COLS-1-c,ROWS-1-r]]){const k=a+','+b;if(!seen.has(k)){seen.add(k);rocks.push({x:RX0+a*T,y:RY0+b*T,w:T,h:T,type});}}}
 if(rocks.length&&Math.random()<0.35)pick(rocks).type='tinted';return rocks;}
const key=(x,y)=>x+','+y;
function linkFloor(list,start){const map={};for(const r of list)map[key(r.gx,r.gy)]=r;
 for(const r of list){r.doors={};for(const [d,[ax,ay]] of Object.entries(DIR))r.doors[d]=map[key(r.gx+ax,r.gy+ay)]||null;}return{list,start,map};}
function genFloor(){
 for(let att=0;att<800;att++){
  const need=att<400?3:2,map={},start={gx:4,gy:4},list=[start];map[key(4,4)]=start;
  const target=Math.min(8+level*2,17);let guard=0;
  while(list.length<target&&guard++<900){const b=pick(list),[dx,dy]=pick(Object.values(DIR)),nx=b.gx+dx,ny=b.gy+dy;if(nx<0||ny<0||nx>8||ny>8||map[key(nx,ny)])continue;let nb=0;for(const [ax,ay] of Object.values(DIR))if(map[key(nx+ax,ny+ay)])nb++;if(nb>1)continue;const r={gx:nx,gy:ny};map[key(nx,ny)]=r;list.push(r);}
  if(list.length<target)continue;
  linkFloor(list,start);
  for(const r of list)r.d=-1;start.d=0;const q=[start];while(q.length){const c=q.shift();for(const n of Object.values(c.doors))if(n&&n.d<0){n.d=c.d+1;q.push(n);}}
  const ends=list.filter(r=>r!==start&&Object.values(r.doors).filter(Boolean).length===1).sort((a,b)=>b.d-a.d);
  if(ends.length<need||ends[0].d<3)continue;
  const boss=ends[0],rest=ends.slice(1),treasure=rest.splice(Math.floor(Math.random()*rest.length),1)[0],shop=rest.length?rest[Math.floor(Math.random()*rest.length)]:null;
  for(const r of list){r.type=r===start?'start':r===boss?'boss':r===treasure?'treasure':r===shop?'shop':'normal';r.cleared=r.type!=='normal'&&r.type!=='boss';r.visited=false;r.seed=(Math.random()*1e9)|0;
   r.rocks=r.type==='normal'?genRocks():[];r.items=[];r.pickups=[];r.trap=null;r.trapT=0;r.floorC=null;r.doorT=1;
   if(r.type==='treasure')r.items.push({x:CX,y:CY,kind:'item',it:drawItemFromPool(),price:0});
   if(r.type==='shop')r.items.push({x:CX-56,y:CY,kind:'item',it:drawItemFromPool(),price:15},{x:CX,y:CY,kind:'heart',price:3},{x:CX+56,y:CY,kind:'bomb',price:5});}
  return linkFloor(list,start);
 }
 return null;
}
function placeAll(x,y,spread){PL.forEach((p,i)=>{const n=PL.length,o=n>1?(i-(n-1)/2)*(spread||14):0;p.x=clamp(x+(spread===0?0:o),RX0+p.r,RX1-p.r);p.y=y;p.vx=p.vy=0;p.hist=[];});}
function newGame(){level=1;kills=0;team={coins:0,bombs:1};PL=[];syncRoster();PL.forEach(p=>{Object.assign(p,newPlayer(p.peer,p.idx,p.name));p.bombSeen=inputOf(p).b;});itemPool=ITEMS.map(i=>i.id);buildFloor();state='play';S('start');popup('Этаж 1',FLOOR_NAMES[0],null);}
function buildFloor(){floor=genFloor();room=floor.start;room.visited=true;placeAll(CX,CY);enemies=[];tears=[];ebul=[];fires=[];bombs=[];fx=[];parts=[];trans=null;fadeT=30;ev({f:'floor',d:floorWire()});}
function mkEnemy(type,x,y){const d=DEF[type],hs=(1+(level-1)*0.35)*(1+(Math.max(1,PL.length)-1)*0.35),hp=type==='blot'?(110+(level-1)*60)*(1+(PL.length-1)*0.5):type==='eraser'?(130+(level-1)*65)*(1+(PL.length-1)*0.5):d.hp*hs;
 return{id:eid++,type,x,y,r:d.r,hp,maxhp:hp,spd:d.spd*(1+(level-1)*0.05),fly:!!d.fly,blood:d.blood,heavy:!!d.heavy,boss:!!d.boss,t:0,spawn:d.boss?70:36,spawnMax:d.boss?70:36,flash:0,kx:0,ky:0,state:0,cd:rnd(50,120),wa:rnd(0,TAU),seed:Math.floor(rnd(0,100)),dead:false,ax:0,ay:0,ct:0,mouth:0};}
function overlapsRock(x,y,r){for(const k of room.rocks){const nx=clamp(x,k.x,k.x+k.w),ny=clamp(y,k.y,k.y+k.h);if((x-nx)**2+(y-ny)**2<r*r)return true;}return false;}
const alive=()=>PL.filter(p=>!p.dead);
function nearest(x,y){let best=null,bd=1e9;for(const p of PL){if(p.dead)continue;const d=Math.hypot(p.x-x,p.y-y);if(d<bd){bd=d;best=p;}}return best||PL[0];}
function spawnEnemies(){const n=Math.min(3+level+ri(0,1)+Math.max(0,PL.length-1),11),pool=level<2?['fly','fly','walker','walker','turret']:['fly','walker','walker','turret','dasher','splitter','dasher'];
 for(let i=0;i<n;i++){const t=pick(pool);let x,y,tr=0,np;do{x=rnd(RX0+16,RX1-16);y=rnd(RY0+16,RY1-16);np=nearest(x,y);tr++;}while(((np&&Math.hypot(x-np.x,y-np.y)<80)||overlapsRock(x,y,DEF[t].r+3))&&tr<90);enemies.push(mkEnemy(t,x,y));}}
function spawnBoss(){const type=level%2===1?'blot':'eraser',names=BOSS_NAMES[type];bossName=names[Math.floor((level-1)/2)%names.length];enemies.push(mkEnemy(type,CX,CY-10));S('boss');popup(bossName,'Босс этажа '+level,null,150);}
function makeFloorCanvas(r){const c=mk(COLS*T,ROWS*T),g=c.getContext('2d'),rng=mulberry32(r.seed);g.fillStyle=PAL.p;g.fillRect(0,0,c.width,c.height);
 for(let i=0;i<300;i++){g.fillStyle=rng()<0.5?PAL.s:'#efe5cf';g.fillRect(Math.floor(rng()*c.width),Math.floor(rng()*c.height),1,1);}
 g.fillStyle=PAL.L;for(let y=7;y<c.height;y+=8)g.fillRect(0,y,c.width,1);
 g.fillStyle=PAL.m;g.fillRect(22,0,1,c.height);g.fillRect(24,0,1,c.height);
 const nd=r.type==='start'?0:1+Math.floor(rng()*3);g.globalAlpha=0.55;
 for(let i=0;i<nd;i++){const d=SP.doodles[Math.floor(rng()*SP.doodles.length)];g.drawImage(d,30+Math.floor(rng()*(c.width-50)),6+Math.floor(rng()*(c.height-20)));}
 if(r.type==='treasure')for(let i=0;i<6;i++)g.drawImage(SP.doodles[0],20+Math.floor(rng()*(c.width-40)),6+Math.floor(rng()*(c.height-20)));
 g.globalAlpha=1;
 if(r.type==='boss'){g.globalAlpha=0.35;for(let i=0;i<5;i++)blobInto(g,30+rng()*(c.width-60),20+rng()*(c.height-40),4+rng()*8,PAL.R,rng);g.globalAlpha=1;}
 g.fillStyle='rgba(18,14,23,0.22)';g.fillRect(0,0,c.width,3);g.fillRect(0,0,3,c.height);g.fillStyle='rgba(18,14,23,0.1)';g.fillRect(0,3,c.width,2);g.fillRect(c.width-2,0,2,c.height);g.fillRect(0,c.height-2,c.width,2);
 return c;}
function blobInto(g,cx,cy,r,col,rng){rng=rng||Math.random;g.fillStyle=col;const R=Math.ceil(r)+1;for(let y=-R;y<=R;y++)for(let x=-R;x<=R;x++){const a=Math.atan2(y,x),k=r*(0.75+0.35*Math.abs(Math.sin(a*3+r)));if(x*x+y*y<k*k)g.fillRect(Math.round(cx+x),Math.round(cy+y),1,1);}
 const nd=2+Math.floor(rng()*4);for(let i=0;i<nd;i++){const a=rng()*TAU,d=r+2+rng()*r;g.fillRect(Math.round(cx+Math.cos(a)*d),Math.round(cy+Math.sin(a)*d),rng()<0.5?1:2,rng()<0.5?1:2);}}
function floorC(r){if(!r.floorC)r.floorC=makeFloorCanvas(r);return r.floorC;}
function splat(x,y,r,col){const c=floorC(room).getContext('2d');c.globalAlpha=0.55;blobInto(c,x-RX0,y-RY0,r,col);c.globalAlpha=1;ev({f:'spl',x:Math.round(x),y:Math.round(y),r,c:col});}

/* стены и затемнение */
const WALLS=(()=>{const c=mk(BW,BH-HUD),g=c.getContext('2d'),rng=mulberry32(77);g.fillStyle='#2a2433';g.fillRect(0,0,c.width,c.height);
 for(let i=0;i<900;i++){g.fillStyle=rng()<0.5?'#231d2b':'#342c3f';g.fillRect(Math.floor(rng()*c.width),Math.floor(rng()*c.height),1+Math.floor(rng()*2),1);}
 g.clearRect(16,16,COLS*T,ROWS*T);
 g.fillStyle='#120e17';g.fillRect(0,0,c.width,1);g.fillRect(0,c.height-1,c.width,1);g.fillRect(0,0,1,c.height);g.fillRect(c.width-1,0,1,c.height);
 g.fillStyle='#4a405e';g.fillRect(15,15,COLS*T+2,1);g.fillRect(15,15,1,ROWS*T+2);g.fillStyle='#1a1520';g.fillRect(15,16+ROWS*T,COLS*T+2,1);g.fillRect(16+COLS*T,15,1,ROWS*T+2);
 for(let x=26;x<c.width-26;x+=14){g.fillStyle='#120e17';g.fillRect(x+1,7,2,2);g.fillStyle='#8b9bb4';g.fillRect(x,2,4,1);g.fillRect(x-1,3,1,16);g.fillRect(x+4,3,1,16);g.fillRect(x,19,4,1);g.fillStyle='#c0cbdc';g.fillRect(x-1,3,1,6);}
 for(const [x,y] of [[0,0],[c.width-12,0],[0,c.height-12],[c.width-12,c.height-12]]){g.fillStyle='#8b9bb4';g.fillRect(x+1,y+1,10,10);g.fillStyle='#5a6988';g.fillRect(x+3,y+3,6,6);g.fillStyle='#c0cbdc';g.fillRect(x+1,y+1,10,1);}
 return c;})();
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const VIGN=(()=>{const c=mk(COLS*T,ROWS*T),g=c.getContext('2d');g.fillStyle='rgba(18,14,23,0.32)';const w=c.width,h=c.height;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const nx=(x/w-0.5)*2,ny=(y/h-0.5)*2,d=Math.min(x,y,w-1-x,h-1-y),v=Math.max(0,Math.hypot(nx*0.92,ny)-0.95)*1.1+Math.max(0,(5-d)/5)*0.5;if(BAYER[(y&3)*4+(x&3)]<clamp(v,0,1)*16)g.fillRect(x,y,1,1);}return c;})();
const DITH=[0.25,0.5,0.75,1].map(lv=>{const c=mk(BW,BH),g=c.getContext('2d');g.fillStyle='#120e17';for(let y=0;y<BH;y++)for(let x=0;x<BW;x++)if(BAYER[(y&3)*4+(x&3)]<lv*16)g.fillRect(x,y,1,1);return c;});

/* ================= физика столкновений ================= */
function pushOut(o,R){const nx=clamp(o.x,R.x,R.x+R.w),ny=clamp(o.y,R.y,R.y+R.h),dx=o.x-nx,dy=o.y-ny,d2=dx*dx+dy*dy;if(d2>=o.r*o.r)return false;
 if(d2===0){const l=o.x-R.x,r=R.x+R.w-o.x,t=o.y-R.y,b=R.y+R.h-o.y,m=Math.min(l,r,t,b);if(m===l)o.x=R.x-o.r;else if(m===r)o.x=R.x+R.w+o.r;else if(m===t)o.y=R.y-o.r;else o.y=R.y+R.h+o.r;}
 else{const d=Math.sqrt(d2);o.x=nx+dx/d*o.r;o.y=ny+dy/d*o.r;}return true;}
function rockAt(x,y){for(const k of room.rocks)if(x>k.x+1&&x<k.x+k.w-1&&y>k.y+1&&y<k.y+k.h-2)return k;return null;}

/* ================= эффекты ================= */
function burst(x,y,col,n,sp,z,net){for(let i=0;i<n;i++){const a=rnd(0,TAU),s=rnd(0.3,sp||1.6);parts.push({x,y,z:z||2,vx:Math.cos(a)*s,vy:Math.sin(a)*s*0.7,vz:rnd(0.5,2.2),life:ri(18,40),col,s:Math.random()<0.3?2:1});}
 if(net!==false)ev({f:'b',x:Math.round(x),y:Math.round(y),c:col,n,sp:sp||1.6,z:z||2});}
function addFx(f){fx.push(f);ev({f:'fx',v:{type:f.type,x:Math.round(f.x),y:Math.round(f.y),col:f.col||null}});}
function shakeTo(v){shake=Math.max(shake,v);ev({f:'sh',v});}
function updParts(){for(let i=parts.length-1;i>=0;i--){const p=parts[i];p.x+=p.vx;p.y+=p.vy;p.z+=p.vz;p.vz-=0.18;if(p.z<0){p.z=0;p.vz*=-0.35;p.vx*=0.6;p.vy*=0.6;}if(--p.life<=0)parts.splice(i,1);}
 for(let i=fx.length-1;i>=0;i--){const f=fx[i];f.t++;if(f.t>(f.type==='boom'?34:f.type==='poof'?16:f.type==='spark'?24:9))fx.splice(i,1);}}

/* ================= игровая логика (ведущий) ================= */
function goRoom(dir){const nb=room.doors[dir];if(!nb||trans)return;
 const snap=mk(BW,BH-HUD);snap.getContext('2d').drawImage(cv,0,HUD,BW,BH-HUD,0,0,BW,BH-HUD);
 room=nb;tears=[];ebul=[];fires=[];bombs=[];fx=[];parts=[];enemies=[];const m=12;
 if(dir==='left')placeAll(RX1-6-m,CY,0);else if(dir==='right')placeAll(RX0+6+m,CY,0);else if(dir==='up')placeAll(CX,RY1-6-m);else placeAll(CX,RY0+6+m);
 if(dir==='left'||dir==='right')PL.forEach((p,i)=>{p.y=CY+(i-(PL.length-1)/2)*12;});
 room.visited=true;room.doorT=1;trans={dir,t:0,snap};S('door');ev({f:'room',dir});}
function onEnter(){if(!room.cleared){if(room.type==='boss')spawnBoss();else spawnEnemies();S('slam');shakeTo(3);}}
function mkTear(x,y,vx,vy,r,dmg,range,col,o){return{id:eid++,x,y,vx,vy,r,dmg,range,trav:0,hit:new Set(),col,pierce:!!o.pierce,homing:!!o.homing,tracer:!!o.tracer,awl:!!o.awl,trail:[],ft:0};}
function babyPos(p,i){const k=(i+1)*14*2;const h=p.hist;if(h.length>k+1)return{x:h[k],y:h[k+1]};return{x:p.x-(i+1)*8,y:p.y+4};}
function fire(P,ax,ay){const a=Math.atan2(ay,ax),angs=P.triple?[a-0.2,a,a+0.2]:[a];
 for(const an of angs)tears.push(mkTear(P.x+Math.cos(an)*3,P.y-3+Math.sin(an)*3,Math.cos(an)*P.shotSpeed+P.vx*0.3,Math.sin(an)*P.shotSpeed+P.vy*0.3,P.size,P.dmg,P.range,P.tearCol,{pierce:P.pierce,homing:P.homing,tracer:P.tracer,awl:has(P,'awl')}));
 P.recoil=6;S('shoot');
 for(let i=0;i<P.babies;i++){if(P.babyCD[i]>0)continue;P.babyCD[i]=28;const b=babyPos(P,i);tears.push(mkTear(b.x,b.y-2,ax*2.4,ay*2.4,1,2,95,P.tearCol,{}));S('baby');}}
function hurt(P,n){if(P.inv>0||P.dead||trans)return;P.hp-=n;P.inv=60;shakeTo(6);S('hurt');burst(P.x,P.y-4,PAL.B,10,1.5);
 if(P.hp<=0){P.hp=0;P.dead=true;P.deathT=0;splat(P.x,P.y+2,8,PINK[P.idx]||PAL.b);}}
function shootE(e,a,s){ebul.push({id:eid++,x:e.x+Math.cos(a)*e.r*0.7,y:e.y-2+Math.sin(a)*e.r*0.7,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:2,trail:[]});}
function dropPickup(x,y,kind){const a=rnd(0,TAU),s=rnd(0.4,1.1);room.pickups.push({id:eid++,x,y,r:3,z:6,vz:2.2,vx:Math.cos(a)*s,vy:Math.sin(a)*s,kind,t:ri(0,100)});}
function kill(e){e.dead=true;kills++;burst(e.x,e.y,e.blood,e.boss?40:12,e.boss?2.4:1.6);splat(e.x,e.y+2,e.r*0.9+1,e.blood);addFx({type:'poof',x:e.x,y:e.y,t:0});shakeTo(e.boss?12:2);S(e.boss?'boom':'kill');
 if(e.type==='splitter')for(let i=0;i<2;i++){const m=mkEnemy('mini',e.x+(i?6:-6),e.y);m.spawn=0;m.kx=i?1.5:-1.5;enemies.push(m);}
 if(!e.boss&&Math.random()<0.09)dropPickup(e.x,e.y,'coin');}
function reviveAll(hp){for(const p of PL)if(p.dead){p.dead=false;p.hp=hp;p.inv=90;const a=alive().find(q=>q!==p);if(a){p.x=a.x+ri(-8,8);p.y=a.y+ri(-6,6);}burst(p.x,p.y-4,'#fee761',14,1.4);}}
function onClear(){room.cleared=true;S('door');
 if(PL.some(p=>p.dead)){reviveAll(2);popup('Друг вернулся','Комната зачищена',null,110);}
 if(room.type==='boss'){room.items.push({x:CX-40,y:CY,kind:'item',it:drawItemFromPool(),price:0});if(PL.length>1)room.items.push({x:CX-40,y:CY+34,kind:'item',it:drawItemFromPool(),price:0});room.trap={x:CX+40,y:CY};room.trapT=0;dropPickup(CX,CY+28,'heart');popup('Босс повержен','Бери предмет и прыгай в люк',null);ebul=[];}
 else{const r=Math.random();if(r<0.3){for(let i=0,n=ri(1,3);i<n;i++)dropPickup(CX,CY,'coin');}else if(r<0.44)dropPickup(CX,CY,Math.random()<0.6?'half':'heart');else if(r<0.56)dropPickup(CX,CY,'bomb');}}
function explode(x,y){addFx({type:'boom',x,y,t:0});shakeTo(10);S('boom');burst(x,y,'#5a6988',16,2.2);burst(x,y,'#f77622',10,2);
 const c=floorC(room).getContext('2d');c.globalAlpha=0.45;blobInto(c,x-RX0,y-RY0,9,'#2a2433');c.globalAlpha=1;ev({f:'spl',x:Math.round(x),y:Math.round(y),r:9,c:'#2a2433',a:0.45});
 for(const e of enemies)if(!e.dead&&e.spawn<=0&&Math.hypot(e.x-x,e.y-y)<30+e.r){e.hp-=12;e.flash=8;if(!e.heavy){const d=Math.hypot(e.x-x,e.y-y)||1;e.kx+=(e.x-x)/d*3;e.ky+=(e.y-y)/d*3;}if(e.hp<=0)kill(e);}
 for(const P of PL)if(Math.hypot(P.x-x,P.y-y)<24)hurt(P,2);
 for(let i=room.rocks.length-1;i>=0;i--){const k=room.rocks[i],kx=k.x+8,ky=k.y+8;if(Math.hypot(kx-x,ky-y)<30){room.rocks.splice(i,1);burst(kx,ky,k.type==='ink'?'#1d2b53':'#f5a3a3',10,1.6);burst(kx,ky,k.type==='ink'?'#4f7cc4':'#5b7fc0',6,1.4);if(k.type==='tinted')for(let j=0;j<3;j++)dropPickup(kx,ky,'coin');}}
 enemies=enemies.filter(e=>!e.dead);}
function nextFloor(){level++;for(const p of PL){if(p.dead){p.dead=false;p.hp=Math.max(2,Math.floor(p.maxHp/2));}else p.hp=Math.min(p.maxHp,p.hp+1);}S('trap');buildFloor();popup('Этаж '+level,FLOOR_NAMES[(level-1)%FLOOR_NAMES.length],null);}

/** Нажатия игрока: свои — с клавиатуры и экрана, чужие — что прислал игрок */
function inputOf(p){if(p.peer===SELF()){let mx=(K.KeyD?1:0)-(K.KeyA?1:0),my=(K.KeyS?1:0)-(K.KeyW?1:0);if(sticks.move.id!==null){mx=sticks.move.vx;my=sticks.move.vy;}
  let sx=(K.ArrowRight?1:0)-(K.ArrowLeft?1:0),sy=(K.ArrowDown?1:0)-(K.ArrowUp?1:0);if(sticks.shoot.id!==null&&(sticks.shoot.vx||sticks.shoot.vy)){sx=sticks.shoot.vx;sy=sticks.shoot.vy;}
  return{mx,my,sx,sy,b:localBombs};}
 return INPUT.get(p.peer)||{mx:0,my:0,sx:0,sy:0,b:p.bombSeen};}

function updatePlayer(P){
 if(P.dead){P.deathT++;return;}
 const inp=inputOf(P);let mx=inp.mx,my=inp.my;
 const ml=Math.hypot(mx,my);if(ml>1){mx/=ml;my/=ml;}
 P.vx+=(mx*P.speed-P.vx)*0.25;P.vy+=(my*P.speed-P.vy)*0.25;P.x+=P.vx;P.y+=P.vy;
 for(const rk of room.rocks)pushOut(P,rk);
 P.x=clamp(P.x,RX0+P.r,RX1-P.r);P.y=clamp(P.y,RY0+P.r,RY1-P.r);
 if(Math.hypot(P.vx,P.vy)>0.25)P.walkT++;
 P.hist.unshift(P.x,P.y);if(P.hist.length>140)P.hist.length=140;
 if(P.inv>0)P.inv--;if(P.recoil>0)P.recoil--;if(--P.blinkT<-8)P.blinkT=ri(120,260);
 if(room.cleared&&room.doorT>0.9){const d=room.doors,hy=Math.abs(P.y-CY)<9,hx=Math.abs(P.x-CX)<9;
  if(d.left&&hy&&P.x<=RX0+P.r+0.5&&mx<-0.3)return goRoom('left');
  if(d.right&&hy&&P.x>=RX1-P.r-0.5&&mx>0.3)return goRoom('right');
  if(d.up&&hx&&P.y<=RY0+P.r+0.5&&my<-0.3)return goRoom('up');
  if(d.down&&hx&&P.y>=RY1-P.r-0.5&&my>0.3)return goRoom('down');}
 let sx=inp.sx,sy=inp.sy;
 if(P.cool>0)P.cool--;
 if(sx||sy){const l=Math.hypot(sx,sy);P.look={x:sx/l,y:sy/l};if(P.cool<=0){fire(P,sx/l,sy/l);P.cool=P.rate;}}else if(mx||my){const l=Math.hypot(mx,my);P.look={x:mx/l,y:my/l};}
 if(inp.b>P.bombSeen){P.bombSeen=inp.b;if(team.bombs>0){team.bombs--;bombs.push({id:eid++,x:P.x,y:P.y+2,t:0});}else showHint('Бомб нет',P.peer);}
 for(let i=0;i<P.babyCD.length;i++)if(P.babyCD[i]>0)P.babyCD[i]--;
 for(let k=0;k<P.clips;k++){const a=frame*0.06+k*TAU/P.clips,cx=P.x+Math.cos(a)*15,cy=P.y-3+Math.sin(a)*11;
  for(let i=ebul.length-1;i>=0;i--){const b=ebul[i];if(Math.hypot(b.x-cx,b.y-cy)<5){addFx({type:'splash',x:b.x,y:b.y,t:0,col:'#c0cbdc'});ebul.splice(i,1);}}
  for(const e of enemies){if(e.spawn>0)continue;if(Math.hypot(e.x-cx,e.y-cy)<e.r+3){const last=P.clipHit.get(e)||0;if(frame-last>10){P.clipHit.set(e,frame);e.hp-=1.5;e.flash=4;if(e.hp<=0)kill(e);}}}}
}

function update(){
 frame++;
 if(pop&&--pop.life<=0)pop=null;if(hint&&--hint.life<=0)hint=null;if(hintCD>0)hintCD--;if(fadeT>0)fadeT--;
 if(shake>0){shake*=0.86;if(shake<0.4)shake=0;}
 updParts();
 if(!HOST()){guestTick();return;}
 if(state!=='play')return;
 if(trans){if(++trans.t>=TRANS){trans=null;onEnter();}return;}
 const tgt=room.cleared?1:0;if(room.doorT!==tgt){room.doorT+=(tgt-room.doorT)*0.16;if(Math.abs(tgt-room.doorT)<0.02)room.doorT=tgt;}
 if(room.trap&&room.trapT<1)room.trapT=Math.min(1,room.trapT+0.03);
 if(PL.length&&PL.every(p=>p.dead)){PL.forEach(p=>p.deathT++);if(++overT>100){state='over';overT=0;const me=meP();if(level>best){best=level;try{localStorage.setItem('klyaksa_best',best);}catch(e){}}}return;}
 for(const P of PL){updatePlayer(P);if(trans)return;}
 /* капли */
 for(let i=tears.length-1;i>=0;i--){const t=tears[i];
  if(t.homing){let be=null,bd=90;for(const e of enemies){if(e.spawn>0||e.dead)continue;const dd=Math.hypot(e.x-t.x,e.y-t.y);if(dd<bd){bd=dd;be=e;}}
   if(be){const sp=Math.hypot(t.vx,t.vy),ca=Math.atan2(t.vy,t.vx);let df=Math.atan2(be.y-t.y,be.x-t.x)-ca;while(df>Math.PI)df-=TAU;while(df<-Math.PI)df+=TAU;const na=ca+clamp(df,-0.08,0.08);t.vx=Math.cos(na)*sp;t.vy=Math.sin(na)*sp;}}
  t.trail.push(t.x,t.y);if(t.trail.length>(t.tracer?24:12))t.trail.splice(0,2);
  t.x+=t.vx;t.y+=t.vy;const sp=Math.hypot(t.vx,t.vy);t.trav+=sp;
  if(t.tracer&&(t.ft++)%3===0)fires.push({x:t.x,y:t.y+3,life:45});
  let gone=false;
  if(t.trav>t.range||t.x<RX0||t.x>RX1||t.y<RY0-2||t.y>RY1||rockAt(t.x,t.y+3))gone=true;
  else for(const e of enemies){if(e.dead||e.spawn>0||t.hit.has(e))continue;
   if(Math.hypot(e.x-t.x,e.y-t.y)<e.r+t.r+1){t.hit.add(e);e.hp-=t.dmg;e.flash=5;burst(t.x,t.y,e.blood,3,1);S('hit');if(!e.heavy){e.kx+=t.vx/sp*1.1;e.ky+=t.vy/sp*1.1;}if(e.hp<=0)kill(e);if(!t.pierce){gone=true;break;}}}
  if(gone){addFx({type:'splash',x:t.x,y:t.y,t:0,col:TEARC[t.col][1]});if(Math.random()<0.5)splat(t.x,t.y+3,1.2+t.r*0.5,TEARC[t.col][0]);tears.splice(i,1);}}
 /* враги — к ближайшему живому игроку */
 for(const e of enemies){if(e.dead)continue;if(e.spawn>0){e.spawn--;continue;}e.t++;if(e.flash>0)e.flash--;if(e.mouth>0)e.mouth--;
  const P=nearest(e.x,e.y),dx=P.x-e.x,dy=P.y-e.y,d=Math.hypot(dx,dy)||1;let vx=0,vy=0;
  switch(e.type){
   case 'fly':{const a=Math.atan2(dy,dx)+Math.sin(e.t*0.1+e.seed)*0.9;vx=Math.cos(a)*e.spd;vy=Math.sin(a)*e.spd;break;}
   case 'walker':case 'mini':case 'splitter':vx=dx/d*e.spd;vy=dy/d*e.spd;break;
   case 'turret':if(--e.cd<=0){shootE(e,Math.atan2(dy,dx),1.35);e.cd=ri(95,130)-level*4;S('eshot');}break;
   case 'dasher':
    if(e.state===0){e.cd--;if(e.t%70===0)e.wa=rnd(0,TAU);vx=Math.cos(e.wa)*e.spd;vy=Math.sin(e.wa)*e.spd;
     if(e.cd<=0){if(Math.abs(dx)<8){e.state=3;e.ct=18;e.ax=0;e.ay=Math.sign(dy);}else if(Math.abs(dy)<8){e.state=3;e.ct=18;e.ax=Math.sign(dx);e.ay=0;}}}
    else if(e.state===3){if(--e.ct<=0){e.state=1;e.ct=60;}}
    else{vx=e.ax*2.6;vy=e.ay*2.6;if(--e.ct<=0){e.state=0;e.cd=60;}}
    break;
   case 'blot':{const enr=e.hp<e.maxhp*0.5,s=e.spd*(enr?1.45:1);vx=dx/d*s;vy=dy/d*s;
    if(--e.cd<=0){const p=e.state%3,a=Math.atan2(dy,dx);e.mouth=20;S('eshot');
     if(p===0){const n=enr?16:12;for(let i=0;i<n;i++)shootE(e,i/n*TAU+e.t*0.01,1.15);}
     else if(p===1){for(let i=-2;i<=2;i++)shootE(e,a+i*0.18,1.6);}
     else if(enr&&enemies.length<8){for(let i=0;i<2;i++){const f=mkEnemy('fly',e.x+rnd(-14,14),e.y+rnd(-10,10));f.spawn=16;f.spawnMax=16;enemies.push(f);}}
     else for(let i=0;i<3;i++)shootE(e,a+rnd(-0.3,0.3),rnd(1.1,1.9));
     e.state++;e.cd=enr?65:95;}
    break;}
   case 'eraser':{const enr=e.hp<e.maxhp*0.5;
    if(e.state===0){vx=dx/d*e.spd;vy=dy/d*e.spd;if(--e.cd<=0){e.state=1;e.ct=enr?26:40;e.ax=dx/d;e.ay=dy/d;S('charge');}}
    else if(e.state===1){if(--e.ct<=0){e.state=2;e.ct=90;}}
    else if(e.state===2){const s=enr?3.4:2.8;vx=e.ax*s;vy=e.ay*s;if(--e.ct<=0){e.state=0;e.cd=60;}}
    else if(e.state===3){if(--e.ct<=0){e.state=0;e.cd=enr?45:75;}}
    break;}
  }
  e.kx*=0.8;e.ky*=0.8;e.x+=vx+e.kx;e.y+=vy+e.ky;
  if(!e.fly)for(const rk of room.rocks)if(pushOut(e,rk)&&e.type==='dasher'&&e.state===1){e.state=0;e.cd=60;shakeTo(3);}
  const out=e.x<RX0+e.r||e.x>RX1-e.r||e.y<RY0+e.r||e.y>RY1-e.r;
  if(out&&e.type==='dasher'&&e.state===1){e.state=0;e.cd=60;shakeTo(3);}
  if(out&&e.type==='eraser'&&e.state===2){e.state=3;e.ct=55;shakeTo(9);S('stun');const n=e.hp<e.maxhp*0.5?12:8;for(let i=0;i<n;i++)shootE(e,i/n*TAU,1.25);burst(e.x,e.y,'#f5a3a3',14,2);}
  e.x=clamp(e.x,RX0+e.r,RX1-e.r);e.y=clamp(e.y,RY0+e.r,RY1-e.r);
  for(const Q of PL)if(!Q.dead&&Math.hypot(Q.x-e.x,Q.y-e.y)<e.r+Q.r-2)hurt(Q,e.boss?2:1);}
 for(let i=0;i<enemies.length;i++)for(let j=i+1;j<enemies.length;j++){const a=enemies[i],b=enemies[j];if(a.spawn>0||b.spawn>0)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||0.01,o=a.r+b.r-d;
  if(o>0){const ux=dx/d,uy=dy/d;if(a.heavy&&!b.heavy){b.x+=ux*o;b.y+=uy*o;}else if(b.heavy&&!a.heavy){a.x-=ux*o;a.y-=uy*o;}else if(!a.heavy&&!b.heavy){a.x-=ux*o/2;a.y-=uy*o/2;b.x+=ux*o/2;b.y+=uy*o/2;}}}
 enemies=enemies.filter(e=>!e.dead);
 /* вражеские пули */
 for(let i=ebul.length-1;i>=0;i--){const b=ebul[i];b.trail.push(b.x,b.y);if(b.trail.length>10)b.trail.splice(0,2);b.x+=b.vx;b.y+=b.vy;
  if(b.x<RX0||b.x>RX1||b.y<RY0-2||b.y>RY1||rockAt(b.x,b.y+3)){addFx({type:'splash',x:b.x,y:b.y,t:0,col:'#ff8e8e'});ebul.splice(i,1);continue;}
  for(const Q of PL)if(!Q.dead&&Math.hypot(b.x-Q.x,b.y-(Q.y-3))<b.r+Q.r-1){hurt(Q,1);ebul.splice(i,1);break;}}
 /* огонь трассера */
 for(let i=fires.length-1;i>=0;i--){const f=fires[i];if(--f.life<=0){fires.splice(i,1);continue;}
  for(const e of enemies){if(e.spawn>0||e.dead)continue;if(Math.hypot(e.x-f.x,e.y-f.y)<e.r+3){e.hp-=0.12;if(frame%8===0)e.flash=2;if(e.hp<=0)kill(e);}}}
 enemies=enemies.filter(e=>!e.dead);
 /* бомбы */
 for(let i=bombs.length-1;i>=0;i--){const b=bombs[i];b.t++;if(b.t%14===0)S('fuse');if(b.t>=80){bombs.splice(i,1);explode(b.x,b.y);}}
 enemies=enemies.filter(e=>!e.dead);
 /* подбираемое: монеты и бомбы — в общий запас, сердца — тому, кто взял */
 for(let i=room.pickups.length-1;i>=0;i--){const p=room.pickups[i];p.t++;p.x+=p.vx;p.y+=p.vy;p.vx*=0.9;p.vy*=0.9;p.z+=p.vz;p.vz-=0.25;if(p.z<0){p.z=0;p.vz*=-0.4;if(Math.abs(p.vz)<0.4)p.vz=0;}
  for(const rk of room.rocks)pushOut(p,rk);p.x=clamp(p.x,RX0+4,RX1-4);p.y=clamp(p.y,RY0+4,RY1-4);
  if(p.z>=3)continue;
  for(const P of PL){if(P.dead||Math.hypot(p.x-P.x,p.y-P.y)>=P.r+4)continue;let took=false;
   if(p.kind==='coin'){team.coins=Math.min(99,team.coins+1);took=true;S('coin');}
   else if(p.kind==='bomb'){team.bombs=Math.min(99,team.bombs+1);took=true;S('bombget');}
   else if(P.hp<P.maxHp){P.hp=Math.min(P.maxHp,P.hp+(p.kind==='heart'?2:1));took=true;S('heart');}
   if(took){addFx({type:'spark',x:p.x,y:p.y-4,t:0,col:p.kind==='coin'?'#fee761':p.kind==='bomb'?'#c0cbdc':'#ff8e8e'});room.pickups.splice(i,1);break;}}}
 /* предметы на пьедесталах */
 for(let i=room.items.length-1;i>=0;i--){const it=room.items[i];const P=PL.find(q=>!q.dead&&Math.hypot(it.x-q.x,it.y-q.y)<=11);if(!P)continue;
  if(it.price&&team.coins<it.price){showHint('Нужно монет: '+it.price,P.peer);if(hintCD===40)S('nope');continue;}
  if(it.kind==='heart'&&P.hp>=P.maxHp&&it.price){showHint('Ты и так здоров',P.peer);continue;}
  team.coins-=it.price||0;if(it.price)S('buy');
  if(it.kind==='item'){it.it.apply(P);P.items.push(it.it.id);popup((PL.length>1&&P.name?P.name+': ':'')+it.it.name,it.it.desc,SP.items[it.it.id][0]);S('item');addFx({type:'spark',x:it.x,y:it.y-14,t:0,col:'#fee761'});burst(it.x,it.y-12,'#fee761',14,1.4,10);}
  else if(it.kind==='heart'){P.hp=Math.min(P.maxHp,P.hp+2);S('heart');}
  else{team.bombs=Math.min(99,team.bombs+1);S('bombget');}
  room.items.splice(i,1);}
 if(!room.cleared&&enemies.length===0)onClear();
 if(room.trap&&room.trapT>=1&&PL.some(P=>!P.dead&&Math.hypot(room.trap.x-P.x,room.trap.y-P.y)<8))nextFloor();
}

/* ================= сеть: снимки (ведущий → все) и нажатия (все → ведущий) ================= */
const r1=v=>Math.round(v*10)/10;
function floorWire(){return{lv:level,rooms:floor.list.map(r=>[r.gx,r.gy,r.type,r.seed]),start:[floor.start.gx,floor.start.gy]};}
function snapWire(){
 return{t:'snap',st:state,lv:level,k:kills,co:team.coins,bo:team.bombs,best,
  rm:[room.gx,room.gy],cl:room.cleared?1:0,dt:r1(room.doorT),tr:trans?{d:trans.dir,t:trans.t}:null,
  vis:floor.list.map(r=>r.visited?1:0).join(''),
  rocks:room.rocks.map(k=>[k.x,k.y,k.type]),
  trap:room.trap?[room.trap.x,room.trap.y,r1(room.trapT)]:null,
  items:room.items.map(it=>[r1(it.x),r1(it.y),it.kind,it.it?it.it.id:'',it.price||0]),
  pk:room.pickups.map(p=>[p.id,r1(p.x),r1(p.y),r1(p.z),p.kind,p.t]),
  pl:PL.map(p=>[p.peer,p.idx,r1(p.x),r1(p.y),r1(p.vx),r1(p.vy),p.hp,p.maxHp,p.inv,r1(p.look.x),r1(p.look.y),p.dead?1:0,p.recoil,p.walkT,p.blinkT,p.babies,p.clips,p.items.join(','),p.compass?1:0,p.name,p.deathT]),
  en:enemies.map(e=>[e.id,e.type,r1(e.x),r1(e.y),Math.round(e.hp),Math.round(e.maxhp),e.flash,e.spawn,e.spawnMax,e.state,e.t,r1(e.ax),r1(e.ay),e.mouth,e.seed,e.cd,e.r]),
  te:tears.map(t=>[t.id,r1(t.x),r1(t.y),r1(t.vx),r1(t.vy),t.r,t.col,t.tracer?1:0,t.awl?1:0]),
  eb:ebul.map(b=>[b.id,r1(b.x),r1(b.y),r1(b.vx),r1(b.vy)]),
  bm:bombs.map(b=>[b.id,r1(b.x),r1(b.y),b.t]),
  fi:fires.map(f=>[r1(f.x),r1(f.y),f.life]),
  ev:EV};}
let sendAcc=0;
function hostNet(){if(!MP()||!HOST()||!floor)return;if(++sendAcc<3)return;sendAcc=0;const s=snapWire();EV=[];Net.send(s);}

/* — у остальных игроков — */
let snapPrev=null,snapCur=null,snapAt=0,floorKnown=-1;
const byId=a=>{const m=new Map();for(const x of a)m.set(x[0],x);return m;};
function applyFloor(d){level=d.lv;const list=d.rooms.map(([gx,gy,type,seed])=>({gx,gy,type,seed,cleared:true,visited:false,rocks:[],items:[],pickups:[],trap:null,trapT:0,floorC:null,doorT:1}));
 const start=list.find(r=>r.gx===d.start[0]&&r.gy===d.start[1])||list[0];floor=linkFloor(list,start);room=start;floorKnown=level;}
function onSnap(s){
 const evs=s.ev||[];
 for(const e of evs)if(e.f==='floor'||e.f==='room')replay(e);
 if(!floor)return;
 const r=floor.map[key(s.rm[0],s.rm[1])];if(!r)return;
 state=s.st;level=s.lv;kills=s.k;team.coins=s.co;team.bombs=s.bo;
 if(s.vis)floor.list.forEach((x,i)=>{x.visited=s.vis[i]==='1';});
 room=r;r.cleared=!!s.cl;r.doorT=s.dt;r.rocks=s.rocks.map(([x,y,type])=>({x,y,w:T,h:T,type}));
 r.trap=s.trap?{x:s.trap[0],y:s.trap[1]}:null;r.trapT=s.trap?s.trap[2]:0;
 r.items=s.items.map(([x,y,kind,id,price])=>({x,y,kind,it:id?ITEMm[id]:null,price}));
 snapPrev=snapCur;snapCur=s;snapAt=performance.now();
 // игроки: состояние — из снимка, позиции подтягиваем в guestTick
 const old=new Map(PL.map(p=>[p.peer,p]));PL=s.pl.map(a=>{const p=old.get(a[0])||newPlayer(a[0],a[1],a[19]);
  Object.assign(p,{idx:a[1],tx:a[2],ty:a[3],vx:a[4],vy:a[5],hp:a[6],maxHp:a[7],inv:a[8],look:{x:a[9],y:a[10]},dead:!!a[11],recoil:a[12],walkT:a[13],blinkT:a[14],babies:a[15],clips:a[16],items:a[17]?a[17].split(','):[],compass:!!a[18],name:a[19],deathT:a[20]});
  if(p.x===CX&&p.y===CY&&!old.has(a[0])){p.x=a[2];p.y=a[3];}
  p.hist.unshift(p.x,p.y);if(p.hist.length>140)p.hist.length=140;return p;});
 const eo=new Map(enemies.map(e=>[e.id,e]));
 enemies=s.en.map(a=>{const e=eo.get(a[0])||{id:a[0],x:a[2],y:a[3],kx:0,ky:0,dead:false};
  Object.assign(e,{type:a[1],tx:a[2],ty:a[3],hp:a[4],maxhp:a[5],flash:a[6],spawn:a[7],spawnMax:a[8],state:a[9],t:a[10],ax:a[11],ay:a[12],mouth:a[13],seed:a[14],cd:a[15],r:a[16],fly:a[1]==='fly',boss:a[1]==='blot'||a[1]==='eraser',heavy:!!(DEF[a[1]]||{}).heavy,blood:(DEF[a[1]]||{}).blood});return e;});
 const to=new Map(tears.map(t=>[t.id,t]));
 tears=s.te.map(a=>{const t=to.get(a[0])||{id:a[0],x:a[1],y:a[2],trail:[]};Object.assign(t,{tx:a[1],ty:a[2],vx:a[3],vy:a[4],r:a[5],col:TEARC[a[6]]?a[6]:'ink',tracer:!!a[7],awl:!!a[8]});return t;});
 const bo=new Map(ebul.map(b=>[b.id,b]));
 ebul=s.eb.map(a=>{const b=bo.get(a[0])||{id:a[0],x:a[1],y:a[2],trail:[]};Object.assign(b,{tx:a[1],ty:a[2],vx:a[3],vy:a[4],r:2});return b;});
 bombs=s.bm.map(a=>({id:a[0],x:a[1],y:a[2],t:a[3]}));
 fires=s.fi.map(a=>({x:a[0],y:a[1],life:a[2]}));
 const po=new Map(room.pickups.map(p=>[p.id,p]));
 room.pickups=s.pk.map(a=>{const p=po.get(a[0])||{id:a[0]};Object.assign(p,{x:a[1],y:a[2],z:a[3],kind:a[4],t:a[5],r:3});return p;});
 if(s.tr&&!trans){trans={dir:s.tr.d,t:s.tr.t,snap:null};}
 if(!s.tr)trans=null;
 best=Math.max(best,s.best||0);
 for(const e of evs)if(e.f!=='floor'&&e.f!=='room')replay(e);
}
/** Между снимками: плавно двигаем игроков, врагов, капли и пули к последним позициям */
function guestTick(){
 const k=0.35;
 for(const p of PL){if(p.tx===undefined)continue;p.x+=(p.tx-p.x)*k;p.y+=(p.ty-p.y)*k;}
 for(const e of enemies){if(e.tx===undefined)continue;e.x+=(e.tx-e.x)*k;e.y+=(e.ty-e.y)*k;}
 for(const t of tears){t.trail.push(t.x,t.y);if(t.trail.length>(t.tracer?24:12))t.trail.splice(0,2);t.tx+=t.vx;t.ty+=t.vy;t.x+=(t.tx-t.x)*0.5;t.y+=(t.ty-t.y)*0.5;}
 for(const b of ebul){b.trail.push(b.x,b.y);if(b.trail.length>10)b.trail.splice(0,2);b.tx+=b.vx;b.ty+=b.vy;b.x+=(b.tx-b.x)*0.5;b.y+=(b.ty-b.y)*0.5;}
 if(trans&&trans.t<TRANS)trans.t++;
 sendInput();
}
function replay(e){
 switch(e.f){
  case 's':sfx(e.k);break;
  case 'b':burst(e.x,e.y,e.c,e.n,e.sp,e.z,false);break;
  case 'fx':fx.push({type:e.v.type,x:e.v.x,y:e.v.y,t:0,col:e.v.col});break;
  case 'sh':shake=Math.max(shake,e.v);break;
  case 'spl':if(room){const c=floorC(room).getContext('2d');c.globalAlpha=e.a||0.55;blobInto(c,e.x-RX0,e.y-RY0,e.r,e.c);c.globalAlpha=1;}break;
  case 'pop':pop={t:e.t,s:e.s,icon:e.i&&SP.items[e.i]?SP.items[e.i][0]:null,life:e.l,max:e.l};break;
  case 'hint':if(e.to===SELF()&&hintCD<=0){hint={t:e.t,life:90};hintCD=40;}break;
  case 'floor':applyFloor(e.d);fadeT=30;break;
  case 'room':{const snapC=mk(BW,BH-HUD);snapC.getContext('2d').drawImage(cv,0,HUD,BW,BH-HUD,0,0,BW,BH-HUD);trans={dir:e.dir,t:0,snap:snapC};fx=[];parts=[];break;}
 }
}
let lastIn='',inAcc=0;
function sendInput(){const p={peer:SELF()};const i=inputOf(p),s=JSON.stringify([i.mx,i.my,i.sx,i.sy,i.b].map(v=>Math.round(v*100)/100));inAcc++;
 if((s!==lastIn&&inAcc>=2)||inAcc>=6){lastIn=s;inAcc=0;Net.send({t:'in',v:JSON.parse(s)});}}

if(window.Net){
 Net.on('init',()=>{syncRoster();if(HOST()){if(state==='play'&&floor){Net.send({t:'floorset',d:floorWire()});}}else{state='wait';}});
 Net.on('join',()=>{if(HOST()){syncRoster();if(floor)Net.send({t:'floorset',d:floorWire()});}});
 Net.on('leave',p=>{INPUT.delete(p.peerId);
  // Ушёл ведущий (вошёл раньше всех) — игра у всех сначала; новый ведущий может начать
  const wasHost=Net.all().every(q=>q.peerId>p.peerId);
  if(wasHost){state=HOST()?'title':'wait';floor=null;room=null;PL=[];syncRoster();enemies=[];tears=[];ebul=[];bombs=[];fires=[];fx=[];parts=[];trans=null;snapCur=snapPrev=null;}
  else if(HOST())syncRoster();});
 Net.on('msg',(d,from)=>{if(!d||typeof d!=='object')return;
  if(d.t==='in'&&HOST()&&Array.isArray(d.v)){const [mx,my,sx,sy,b]=d.v.map(Number);INPUT.set(from,{mx:clamp(mx||0,-1,1),my:clamp(my||0,-1,1),sx:clamp(sx||0,-1,1),sy:clamp(sy||0,-1,1),b:b|0});}
  else if(d.t==='floorset'&&!HOST()){applyFloor(d.d);}
  else if(d.t==='snap'&&!HOST())onSnap(d);
  else if(d.t==='start'&&HOST()&&(state==='title'||state==='over'))newGame();});
}

/* ================= отрисовка ================= */
function px(x,y,w,h,col){ctx.fillStyle=col;ctx.fillRect(Math.round(x),Math.round(y),w,h);}
function pcirc(cx,cy,r,col){ctx.fillStyle=col;cx=Math.round(cx);cy=Math.round(cy);const n=Math.floor(r);for(let y=-n;y<=n;y++){const w=Math.floor(Math.sqrt(Math.max(0,r*r-y*y))+0.35);ctx.fillRect(cx-w,cy+y,w*2+1,1);}}
function pell(cx,cy,rx,ry,col){ctx.fillStyle=col;cx=Math.round(cx);cy=Math.round(cy);rx=Math.round(rx);ry=Math.max(1,Math.round(ry));for(let y=-ry;y<=ry;y++){const w=Math.round(rx*Math.sqrt(Math.max(0,1-(y*y)/(ry*ry))));ctx.fillRect(cx-w,cy+y,w*2+1,1);}}
function pring(cx,cy,r,col){ctx.fillStyle=col;const n=Math.max(8,Math.round(r*6));for(let i=0;i<n;i++){const a=i/n*TAU;ctx.fillRect(Math.round(cx+Math.cos(a)*r),Math.round(cy+Math.sin(a)*r),1,1);}}
const SH='rgba(18,14,23,0.28)';
function shad(cx,cy,w){cx=Math.round(cx);cy=Math.round(cy);w=Math.max(1,Math.round(w));ctx.fillStyle=SH;ctx.fillRect(cx-w,cy,w*2+1,1);if(w>2)ctx.fillRect(cx-w+1,cy+1,w*2-1,1);}
function drawSpr(img,cx,bottomY,e){const w=img.width,h=img.height,x=Math.round(cx-w/2),y=Math.round(bottomY-h);
 if(e&&e.spawn>0){const p=1-e.spawn/e.spawnMax,vh=Math.max(1,Math.round(h*p));pell(cx,bottomY-1,w/2+1,2,'#120e17');ctx.drawImage(img,0,0,w,vh,x,y+h-vh,w,vh);return{x,y,partial:true};}
 ctx.drawImage(e&&e.flash>0?white(img):img,x,y);return{x,y,partial:false};}
function eyes(x0,y0,lx,rx,ey,lk,angry,blink){for(const ex of [lx,rx]){if(blink){px(x0+ex,y0+ey+1,2,1,PAL.k);continue;}px(x0+ex,y0+ey,2,3,PAL.w);
 const pxo=lk.x>0.35?1:lk.x<-0.35?0:(ex===lx?1:0),pyo=lk.y<-0.35?0:1;px(x0+ex+pxo,y0+ey+pyo,1,2,PAL.k);if(angry)px(x0+ex+(ex===lx?1:0),y0+ey,1,1,PAL.k);}}
function look(e){const P=nearest(e.x,e.y);if(!P)return{x:0,y:1};const dx=P.x-e.x,dy=P.y-e.y,d=Math.hypot(dx,dy)||1;return{x:dx/d,y:dy/d};}
function drawDoor(dir,nb){const t=nb.type==='boss'||room.type==='boss'?'boss':nb.type==='treasure'?'treasure':nb.type==='shop'?'shop':'normal';
 const C={normal:['#5d3a28','#8f563b','#e4a672'],boss:['#68386c','#9e2835','#e43b44'],treasure:['#b86f50','#feae34','#fee761'],shop:['#265c42','#3e8948','#63c74d']}[t];
 let fxp,fyp,fw,fh,ox,oy,ow,oh;
 if(dir==='up'){fxp=CX-18;fyp=HUD;fw=36;fh=16;ox=CX-12;oy=HUD+4;ow=24;oh=12;}else if(dir==='down'){fxp=CX-18;fyp=RY1;fw=36;fh=16;ox=CX-12;oy=RY1;ow=24;oh=12;}
 else if(dir==='left'){fxp=0;fyp=CY-18;fw=16;fh=36;ox=4;oy=CY-12;ow=12;oh=24;}else{fxp=RX1;fyp=CY-18;fw=16;fh=36;ox=RX1;oy=CY-12;ow=12;oh=24;}
 px(fxp,fyp,fw,fh,PAL.k);px(fxp+1,fyp+1,fw-2,fh-2,C[1]);px(fxp+1,fyp+1,fw-2,1,C[2]);px(fxp+1,fyp+1,1,fh-2,C[2]);px(fxp+1,fyp+fh-2,fw-2,1,C[0]);px(fxp+fw-2,fyp+1,1,fh-2,C[0]);
 px(ox,oy,ow,oh,PAL.k);
 const c=1-room.doorT;if(c>0.02){const vert=dir==='up'||dir==='down';
  if(vert){const L=Math.max(1,Math.round(oh*c));for(let i=0;i<4;i++){const bx=ox+3+i*6;if(dir==='up'){px(bx,oy,2,L,'#8b9bb4');px(bx,oy,1,L,'#c0cbdc');}else{px(bx,oy+oh-L,2,L,'#8b9bb4');px(bx,oy+oh-L,1,L,'#c0cbdc');}}}
  else{const L=Math.max(1,Math.round(ow*c));for(let i=0;i<4;i++){const by=oy+3+i*6;if(dir==='left'){px(ox,by,L,2,'#8b9bb4');px(ox,by,L,1,'#c0cbdc');}else{px(ox+ow-L,by,L,2,'#8b9bb4');px(ox+ow-L,by,L,1,'#c0cbdc');}}}}
 const ic=t==='boss'?SP.skull:t==='treasure'?SP.star:t==='shop'?SP.coin[0]:null;
 if(ic){if(dir==='up'||dir==='down')ctx.drawImage(ic,fxp-ic.width-2,fyp+5);else ctx.drawImage(ic,fxp+Math.round((16-ic.width)/2),fyp-ic.height-2);}}
function drawTrap(t){const x=Math.round(t.x-11),y=Math.round(t.y-9);px(x,y,22,18,PAL.k);px(x+1,y+1,20,16,PAL.N);px(x+2,y+2,18,14,PAL.k);
 for(let i=0;i<3;i++)px(x+7,y+4+i*4,8,1,PAL.n);px(x+6,y+3,1,12,PAL.n);px(x+15,y+3,1,12,PAL.n);
 const pw=Math.round(9*(1-room.trapT));if(pw>0){px(x+2,y+2,pw,14,PAL.n);px(x+20-pw,y+2,pw,14,PAL.n);for(let i=0;i<3;i++){px(x+2,y+5+i*4,pw,1,PAL.N);px(x+20-pw,y+5+i*4,pw,1,PAL.N);}}}
function itemImg(it){if(it.kind==='item'&&it.it){const fr=SP.items[it.it.id];return fr[Math.floor(frame/18)%fr.length];}return it.kind==='heart'?SP.heart:SP.bomb[0];}
function drawPedestal(it){const x=Math.round(it.x),y=Math.round(it.y);ctx.drawImage(SP.pedestal,x-9,y-1);
 const bob=Math.round(Math.sin(frame*0.08+it.x)*1.5),img=itemImg(it);
 if(it.kind==='item'){const g=(frame+it.x)%60;if(g<30){px(x-9+(g%19),y-22+((g*7)%13),1,1,PAL.Y);}if(g>20&&g<26)px(x+7,y-19,1,1,PAL.w);}
 ctx.drawImage(img,Math.round(x-img.width/2),y-img.height-3+bob);
 if(it.price){const w=txt(String(it.price),'#fee761').width+10,sx0=Math.round(x-w/2);ctx.drawImage(SP.coin[0],sx0,y+10);text(String(it.price),sx0+9,y+10,'#fee761','left','#120e17');}}
function drawPickup(p){const x=Math.round(p.x),y=Math.round(p.y);shad(x,y+2,3);const bob=p.z>0?0:Math.round(Math.sin(p.t*0.1)*1);let img;
 if(p.kind==='coin')img=SP.coin[Math.floor(p.t/6)%4];else if(p.kind==='bomb')img=SP.bomb[Math.floor(p.t/10)%2];else img=SP.heart;
 if(p.kind==='half'){ctx.drawImage(SP.heart,0,0,5,8,x-4,Math.round(y-8-p.z)+bob,5,8);return;}
 ctx.drawImage(img,Math.round(x-img.width/2),Math.round(y-img.height+1-p.z)+bob);}
function drawBomb(b){const x=Math.round(b.x),y=Math.round(b.y);shad(x,y+1,4);const s=b.t>50&&Math.floor(b.t/4)%2?white(SP.bomb[0]):SP.bomb[Math.floor(b.t/5)%2];
 const pulse=b.t>60&&b.t%8<4?1:0;ctx.drawImage(s,x-4-pulse,y-9-pulse,9+pulse*2,10+pulse*2);}
function drawPlayer(P){
 const sp=PSP[P.idx]||PSP[0],x0=Math.round(P.x-8),y0=Math.round(P.y-13);
 if(P.dead){const img=P.deathT<30?sp.pdie[0]:sp.pdie[1];ctx.globalAlpha=PL.length>1?0.55:1;ctx.drawImage(img,x0,y0);ctx.globalAlpha=1;if(P.deathT<30)eyes(x0,y0,4,10,9,P.look,false,true);return;}
 shad(P.x,P.y+2,6);
 if(P.inv>0&&Math.floor(P.inv/4)%2)return;
 const moving=Math.hypot(P.vx,P.vy)>0.25;let fi;if(P.recoil>0)fi=1;else if(moving)fi=[0,2,0,1][Math.floor(P.walkT/6)%4];else fi=Math.floor(frame/40)%2;
 ctx.drawImage(sp.player[fi],x0,y0);
 const ey=[6,7,5][fi],top=y0+[1,2,0][fi];
 if(has(P,'kit')){px(x0+11,y0+ey+4,3,1,PAL.w);px(x0+12,y0+ey+3,1,3,PAL.w);}
 if(has(P,'pie')){px(x0+2,y0+ey+3,2,1,PAL.P);px(x0+12,y0+ey+3,2,1,PAL.P);}
 if(has(P,'dumbbell')){px(x0+2,top+3,12,2,PAL.r);px(x0+2,top+4,12,1,PAL.R);px(x0+13,top+5,2,2,PAL.r);}
 if(has(P,'binoc'))ctx.drawImage(SP.glasses,x0+2,y0+ey-1);
 else{const blink=P.blinkT<0;eyes(x0,y0,4,10,ey,P.look,false,blink);if(has(P,'tracer')&&!blink){px(x0+4+(P.look.x>0.35?1:0),y0+ey+1,1,1,PAL.o);px(x0+10+(P.look.x<-0.35?0:1)-((P.look.x<=0.35&&P.look.x>=-0.35)?1:0),y0+ey+1,1,1,PAL.o);}}
 if(has(P,'triple')){px(x0+7,top+2,2,2,PAL.w);px(x0+7+(P.look.x>0.3?1:0),top+3,1,1,PAL.k);}
 if(has(P,'awl'))ctx.drawImage(SP.horn,x0+3,top-5);
 if(has(P,'magnet'))ctx.drawImage(SP.maghat,x0+8,top-6);
 if(has(P,'pepper'))ctx.drawImage(SP.flames[Math.floor(frame/6)%2],x0+3,top-3);
 if(has(P,'coffee')){const s=Math.floor(frame/5)%8;px(x0+13+(s%2),top-2-s,1,1,PAL.l);px(x0+14-(s%2),top-6-(s+3)%8,1,1,PAL.a);}
 if(has(P,'battery')&&frame%9<3)px(x0+ri(1,14),y0+ri(3,13),1,1,frame%2?PAL.Y:PAL.c);
 if(has(P,'sneakers'))ctx.drawImage(SP.shoes,x0,y0+13);
 // ник над кляксой, когда играете вместе
 if(PL.length>1&&P.name){const nm=P.name.slice(0,10),c=P.peer===SELF()?'#fee761':'#e8e0d0',w=txt(nm,c).width;px(Math.round(P.x-w/2)-2,y0-12,w+3,10,'rgba(18,14,23,0.6)');text(nm,P.x,y0-11,c,'center');}
}
function drawEnemy(e){const lk=look(e),fl=e.flash>0;
 if(e.type!=='eraser'){if(e.r>=8)pell(e.x,e.y+e.r,e.r,Math.max(2,Math.round(e.r/4)),SH);else shad(e.x,e.y+e.r+(e.fly?2:0),e.r);}
 switch(e.type){
  case 'fly':{const bob=Math.round(Math.sin(frame*0.2+e.seed)*1.5);drawSpr(SP.fly[Math.floor(frame/3+e.seed)%2],e.x,e.y+2+bob,e);break;}
  case 'walker':{const f=Math.floor(e.t/10)%2,r=drawSpr(SP.walker[f],e.x,e.y+e.r+1,e);if(!r.partial&&!fl)eyes(r.x,r.y,3,9,[4,5][f],lk,true,false);break;}
  case 'turret':{const r=drawSpr(SP.turret,e.x,e.y+e.r+1,e);if(r.partial||fl)break;const cx=r.x+6,cy=r.y+6,ox=Math.round(lk.x*2),oy=Math.round(lk.y*2),warn=e.cd<14&&e.cd%4<2;
   pcirc(cx+ox,cy+oy,2.6,warn?PAL.w:PAL.r);pcirc(cx+ox,cy+oy,1.2,PAL.k);px(cx+ox-1,cy+oy-1,1,1,PAL.P);
   if((frame+e.seed*7)%160<6){px(r.x+1,r.y+2,11,5,PAL.R);px(r.x+1,r.y+6,11,1,PAL.k);}break;}
  case 'dasher':{let sx=0;if(e.state===3)sx=frame%4<2?-1:1;const f=e.state===1?1:Math.floor(e.t/8)%2,r=drawSpr(SP.dasher[f],e.x+sx,e.y+e.r+1,e);
   if(!r.partial&&!fl){eyes(r.x,r.y,3,9,[3,4][f],lk,true,false);if(e.state>=1&&e.state!==0){px(r.x+3,r.y+[3,4][f],2,1,PAL.r);px(r.x+9,r.y+[3,4][f],2,1,PAL.r);}}
   if(e.state===1)for(let i=1;i<4;i++)px(e.x-e.ax*(8+i*4)+(e.ay?ri(-4,4):0),e.y-e.ay*(8+i*4)+(e.ax?ri(-4,3):0),e.ax?3:1,e.ay?3:1,PAL.l);break;}
  case 'splitter':{const bob=Math.round(Math.sin(e.t*0.12)),r=drawSpr(SP.splitter,e.x,e.y+e.r+1+bob,e);if(!r.partial&&!fl)eyes(r.x,r.y,5,11,5,lk,true,(frame+e.seed)%140<5);break;}
  case 'mini':{const bob=Math.round(Math.sin(e.t*0.2)),r=drawSpr(SP.mini,e.x,e.y+e.r+1+bob,e);if(!r.partial&&!fl)eyes(r.x,r.y,2,6,2,lk,true,false);break;}
  case 'blot':{const img=SP.blot[Math.floor(e.t/6)%8],r=drawSpr(img,e.x,e.y+e.r+6,e);if(r.partial||fl)break;const cx=Math.round(e.x),cy=Math.round(e.y-6);
   for(const s of [-1,1]){const ex=cx+s*6-(s<0?4:0),ey=cy-5;px(ex,ey,4,5,PAL.w);px(ex+1+Math.round(lk.x),ey+1+Math.round(lk.y+0.5),2,3,PAL.k);px(ex,ey-1,4,1,PAL.k);px(s<0?ex+2:ex,ey,2,1,PAL.k);}
   if(e.mouth>0){pell(cx,cy+6,5,2+(e.mouth>10?1:0),PAL.k);px(cx-1,cy+7,3,1,PAL.R);}else{px(cx-4,cy+6,9,1,PAL.k);px(cx-4,cy+5,1,1,PAL.k);px(cx+4,cy+5,1,1,PAL.k);}break;}
  case 'eraser':drawEraser(e);break;
 }}
function drawEraser(e){const fl=e.flash>0,sp=e.spawn>0;let w=34,h=20,ox=0;if(e.state===1)ox=frame%4<2?-1:1;
 if(e.state===2){if(Math.abs(e.ax)>Math.abs(e.ay)){w=38;h=18;}else{w=30;h=22;}}
 const x=Math.round(e.x-w/2)+ox,y=Math.round(e.y-h/2-3);pell(e.x,e.y+e.r-2,w/2,3,SH);
 if(sp){const p=1-e.spawn/e.spawnMax,vh=Math.max(1,Math.round(h*p));px(x,y+h-vh,w,vh,PAL.e);px(x,y+h-vh,w,1,PAL.k);return;}
 const pw=Math.round((w-2)*0.6),c1=fl?PAL.w:PAL.e,c2=fl?PAL.w:PAL.f;
 px(x,y,w,h,PAL.k);px(x+1,y+1,pw,h-2,c1);px(x+1+pw,y+1,w-2-pw,h-2,c2);
 if(!fl){px(x+1,y+1,pw,4,PAL.P);px(x+1+pw,y+1,w-2-pw,4,PAL.i);px(x+1,y+h-4,pw,3,PAL.E);px(x+2+pw,y+h-4,w-3-pw,3,PAL.F);}
 px(x+1+pw,y+1,1,h-2,PAL.k);
 if(fl)return;
 const lk=look(e),stun=e.state===3;
 for(const s of [0,1]){const ex=x+4+s*9,ey=y+6;if(stun){px(ex,ey+1,4,1,PAL.k);px(ex+1,ey,2,3,PAL.k);continue;}px(ex,ey,4,4,PAL.w);px(ex+1+Math.round(lk.x*0.8),ey+1+Math.round(lk.y*0.8),2,2,PAL.k);px(ex,ey-1,4,1,PAL.k);px(s?ex:ex+2,ey,2,1,PAL.k);}
 const mo=e.state===2?3:e.state===1?2:1;px(x+5,y+12,12,mo+1,PAL.k);for(let i=0;i<6;i++)px(x+5+i*2,y+12,1,1,PAL.w);
 if(stun)for(let i=0;i<3;i++){const a=frame*0.15+i*TAU/3;px(e.x+Math.cos(a)*11,y-3+Math.sin(a)*3,2,2,PAL.Y);}
 if(e.state===2)for(let i=1;i<5;i++)px(e.x-e.ax*(w/2+i*5)+(e.ay?ri(-8,8):0),e.y-e.ay*(h/2+i*5)+(e.ax?ri(-6,6):0),e.ax?4:1,e.ay?4:1,PAL.l);}
function drawTear(t){const c=TEARC[t.col]||TEARC.ink,tr=t.trail,n=tr.length;
 for(let i=0;i<n;i+=2){const k=i/n;if(t.tracer){ctx.fillStyle=k>0.65?c[1]:k>0.3?c[2]:PAL.R;const s=k>0.5?2:1;ctx.fillRect(Math.round(tr[i])-(s>>1),Math.round(tr[i+1])-(s>>1),s,s);}
  else if(((i>>1)+frame)%2===0||k>0.6){ctx.fillStyle=k>0.6?c[1]:c[2];ctx.fillRect(Math.round(tr[i]),Math.round(tr[i+1]),1,1);}}
 shad(t.x,t.y+4,t.r);
 if(t.awl){const sp=Math.hypot(t.vx,t.vy)||1,ux=t.vx/sp,uy=t.vy/sp;for(let i=1;i<=t.r+2;i++)px(t.x+ux*i,t.y+uy*i,1,1,PAL.l);}
 const wob=(frame+((t.x*7)|0))%10<5?0:0.4;pcirc(t.x,t.y,t.r+wob,c[0]);px(t.x-1,t.y-1,1,1,c[1]);if(t.r>=3)px(t.x-1,t.y-2,2,1,c[1]);
 if(t.col==='battery'&&frame%3===0)px(t.x+ri(-3,3),t.y+ri(-3,3),1,1,PAL.c);}
function drawEBullet(b){const n=b.trail.length;for(let i=0;i<n;i+=2){if(((i>>1)+frame)%2&&i/n<0.6)continue;px(b.trail[i],b.trail[i+1],1,1,i/n>0.6?PAL.P:PAL.R);}
 shad(b.x,b.y+4,2);pcirc(b.x,b.y,2,PAL.R);px(b.x-1,b.y-1,2,1,PAL.r);px(b.x-1,b.y-1,1,1,PAL.P);}
function drawFx(f){switch(f.type){
 case 'splash':{const r=1+f.t*0.6;pring(f.x,f.y,r,f.col);if(f.t<3)pcirc(f.x,f.y,1,f.col);break;}
 case 'poof':{const r=2+f.t*0.8;if(f.t<10)pring(f.x,f.y,r,PAL.w);for(let i=0;i<6;i++){const a=i/6*TAU+f.t*0.1;px(f.x+Math.cos(a)*r*1.2,f.y+Math.sin(a)*r*0.8,1,1,PAL.l);}break;}
 case 'spark':{for(let i=0;i<4;i++){const a=i/4*TAU+f.t*0.12,r=2+f.t*0.5;px(f.x+Math.cos(a)*r,f.y+Math.sin(a)*r-f.t*0.3,1,1,f.col);}if(f.t<12){px(f.x,f.y-3-f.t*0.4,1,3,PAL.w);px(f.x-1,f.y-2-f.t*0.4,3,1,PAL.w);}break;}
 case 'boom':{const t=f.t;if(t<6){pcirc(f.x,f.y,6+t*4,t<2?PAL.w:PAL.Y);}else if(t<14){pcirc(f.x,f.y,30-(t-6)*1.5,PAL.o);pcirc(f.x,f.y,22-(t-6)*2,PAL.Y);pring(f.x,f.y,30+(t-6),PAL.r);}
  else{const k=(t-14)/20;for(let i=0;i<7;i++){const a=i/7*TAU;pcirc(f.x+Math.cos(a)*(14+k*10),f.y+Math.sin(a)*(10+k*6)-k*12,Math.max(0,5-k*5),k<0.5?PAL.A:PAL.a);}}break;}
}}
function drawRoom(){
 ctx.drawImage(floorC(room),RX0,RY0);ctx.drawImage(WALLS,0,HUD);
 for(const [d,nb] of Object.entries(room.doors))if(nb)drawDoor(d,nb);
 for(const k of room.rocks)ctx.drawImage(SP.rocks[k.type],k.x,k.y);
 if(room.trap)drawTrap(room.trap);
 for(const f of fires){const fl=(frame+f.x)%6<3;px(f.x,f.y,1,1,f.life>20?(fl?PAL.Y:PAL.o):PAL.r);if(f.life>25)px(f.x+(fl?1:-1),f.y-1,1,1,PAL.o);}
 for(const p of room.pickups)drawPickup(p);
 for(const it of room.items)drawPedestal(it);
 for(const b of bombs)drawBomb(b);
 const ents=[];for(const e of enemies)ents.push({y:e.y,f:()=>drawEnemy(e)});
 for(const P of PL){ents.push({y:P.y,f:()=>drawPlayer(P)});
  if(!P.dead){const sp=PSP[P.idx]||PSP[0];for(let i=0;i<P.babies;i++){const b=babyPos(P,i);ents.push({y:b.y,f:()=>{shad(b.x,b.y+2,4);const bob=Math.round(Math.sin(frame*0.15+i));const x0=Math.round(b.x-5),y0=Math.round(b.y-7+bob);ctx.drawImage(sp.baby,x0,y0);eyes(x0,y0,2,6,2,P.look,false,(frame+i*50)%170<5);}});}
   for(let k=0;k<P.clips;k++){const a=frame*0.06+k*TAU/P.clips,cx=P.x+Math.cos(a)*15,cy=P.y-3+Math.sin(a)*11;ents.push({y:cy+3,f:()=>{shad(cx,cy+7,2);ctx.drawImage(SP.clip,Math.round(cx-2),Math.round(cy-4));}});}}}
 ents.sort((a,b)=>a.y-b.y);for(const o of ents)o.f();
 for(const t of tears)drawTear(t);for(const b of ebul)drawEBullet(b);for(const f of fx)drawFx(f);
 for(const p of parts)px(p.x,p.y-p.z,p.s,p.s,p.col);
 ctx.drawImage(VIGN,RX0,RY0);
}
function drawMinimap(){const me=meP(),comp=PL.some(p=>p.compass);const known=floor.list.filter(r=>comp||r.visited||Object.values(r.doors).some(n=>n&&n.visited));let mnx=9,mny=9,mxx=0,mxy=0;
 for(const r of known){mnx=Math.min(mnx,r.gx);mny=Math.min(mny,r.gy);mxx=Math.max(mxx,r.gx);mxy=Math.max(mxy,r.gy);}
 const cw=7,ch=5,mw=(mxx-mnx+1)*(cw+1)+3,mh=(mxy-mny+1)*(ch+1)+3,ox=RX1-mw-2,oy=RY0+2;ctx.fillStyle='rgba(18,14,23,0.55)';ctx.fillRect(ox,oy,mw,mh);
 for(const r of known){const x=ox+2+(r.gx-mnx)*(cw+1),y=oy+2+(r.gy-mny)*(ch+1);px(x,y,cw,ch,r===room?PAL.w:r.visited?PAL.a:'#3d3450');
  const ic=r.type==='boss'?PAL.r:r.type==='treasure'?PAL.Y:r.type==='shop'?PAL.g:null;if(ic)px(x+2,y+1,3,3,ic);}}
function drawHUD(){px(0,0,BW,HUD,PAL.k);const P=meP();if(!P)return;
 const total=Math.ceil(P.maxHp/2);for(let i=0;i<total;i++){const x=4+i*10,y=3,f=clamp(P.hp-i*2,0,2),half=P.maxHp%2===1&&i===total-1,beat=(P.hp<=2&&f>0&&Math.floor(frame/12)%2)?1:0;
  if(half){ctx.drawImage(SP.heartE,0,0,5,8,x,y,5,8);if(f>0)ctx.drawImage(SP.heart,0,0,5,8,x,y-beat,5,8);}
  else{ctx.drawImage(SP.heartE,x,y);if(f>=2)ctx.drawImage(SP.heart,x,y-beat);else if(f===1)ctx.drawImage(SP.heart,0,0,5,8,x,y-beat,5,8);}}
 ctx.drawImage(SP.coin[Math.floor(frame/8)%4],4,14);text(String(team.coins).padStart(2,'0'),13,15,'#fee761');
 ctx.drawImage(SP.bomb[Math.floor(frame/10)%2],38,13);text(String(team.bombs).padStart(2,'0'),49,15,'#c0cbdc');
 text('Этаж '+level,CX,3,'#e8e0d0','center');text(PL.length>1?'Игроков: '+PL.length:FLOOR_NAMES[(level-1)%FLOOR_NAMES.length],CX,13,'#8a8296','center');
 const rec=P.items.slice(-4);for(let i=0;i<rec.length;i++)if(SP.items[rec[rec.length-1-i]])ctx.drawImage(SP.items[rec[rec.length-1-i]][0],BW-20-i*18,4);
 if(isTouch){const bx=BW-18,by=BH-18;pcirc(bx,by,11,'rgba(18,14,23,0.55)');pring(bx,by,11,team.bombs>0?PAL.l:PAL.A);ctx.drawImage(SP.bomb[0],bx-4,by-6);}}
function drawPop(){if(!pop)return;const age=pop.max-pop.life,slide=Math.min(1,age/10),out=Math.min(1,pop.life/12);if(out<=0)return;
 const tw=Math.max(txt(pop.t,'#fee761').width,pop.s?txt(pop.s,'#e8e0d0').width:0),w=tw+(pop.icon?24:0)+14,h=pop.s?26:16,x=Math.round(CX-w/2),y=Math.round(RY0+6-(1-slide)*34-(1-out)*34);
 px(x,y,w,h,PAL.k);px(x+1,y+1,w-2,h-2,'#2a2433');px(x+1,y+1,w-2,1,'#4a405e');let tx=x+7;if(pop.icon){ctx.drawImage(pop.icon,x+5,y+Math.round((h-16)/2));tx=x+24;}
 text(pop.t,tx,y+4,'#fee761');if(pop.s)text(pop.s,tx,y+15,'#e8e0d0');}
function drawSticks(){for(const s of Object.values(sticks)){if(s.id===null)continue;pring(s.ox,s.oy,20,'rgba(18,14,23,0.6)');pring(s.ox,s.oy,19,'rgba(255,248,236,0.4)');pcirc(s.ox+s.vx*18,s.oy+s.vy*18,7,s===sticks.move?'rgba(41,68,126,0.75)':'rgba(228,59,68,0.75)');}}
function playerIcon(fi){const c=mk(16,16),g=c.getContext('2d');g.drawImage(SP.player[fi],0,0);const ey=[6,7,5][fi];for(const ex of [4,10]){g.fillStyle=PAL.w;g.fillRect(ex,ey,2,3);g.fillStyle=PAL.k;g.fillRect(ex+(ex===4?1:0),ey+1,1,2);}return c;}
const PICON=[0,1,2].map(playerIcon);
let titleBG=null;
function drawTitle(){if(!titleBG){titleBG=mk(BW,BH);const g=titleBG.getContext('2d');g.fillStyle=PAL.p;g.fillRect(0,0,BW,BH);const rng=mulberry32(5);for(let i=0;i<500;i++){g.fillStyle=rng()<0.5?PAL.s:'#efe5cf';g.fillRect(Math.floor(rng()*BW),Math.floor(rng()*BH),1,1);}
  g.fillStyle=PAL.L;for(let y=7;y<BH;y+=8)g.fillRect(0,y,BW,1);g.fillStyle=PAL.m;g.fillRect(26,0,1,BH);g.fillRect(28,0,1,BH);g.globalAlpha=0.5;for(let i=0;i<9;i++)g.drawImage(SP.doodles[i%5],40+Math.floor(rng()*(BW-60)),10+Math.floor(rng()*(BH-24)));g.globalAlpha=1;
  for(let i=0;i<6;i++){g.globalAlpha=0.6;blobInto(g,40+rng()*(BW-80),20+rng()*(BH-40),2+rng()*5,PAL.b,rng);}g.globalAlpha=1;}
 ctx.drawImage(titleBG,0,0);const t=frame;
 text('КЛЯКСА',CX,16,'#1d2b53','center','#9cc3ff',4);text('подвал тетрадки',CX,54,'#9e2835','center');
 const bob=Math.round(Math.abs(Math.sin(t*0.06))*-6),fi=bob<-4?2:bob>-1?1:0;pell(CX,118,18,4,'rgba(18,14,23,0.25)');ctx.drawImage(PICON[fi],CX-24,70+bob,48,48);
 for(let i=0;i<3;i++){const a=t*0.03+i*TAU/3,x=CX+Math.cos(a)*56,y=94+Math.sin(a)*18;ctx.drawImage(SP.fly[Math.floor(t/3+i)%2],Math.round(x-5),Math.round(y-4));}
 const lines=isTouch?['Левый палец — ходить','Правый палец — стрелять','Кнопка справа внизу — бомба']:['WASD — ходить','Стрелки — стрелять','E — бомба'];
 lines.forEach((l,i)=>text(l,CX,134+i*12,'#2a2433','center'));
 const n=window.Net&&Net.self?Net.all().length:1;
 if(n>1)text('Игроков в комнате: '+n,CX,172,'#3e8948','center');
 const msg=isTouch?'Коснись, чтобы начать':'Нажми любую клавишу';
 if(Math.floor(t/30)%2===0)text(msg,CX,188,'#e43b44','center','#120e17');
 if(best)text('Рекорд: этаж '+best,CX,208,'#5a6988','center');}
function drawOverlay(lvl){ctx.drawImage(DITH[lvl],0,0);}
function drawPause(){const P=meP();drawOverlay(1);px(CX-118,20,236,200,'rgba(18,14,23,0.86)');px(CX-118,20,236,1,'#4a405e');text('ПАУЗА',CX,30,'#fee761','center','#120e17',2);
 const st=['Урон '+P.dmg.toFixed(1).replace('.',','),'Выстрелы в сек '+(60/P.rate).toFixed(1).replace('.',','),'Скорость '+P.speed.toFixed(2).replace('.',','),'Дальность '+Math.round(P.range)];
 st.forEach((s,i)=>text(s,CX,60+i*11,'#e8e0d0','center','#120e17'));
 text('Предметы',CX,110,'#8a8296','center');const n=P.items.length,per=12,sx0=Math.round(CX-Math.min(n,per)*18/2);
 P.items.forEach((id,i)=>{ctx.drawImage(SP.items[id][0],sx0+(i%per)*18,122+Math.floor(i/per)*18);});if(!n)text('пока пусто',CX,126,'#5a6988','center');
 text(isTouch?'Коснись, чтобы продолжить':'P — продолжить, R — заново',CX,196,'#c0cbdc','center','#120e17');text(muted?'Звук выключен (M)':'Звук включён (M)',CX,210,'#5a6988','center');}
function drawOver(){drawOverlay(1);px(CX-124,36,248,150,'rgba(18,14,23,0.86)');px(CX-124,36,248,1,'#4a405e');text(PL.length>1?'КЛЯКСЫ ВЫСОХЛИ':'КЛЯКСА ВЫСОХЛА',CX,48,'#e43b44','center','#120e17',2);
 const P=meP();[['Этаж',level],['Врагов стёрто',kills],['Предметов',P?P.items.length:0],['Рекорд: этаж',best]].forEach(([a,b],i)=>text(a+' '+b,CX,90+i*13,'#e8e0d0','center','#120e17'));
 if(Math.floor(frame/30)%2===0)text(isTouch?'Коснись, чтобы начать заново':'R или Enter — заново',CX,170,'#fee761','center','#120e17');}

function draw(){
 ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;
 if(state==='title'||state==='wait'||!floor||!room){drawTitle();return;}
 px(0,0,BW,BH,PAL.k);
 ctx.save();ctx.beginPath();ctx.rect(0,HUD,BW,BH-HUD);ctx.clip();
 if(trans&&trans.snap){const p0=Math.min(1,trans.t/TRANS),p=p0<0.5?2*p0*p0:1-Math.pow(-2*p0+2,2)/2,[dx,dy]=DIR[trans.dir],sw=BW,sh=BH-HUD;
  ctx.drawImage(trans.snap,Math.round(-dx*sw*p),HUD+Math.round(-dy*sh*p));ctx.translate(Math.round(dx*sw*(1-p)),Math.round(dy*sh*(1-p)));drawRoom();}
 else{const s=Math.min(3,Math.round(shake/2));if(s)ctx.translate(ri(-s,s),ri(-s,s));drawRoom();}
 ctx.restore();
 if(!trans){drawMinimap();const b=enemies.find(e=>e.boss&&e.spawn<=0);if(b){const bw=120,bx=CX-60,by=RY1-9;px(bx-2,by-2,bw+4,8,PAL.k);px(bx,by,bw,4,'#3d1c25');const fw=Math.round(bw*Math.max(0,b.hp)/b.maxhp);px(bx,by,fw,4,PAL.r);px(bx,by,fw,1,PAL.P);ctx.drawImage(SP.skull,bx-9,by-2);}}
 drawPop();
 if(hint){const w=txt(hint.t,'#fee761').width+10,x=Math.round(CX-w/2),y=RY1-26;px(x,y,w,13,PAL.k);px(x+1,y+1,w-2,11,'#2a2433');text(hint.t,x+5,y+3,'#fee761');}
 const me=meP();if(me&&me.dead&&state==='play'&&PL.length>1){const s='Вы погибли — друзья вернут вас, зачистив комнату';const w=txt(s,'#e8e0d0').width+10,x=Math.round(CX-w/2),y=RY1-40;px(x,y,w,13,PAL.k);text(s,x+5,y+3,'#e8e0d0');}
 drawHUD();drawSticks();
 if(fadeT>0)drawOverlay(Math.min(3,Math.floor(fadeT/8)));
 if(state==='pause')drawPause();
 if(state==='over')drawOver();}

/* ================= ввод ================= */
const GK=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD','KeyE','KeyQ'];
function toggleMute(){muted=!muted;try{localStorage.setItem('klyaksa_mute',muted?'1':'0');}catch(e){}if(!muted)sfx('coin');}
function startOrAsk(){if(HOST()){if(state!=='play'&&state!=='pause')newGame();}else Net.send({t:'start'});}
addEventListener('keydown',e=>{if(GK.includes(e.code))e.preventDefault();actx();
 if(e.code==='KeyM'&&!e.repeat){toggleMute();return;}
 K[e.code]=true;
 if(state==='title'||state==='wait'){if(!e.repeat)startOrAsk();return;}
 if(state==='over'){if(e.code==='KeyR'||e.code==='Enter'||e.code==='Space')startOrAsk();return;}
 if(e.code==='KeyR'&&!e.repeat&&!MP()){newGame();return;}
 if((e.code==='KeyP'||e.code==='Escape')&&!e.repeat&&!MP()){if(state==='play')state='pause';else if(state==='pause')state='play';return;}
 if((e.code==='KeyE'||e.code==='KeyQ')&&!e.repeat&&state==='play')localBombs++;});
addEventListener('keyup',e=>{K[e.code]=false;});
addEventListener('blur',()=>{for(const k in K)K[k]=false;if(state==='play'&&!MP())state='pause';});
function toGame(t){const r=cv.getBoundingClientRect();return{x:(t.clientX-r.left)/r.width*BW,y:(t.clientY-r.top)/r.height*BH};}
function setStick(s,p){let dx=p.x-s.ox,dy=p.y-s.oy;const l=Math.hypot(dx,dy);if(l<4){s.vx=s.vy=0;return;}const m=Math.min(1,l/20);s.vx=dx/l*m;s.vy=dy/l*m;}
cv.addEventListener('touchstart',e=>{e.preventDefault();isTouch=true;actx();
 if(state==='title'||state==='over'||state==='wait'){startOrAsk();return;}if(state==='pause'){state='play';return;}
 for(const t of e.changedTouches){const p=toGame(t);if(Math.hypot(p.x-(BW-18),p.y-(BH-18))<14){localBombs++;continue;}if(p.y<HUD&&!MP()){state='pause';continue;}
  const s=p.x<BW/2?sticks.move:sticks.shoot;if(s.id===null){s.id=t.identifier;s.ox=p.x;s.oy=p.y;s.vx=s.vy=0;}}},{passive:false});
cv.addEventListener('touchmove',e=>{e.preventDefault();for(const t of e.changedTouches)for(const s of Object.values(sticks))if(s.id===t.identifier)setStick(s,toGame(t));},{passive:false});
function endTouch(e){for(const t of e.changedTouches)for(const s of Object.values(sticks))if(s.id===t.identifier){s.id=null;s.vx=s.vy=0;}}
cv.addEventListener('touchend',endTouch);cv.addEventListener('touchcancel',endTouch);
cv.addEventListener('mousedown',()=>{cv.focus();actx();if(state==='title'||state==='over'||state==='wait')startOrAsk();else if(state==='pause')state='play';});

syncRoster();
let last=performance.now(),acc=0;const STEP=1000/60;
function loop(now){acc+=Math.min(100,now-last);last=now;while(acc>=STEP){update();if(HOST())hostNet();acc-=STEP;}try{draw();}catch(err){console.error(err);}requestAnimationFrame(loop);}
requestAnimationFrame(loop);
cv.focus();
})();
