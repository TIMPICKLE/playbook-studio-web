import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { materializeHuddleArt } from '../scripts/huddle-art.mjs';
import { EDITABLE_TRACES } from '../web/data/madden-editable.js';
import { TEAM_TRACE_ALIASES } from '../web/data/madden-team-trace-aliases.js';
import { SEED_TRACES } from '../web/data/madden-editable-seed.js';
import { BATCH_TRACES } from '../web/data/madden-editable-batch.js';
import { EXPANDED_TRACES } from '../web/data/madden-editable-80.js';
import { REVIEWED_OCT28_TRACES } from '../web/data/madden-editable-oct28.js';
import { CONTINUED_TRACES } from '../web/data/madden-editable-continued.js';
import { FINAL_TRACES } from '../web/data/madden-editable-final.js';
import { TRACE_SUMMARY, RETAINED_REASONS } from '../web/data/madden-trace-status.js';
import { hasEditableTrace, makeMaddenPlay, retainedReason } from '../web/madden-model.js';
const catalogBytes=readFileSync(new URL('../web/data/huddle-catalog.json',import.meta.url));
const catalog=JSON.parse(catalogBytes);
const manifest=JSON.parse(readFileSync(new URL('../vendor/huddle-art/manifest.json',import.meta.url))); 
const audit=JSON.parse(readFileSync(new URL('../docs/madden-conversion-audit.json',import.meta.url)));
const review=JSON.parse(readFileSync(new URL('../scripts/madden-trace-review.json',import.meta.url)));
const expandedReview=JSON.parse(readFileSync(new URL('../scripts/madden-trace-review-80.json',import.meta.url)));
const continuedReview=JSON.parse(readFileSync(new URL('../scripts/madden-trace-review-continued.json',import.meta.url)));
const finalReview=JSON.parse(readFileSync(new URL('../scripts/madden-trace-review-final.json',import.meta.url)));
const octoberReview=JSON.parse(readFileSync(new URL('../scripts/madden-trace-review-oct28.json',import.meta.url)));

test('the historical audit covers its catalog entries exactly once, and unsuccessful images stay original',()=>{
  assert.deepEqual(audit.summary,TRACE_SUMMARY);
  const historical = {...catalog, teams:catalog.teams.filter(team=>['eagles','ravens'].includes(team.id)), plays:catalog.plays.filter(play=>['eagles','ravens'].includes(play.team))};
  delete historical.expansionFetchedAt;
  assert.equal(createHash('sha256').update(JSON.stringify(historical,null,2)+'\n').digest('hex'),TRACE_SUMMARY.catalogSha256);
  assert.equal(new Set(audit.entries.map(r=>r.id)).size,audit.entries.length);
  assert.equal(TRACE_SUMMARY.attemptedRemaining,TRACE_SUMMARY.newlyEditable+TRACE_SUMMARY.retainedOriginal);
  for(const r of audit.entries){
    const entry=catalog.plays.find(entry=>entry.id===r.id);assert.ok(entry);assert.equal(r.image,entry.image);
    const editable=r.status!=='retained-original';assert.equal(hasEditableTrace(entry.id),editable);
    const play=makeMaddenPlay(entry);
    if(editable)assert.equal(play.diagramSource.catalogId,entry.id);
    else {assert.equal(play.reference.image,entry.image);assert.equal(play.players.length,0);assert.equal(play.routes.length,0);assert.equal(retainedReason(entry.id),r.reasonText);}
  }
  assert.equal(Object.keys(RETAINED_REASONS).length,TRACE_SUMMARY.retainedOriginal);
  assert.equal(Object.keys(BATCH_TRACES).length+Object.keys(EXPANDED_TRACES).length+Object.keys(REVIEWED_OCT28_TRACES).length+Object.keys(CONTINUED_TRACES).length+Object.keys(FINAL_TRACES).length,TRACE_SUMMARY.newlyEditable);
  for(const [id,seed] of Object.entries(SEED_TRACES))assert.deepEqual(EDITABLE_TRACES[id],seed);
});

test('new traces have explicit visual review and match the exact bundled source image bytes',async()=>{
  await materializeHuddleArt();
  assert.deepEqual(Object.keys(review.approved).sort(),Object.keys(BATCH_TRACES).sort());
  assert.deepEqual(Object.keys(expandedReview.approved).sort(),Object.keys(EXPANDED_TRACES).sort());
  assert.deepEqual(Object.keys(octoberReview.approved).sort(),Object.keys(REVIEWED_OCT28_TRACES).sort());
  assert.equal(new Set(Object.values(REVIEWED_OCT28_TRACES).map(t=>t.image)).size,24);
  assert.deepEqual(Object.keys(continuedReview.approved).sort(),Object.keys(CONTINUED_TRACES).sort());
  assert.equal(new Set(Object.values(CONTINUED_TRACES).map(t=>t.image)).size,137);
  assert.deepEqual(Object.keys(finalReview.approved).sort(),Object.keys(FINAL_TRACES).sort());
  assert.equal(new Set(Object.values(FINAL_TRACES).map(t=>t.image)).size,139);
  assert.equal(new Set([...Object.values(REVIEWED_OCT28_TRACES),...Object.values(CONTINUED_TRACES),...Object.values(FINAL_TRACES)].map(t=>t.image)).size,300);
  for(const [id,trace] of Object.entries({...BATCH_TRACES,...EXPANDED_TRACES,...REVIEWED_OCT28_TRACES,...CONTINUED_TRACES,...FINAL_TRACES})){
    const approval=review.approved[id]||expandedReview.approved[id]||octoberReview.approved[id]||continuedReview.approved[id]||finalReview.approved[id];assert.deepEqual(approval.trace,trace);
    const bytes=readFileSync(new URL('../web/'+trace.image,import.meta.url));
    const digest=createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest,approval.sourceSha256);assert.equal(digest,manifest.images[trace.image.split('/').at(-1)]);
    assert.equal(audit.entries.find(r=>r.id===id).sourceSha256,digest);
  }
});

test('the expansion covers 80 distinct images and preserves shared-source geometry across teams',()=>{
  const traces=Object.values(EXPANDED_TRACES), byImage=new Map();
  assert.equal(traces.length,90);
  for(const trace of traces){
    const group=byImage.get(trace.image)||[];group.push(trace);byImage.set(trace.image,group);
  }
  assert.equal(byImage.size,80);
  assert.equal([...byImage.values()].filter(group=>group.length===2).length,10);
  assert.equal(traces.filter(trace=>trace.team==='eagles').length,60);
  assert.equal(traces.filter(trace=>trace.team==='ravens').length,30);
  for(const group of byImage.values()){
    assert.ok(group.length===1||group.length===2);
    if(group.length===2){
      assert.notEqual(group[0].team,group[1].team);
      assert.equal(group[0].name,group[1].name);
      assert.equal(group[0].formation,group[1].formation);
      assert.deepEqual(group[0].players,group[1].players);
      assert.deepEqual(group[0].routes,group[1].routes);
    }
  }
});

test('continued team entries built from the same source share reviewed geometry',()=>{
  const groups=new Map();
  for(const trace of [...Object.values(CONTINUED_TRACES),...Object.values(FINAL_TRACES)]){
    const group=groups.get(trace.image)||[];group.push(trace);groups.set(trace.image,group);
  }
  for(const group of groups.values())if(group.length>1){
    for(const other of group.slice(1)){
      assert.notEqual(other.team,group[0].team);
      assert.deepEqual(other.players,group[0].players);
      assert.deepEqual(other.routes,group[0].routes);
    }
  }
});

test('a rejected candidate stays original unless subsequently corrected and source-reviewed',()=>{
  const approvedId='eagles-fd2267e23547b4dab4d8';
  const rejectedId='eagles-399ec8e24df6d87cf67a';
  const entry=catalog.plays.find(p=>p.id===rejectedId);assert.ok(entry);
  assert.equal(hasEditableTrace(rejectedId),false);assert.ok(makeMaddenPlay(entry).reference);
  assert.equal(audit.entries.find(r=>r.id===rejectedId).reason,'visual-review-rejected');
  assert.equal(hasEditableTrace(approvedId),true);
  assert.ok(continuedReview.approved[approvedId]);
  assert.equal(audit.entries.find(r=>r.id===approvedId).status,'converted');
});


test('each expanded team has 40 editable plays using exactly the reviewed source images', () => {
  assert.equal(catalog.teams.length, 10);
  const byId = new Map(catalog.plays.map(play => [play.id,play]));
  for (const team of catalog.teams) {
    const plays = catalog.plays.filter(play => play.team === team.id);
    assert.ok(plays.length >= 40, team.id);
    assert.ok(plays.filter(play => hasEditableTrace(play.id)).length >= 40, team.id);
  }
  for (const [id, originalId] of Object.entries(TEAM_TRACE_ALIASES)) {
    const entry = byId.get(id), original = EDITABLE_TRACES[originalId];
    assert.ok(entry && original, id);
    for (const key of ['name','group','formation','game','image','imageUrl']) assert.equal(entry[key], original[key], `${id}: ${key}`);
    const imported = makeMaddenPlay(entry);
    assert.equal(imported.diagramSource.catalogId, entry.id);
    assert.equal(imported.diagramSource.team, entry.team);
    assert.equal(imported.diagramSource.sourceUrl, entry.sourceUrl);
    assert.equal(imported.diagramSource.image, entry.image);
    assert.equal(imported.players.length, 11);
  }
});
