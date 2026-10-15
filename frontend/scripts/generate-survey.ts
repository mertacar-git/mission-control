import { writeFileSync } from 'node:fs';
import { newMission } from '../src/types';
import { examplePlanning, generateSurvey } from '../src/planning';

const mission={...newMission(),id:'acceptance-survey-v13',name:'İçbükey L alanı · SITL kabul',planning:examplePlanning()};
mission.planning.altitude_m=10;
const preview=generateSurvey(mission);
mission.waypoints=preview.waypoints;mission.takeoff_altitude_m=10;
writeFileSync('../docs/verification/survey-mission.json',JSON.stringify(mission,null,2));
console.log(JSON.stringify({waypoints:preview.waypoints.length,distance_m:preview.distance_m,area_m2:preview.area_m2}));
