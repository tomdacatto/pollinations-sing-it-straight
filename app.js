import { countIn, listen, playTune } from "./audio.js";
import { COACH_MODEL, HEAR_MODEL, NOTE_SECONDS, RANGES, TUNE_MODEL, VOICE_MODEL } from "./config.js";
import { coachMessages, letterMatch } from "./feedback.js";
import { parseTune, tuneMessages } from "./melody.js";
import { chat, clearSession, completeSignIn, getSession, speak, startSignIn, transcribe } from "./pollen.js";
import { foldSemitones, scoreNotes, summarise } from "./score.js";

const $ = (selector) => document.querySelector(selector);
const seed = () => Math.floor(Math.random() * 1e9);
const state = { tune: null, advice: "", busy: false };

function notice(message, kind = "info") {
    const box = $("#notice");
    box.hidden = !message;
    box.className = `notice ${kind === "error" ? "error" : ""}`;
    box.textContent = message ?? "";
}

function renderSession() {
    const session = getSession();
    $("#whoami").hidden = !session;
    $("#sign-out").hidden = !session;
    $("#sign-in").hidden = Boolean(session);
}

const PROBLEMS = {
    denied: "Sign-in was cancelled.",
    "bad-state": "That sign-in did not match this page. Try again.",
    "bad-key": "The sign-in returned something unexpected. Try again.",
    "no-storage": "This browser blocks the storage the sign-in needs.",
};

// ---- the piano roll: target notes as bars, the sung pitch as dots
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function drawRoll(frames = [], playing = -1, now = null) {
    const canvas = $("#roll");
    const g = canvas.getContext("2d");
    const { notes } = state.tune;
    const [w, h] = [canvas.width, canvas.height];
    const lo = Math.min(...notes) - 3;
    const hi = Math.max(...notes) + 3;
    const x = (t) => 40 + (t / (notes.length * NOTE_SECONDS)) * (w - 56);
    const y = (midi) => h - 18 - ((midi - lo) / (hi - lo)) * (h - 36);
    g.clearRect(0, 0, w, h);
    g.font = "13px system-ui, sans-serif";
    g.textBaseline = "middle";
    notes.forEach((midi, i) => {
        g.fillStyle = i === playing ? css("--accent") : `${css("--accent")}55`;
        g.fillRect(x(i * NOTE_SECONDS) + 2, y(midi) - 9, x(NOTE_SECONDS) - x(0) - 4, 18);
        g.fillStyle = css("--ink");
        g.textAlign = "center";
        g.fillText(state.tune.syllables[i], x((i + 0.5) * NOTE_SECONDS), y(midi) - 20);
    });
    g.textAlign = "right";
    g.fillStyle = css("--muted");
    for (let m = Math.ceil(lo); m <= hi; m++) if ([0, 4, 7].includes(m % 12)) g.fillText(noteLabel(m), 34, y(m));
    // Each sung frame is drawn at the height of the note it was meant for, plus how far off it was.
    g.fillStyle = css("--ink");
    for (const f of frames) {
        const i = Math.min(notes.length - 1, Math.floor(f.t / NOTE_SECONDS));
        if (f.t < 0 || f.t >= notes.length * NOTE_SECONDS) continue;
        const shown = notes[i] + Math.max(-4, Math.min(4, foldSemitones(f.midi, notes[i])));
        g.beginPath();
        g.arc(x(f.t), y(shown), 2.5, 0, 2 * Math.PI);
        g.fill();
    }
    if (now !== null) {
        g.fillStyle = css("--muted");
        g.fillRect(x(Math.min(now, notes.length * NOTE_SECONDS)), 8, 1, h - 16);
    }
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteLabel = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

// ---- getting a tune
async function writeTune() {
    if (!getSession()) return startSignIn();
    const theme = $("#theme").value.trim() || "a quiet morning";
    const range = RANGES[$("#range").value];
    notice(null);
    $("#write").disabled = true;
    $("#result").hidden = true;
    try {
        let messages = tuneMessages({ theme, ...range });
        let last = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
            $("#write").textContent = attempt === 1 ? "Writing…" : `Fixing the tune (try ${attempt})…`;
            const reply = await chat(TUNE_MODEL, messages, { seed: seed() });
            const parsed = parseTune(reply, range);
            if (parsed.tune) {
                state.tune = parsed.tune;
                $("#title").textContent = `2. Hear "${parsed.tune.title}", then sing it`;
                $("#roll").setAttribute(
                    "aria-label",
                    `The tune to sing: ${parsed.tune.notes.map((m, i) => `${noteLabel(m)} ${parsed.tune.syllables[i]}`).join(", ")}`,
                );
                $("#stage").hidden = false;
                $("#state").textContent = "";
                drawRoll();
                return;
            }
            last = parsed.problems;
            messages = [
                ...messages,
                { role: "assistant", content: reply },
                { role: "user", content: `That tune was refused: ${last.join(" ")} Reply with corrected JSON only.` },
            ];
        }
        notice(`The model did not write a singable tune in three tries. Last problem: ${last.join(" ")}`, "error");
    } catch (error) {
        notice(error.message, "error");
    } finally {
        $("#write").disabled = false;
        $("#write").textContent = "Write me a tune";
    }
}

async function hear() {
    if (state.busy) return;
    state.busy = true;
    try {
        await playTune(state.tune.notes, NOTE_SECONDS, (i) => drawRoll([], i));
    } finally {
        drawRoll();
        state.busy = false;
    }
}

// ---- singing and the results
async function sing() {
    if (state.busy) return;
    state.busy = true;
    $("#sing").disabled = true;
    $("#hear").disabled = true;
    $("#result").hidden = true;
    notice(null);
    let mic;
    try {
        $("#state").textContent = "Allow the microphone…";
        const live = [];
        mic = await listen((frame) => frame && live.push(frame));
        $("#state").textContent = "Counting in…";
        await countIn(NOTE_SECONDS);
        $("#state").textContent = "Sing!";
        mic.begin();
        const total = state.tune.notes.length * NOTE_SECONDS;
        await new Promise((done) => {
            const began = performance.now();
            const tick = setInterval(() => {
                const t = (performance.now() - began) / 1000;
                drawRoll(live, Math.floor(t / NOTE_SECONDS), t);
                if (t > total + 0.3) {
                    clearInterval(tick);
                    done();
                }
            }, 40);
        });
        const take = await mic.stop();
        $("#state").textContent = "";
        await showResult(take);
    } catch (error) {
        notice(
            error.name === "NotAllowedError" || error.name === "NotFoundError"
                ? "The microphone is not available. Allow it for this page and try again."
                : error.message,
            "error",
        );
    } finally {
        $("#state").textContent = "";
        $("#sing").disabled = false;
        $("#hear").disabled = false;
        state.busy = false;
    }
}

const VERDICT = {
    good: "Every note was on the note.",
    "all-flat": "Right tune, sung flat: the steps were good but the whole tune sat low.",
    "all-sharp": "Right tune, sung sharp: the steps were good but the whole tune sat high.",
    "single-notes": "Close, with a few notes to fix.",
    "too-quiet": "Hardly anything was picked up. Check the microphone and sing a little louder.",
};

async function showResult({ frames, blob }) {
    const { notes, syllables } = state.tune;
    drawRoll(frames);
    const results = scoreNotes(notes, frames, { noteSeconds: NOTE_SECONDS });
    const summary = summarise(results);
    $("#result").hidden = false;
    $("#verdict").textContent = `${summary.on} of ${summary.notes} notes on pitch. ${VERDICT[summary.focus]}`;
    const table = $("#notes");
    table.replaceChildren();
    const head = table.insertRow();
    for (const name of ["Note", "Syllable", "You sang", "Off by", "Verdict"])
        head.append(Object.assign(document.createElement("th"), { textContent: name }));
    results.forEach((r, i) => {
        const row = table.insertRow();
        const cells = [
            r.name,
            syllables[i],
            r.sung ?? "–",
            r.cents === undefined ? "–" : `${r.cents > 0 ? "+" : ""}${r.cents} cents`,
            r.verdict === "on" ? "on the note" : r.verdict,
        ];
        cells.forEach((text, c) => {
            const cell = row.insertCell();
            cell.textContent = text;
            if (c === 4) cell.className = r.verdict;
        });
    });
    $("#heard").textContent = "Listening for the words…";
    $("#coach").textContent = "The coach is reading the numbers…";
    $("#say").hidden = true;
    const [heard, advice] = await Promise.allSettled([
        transcribe(HEAR_MODEL, blob),
        chat(COACH_MODEL, coachMessages(summary, results), { seed: seed() }),
    ]);
    if (heard.status === "fulfilled") {
        const { matched, total } = letterMatch(syllables.join(""), heard.value);
        $("#heard").textContent = heard.value
            ? `The transcriber heard: "${heard.value}". ${matched} of ${total} letters of the lyric matched, in order. Sung words are hard to transcribe, so treat this as a hint.`
            : "The transcriber heard no words.";
    } else $("#heard").textContent = `The words could not be checked: ${heard.reason.message}`;
    if (advice.status === "fulfilled") {
        state.advice = advice.value.trim();
        $("#coach").textContent = state.advice;
        $("#say").hidden = false;
    } else $("#coach").textContent = `The coach could not answer: ${advice.reason.message}`;
}

async function hearCoach() {
    $("#say").disabled = true;
    try {
        const audio = await speak(VOICE_MODEL, state.advice);
        await new Audio(URL.createObjectURL(audio)).play();
    } catch (error) {
        notice(error.message, "error");
    } finally {
        $("#say").disabled = false;
    }
}

// ---- start
for (const [key, range] of Object.entries(RANGES)) $("#range").append(new Option(range.label, key));
$("#sign-in").onclick = () => startSignIn();
$("#sign-out").onclick = () => {
    clearSession();
    renderSession();
};
$("#write").onclick = () => writeTune();
$("#hear").onclick = () => hear().catch((error) => notice(error.message, "error"));
$("#sing").onclick = () => sing();
$("#say").onclick = () => hearCoach();
const outcome = completeSignIn();
if (outcome && outcome !== "ok") notice(PROBLEMS[outcome], "error");
renderSession();
