import {writeFileSync,mkdirSync} from 'node:fs';
import {newMission} from '../src/types';
import {examplePlanning} from '../src/planning';
import {compareRoutes} from '../src/routeComparison';
const mission={...newMission(),id:'comparison-v16',name:'L survey comparison',takeoff_altitude_m:10,planning:{...examplePlanning(),altitude_m:10}};
const candidates=compareRoutes(mission);
const rows=candidates.map(c=>({...c,mission:c.preview?{...mission,id:`comparison-${c.heading_deg}`,name:`L survey ${c.heading_deg} degrees`,waypoints:c.preview.waypoints,generation:c.preview.generation,planning:{...mission.planning,heading_deg:c.heading_deg}}:null}));
mkdirSync('../docs/verification/comparison',{recursive:true});
writeFileSync('../docs/verification/comparison/candidates.json',JSON.stringify({schema_version:1,assumptions:{speed_ms:5,turn_delay_s:2},candidates:rows},null,2));
