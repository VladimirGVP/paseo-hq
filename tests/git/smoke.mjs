import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../..");
const output = process.env.GIT_SMOKE_OUTPUT || "/tmp/opencode/hq-git";
await mkdir(output, { recursive: true });
await build({absWorkingDir:root,entryPoints:["tests/git/browser.tsx"],outfile:join(output,"browser.js"),bundle:true,platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',__DEV__:"false"},alias:{"react-native":"react-native-web","@getpaseo/plugin/client":resolve(root,"tests/git/host.tsx"),"@getpaseo/plugin/client/react-native":resolve(root,"tests/git/host.tsx")} });
await build({absWorkingDir:root,entryPoints:["server/git-login.server.ts"],outfile:join(output,"login.mjs"),bundle:true,platform:"node",format:"esm"});
const {GitLoginService}=await import(pathToFileURL(join(output,"login.mjs")));
const children=[];
let failLogin=false;
const login=new GitLoginService({launch:()=>{
 const child=spawn(process.execPath,["-e",failLogin ? "process.stderr.write('OAuth denied');process.exit(1)" : "process.stderr.write('First copy your one-time code: ABCD-EFGH\\n');process.stdin.on('data',x=>{if(String(x).includes('finish'))process.exit(0)})"]);
 children.push(child);return child;
}});
let connected=false;
let daemon;
if(process.argv.includes("--live")){
 const {DaemonClient}=await import("@getpaseo/client/internal/daemon-client");
 daemon=new DaemonClient({url:process.env.PASEO_DAEMON_URL||"ws://127.0.0.1:6767/ws",password:process.env.PASEO_PASSWORD,clientId:"hq-git-smoke",clientType:"cli",appVersion:"0.15.2",reconnect:{enabled:false}});await daemon.connect();
}
const fixture={ id:"github:studio/team-project",name:"team-project",fullName:"studio/team-project",description:"Team repository",url:"https://github.com/studio/team-project",sshUrl:"git@github.com:studio/team-project.git",httpUrl:"https://github.com/studio/team-project.git",defaultBranch:"main",provider:"github",isPrivate:true,isLocal:false,localPath:"/tmp/studio/team-project" };
const auth=()=>({github:{installed:true,loggedIn:connected,user:connected?"person":undefined},gitlab:{installed:true,loggedIn:connected,user:connected?"lab-user":undefined,host:"gitlab.com"}});
const server=createServer(async(req,res)=>{
 try{
  if(req.url==="/rpc"){
   let body="";for await(const part of req)body+=part;const {method,input}=JSON.parse(body);
   let value;
   if(daemon && ["git.list-repos","git.trigger-sync"].includes(method)) value=await daemon.invokePluginRpc("paseo-hq",method,input);
   else if(method==="git.list-repos")value={repos:connected?[fixture]:[],lastSyncedAt:Date.now(),isSyncing:false,auth:auth(),errors:[]};
   else if(method==="git.trigger-sync")value={success:true,count:1,lastSyncedAt:Date.now(),auth:auth(),errors:[]};
   else if(method==="git.login-start")value=login.start(input.provider,input.gitlabUrl);
   else if(method==="git.login-status"){value=login.get(input.id);if(value.state==="complete")connected=true;}
   else if(method==="git.login-cancel")value=login.cancel(input.id);
   else throw Error("Unexpected RPC "+method);
   res.setHeader("Content-Type","application/json");res.end(JSON.stringify(value));
  }else if(req.url==="/complete"){children.at(-1).stdin.write("finish\n");res.end("ok");}
  else if(req.url==="/fail"){failLogin=true;res.end("ok");}
  else if(req.url==="/browser.js"){res.setHeader("Content-Type","text/javascript");res.end(await readFile(join(output,"browser.js")));}
  else{res.setHeader("Content-Type","text/html");res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root" style="height:100vh;display:flex"></div><script src="/browser.js"></script></body></html>');}
 }catch(error){res.writeHead(500);res.end(String(error));}
});
let browser;
const results=[];
try{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const dirs=await readdir(join(homedir(),".cache/ms-playwright"));
 const shell=dirs.filter(x=>x.startsWith("chromium_headless_shell-")).sort().at(-1);
 browser=await chromium.launch(shell?{executablePath:join(homedir(),".cache/ms-playwright",shell,"chrome-headless-shell-linux64/chrome-headless-shell")}:{ });
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:1050}});page.setDefaultTimeout(12000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?${width===1280?"dark":"light"}`);
  if(!daemon){
   await page.getByRole("button",{name:"Войти в GitHub",exact:true}).click();
   await page.getByText("ABCD-EFGH",{exact:true}).waitFor();
   await page.getByRole("button",{name:"Копировать код",exact:true}).click();
   assert.equal(await page.evaluate(()=>document.body.dataset.copied),"ABCD-EFGH");
   await page.getByRole("button",{name:"Открыть GitHub",exact:true}).click();
   assert.equal(await page.evaluate(()=>document.body.dataset.opened),"https://github.com/login/device");
   await page.getByRole("button",{name:"Отменить вход",exact:true}).click();
   await page.getByRole("button",{name:"Войти в GitLab",exact:true}).click();
   await page.getByText("ABCD-EFGH",{exact:true}).waitFor();
   await page.getByRole("button",{name:"Открыть GitLab",exact:true}).click();
   assert.equal(await page.evaluate(()=>document.body.dataset.opened),"https://gitlab.com/oauth/device");
   await page.request.get(`http://127.0.0.1:${server.address().port}/complete`);
   await page.getByText("studio/team-project",{exact:true}).waitFor();
   await page.getByText("Вход выполнен",{exact:true}).waitFor();
  }else{
   await page.getByText("@" + process.env.PASEO_GIT_EXPECT_USER,{exact:true}).waitFor();
   await page.getByPlaceholder("Поиск репозиториев...").fill(process.env.PASEO_GIT_EXPECT_NAMESPACE || "studio/");
   await page.getByText(new RegExp(process.env.PASEO_GIT_EXPECT_NAMESPACE || "studio/")).first().waitFor();
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"horizontal overflow");
  assert.deepEqual(errors,[]);
  await page.screenshot({path:join(output,`git-${width}${daemon?"-live":""}.png`),fullPage:true});
  results.push({name:`${width}px: ${daemon?"live studio repositories":"GitHub/GitLab login, code, cancel, completion and organization"}`,status:"passed"});
  if (!daemon) {
   await page.request.get(`http://127.0.0.1:${server.address().port}/fail`);
   await page.getByRole("button",{name:"Войти заново в GitHub",exact:true}).click();
   await page.getByText("OAuth denied",{exact:true}).waitFor();
  }
  await page.close();connected=false;failLogin=false;
 }
}catch(error){results.push({name:"Git UI smoke",status:"failed",message:String(error.stack||error)});process.exitCode=1;}
finally{login.dispose();await browser?.close();await new Promise(resolve=>server.close(resolve));await daemon?.close();await writeFile(join(output,daemon?"ui-live-tests.json":"ui-tests.json"),JSON.stringify(results,null,2));console.log(JSON.stringify(results));}
