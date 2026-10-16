"""Observed mission outcome, independent of ACKs and transport state."""
class MissionLifecycle:
    def __init__(self,waypoint_count=0):
        self.waypoint_count=waypoint_count
        self.final_waypoint_observed=False;self.landing_observed=False
        self.ever_armed=False;self.previous_armed=None
        self.interrupted=False;self.completed=False;self.state='preparing'

    def reached(self,index):
        if self.waypoint_count and index==self.waypoint_count+1:self.final_waypoint_observed=True

    def observe(self,t,loaded):
        if self.completed:self.state='completed'
        elif t['connection']!='connected' or not t.get('position_fresh'):
            self.state='unknown';self.previous_armed=None
        elif not loaded:self.state='preparing'
        else:
            armed=t.get('armed');mode=t.get('flight_mode');index=t.get('mission_index')
            if armed is True:
                self.ever_armed=True
                if mode=='RTL':self.interrupted=True;self.state='returning'
                elif mode=='LAND' or mode=='AUTO' and index==self.waypoint_count+2:
                    self.landing_observed=True;self.state='landing'
                elif mode in ('BRAKE','LOITER'):self.state='holding'
                elif mode=='AUTO':self.state='executing'
                else:self.state='unknown'
            elif armed is False and not self.ever_armed:self.state='loaded'
            elif (armed is False and self.previous_armed is True and self.final_waypoint_observed
                  and self.landing_observed and not self.interrupted
                  and t.get('relative_altitude_m') is not None and t['relative_altitude_m']<=1):
                self.completed=True;self.state='completed'
            else:self.state='unknown'
            self.previous_armed=armed
        return self.snapshot()

    def snapshot(self):
        return dict(state=self.state,final_waypoint_observed=self.final_waypoint_observed,
                    landing_observed=self.landing_observed,ever_armed=self.ever_armed)
