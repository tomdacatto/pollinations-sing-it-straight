// Pitch from the microphone, in code: no model hears the singing, so every number on screen can be checked.
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const noteName = (midi) => {
    const m = Math.round(midi);
    return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};

/**
 * Pitch of one frame of samples, by the normalised square difference function (McLeod): the first strong peak
 * is the fundamental, so a voice rich in overtones is not read an octave high. Returns { hz, clarity } or null.
 */
export function detectPitch(frame, sampleRate, { minHz = 70, maxHz = 1000, minClarity = 0.85, minRms = 0.01 } = {}) {
    const n = frame.length;
    let energy = 0;
    for (let i = 0; i < n; i++) energy += frame[i] * frame[i];
    if (Math.sqrt(energy / n) < minRms) return null;
    const minLag = Math.floor(sampleRate / maxHz);
    const maxLag = Math.min(Math.ceil(sampleRate / minHz), n >> 1);
    const nsdf = new Float32Array(maxLag + 2);
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
        let acf = 0;
        let norm = 0;
        for (let i = 0; i < n - lag; i++) {
            acf += frame[i] * frame[i + lag];
            norm += frame[i] * frame[i] + frame[i + lag] * frame[i + lag];
        }
        nsdf[lag] = norm ? (2 * acf) / norm : 0;
    }
    // Local maxima after the first downward zero crossing.
    const peaks = [];
    let lag = minLag;
    while (lag < maxLag && nsdf[lag] > 0) lag++; // skip the lobe at lag 0
    while (lag < maxLag) {
        while (lag < maxLag && nsdf[lag] <= 0) lag++;
        let best = lag;
        while (lag < maxLag && nsdf[lag] > 0) {
            if (nsdf[lag] > nsdf[best]) best = lag;
            lag++;
        }
        if (best >= minLag && best < maxLag) peaks.push(best);
    }
    if (!peaks.length) return null;
    const top = Math.max(...peaks.map((p) => nsdf[p]));
    const peak = peaks.find((p) => nsdf[p] >= 0.9 * top);
    if (nsdf[peak] < minClarity) return null;
    // Parabolic interpolation around the peak for a finer lag.
    const [a, b, c] = [nsdf[peak - 1], nsdf[peak], nsdf[peak + 1]];
    const shift = a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
    return { hz: sampleRate / (peak + shift), clarity: nsdf[peak] };
}
