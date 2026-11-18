import assert from "node:assert/strict";
import test from "node:test";
import { coachMessages, letterMatch } from "./feedback.js";
import { MAX_LEAP, parseTune } from "./melody.js";
import { detectPitch, hzToMidi, midiToHz, noteName } from "./pitch.js";
import { foldSemitones, scoreNotes, summarise } from "./score.js";

const RATE = 48000;
// A voice-like frame: a fundamental with overtones, the second one stronger than the fundamental.
const voice = (hz, { n = 2048, amps = [0.5, 1, 0.7, 0.4] } = {}) =>
    Float32Array.from({ length: n }, (_, i) =>
        amps.reduce((sum, a, k) => sum + 0.2 * a * Math.sin(2 * Math.PI * hz * (k + 1) * (i / RATE)), 0),
    );

test("pitch: notes are named and converted both ways", () => {
    assert.equal(noteName(60), "C4");
    assert.equal(noteName(69), "A4");
    assert.equal(Math.round(midiToHz(69)), 440);
    assert.equal(Math.round(hzToMidi(261.63)), 60);
});

test("pitch: the fundamental is found within 10 cents, even when an overtone is stronger", () => {
    for (const hz of [110, 196, 261.63, 440, 659.25]) {
        const found = detectPitch(voice(hz), RATE);
        assert.ok(found, `no pitch at ${hz}`);
        const cents = Math.abs(1200 * Math.log2(found.hz / hz));
        assert.ok(cents < 10, `${hz} Hz read as ${found.hz.toFixed(1)} Hz (${cents.toFixed(1)} cents off)`);
    }
});

test("pitch: silence and noise are not a pitch", () => {
    assert.equal(detectPitch(new Float32Array(2048), RATE), null);
    let seed = 7;
    const next = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647 - 0.5;
    };
    const noise = Float32Array.from({ length: 2048 }, () => next() * 0.5);
    assert.equal(detectPitch(noise, RATE), null);
});

const NOTES = [60, 62, 64, 62, 60];
// A take of those notes, 0.8 s each, with a cents offset per note and 25 frames a second.
const take = (offsets, { silent = [] } = {}) =>
    offsets.flatMap((cents, i) =>
        silent.includes(i)
            ? []
            : Array.from({ length: 20 }, (_, k) => ({ t: i * 0.8 + k * 0.04, midi: NOTES[i] + cents / 100 })),
    );

test("score: folding keeps the nearest octave, so an octave down is still on the note", () => {
    assert.equal(foldSemitones(48, 60), 0);
    assert.equal(foldSemitones(59.5, 60), -0.5);
    assert.ok(Math.abs(foldSemitones(66.4, 60) - -5.6) < 1e-9);
});

test("score: each note gets cents and a verdict; a silent note is called silent", () => {
    const results = scoreNotes(NOTES, take([0, -80, 20, 120, 0], { silent: [4] }));
    assert.deepEqual(
        results.map((r) => r.verdict),
        ["on", "flat", "on", "sharp", "silent"],
    );
    assert.equal(results[1].cents, -80);
    assert.equal(results[3].sung, "D#4");
    assert.equal(results[0].name, "C4");
});

test("score: a steady offset is reported as one thing, a single bad note as another", () => {
    const flat = summarise(scoreNotes(NOTES, take([-60, -55, -65, -60, -58])));
    assert.equal(flat.focus, "all-flat");
    assert.equal(flat.drift, -60);
    const one = summarise(scoreNotes(NOTES, take([0, 5, -10, 150, 0])));
    assert.equal(one.focus, "single-notes");
    assert.deepEqual(one.worst, { name: "D4", cents: 150 });
    assert.equal(summarise(scoreNotes(NOTES, take([0, 10, -20, 30, 0]))).focus, "good");
    assert.equal(summarise(scoreNotes(NOTES, [])).focus, "too-quiet");
});

test("tune: a good reply passes; each kind of problem is named so it can be sent back", () => {
    const range = { low: 57, high: 76 };
    const ok = { title: "T", syllables: ["la", "la", "la", "la", "la"], notes: [60, 62, 64, 62, 60] };
    const fenced = `Here you go:\n\`\`\`json\n${JSON.stringify(ok)}\n\`\`\``;
    assert.deepEqual(parseTune(fenced, range).tune.notes, ok.notes);
    const bad = (patch) => parseTune(JSON.stringify({ ...ok, ...patch }), range).problems?.join(" ");
    assert.match(bad({ notes: [60, 67, 64, 62, 60] }), /semitones apart/);
    assert.match(bad({ notes: [60, 62, 64, 62] }), /Use 5 to 8 notes, not 4/);
    assert.match(bad({ notes: [40, 62, 64, 62, 60] }), /between 57 and 76/);
    assert.match(bad({ notes: [60, 60, 60, 60, 60] }), /three different/);
    assert.match(bad({ syllables: ["a b", "c", "d", "e", "f"] }), /no spaces/);
    assert.match(parseTune("sorry, I cannot", range).problems[0], /not valid JSON/);
    assert.ok(MAX_LEAP >= 4);
});

test("lyric letters: matched in order, ignoring case, spaces and punctuation", () => {
    assert.deepEqual(letterMatch("Twin kle twin kle star", "twin-kle, twin-kle star!"), { matched: 18, total: 18 });
    assert.deepEqual(letterMatch("la la la la la", "la la la"), { matched: 6, total: 10 });
    assert.deepEqual(letterMatch("one two", ""), { matched: 0, total: 6 });
});

test("coach: the model is given the measured numbers and told not to invent any", () => {
    const results = scoreNotes(NOTES, take([0, -80, 20, 120, 0]));
    const messages = coachMessages(summarise(results), results);
    assert.match(messages[0].content, /never invent a measurement/);
    assert.match(messages[1].content, /D4: sang C#4, -80 cents \(flat\)/);
});
