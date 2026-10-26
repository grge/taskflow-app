// What the sync status means to a person, for the header pill (short) and
// Settings (long). `status` is client.js's { state, detail }; `pending` the
// number of changes the backend hasn't acknowledged.

const changes = n => `${n} change${n === 1 ? '' : 's'}`;

export function describeSync(status, pending) {
  if (status.state === 'error' && status.detail === 'unauthorized') {
    return { tone: 'error', short: 'Sync stopped', long: 'The backend no longer accepts this device\'s token; it may have been revoked. Disconnect, then connect with a new token. Nothing on this device is lost.' };
  }
  if (status.state === 'error') {
    return { tone: 'error', short: 'Sync stopped', long: 'The backend speaks a different sync protocol from this app. Update whichever is older; until then this device works on its own.' };
  }
  if (status.state === 'online') {
    return pending
      ? { tone: 'busy', short: 'Syncing…', long: `Online · sending ${changes(pending)}` }
      : { tone: 'ok', short: 'Synced', long: 'Online · in sync' };
  }
  if (status.state === 'connecting') {
    return { tone: 'busy', short: 'Connecting…', long: `Connecting…${pending ? ` · ${changes(pending)} waiting to send` : ''}` };
  }
  return {
    tone: 'off',
    short: 'Offline',
    long: `Can't reach the backend; retrying. Changes made here are kept${pending ? ` (${changes(pending)} waiting)` : ''} and sent when it answers.`
  };
}
