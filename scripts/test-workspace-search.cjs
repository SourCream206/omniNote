const assert = require('node:assert/strict');
const { searchWorkspace } = require('../.tools/test-build/workspaceSearch.js');

const nodes = [
  { id:'book-a', parent_id:null, kind:'notebook', title:'Physics' },
  { id:'folder-a', parent_id:'book-a', kind:'folder', title:'Week one' },
  { id:'page-a', parent_id:'folder-a', kind:'page', title:'Lecture notes' },
  { id:'page-b', parent_id:'book-a', kind:'page', title:'Slides' },
  { id:'book-b', parent_id:null, kind:'notebook', title:'Private' },
  { id:'page-c', parent_id:'book-b', kind:'page', title:'Resistor plan' },
];
const snapshot = { nodes, objects:[
  { id:'text-a', page_id:'page-a', type:'text', payload:{ doc:{ type:'doc', content:[{ type:'paragraph', content:[{ type:'text', text:'A resistor limits current.' }] }] } } },
  { id:'file-b', page_id:'page-b', type:'document', payload:{ name:'resistor-slides.pdf' } },
], documentPages:[], assets:[] };

assert.deepEqual(searchWorkspace(snapshot, 'tab', 'page-a', 'resistor').map((hit) => hit.objectId), ['text-a']);
assert.deepEqual(searchWorkspace(snapshot, 'notebook', 'page-a', 'resistor').map((hit) => hit.pageId), ['page-a', 'page-b']);
assert.deepEqual(searchWorkspace(snapshot, 'open', 'page-a', 'resistor').map((hit) => hit.pageId), ['page-c']);
assert.equal(searchWorkspace(snapshot, 'tab', 'page-a', '').length, 0);
assert.ok(searchWorkspace(snapshot, 'open', 'page-a', '').length >= 3);
