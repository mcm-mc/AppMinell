// World Workbench launcher  (Scriptable)
// 1) pick your minecraftWorlds folder (or one world folder)   2) pick a world
// 3) the editor opens with that world loaded   4) tap "Save to game" and it is written back in place.
// Close Minecraft completely before running this.

const MINECRAFT_URL = "minecraft://";
const CHUNK = 1048576; // base64 characters per transfer (multiple of 4)

const fm = FileManager.local();
const sleep = ms => new Promise(r => Timer.schedule(ms, false, r));
const isWorld = p => fm.fileExists(fm.joinPath(p, "level.dat")) && fm.fileExists(fm.joinPath(p, "db"));
async function say(title, msg) { const a = new Alert(); a.title = title; a.message = msg; a.addAction("OK"); await a.present(); }

async function pickWorld() {
  const root = await DocumentPicker.openFolder();
  if (!root) return null;
  if (isWorld(root)) return root;
  const worlds = [];
  for (const n of fm.listContents(root)) {
    const p = fm.joinPath(root, n);
    if (fm.isDirectory(p) && isWorld(p)) {
      let label = n;
      const lnPath = fm.joinPath(p, "levelname.txt");
      if (fm.fileExists(lnPath)) { try { label = fm.readString(lnPath).trim() || n; } catch (e) {} }
      worlds.push({ p, label });
    }
  }
  if (!worlds.length) { await say("No world found", "Pick the minecraftWorlds folder, or a single world folder (it has level.dat and a db folder)."); return null; }
  const a = new Alert(); a.title = "Choose a world";
  worlds.forEach(w => a.addAction(w.label));
  a.addCancelAction("Cancel");
  const i = await a.presentSheet();
  return i < 0 ? null : worlds[i].p;
}

function gatherFiles(world) {
  const files = [];
  for (const n of ["level.dat", "levelname.txt"]) { const p = fm.joinPath(world, n); if (fm.fileExists(p)) files.push([n, p]); }
  const db = fm.joinPath(world, "db");
  for (const n of fm.listContents(db)) { const p = fm.joinPath(db, n); if (!fm.isDirectory(p) && n !== "LOCK") files.push(["db/" + n, p]); }
  return files;
}

async function main() {
  // ask for the password every time
  const pa = new Alert(); pa.title = "Password"; pa.message = "Enter the password to open World Workbench.";
  pa.addSecureTextField("password"); pa.addAction("OK"); pa.addCancelAction("Cancel");
  const pr = await pa.present(); if (pr < 0) return;
  PW = (pa.textFieldValue(0) || "").trim(); if (!PW) return;

  // 1) make sure the editor page is reachable and is the new version (so the screen never goes black silently)
  let html = "";
  try { const rq = new Request(PAGE_URL + "?embed=1"); html = await rq.loadString(); }
  catch (e) { await say("Cannot reach the editor page", PAGE_URL + "\n\n" + String(e && e.message || e) + "\n\nCheck PAGE_URL and your internet."); return; }
  if (html.indexOf("workbench-enc") < 0) {
    await say("Editor page is the old version", "The page at\n" + PAGE_URL + "\ndoes not have the Save-to-game support. Upload the newest index.html to GitHub, wait ~1 minute, and run again.");
    return;
  }

  const ch = new Alert(); ch.title = "World Workbench"; ch.message = "What do you want to open?";
  ch.addAction("Edit a real world"); ch.addAction("Try the sample world (test only)"); ch.addCancelAction("Cancel");
  const pickedMode = await ch.presentSheet();
  if (pickedMode < 0 || pickedMode > 1) return;
  if (pickedMode === 1) { // sample: normal page, nothing is written to any world
    const sv = new WebView(); await sv.loadURL(PAGE_URL + "#" + encodeURIComponent(PW)); await sv.present(true); return;
  }

  const world = await pickWorld();
  if (!world) return;
  const name = world.split("/").filter(Boolean).pop();
  const files = gatherFiles(world);

  // 2) load the page and send the world while the WebView is NOT shown yet
  const wv = new WebView();
  await wv.loadURL(PAGE_URL + "?embed=1#" + encodeURIComponent(PW));
  let ok = false;
  for (let t = 0; t < 40 && !ok; t++) {
    try { ok = (await wv.evaluateJavaScript("typeof WB!=='undefined' && typeof WB.put==='function'")) === true; } catch (e) {}
    if (!ok) await sleep(500);
  }
  if (!ok) { await say("Editor did not start", "Wrong password, or the page did not start. Check the password and try again."); return; }

  let sent = 0;
  for (const [rel, p] of files) {
    const b64 = fm.read(p).toBase64String();
    const n = Math.max(1, Math.ceil(b64.length / CHUNK));
    for (let i = 0; i < n; i++) {
      try { await wv.evaluateJavaScript("WB.put(" + JSON.stringify(rel) + "," + i + "," + n + "," + JSON.stringify(b64.slice(i * CHUNK, (i + 1) * CHUNK)) + ")"); }
      catch (e) { await say("Transfer failed", rel + "\n" + String(e && e.message || e)); return; }
    }
    sent++;
    console.log("sent " + sent + "/" + files.length + " " + rel);
  }
  await wv.evaluateJavaScript("window.__ready=''; WB.open(" + JSON.stringify(name) + ").then(function(){window.__ready='ok'}).catch(function(e){window.__ready='ERR '+e.message}); 0");
  let closed = false;
  let shown = false;
  let diag = '';
  // wait for the editor to finish loading
  for (;;) {
    const r = await wv.evaluateJavaScript("window.__ready||''");
    if (r === "ok") {
      wv.present(true).then(() => { closed = true; }); shown = true;
      await sleep(1500);
      try {
        diag = await wv.evaluateJavaScript("(function(){var s=document.getElementById('splash');if(s)s.remove();document.body.style.display='none';void document.body.offsetHeight;document.body.style.display='';return JSON.stringify({textLen:document.body.innerText.length,bg:getComputedStyle(document.body).backgroundColor,w:innerWidth,h:innerHeight,vis:document.visibilityState,txt:document.body.innerText.slice(0,60)})})()");
      } catch (e) { diag = "diag error: " + e; }
      break;
    }
    if (r && r.indexOf("ERR") === 0) { await say("Could not open world", r); return; }
    await sleep(500);
  }

  // wait for the user to press "Save to game"
  let result = "";
  for (;;) {
    if (closed) { await say("Editor closed", "Closed without saving. Page info:\n" + diag); return; }
    result = await wv.evaluateJavaScript("window.__result||''");
    if (result) break;
    await sleep(700);
  }
  const out = JSON.parse(result).files;

  // back up level.dat, then write the changed files in place
  const lvl = fm.joinPath(world, "level.dat");
  if (fm.fileExists(lvl)) fm.write(fm.joinPath(world, "level.dat_old"), fm.read(lvl));
  for (const f of out) {
    const target = fm.joinPath(world, f.p);
    const dir = target.split("/").slice(0, -1).join("/");
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    fm.write(target, Data.fromBase64String(f.b));
  }
  const n = new Notification(); n.title = "World saved"; n.body = out.length + " file(s) written. Open Minecraft."; await n.schedule();
  try { Safari.open(MINECRAFT_URL); } catch (e) {}
}

// Shortcuts / Siri cannot show windows. If we were started from there, re-open this script inside the Scriptable app.
if (!config.runsInApp) {
  Safari.open("scriptable:///run/" + encodeURIComponent(Script.name()));
} else {
  try { await main(); } catch (e) { await say("Error", String(e && e.message || e)); }
}
Script.complete();
