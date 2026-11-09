/** The capture steps as a small state machine: 1 front, 2 back, review, done. Pure, no DOM. */

export const STEPS = ['front', 'back'];

export function newSessionId() {
  const bytes = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (b) => b.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createSession(sessionId = newSessionId()) {
  return { sessionId, step: 0, phase: 'capturing', sides: [], preview: null };
}

/** A side was captured: show it for review (Retake or Accept). */
export function captured(session, side) {
  if (session.phase !== 'capturing') throw new Error('not capturing');
  return { ...session, phase: 'reviewing', preview: { ...side, side: STEPS[session.step] } };
}

export function retake(session) {
  if (session.phase !== 'reviewing') throw new Error('nothing to retake');
  return { ...session, phase: 'capturing', preview: null };
}

export function accept(session) {
  if (session.phase !== 'reviewing') throw new Error('nothing to accept');
  const sides = [...session.sides.filter((s) => s.side !== session.preview.side), session.preview];
  const last = session.step >= STEPS.length - 1;
  return { ...session, sides, preview: null, step: last ? session.step : session.step + 1, phase: last ? 'done' : 'capturing' };
}

/** Go back to redo a finished side, for example "retake the front" from the final screen. */
export function redo(session, side) {
  const step = STEPS.indexOf(side);
  if (step < 0) throw new Error('unknown side');
  return { ...session, step, phase: 'capturing', preview: null };
}

export const label = (session) => (session.phase === 'done' ? 'Done' : `Step ${session.step + 1} of ${STEPS.length}: ${STEPS[session.step]}`);

/** What the caller receives. Nothing is uploaded by this module. */
export function result(session) {
  if (session.phase !== 'done') throw new Error('capture not finished');
  return { sessionId: session.sessionId, sides: STEPS.map((s) => session.sides.find((x) => x.side === s)) };
}
