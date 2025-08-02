// --- src/honeypot/state.js ---

// Honeypot Data Store (in-memory, resets on server restart)
export const honeypotData = {};
export let honeypotRankCounter = 1;

// A helper to re-assign the counter, needed because of ES module import rules
export function incrementRankCounter() {
    honeypotRankCounter++;
}