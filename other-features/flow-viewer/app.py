"""Temporary live viewer for the ID intake flow: watch each photo go through the steps and see what came out.

  python app.py --python <python of the intake worker> --runner <its scripts/run_folder.py> --in <photo folder> --out <output folder>
                [--port 8096]        then open http://127.0.0.1:8096

The page starts the folder runner (a separate program, run as a subprocess; nothing is imported from it) on a random sample of the
photo folder and follows its event log: one chip per step (grey waiting, blue running, green done with its milliseconds), in two
rows: "Form" (the fast part, ending in the form-ready moment) and "Saving" (the background part, ending in the moment the picture is
saved), then the original photo next to the picture that came out, the status, the flags, what the saving part saw differently
(codes and field names only) and which fields were read (filled or empty, never their values). Local only: 127.0.0.1, nothing is uploaded; the photos are read-only and served only from the folder given with --in; the
output pictures only from --out. Standard library only. Meant for looking at a small batch (for example 10 photos)."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

STATE = {"proc": None, "started": 0.0, "log": None}
CFG: dict = {}
LOCK = threading.Lock()
MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".bmp": "image/bmp",
        ".tif": "image/tiff", ".tiff": "image/tiff", ".gif": "image/gif"}


def under(path: Path, folder: Path) -> bool:
    try:
        path.resolve().relative_to(folder.resolve())
        return True
    except (ValueError, OSError):
        return False


def start_run(limit: int, seed: int) -> dict:
    with LOCK:
        proc = STATE["proc"]
        if proc is not None and proc.poll() is None:
            return {"started": False, "error": "a run is already going"}
        out = Path(CFG["out"])
        out.mkdir(parents=True, exist_ok=True)
        for old in out.iterdir():  # a fresh run: this viewer's own output folder is emptied first (pictures and report only)
            if old.is_file() and old.suffix.lower() in (".jpg", ".png", ".webp", ".csv", ".html", ".jsonl"):
                old.unlink()
        log = open(out / "runner.log", "w", encoding="utf-8")
        cmd = [CFG["python"], CFG["runner"], "--in", CFG["src"], "--out", str(out), "--limit", str(limit), "--seed", str(seed),
               "--progress", str(out / "progress.jsonl"), "--no-resume"]
        flags = 0x00004000 if sys.platform == "win32" else 0  # BELOW_NORMAL_PRIORITY_CLASS: the PC stays usable
        STATE.update(proc=subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, creationflags=flags), started=time.time(), log=log)
        return {"started": True}


def events_since(offset: int) -> dict:
    path = Path(CFG["out"]) / "progress.jsonl"
    if not path.exists():
        return {"events": [], "offset": 0, "running": False}
    with open(path, "rb") as fh:
        fh.seek(offset)
        chunk = fh.read()
    end = chunk.rfind(b"\n") + 1  # only whole lines
    events = [json.loads(line) for line in chunk[:end].decode("utf-8").splitlines() if line.strip()]
    proc = STATE["proc"]
    return {"events": events, "offset": offset + end, "running": proc is not None and proc.poll() is None}


PAGE = r"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>ID flow viewer</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--ink:#1d232b;--mut:#5b6573;--line:#d7dce3;--run:#2b6cb0;--ok:#1f7a4a;--bad:#c0392b;--warn:#b7791f;--grey:#c9ced6}
@media(prefers-color-scheme:dark){:root{--bg:#12161b;--card:#1a2027;--ink:#e6e9ee;--mut:#9aa4b1;--line:#2c343e;--run:#5aa0e6;--ok:#5cc28b;--bad:#ef7468;--warn:#e0b04a;--grey:#3a434f}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
header b{font-size:16px}header label{color:var(--mut)}header input{width:64px;padding:5px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)}
button{padding:7px 16px;border:0;border-radius:6px;background:var(--ink);color:var(--bg);font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}
.sum{margin-left:auto;color:var(--mut)}.sum b{color:var(--ink)}
main{max-width:1180px;margin:14px auto;padding:0 16px;display:grid;gap:12px}
.item{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;display:grid;grid-template-columns:150px 1fr;gap:14px}
.item.run{border-color:var(--run)}.item.rejected{border-color:var(--bad)}
.orig{width:150px;height:110px;object-fit:contain;background:var(--bg);border-radius:6px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 8px}.chip{padding:3px 8px;border-radius:999px;font-size:12px;background:var(--grey);color:#fff;white-space:nowrap}
.chip.run{background:var(--run);animation:p 1s infinite}.chip.done{background:var(--ok)}.chip.skip{background:transparent;color:var(--mut);border:1px dashed var(--grey)}
@keyframes p{50%{opacity:.55}}@media(prefers-reduced-motion:reduce){.chip.run{animation:none}}
.out{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px}.out>div{max-width:300px}.out img{max-width:300px;max-height:260px;border-radius:6px;border:1px solid var(--line);display:block}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0}.tag{padding:2px 8px;border-radius:999px;font-size:12px;border:1px solid currentColor}
.tag.ok{color:var(--ok)}.tag.bad{color:var(--bad)}.tag.warn{color:var(--warn)}.tag.mut{color:var(--mut)}
.mut{color:var(--mut);font-size:12px}.retake{color:var(--bad);font-weight:600}
.part{display:grid;grid-template-columns:64px 1fr;gap:8px;align-items:start}.part .chips{margin:2px 0 4px}.lbl{color:var(--mut);font-size:12px;padding-top:3px}
.mile{grid-column:2;font-size:12px;color:var(--mut);margin-bottom:6px}.mile:empty{display:none}.mile.ok{color:var(--ok);font-weight:600}
@media(max-width:700px){.item{grid-template-columns:1fr}}
</style>
<header><b>ID flow viewer</b><label>photos <input id=limit type=number value=10 min=1 max=200></label><label>seed <input id=seed type=number value=1></label>
<button id=go>Start the flow</button><span class=sum id=sum>Ready. Pick a number of photos and press Start.</span></header>
<main id=list></main>
<script>
const $=id=>document.getElementById(id);
// Two parts (MJ, 5 Nov 2026): the FAST part fills the form, the BACKGROUND part saves the picture after it.
const STEPS=['type','scan','rebuild','gate','find','read','inspect','group','enhance','merge','compress'];
const BG=['cut','read','inspect','group','people','enhance','merge','compress'];
const LABEL={type:'file type',scan:'virus scan',rebuild:'clean re-save',gate:'quality check',find:'find card',cut:'cut cards (model)',read:'read',inspect:'photo + clarity',group:'pair front/back',people:'per person',enhance:'enhance',merge:'stack',compress:'compress'};
const items=new Map();let offset=0,timer=null,order=[];
const short=p=>p.split(/[\\/]/).slice(-1)[0];
const secs=ms=>ms>=1000?(ms/1000).toFixed(1)+' s':ms+' ms';
function node(input){let it=items.get(input);if(it)return it;
 const el=document.createElement('div');el.className='item run';
 el.innerHTML='<img class=orig loading=lazy src="/photo?path='+encodeURIComponent(input)+'"><div><div class=mut>'+short(input).replace(/</g,'&lt;')+'</div>'+
  '<div class=part><span class=lbl>Form</span><div class="chips fast"></div><span class="mile ready"></span></div>'+
  '<div class=part><span class=lbl>Saving</span><div class="chips bg"></div><span class="mile savedat"></span></div><div class=tags></div><div class=out></div></div>';
 $('list').appendChild(el);it={el,chips:new Map(),done:false,saved:[],ready:null};items.set(input,it);order.push(input);return it}
function chip(it,step,cls,txt){const bg=it.ready!==null&&step!=='';const key=(bg?'bg:':'')+step,list=bg?BG:STEPS;let c=it.chips.get(key);
 if(!c){c=document.createElement('span');it.chips.set(key,c);const idx=list.indexOf(step);const holder=it.el.querySelector(bg?'.chips.bg':'.chips.fast');let placed=false;
  for(const [s,e] of it.chips){if(e!==c&&s.startsWith('bg:')===bg&&list.indexOf(s.replace('bg:',''))>idx){holder.insertBefore(c,e);placed=true;break}}if(!placed)holder.appendChild(c)}
 c.className='chip '+cls;c.textContent=(LABEL[step]||step)+(txt?' '+txt:'')}
function apply(ev){const it=node(ev.input);
 if(ev.event==='step'){if(ev.done)chip(it,ev.done,'done',secs(ev.ms));if(ev.next)chip(it,ev.next,'run','…')}
 else if(ev.event==='read'){for(const [k,e] of it.chips)if(!k.startsWith('bg:')&&e.classList.contains('run'))e.className='chip done';
  it.ready=ev;const m=it.el.querySelector('.mile.ready');m.classList.add('ok');
  m.textContent='form ready in '+(ev.ms/1000).toFixed(1)+' s'+(ev.check?' (check)':'')+(ev.people>1?' · '+ev.people+' guests':'');
  it.el.querySelector('.tags').innerHTML=tag('fields: '+(ev.filled||'-'),'mut')}
 else if(ev.event==='saved'){it.saved.push(ev);render(it)}
 summary()}
function tag(t,c){return '<span class="tag '+c+'">'+t+'</span>'}
function render(it){it.done=true;it.el.classList.remove('run');for(const [s,e] of it.chips){if(e.classList.contains('run')){e.className='chip done'}}
 const rej=it.saved.some(s=>String(s.status).startsWith('rejected')||String(s.status).startsWith('error'));if(rej)it.el.classList.add('rejected');
 const last=Math.max(0,...it.saved.map(s=>Number(s.saved_seconds)||0)),m=it.el.querySelector('.mile.savedat');
 if(last){m.classList.add('ok');m.textContent='picture saved at '+last.toFixed(1)+' s'}
 const tags=[],out=[];
 for(const s of it.saved){const st=String(s.status),bad=st.startsWith('rejected')||st.startsWith('error'),chk=st.includes('(check)');
  tags.push(tag(bad?st:chk?'done, needs a check':'done',bad?'bad':chk?'warn':'ok'));
  if(s.background)tags.push(tag('saving saw it differently: '+s.background,'warn'));
  if(s.doc_type)tags.push(tag(s.doc_type,'mut'));if(s.sides)tags.push(tag(s.sides,'mut'));if(s.evidence&&s.evidence!=='none')tags.push(tag('paired by '+s.evidence,'ok'));
  if(s.paired_by_position)tags.push(tag('paired by position','warn'));if(s.rare)tags.push(tag('rare (same name and birthday)','warn'));
  if(s.clarity)tags.push(tag('clarity '+s.clarity,s.clarity==='clear'?'ok':s.clarity==='usable'?'warn':'bad'));
  (s.flags||'').split(' ').filter(Boolean).forEach(f=>tags.push(tag(f,'mut')));
  const kb=s.bytes_after?Math.round(s.bytes_after/1024)+' KB':'';
  out.push('<div>'+(s.output?'<a href="/out?name='+encodeURIComponent(s.output)+'" target=_blank><img loading=lazy src="/out?name='+encodeURIComponent(s.output)+'"></a>':'')+
   '<div class=mut>'+(s.output||'no picture saved')+(kb?' · '+kb:'')+' · '+s.seconds+' s</div><div class=mut>fields: '+(s.filled||'-')+'</div>'+(s.retake?'<div class=retake>'+s.retake.replace(/</g,'&lt;')+'</div>':'')+'</div>')}
 it.el.querySelector('.tags').innerHTML=tags.join('');it.el.querySelector('.out').innerHTML=out.join('')}
function summary(){const n=items.size,d=[...items.values()].filter(i=>i.done).length;let pics=0,rej=0,form=0,forms=0,saved=0,saves=0;
 for(const i of items.values()){if(i.ready){form+=i.ready.ms/1000;forms++}
  for(const s of i.saved){if(s.output)pics++;const st=String(s.status);if(st.startsWith('rejected')||st.startsWith('error'))rej++;
   if(Number(s.saved_seconds)){saved+=Number(s.saved_seconds);saves++}}}
 $('sum').innerHTML='<b>'+d+'</b> of <b>'+n+'</b> photos finished · <b>'+pics+'</b> pictures saved · <b>'+rej+'</b> rejected'+
  (forms?' · form ready in about <b>'+(form/forms).toFixed(1)+' s</b>':'')+(saves?' · picture saved at about <b>'+(saved/saves).toFixed(1)+' s</b>':'')}
async function poll(){const r=await (await fetch('/api/events?offset='+offset)).json();offset=r.offset;r.events.forEach(apply);
 if(!r.running&&!r.events.length&&timer){clearInterval(timer);timer=null;$('go').disabled=false;$('go').textContent='Start again';summary()}}
$('go').onclick=async()=>{$('list').innerHTML='';items.clear();order=[];offset=0;$('go').disabled=true;
 const r=await (await fetch('/api/start?limit='+$('limit').value+'&seed='+$('seed').value,{method:'POST'})).json();
 if(!r.started){$('sum').textContent=r.error||'could not start';$('go').disabled=false;return}
 $('sum').textContent='Running…';timer=setInterval(poll,700)};
(async()=>{const r=await (await fetch('/api/events?offset=0')).json();  // open the page during or after a run: pick it up
 if(r.running||r.events.length){r.events.forEach(apply);offset=r.offset;if(r.running){$('go').disabled=true;$('sum').textContent='Running…';timer=setInterval(poll,700)}else summary()}})();
</script>"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def file(self, path: Path, folder: Path) -> None:
        if not path.is_file() or not under(path, folder) or path.suffix.lower() not in MIME:
            return self.send(404, b"not found", "text/plain")
        self.send(200, path.read_bytes(), MIME[path.suffix.lower()])

    def do_GET(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/":
            self.send(200, PAGE.encode(), "text/html; charset=utf-8")
        elif u.path == "/api/events":
            self.send(200, json.dumps(events_since(int((q.get("offset") or ["0"])[0] or 0))).encode())
        elif u.path == "/photo":  # an original photo: only from the --in folder, read-only
            self.file(Path((q.get("path") or [""])[0]), Path(CFG["src"]))
        elif u.path == "/out":  # a picture that came out: only from the --out folder
            name = Path((q.get("name") or [""])[0]).name
            self.file(Path(CFG["out"]) / name, Path(CFG["out"]))
        else:
            self.send(404, b"not found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/api/start":
            limit = max(1, min(200, int((q.get("limit") or ["10"])[0] or 10)))
            self.send(200, json.dumps(start_run(limit, int((q.get("seed") or ["1"])[0] or 1))).encode())
        else:
            self.send(404, b"{}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--python", required=True, help="python of the intake worker's own environment")
    ap.add_argument("--runner", required=True, help="the intake worker's scripts/run_folder.py")
    ap.add_argument("--in", dest="src", required=True, help="photo folder (read-only)")
    ap.add_argument("--out", required=True, help="folder for this viewer's runs (its pictures and report are replaced at each start)")
    ap.add_argument("--port", type=int, default=8096)
    a = ap.parse_args()
    CFG.update(python=a.python, runner=a.runner, src=a.src, out=a.out)
    print(f"Open http://127.0.0.1:{a.port}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
