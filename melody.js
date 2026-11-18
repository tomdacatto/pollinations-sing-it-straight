// The tune a model writes, and the checks that make it singable. The model supplies words and notes;
// code refuses a tune that is out of range, leaps too far, or does not line up syllable for note.

export const MIN_NOTES = 5;
export const MAX_NOTES = 8;
export const MAX_LEAP = 5; // semitones between neighbours: a fourth is easy to sing, a sixth is not

export function tuneMessages({ theme, low, high }) {
    return [
        {
            role: "system",
            content:
                "You write very short singable tunes. Reply with JSON only: " +
                '{"title": string, "syllables": string[], "notes": integer[]}. ' +
                `Use ${MIN_NOTES} to ${MAX_NOTES} notes. "syllables" has exactly one short sung syllable per note, ` +
                `in order, so the line reads as one phrase. "notes" are MIDI numbers between ${low} and ${high}. ` +
                `No two neighbouring notes may be more than ${MAX_LEAP} semitones apart, use at least three different notes, ` +
                "and end on the note you started with.",
        },
        { role: "user", content: `A tiny tune about: ${theme}` },
    ];
}

/** Reads a model reply. Returns { tune } or { problems: string[] } so the problems can be sent back to the model. */
export function parseTune(reply, { low, high }) {
    let data;
    try {
        const text = String(reply).replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, "$1");
        data = JSON.parse(text);
    } catch {
        return { problems: ["The reply was not valid JSON."] };
    }
    const problems = [];
    const { syllables, notes } = data;
    if (!Array.isArray(syllables) || !Array.isArray(notes))
        return { problems: ["syllables and notes must be arrays."] };
    if (!notes.every(Number.isInteger)) problems.push("notes must be whole MIDI numbers.");
    if (notes.length < MIN_NOTES || notes.length > MAX_NOTES)
        problems.push(`Use ${MIN_NOTES} to ${MAX_NOTES} notes, not ${notes.length}.`);
    if (syllables.length !== notes.length)
        problems.push(`There are ${syllables.length} syllables for ${notes.length} notes; they must match one to one.`);
    if (syllables.some((s) => typeof s !== "string" || !s.trim() || /\s/.test(s.trim())))
        problems.push("Each syllable must be one word or part of a word, with no spaces.");
    if (notes.some((n) => n < low || n > high)) problems.push(`Every note must be between ${low} and ${high}.`);
    for (let i = 1; i < notes.length; i++)
        if (Math.abs(notes[i] - notes[i - 1]) > MAX_LEAP) {
            problems.push(
                `Notes ${i} and ${i + 1} are ${Math.abs(notes[i] - notes[i - 1])} semitones apart; the most is ${MAX_LEAP}.`,
            );
            break;
        }
    if (new Set(notes).size < 3) problems.push("Use at least three different notes.");
    if (problems.length) return { problems };
    return {
        tune: {
            title: String(data.title ?? "Untitled").slice(0, 60),
            syllables: syllables.map((s) => s.trim()),
            notes,
        },
    };
}
