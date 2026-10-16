"""SQLite writes are serialized by a lock; recordings preserve nullable measurements."""
import csv
import io
import json
import sqlite3
import threading
from pathlib import Path
from uuid import uuid4
from .models import Mission, utc_now

class Store:
    def __init__(self, path: str | Path):
        if str(path) != ':memory:': Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.db:
            self.db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS missions(id TEXT PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL, updated_utc TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, name TEXT NOT NULL, started_utc TEXT NOT NULL, ended_utc TEXT, source TEXT NOT NULL, mission TEXT);
                CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, type TEXT NOT NULL, received_utc TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS events_session_idx ON events(session_id,id);
                CREATE TABLE IF NOT EXISTS scenario_runs(id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS emulator_runs(id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS experiment_definitions(id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS experiment_runs(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            ''')
            if self.db.execute('PRAGMA user_version').fetchone()[0]<1:
                self.db.execute('PRAGMA user_version=1')
        # Interrupted recordings are closed at last persisted event, never labeled complete.
        with self.db:
            self.db.execute("UPDATE sessions SET ended_utc=COALESCE((SELECT MAX(received_utc) FROM events WHERE session_id=sessions.id),started_utc) WHERE ended_utc IS NULL")
        self.active: str | None = None
        for run in self.experiment_runs():
            if run['status'] in ('queued','running'):
                run.update(status='interrupted',ended_utc=utc_now(),error='Backend restarted before completion; no acceptance result.')
                self.save_experiment_run(run)
        for run in self.scenario_runs():
            if run['status']=='running':
                run.update(status='interrupted',ended_utc=utc_now(),error='Backend restarted before completion; result is not a pass.')
                self.save_scenario(run)
        for run in self.emulator_runs():
            if run['status']=='running':
                run.update(status='interrupted',ended_utc=utc_now(),error='Backend restarted before completion.')
                self.save_emulator(run)

    def add_experiment(self, definition):
        with self.lock,self.db:
            self.db.execute('INSERT INTO experiment_definitions VALUES(?,?)',(definition['id'],json.dumps(definition,allow_nan=False)))

    def experiments(self):
        with self.lock:
            return [json.loads(r['body']) for r in self.db.execute('SELECT body FROM experiment_definitions ORDER BY rowid DESC')]

    def experiment(self, identifier):
        with self.lock:row=self.db.execute('SELECT body FROM experiment_definitions WHERE id=?',(identifier,)).fetchone()
        if row is None:raise KeyError(identifier)
        return json.loads(row['body'])

    def save_experiment_run(self, run):
        with self.lock,self.db:
            self.db.execute('INSERT OR REPLACE INTO experiment_runs VALUES(?,?)',(run['id'],json.dumps(run,allow_nan=False)))

    def experiment_runs(self):
        with self.lock:return [json.loads(r['body']) for r in self.db.execute('SELECT body FROM experiment_runs ORDER BY rowid DESC')]

    def experiment_run(self, identifier):
        with self.lock:row=self.db.execute('SELECT body FROM experiment_runs WHERE id=?',(identifier,)).fetchone()
        if row is None:raise KeyError(identifier)
        return json.loads(row['body'])

    def save_emulator(self,run):
        with self.lock,self.db:self.db.execute('INSERT OR REPLACE INTO emulator_runs VALUES(?,?)',(run['id'],json.dumps(run,allow_nan=False)))

    def emulator_runs(self):
        with self.lock:return [json.loads(r['body']) for r in self.db.execute('SELECT body FROM emulator_runs ORDER BY rowid DESC LIMIT 100')]

    def emulator_run(self,identifier):
        with self.lock:row=self.db.execute('SELECT body FROM emulator_runs WHERE id=?',(identifier,)).fetchone()
        if row is None:raise KeyError(identifier)
        return json.loads(row['body'])

    def save_scenario(self, run):
        with self.lock, self.db:
            self.db.execute('INSERT OR REPLACE INTO scenario_runs VALUES(?,?)',(run['id'],json.dumps(run,allow_nan=False)))

    def scenario_runs(self):
        with self.lock:
            return [json.loads(r['body']) for r in self.db.execute('SELECT body FROM scenario_runs ORDER BY rowid DESC LIMIT 100')]

    def close(self):
        self.stop_recording()
        self.db.close()

    def save_mission(self, mission: Mission):
        with self.lock, self.db:
            self.db.execute('INSERT OR REPLACE INTO missions VALUES(?,?,?,?)', (mission.id,mission.name,mission.model_dump_json(),utc_now()))
        return mission.model_dump()

    def missions(self):
        with self.lock: return [json.loads(r['body']) for r in self.db.execute('SELECT body FROM missions ORDER BY updated_utc DESC')]

    def mission(self, mission_id):
        with self.lock: row = self.db.execute('SELECT body FROM missions WHERE id=?',(mission_id,)).fetchone()
        if row is None: raise KeyError(mission_id)
        return Mission.model_validate_json(row['body'])

    def delete_mission(self, mission_id):
        with self.lock, self.db: self.db.execute('DELETE FROM missions WHERE id=?',(mission_id,))

    def start_recording(self, name, mission=None):
        with self.lock, self.db:
            if self.active: raise ValueError('A recording is already active.')
            identifier = str(uuid4())
            self.db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?)',(identifier,name,utc_now(),None,'sitl',json.dumps(mission) if mission else None))
            self.active=identifier
            return identifier

    def append(self, event):
        with self.lock, self.db:
            if self.active:
                self.db.execute('INSERT INTO events(session_id,type,received_utc,payload) VALUES(?,?,?,?)',(self.active,event['type'],event['received_utc'],json.dumps(event['payload'],allow_nan=False)))

    def stop_recording(self):
        with self.lock, self.db:
            identifier=self.active
            if identifier: self.db.execute('UPDATE sessions SET ended_utc=? WHERE id=?',(utc_now(),identifier))
            self.active=None
            return identifier

    def sessions(self):
        with self.lock:
            return [dict(r) for r in self.db.execute('SELECT id,name,started_utc,ended_utc,source FROM sessions ORDER BY started_utc DESC')]

    def session(self, identifier):
        with self.lock:
            row=self.db.execute('SELECT * FROM sessions WHERE id=?',(identifier,)).fetchone()
            if row is None: raise KeyError(identifier)
            events=[dict(type=r['type'],received_utc=r['received_utc'],payload=json.loads(r['payload'])) for r in self.db.execute('SELECT * FROM events WHERE session_id=? ORDER BY id',(identifier,))]
        result=dict(row)
        result['mission']=json.loads(result['mission']) if result['mission'] else None
        return dict(schema_version=1,session=result,events=events)

    def csv(self, identifier):
        rows=[e['payload'] for e in self.session(identifier)['events'] if e['type']=='telemetry']
        output=io.StringIO(newline='')
        fields=['received_utc','elapsed_s','vehicle_time_ms','latitude','longitude','relative_altitude_m','ground_speed_ms','battery_pct','battery_voltage_v','flight_mode','armed','mission_index','position_fresh','connection']
        fields.append('gps_fix_type')
        writer=csv.DictWriter(output,fieldnames=fields,extrasaction='ignore'); writer.writeheader(); writer.writerows(rows)
        return output.getvalue()
