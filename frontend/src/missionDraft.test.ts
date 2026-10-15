import {describe,it,expect} from 'vitest';
import {createHistory,draftReducer,moveWaypoint,validCoordinate,HISTORY_LIMIT} from './missionDraft';
import {newMission} from './types';

describe('mission edit history',()=>{
  it('undoes coordinate edits and restores them with redo',()=>{
    const mission=newMission();let state=createHistory(mission);
    state=draftReducer(state,{type:'edit',update:previous=>({...previous,takeoff_altitude_m:40})});
    expect(state.present.takeoff_altitude_m).toBe(40);
    state=draftReducer(state,{type:'undo'});expect(state.present).toEqual(mission);
    state=draftReducer(state,{type:'redo'});expect(state.present.takeoff_altitude_m).toBe(40);
  });
  it('clears the redo branch after a new edit',()=>{
    let state=createHistory(newMission());state=draftReducer(state,{type:'edit',update:m=>({...m,name:'First'})});
    state=draftReducer(state,{type:'undo'});state=draftReducer(state,{type:'edit',update:m=>({...m,name:'Other'})});
    expect(state.future).toEqual([]);expect(draftReducer(state,{type:'redo'})).toBe(state);
  });
  it('isolates imported snapshots from later mutations by the caller',()=>{
    const initial=newMission(),imported=newMission();let state=createHistory(initial);
    imported.name='Imported';state=draftReducer(state,{type:'edit',update:imported});
    imported.waypoints[0].latitude=0;expect(state.present.waypoints[0].latitude).not.toBe(0);
    expect(draftReducer(state,{type:'undo'}).present).toEqual(initial);
  });
  it('bounds history and ignores identical edits and empty undo',()=>{
    let state=createHistory(newMission());expect(draftReducer(state,{type:'undo'})).toBe(state);
    expect(draftReducer(state,{type:'edit',update:structuredClone(state.present)})).toBe(state);
    for(let i=0;i<120;i++)state=draftReducer(state,{type:'edit',update:m=>({...m,name:String(i)})});
    expect(state.past).toHaveLength(HISTORY_LIMIT);
  });
  it('reorders complete points, renumbers by order and supports undo',()=>{
    const mission=newMission();mission.waypoints[1].altitude_m=35;
    const moved=moveWaypoint(mission,1,0);expect(moved.waypoints[0]).toEqual(mission.waypoints[1]);
    expect(mission.waypoints[0].altitude_m).toBe(20);
    const edited=draftReducer(createHistory(mission),{type:'edit',update:moved});
    expect(draftReducer(edited,{type:'undo'}).present).toEqual(mission);
  });
  it('does not corrupt a route for invalid reorder indices',()=>{
    const mission=newMission();for(const [from,to] of [[0,-1],[4,0],[0,4],[.5,1],[1,1]])expect(moveWaypoint(mission,from,to)).toBe(mission);
  });
  it('undoes deletion and map dragging without losing the rest of the route',()=>{
    const mission=newMission();let state=createHistory(mission);
    state=draftReducer(state,{type:'edit',update:m=>({...m,waypoints:m.waypoints.slice(1)})});
    state=draftReducer(state,{type:'edit',update:m=>({...m,waypoints:m.waypoints.map((p,i)=>i===0?{...p,latitude:41.01}:p)})});
    state=draftReducer(draftReducer(state,{type:'undo'}),{type:'undo'});expect(state.present).toEqual(mission);
  });
  it('filters invalid intermediate coordinates before Leaflet receives them',()=>{
    expect(validCoordinate({latitude:0,longitude:0})).toBe(true);
    for(const point of [{latitude:NaN,longitude:29},{latitude:91,longitude:29},{latitude:41,longitude:Infinity}])expect(validCoordinate(point)).toBe(false);
  });
});
