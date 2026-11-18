// Scores a sung take against the notes it was meant to hit. Pure functions: a take is a list of
// { t, midi } frames (t in seconds from the start of the first note) and the notes are MIDI numbers.
import { noteName } from "./pitch.js";

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The difference in semitones from `target` to `sung`, folded to the nearest octave: a low voice singing an octave down is still right. */
export const foldSemitones = (sung, target) => ((((sung - target + 6) % 12) + 12) % 12) - 6;

/**
 * One result per note: what was sung (median of the voiced frames in the middle of the note), how far off in cents,
 * and a verdict. A note with too few voiced frames is "silent".
 */
export function scoreNotes(notes, frames, { noteSeconds = 0.8, tolerance = 50, minFrames = 4 } = {}) {
    return notes.map((target, i) => {
        const from = i * noteSeconds + 0.25 * noteSeconds; // skip the onset: the voice is still finding the note
        const to = (i + 1) * noteSeconds;
        const inside = frames.filter((f) => f.t >= from && f.t < to).map((f) => f.midi);
        if (inside.length < minFrames)
            return { target, name: noteName(target), verdict: "silent", frames: inside.length };
        const sung = median(inside);
        const cents = Math.round(foldSemitones(sung, target) * 100);
        const verdict = Math.abs(cents) <= tolerance ? "on" : cents < 0 ? "flat" : "sharp";
        return { target, name: noteName(target), sung: noteName(sung), cents, verdict, frames: inside.length };
    });
}

/** The whole take in a few numbers, and the one thing to fix. */
export function summarise(results) {
    const heard = results.filter((r) => r.verdict !== "silent");
    const summary = {
        notes: results.length,
        heard: heard.length,
        on: heard.filter((r) => r.verdict === "on").length,
        flat: heard.filter((r) => r.verdict === "flat").length,
        sharp: heard.filter((r) => r.verdict === "sharp").length,
        silent: results.length - heard.length,
    };
    if (heard.length < 3) return { ...summary, focus: "too-quiet" };
    const drift = Math.round(median(heard.map((r) => r.cents)));
    const spread = Math.round(median(heard.map((r) => Math.abs(r.cents - drift))));
    summary.drift = drift;
    summary.spread = spread;
    // A steady offset with small spread is the right tune in the wrong place; fix it as one thing.
    if (Math.abs(drift) >= 30 && spread <= 35) summary.focus = drift < 0 ? "all-flat" : "all-sharp";
    else if (summary.on === summary.heard) summary.focus = "good";
    else {
        const worst = heard.reduce((a, b) => (Math.abs(b.cents) > Math.abs(a.cents) ? b : a));
        summary.focus = "single-notes";
        summary.worst = { name: worst.name, cents: worst.cents };
    }
    return summary;
}
