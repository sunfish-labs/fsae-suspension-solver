// Writes the CAD exports for a design or car file (used by tests/test_cad.py): node tests/cad_gen.js ui design.json out_base [options-json]
/* global Susp, SuspCAD */
const path=require('path'), fs=require('fs');
const ui=path.resolve(process.argv[2]); require(ui+'/susp.js'); require(ui+'/cad.js');
const raw=JSON.parse(fs.readFileSync(process.argv[3])); const out=process.argv[4]; const opts=JSON.parse(process.argv[5]||'{}');
const mk=(ax)=>Object.assign({},raw[ax],{axle:ax,vehicle:Object.assign({},raw[ax].vehicle||{},raw.vehicle)});
const corners=raw.front&&raw.rear?['front','rear'].map(a=>({e:Susp.evaluate(mk(a))})):[{e:Susp.evaluate(raw)}];
const g=SuspCAD.geometry(corners,Object.assign({wheelbase:(raw.vehicle||{}).wheelbase},opts));
fs.writeFileSync(out+'.igs',SuspCAD.toIGES(g,{name:'car'}));fs.writeFileSync(out+'.step',SuspCAD.toSTEP(g,{name:'car'}));
fs.writeFileSync(out+'_solid.step',SuspCAD.toSTEPSolid(g,{name:'car'}));
fs.writeFileSync(out+'.csv',SuspCAD.toCSV(g));fs.writeFileSync(out+'.stl',SuspCAD.toSTL(g,{name:'car'}));
fs.writeFileSync(out+'.json',JSON.stringify(g));
fs.writeFileSync(out+'_fea.csv',SuspCAD.toFEACSV(corners.map(c=>({e:c.e,L:c.e.spring?Susp.runLoads(c.e.cfg,c.e.susp,c.e.spring):null})),Object.assign({wheelbase:(raw.vehicle||{}).wheelbase},opts)));
console.log('points',g.points.length,'lines',g.lines.length,'layers',g.layers.length);
