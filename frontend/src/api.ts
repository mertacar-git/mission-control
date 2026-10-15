import type {
  Mission,
  Status,
  Recording,
  SessionInfo,
  Action,
  FlightEvent,
} from './types';
import type { Validation } from './planning';
const key = 'mission-control-controller';
export function controller() {
  let token = sessionStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    sessionStorage.setItem(key, token);
  }
  return token;
}
export async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Control-Session': controller(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = 'Backend isteği başarısız.';
    try {
      const payload = await response.json();
      message =
        typeof payload.detail === 'string'
          ? payload.detail
          : JSON.stringify(payload.detail);
    } catch {
      /* retain message */
    }
    throw Error(message);
  }
  return response.json() as Promise<T>;
}
export const api = {
  validate: (mission: Mission) =>
    request<Validation>('/missions/validate', 'POST', mission),
  status: () => request<Status>('/status'),
  connect: (speedup = 1) => request<Status>('/connection', 'POST', { speedup }),
  disconnect: () => request<Status>('/connection', 'DELETE'),
  renew: () => request('/control/renew', 'POST'),
  save: (mission: Mission) => request<Mission>('/missions', 'POST', mission),
  missions: () => request<Mission[]>('/missions'),
  upload: (id: string) =>
    request('/missions/' + encodeURIComponent(id) + '/upload', 'POST'),
  command: (action: Action) => request('/commands', 'POST', { action }),
  startRecording: (name: string) =>
    request<{ id: string }>('/recordings', 'POST', { name }),
  stopRecording: () =>
    request<{ id: string | null }>('/recordings/stop', 'POST'),
  recordings: () => request<SessionInfo[]>('/recordings'),
  recording: (id: string) =>
    request<Recording>('/recordings/' + encodeURIComponent(id)),
  readback: () => request<{ items: unknown[] }>('/vehicle/mission'),
};
export function subscribe(
  onEvent: (event: FlightEvent) => void,
  onError: () => void,
) {
  const ws = new WebSocket(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  );
  ws.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data));
    } catch {
      onError();
    }
  };
  ws.onerror = onError;
  ws.onclose = onError;
  return ws;
}
