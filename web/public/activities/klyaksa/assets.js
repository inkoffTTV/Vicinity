// Клякса: графика (палитра и пиксельные спрайты), пиксельный текст, звук и данные игры.
// Из оригинальной игры; общие объявления видны логике (game.js) — оба файла обычные скрипты.
'use strict';
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
 case 'paper':noise(0.18,0.07,1800);noise(0.1,0.05,600);break;
 case 'ping':tone(1046,0.08,'triangle',0.04);tone(1568,0.12,'triangle',0.035,0,0.07);break;
 case 'merge':[392,523,659,784].forEach((f,i)=>tone(f,0.1,'triangle',0.04,0,i*0.05));break;
 case 'split':[784,659,523].forEach((f,i)=>tone(f,0.08,'triangle',0.035,0,i*0.05));break;
 case 'revive':[523,659,784,1047].forEach((f,i)=>tone(f,0.14,'sine',0.05,0,i*0.08));break;
 case 'laser':tone(1800,0.25,'sawtooth',0.03,-1500);noise(0.12,0.05,3000);break;
 case 'shield':tone(1300,0.1,'square',0.025,-600);break;
 case 'intro':tone(98,0.6,'sawtooth',0.05,-20);tone(147,0.6,'square',0.025,-30,0.15);noise(0.3,0.05,300);break;
 case 'curse':tone(220,0.4,'sawtooth',0.04,-120);tone(233,0.4,'sawtooth',0.03,-120,0.05);break;
 case 'task':[659,784,1047].forEach((f,i)=>tone(f,0.12,'square',0.03,0,i*0.07));break;
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

