import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export interface Point { at:number; boot:string; iface:string; rx:number; tx:number }
export interface Traffic { rx:number; tx:number; hours:number; complete:boolean; iface:string }
const DAY=24*60*60*1000;
const STEP=60*1000;
export function total(points:Point[],now:number):Traffic|null {
 if(points.length===0)return null;
 const cutoff=now-DAY; let begin=0;
 while(begin+1<points.length&&points[begin+1]!.at<=cutoff)begin++;
 const relevant=points.slice(begin);const first=relevant[0]!,last=relevant[relevant.length-1]!;
 let rx=0,tx=0,complete=first.at<=cutoff&&now-last.at<=STEP*3;
 for(let i=1;i<relevant.length;i++){
  const a=relevant[i-1]!,b=relevant[i]!;
  if(b.boot!==a.boot||b.iface!==a.iface||b.rx<a.rx||b.tx<a.tx||b.at<=a.at||b.at-a.at>STEP*3){complete=false;continue;}
  rx+=b.rx-a.rx;tx+=b.tx-a.tx;
 }
 return {rx,tx,hours:Math.min(24,Math.max(0,(last.at-first.at)/3600000)),complete,iface:last.iface};
}
export function createTrafficCollector(){
 const dir=join(os.homedir(),'.local/state/paseo-host-monitor'),file=join(dir,'traffic.json');
 let points:Point[]=[];
 try {const x=JSON.parse(readFileSync(file,'utf8')); if(Array.isArray(x.points))points=x.points.filter((p:Point)=>Number.isFinite(p.at)&&Number.isFinite(p.rx)&&Number.isFinite(p.tx)&&typeof p.boot==='string'&&typeof p.iface==='string').slice(-1500); }catch{}
 function tick(){
  try {
   const at=Date.now();if(points.length&&at-points[points.length-1]!.at<STEP)return;
   const routes=readFileSync('/proc/net/route','utf8').split('\n').slice(1).map(l=>l.trim().split(/\s+/));
   const route=routes.filter(x=>x[1]==='00000000'&&((parseInt(x[3]||'0',16)&1)!==0)).sort((a,b)=>Number(a[6])-Number(b[6]))[0];
   const iface=route?.[0];if(!iface||!/^[A-Za-z0-9_.-]+$/.test(iface))return;
   const boot=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
   const rx=Number(readFileSync(`/sys/class/net/${iface}/statistics/rx_bytes`,'utf8'));
   const tx=Number(readFileSync(`/sys/class/net/${iface}/statistics/tx_bytes`,'utf8'));
   if(!Number.isSafeInteger(rx)||!Number.isSafeInteger(tx))return;
   points.push({at,boot,iface,rx,tx});
   while(points.length>2&&points[1]!.at<at-DAY)points.shift();
   points=points.slice(-1500);
   mkdirSync(dir,{recursive:true,mode:0o700});const tmp=file+'.tmp';
   writeFileSync(tmp,JSON.stringify({version:1,points}),{mode:0o600});renameSync(tmp,file);
  }catch(e){console.error('[host-monitor] traffic history unavailable:',e instanceof Error?e.message:'unknown error');}
 }
 return {tick,read:()=>total(points,Date.now())};
}
