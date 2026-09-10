/** Bahoosh Persian (Jalali) date picker — no external dependency. */
(function(){
  'use strict';
  var faDigits='۰۱۲۳۴۵۶۷۸۹';
  var months=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  var weekdays=['ش','ی','د','س','چ','پ','ج'];
  function fa(n){return String(n).replace(/\d/g,function(d){return faDigits[d];});}
  function div(a,b){return ~~(a/b)} function mod(a,b){return a-~~(a/b)*b}
  function jalCal(jy){var breaks=[-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178],bl=breaks.length,gy=jy+621,leapJ=-14,jp=breaks[0],jm,jump,leap,n,i;if(jy<jp||jy>=breaks[bl-1])return null;for(i=1;i<bl;i++){jm=breaks[i];jump=jm-jp;if(jy<jm)break;leapJ+=div(jump,33)*8+div(mod(jump,33),4);jp=jm;}n=jy-jp;leapJ+=div(n,33)*8+div(mod(n,33)+3,4);if(mod(jump,33)===4&&jump-n===4)leapJ++;var leapG=div(gy,4)-div((div(gy,100)+1)*3,4)-150;var march=20+leapJ-leapG;if(jump-n<6)n=n-jump+div(jump+4,33)*33;leap=mod(mod(n+1,33)-1,4);if(leap===-1)leap=4;return{leap:leap,gy:gy,march:march};}
  function g2d(gy,gm,gd){var d=div((gy+div(gm-8,6)+100100)*1461,4)+div(153*mod(gm+9,12)+2,5)+gd-34840408;d=d-div(div(gy+100100+div(gm-8,6),100)*3,4)+752;return d;}
  function d2g(jdn){var j=4*jdn+139361631;j=j+div(div(4*jdn+183187720,146097)*3,4)*4-3908;var i=div(mod(j,1461),4)*5+308;var gd=div(mod(i,153),5)+1,gm=mod(div(i,153),12)+1,gy=div(j,1461)-100100+div(8-gm,6);return{gy:gy,gm:gm,gd:gd};}
  function j2d(jy,jm,jd){var r=jalCal(jy);return g2d(r.gy,3,r.march)+(jm-1)*31-div(jm,7)*(jm-7)+jd-1;}
  function d2j(jdn){var g=d2g(jdn),jy=g.gy-621,r=jalCal(jy),jdn1f=g2d(g.gy,3,r.march),k=jdn-jdn1f,jm,jd;if(k>=0){if(k<=185){jm=1+div(k,31);jd=mod(k,31)+1;return{jy:jy,jm:jm,jd:jd};}k-=186;}else{jy-=1;k+=179;if(r.leap===1)k+=1;}jm=7+div(k,30);jd=mod(k,30)+1;return{jy:jy,jm:jm,jd:jd};}
  function toJ(gy,gm,gd){return d2j(g2d(gy,gm,gd));}
  function toG(jy,jm,jd){return d2g(j2d(jy,jm,jd));}
  function parseISO(s){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?{gy:+m[1],gm:+m[2],gd:+m[3]}:null;}
  function isoFromJ(jy,jm,jd){var g=toG(jy,jm,jd);return String(g.gy).padStart(4,'0')+'-'+String(g.gm).padStart(2,'0')+'-'+String(g.gd).padStart(2,'0');}
  function formatISO(s,long){var g=parseISO(s);if(!g)return s||'';var j=toJ(g.gy,g.gm,g.gd);return long?fa(j.jd)+' '+months[j.jm-1]+' '+fa(j.jy):fa(j.jy)+'/'+fa(String(j.jm).padStart(2,'0'))+'/'+fa(String(j.jd).padStart(2,'0'));}
  function daysInMonth(jy,jm){if(jm<=6)return 31;if(jm<=11)return 30;return jalCal(jy).leap===0?30:29;}
  function todayJ(){var d=new Date(),j=toJ(d.getFullYear(),d.getMonth()+1,d.getDate());return j;}
  var active=null,view=null;
  function close(){if(active){active.remove();active=null;}view=null;}
  function open(input){close();var target=document.getElementById(input.getAttribute('data-bap-jalali-target'));if(!target)return;var current=parseISO(target.value),j=current?toJ(current.gy,current.gm,current.gd):todayJ();view={jy:j.jy,jm:j.jm,target:target,input:input,selected:j};
    var pop=document.createElement('div');pop.className='bap-jalali-popover';pop.setAttribute('dir','rtl');active=pop;document.body.appendChild(pop);render();position();}
  function position(){if(!active||!view)return;var r=view.input.getBoundingClientRect(),w=Math.min(340,window.innerWidth-24);active.style.width=w+'px';var left=Math.max(12,Math.min(window.innerWidth-w-12,r.right-w));active.style.left=(left+window.scrollX)+'px';active.style.top=(r.bottom+8+window.scrollY)+'px';}
  function render(){if(!active||!view)return;var p=active;p.innerHTML='';var head=document.createElement('div');head.className='bap-jdp-head';var prev=button('‹','ماه قبل',function(){view.jm--;if(view.jm<1){view.jm=12;view.jy--;}render();});var title=document.createElement('button');title.type='button';title.className='bap-jdp-title';title.textContent=months[view.jm-1]+' '+fa(view.jy);var next=button('›','ماه بعد',function(){view.jm++;if(view.jm>12){view.jm=1;view.jy++;}render();});head.appendChild(prev);head.appendChild(title);head.appendChild(next);p.appendChild(head);
    var wk=document.createElement('div');wk.className='bap-jdp-weekdays';weekdays.forEach(function(x){var s=document.createElement('span');s.textContent=x;wk.appendChild(s);});p.appendChild(wk);
    var grid=document.createElement('div');grid.className='bap-jdp-grid';var g=toG(view.jy,view.jm,1),dow=new Date(g.gy,g.gm-1,g.gd).getDay();var offset=(dow+1)%7;for(var i=0;i<offset;i++){var blank=document.createElement('span');blank.className='is-blank';grid.appendChild(blank);}var count=daysInMonth(view.jy,view.jm),t=todayJ();for(let d=1;d<=count;d++){let day=d;var b=document.createElement('button');b.type='button';b.textContent=fa(day);b.className='bap-jdp-day';if(t.jy===view.jy&&t.jm===view.jm&&t.jd===day)b.classList.add('is-today');var sel=parseISO(view.target.value);if(sel){var sj=toJ(sel.gy,sel.gm,sel.gd);if(sj.jy===view.jy&&sj.jm===view.jm&&sj.jd===day)b.classList.add('is-selected');}b.addEventListener('click',function(){var iso=isoFromJ(view.jy,view.jm,day);view.target.value=iso;view.input.value=formatISO(iso,true);view.target.dispatchEvent(new Event('change',{bubbles:true}));close();});grid.appendChild(b);}p.appendChild(grid);
    var foot=document.createElement('div');foot.className='bap-jdp-foot';var clear=button('پاک کردن','',function(){view.target.value='';view.input.value='';view.target.dispatchEvent(new Event('change',{bubbles:true}));close();});var tod=button('امروز','',function(){var t=todayJ(),iso=isoFromJ(t.jy,t.jm,t.jd);view.target.value=iso;view.input.value=formatISO(iso,true);view.target.dispatchEvent(new Event('change',{bubbles:true}));close();});foot.appendChild(clear);foot.appendChild(tod);p.appendChild(foot);}
  function button(txt,label,fn){var b=document.createElement('button');b.type='button';b.textContent=txt;if(label)b.setAttribute('aria-label',label);b.addEventListener('click',fn);return b;}
  function init(){document.querySelectorAll('.bap-jalali-input').forEach(function(input){var target=document.getElementById(input.getAttribute('data-bap-jalali-target'));if(target&&target.value)input.value=formatISO(target.value,true);input.addEventListener('click',function(e){e.stopPropagation();open(input);});});}
  document.addEventListener('click',function(e){if(active&&!active.contains(e.target)&&(!view||e.target!==view.input))close();});window.addEventListener('resize',position);window.addEventListener('scroll',position,true);document.addEventListener('DOMContentLoaded',init);
  window.BAPJalali={formatISO:formatISO,toJalali:toJ,toGregorian:toG,init:init};
})();
