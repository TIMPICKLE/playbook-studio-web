import {starterWorkspace,encodeWorkspace,STORAGE_KEY} from './model.js';
import {ONBOARDING_STORAGE_KEY} from './onboarding.js';
import {VISUAL_MODE_KEY} from './visual-mode.js';

const query=new URLSearchParams(location.search);
const button=document.querySelector('button');
async function start() {
  const response=await fetch('./film-bench-scene.json',{cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const {play}=await response.json(),workspace=starterWorkspace();
  workspace.plays=[play];localStorage.setItem(STORAGE_KEY,encodeWorkspace(workspace));
  localStorage.setItem(VISUAL_MODE_KEY,query.get('visual')==='digital'?'digital':'traditional');
  localStorage.setItem(ONBOARDING_STORAGE_KEY,JSON.stringify({dismissed:true,completed:[]}));
  const choices=new URLSearchParams();
  for(const key of ['run','quick','renderer','machine','visual'])if(query.has(key))choices.set(key,query.get(key));
  sessionStorage.setItem('coach-film-normal-entry:'+new URL('.',location.href).pathname,choices.toString());
  location.replace('./index.html#editor');
}
button.onclick=()=>{button.disabled=true;start().catch(error=>{document.querySelector('pre').textContent='ERROR: '+error.message;button.disabled=false;});};
button.disabled=false;if(query.has('run'))button.click();
