import {readFileSync,writeFileSync} from 'node:fs';
import {compareFlights,comparisonCSV} from '../src/multiFlightComparison';
import {parseRecording} from '../src/recording';
const recordings=['flight-0','flight-90','baseline-0','baseline-1','baseline-2'].map(name=>parseRecording(JSON.parse(readFileSync(`public/comparison/${name}.json`,'utf8'))));
const result=await compareFlights(recordings);
writeFileSync('../docs/verification/phases/phase-3/comparison-browser.json',JSON.stringify(result,null,2)+'\n');
writeFileSync('../docs/verification/phases/phase-3/comparison.csv',comparisonCSV(result));
