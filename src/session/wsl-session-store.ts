import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SessionCatalog, SessionSummary } from "./session-store.js";
import { isRecord } from "../utils/is-record.js";

const execFileAsync = promisify(execFile);
const MAX_SESSIONS = 500;

export class WslSessionStore implements SessionCatalog {
  constructor(
    private readonly distribution: string,
    private readonly wslExecutable = "wsl.exe",
    private readonly run: typeof execFileAsync = execFileAsync,
  ) {}

  async list(cwd: string): Promise<SessionSummary[]> {
    try {
      const { stdout } = await this.run(this.wslExecutable, [
        "-d", this.distribution,
        "--exec", "/bin/bash", "-ilc",
        'node -e "$1" "$2"',
        "pi-vscode-sessions",
        WSL_SESSION_SCRIPT,
        cwd,
      ], {
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
      const value: unknown = JSON.parse(cleanWslOutput(stdout));
      if (!Array.isArray(value)) return [];
      return value.slice(0, MAX_SESSIONS).map(parseSessionSummary).filter((item): item is SessionSummary => item !== undefined);
    } catch {
      return [];
    }
  }
}

function parseSessionSummary(value: unknown): SessionSummary | undefined {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.path !== "string"
    || !value.path.startsWith("/")
    || typeof value.cwd !== "string"
    || typeof value.firstMessage !== "string"
    || typeof value.messageCount !== "number"
    || typeof value.created !== "string"
    || typeof value.modified !== "string") return undefined;
  return {
    id: value.id.slice(0, 500),
    path: value.path.slice(0, 4096),
    cwd: value.cwd.slice(0, 4096),
    name: typeof value.name === "string" ? value.name.slice(0, 1_000) : undefined,
    firstMessage: value.firstMessage.slice(0, 10_000),
    messageCount: Math.max(0, Math.floor(value.messageCount)),
    created: value.created,
    modified: value.modified,
  };
}

function cleanWslOutput(value: string): string {
  return value.replaceAll("\0", "").replaceAll("\r", "").trim();
}

const WSL_SESSION_SCRIPT = String.raw`
const fs=require("fs"),path=require("path"),readline=require("readline");
const cwd=path.resolve(process.argv[1]);
const safe="--"+cwd.replace(/^[/\\]/,"").replace(/[/\\:]/g,"-")+"--";
const dir=path.join(process.env.PI_CODING_AGENT_DIR||path.join(process.env.HOME,".pi","agent"),"sessions",safe);
(async()=>{
 let files=[]; try{files=(await fs.promises.readdir(dir)).filter(f=>f.endsWith(".jsonl")).slice(0,500)}catch{return console.log("[]")}
 const out=[];
 for(const file of files){
  try{
   const filePath=path.join(dir,file),st=await fs.promises.stat(filePath),lines=readline.createInterface({input:fs.createReadStream(filePath,{encoding:"utf8"}),crlfDelay:Infinity});
   let header,name,first="",count=0,last=0;
   for await(const line of lines){let e;try{e=JSON.parse(line)}catch{continue}if(!header){if(e.type!=="session"||typeof e.id!=="string"||path.resolve(e.cwd)!==cwd)break;header=e;continue}if(e.type==="session_info"){if(typeof e.name==="string"&&e.name.trim())name=e.name.trim();continue}if(e.type!=="message"||!e.message)continue;count++;const m=e.message;if(m.role==="user"&&!first){const c=m.content;first=typeof c==="string"?c:Array.isArray(c)?c.filter(b=>b&&b.type==="text"&&typeof b.text==="string").map(b=>b.text).join(" "):""}const ts=typeof m.timestamp==="number"?m.timestamp:Date.parse(e.timestamp);if(Number.isFinite(ts))last=Math.max(last,ts)}
   if(header)out.push({id:header.id,path:filePath,cwd:header.cwd,name,firstMessage:first||"(no messages)",messageCount:count,created:typeof header.timestamp==="string"?header.timestamp:st.birthtime.toISOString(),modified:new Date(last||st.mtimeMs).toISOString()})
  }catch{}
 }
 out.sort((a,b)=>Date.parse(b.modified)-Date.parse(a.modified));console.log(JSON.stringify(out));
})().catch(()=>console.log("[]"));
`;
