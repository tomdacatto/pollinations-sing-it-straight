// Browser audio: playing the tune, counting in, and listening to the singer. Nothing here is sent anywhere.
import { detectPitch, hzToMidi, midiToHz } from "./pitch.js";

let context;
const ctx = () => {
    context ??= new AudioContext();
    return context;
};

function tone(at, hz, seconds, { type = "triangle", gain = 0.25 } = {}) {
    const audio = ctx();
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(gain, at + 0.03);
    amp.gain.setValueAtTime(gain, at + seconds - 0.08);
    amp.gain.linearRampToValueAtTime(0, at + seconds - 0.02);
    osc.connect(amp).connect(audio.destination);
    osc.start(at);
    osc.stop(at + seconds);
}

/** Plays the notes one after another; `onNote(i)` is called as each begins. Resolves when the tune ends. */
export async function playTune(notes, noteSeconds, onNote = () => {}) {
    const audio = ctx();
    await audio.resume();
    const start = audio.currentTime + 0.1;
    notes.forEach((midi, i) => {
        tone(start + i * noteSeconds, midiToHz(midi), noteSeconds);
        setTimeout(() => onNote(i), (start - audio.currentTime + i * noteSeconds) * 1000);
    });
    await new Promise((done) => setTimeout(done, (notes.length * noteSeconds + 0.2) * 1000));
}

/** Three clicks, one per note length, then resolves at the moment the first note should begin. */
export async function countIn(noteSeconds) {
    const audio = ctx();
    await audio.resume();
    const start = audio.currentTime + 0.1;
    for (let i = 0; i < 3; i++) tone(start + i * noteSeconds, 1200, 0.06, { type: "square", gain: 0.12 });
    await new Promise((done) => setTimeout(done, 3 * noteSeconds * 1000 + 100));
}

/**
 * Listens to the microphone. Echo cancelling and gain control are off, because they bend the pitch.
 * Open it first (the browser asks permission), count in, then call `begin()` as the first note starts:
 * `onFrame(frame, t)` is called about 25 times a second from then on, and `stop()` resolves to { frames, blob }.
 */
export async function listen(onFrame = () => {}) {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const audio = ctx();
    await audio.resume();
    const source = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.start();
    const buffer = new Float32Array(analyser.fftSize);
    const frames = [];
    let began = null;
    const timer = setInterval(() => {
        if (began === null) return;
        analyser.getFloatTimeDomainData(buffer);
        const t = audio.currentTime - began;
        const found = detectPitch(buffer, audio.sampleRate);
        const frame = found ? { t, midi: hzToMidi(found.hz) } : null;
        if (frame) frames.push(frame);
        onFrame(frame, t);
    }, 40);
    return {
        begin: () => {
            began = audio.currentTime;
        },
        stop: () =>
            new Promise((done) => {
                clearInterval(timer);
                recorder.onstop = () => {
                    for (const track of stream.getTracks()) track.stop();
                    source.disconnect();
                    done({ frames, blob: new Blob(chunks, { type: recorder.mimeType }) });
                };
                recorder.stop();
            }),
    };
}
