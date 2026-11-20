import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

// Deterministic DOM operation counts. The browser cadence and GPU require the
// separate full foreground trial. Each checkout gets the identical input play.
const checkout = fileURLToPath(new URL('../../../',import.meta.url));
const fixture = readFileSync(new URL('../mesh.json',import.meta.url));
const {play} = JSON.parse(fixture);
const focus = ['H','Y'].map(label => play.players.find(player => player.label === label).id);
const routed = new Set(play.routes.filter(route => !route.optional && route.kind !== 'pass').map(route => route.playerId));

async function measure(directory) {
  const root = pathToFileURL(resolve(directory)+sep);
  const {createFilmModel} = await import(new URL('web/coach-film-model.js',root));
  const {createFilmField} = await import(new URL('web/coach-film-field.js',root));
  const recorded = {actorTransformReads:0,stationaryTransformReads:0,actorTransformWrites:0,liveBlockPathReads:0};
  const win = new Window();
  win.HTMLCanvasElement.prototype.getContext = () => null;
  const model = createFilmModel(play), field = createFilmField(win.document.body,{model});
  try {
    for (const actor of win.document.querySelectorAll('[data-film-player]')) {
      const stationary = !routed.has(actor.dataset.filmPlayer);
      const get = actor.getAttribute.bind(actor), set = actor.setAttribute.bind(actor);
      actor.getAttribute = name => {
        if (name === 'transform') {
          recorded.actorTransformReads++;
          if (stationary) recorded.stationaryTransformReads++;
        }
        return get(name);
      };
      actor.setAttribute = (name,value) => {
        if (name === 'transform') recorded.actorTransformWrites++;
        return set(name,value);
      };
    }
    for (const route of play.routes.filter(route => route.blockTargets?.length)) {
      const path = win.document.querySelector(`[data-film-route="${route.id}"]`);
      const get = path.getAttribute.bind(path);
      path.getAttribute = name => {
        if (name === 'd') recorded.liveBlockPathReads++;
        return get(name);
      };
    }
    for (let tick=0; tick<=360; tick++) field.render(model.frameAt(tick/60,focus),focus);
    const modules = ['coach-film-model.js','coach-film-field.js','model.js'];
    const moduleHash = createHash('sha256');
    for (const name of modules) moduleHash.update(name).update('\0').update(readFileSync(new URL('web/'+name,root)));
    return {moduleSha256:moduleHash.digest('hex'),...recorded};
  } finally { field.destroy(); await win.happyDOM.abort(); }
}

const directories = process.argv.slice(2);
if (!directories.length) directories.push(checkout);
const results = [];
for (const directory of directories) results.push(await measure(directory));
console.log(JSON.stringify({fixtureSha256:createHash('sha256').update(fixture).digest('hex'),players:play.players.length,
  routes:play.routes.length,stationaryPlayers:play.players.length-routed.size,frames:361,focus:['H','Y'],results},null,2));
