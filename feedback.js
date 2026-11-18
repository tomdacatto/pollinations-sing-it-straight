// Turns measured results into words. The coach model is given only numbers that code measured,
// and the heard words are compared to the lyric in code.

const letters = (text) => [...text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")];

/** How many of the lyric's letters were heard, in order. Sung words run together, so letters are fairer than words. */
export function letterMatch(lyric, heard) {
    const a = letters(lyric);
    const b = letters(heard);
    let previous = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
        const row = [0];
        for (let j = 1; j <= b.length; j++)
            row[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
        previous = row;
    }
    return { matched: previous[b.length], total: a.length };
}

const FOCUS = {
    "too-quiet": "Almost no singing was picked up. Check the microphone and sing louder.",
    "all-flat": "The whole tune was sung below the notes, but the steps between notes were good.",
    "all-sharp": "The whole tune was sung above the notes, but the steps between notes were good.",
    "single-notes": "Most notes were close, with one or two that were off.",
    good: "Every note was within half a semitone.",
};

export function coachMessages(summary, results) {
    const facts = {
        ...summary,
        notes: results.map((r) =>
            r.verdict === "silent"
                ? `${r.name}: not heard`
                : `${r.name}: sang ${r.sung}, ${r.cents} cents (${r.verdict})`,
        ),
    };
    return [
        {
            role: "system",
            content:
                "You are a kind, exact singing coach. You are given measurements from code. Write two short sentences: " +
                "what went well, then the one thing to fix and how. Use only the numbers given; never invent a measurement. " +
                "100 cents is one semitone; a negative number is flat, a positive number is sharp.",
        },
        { role: "user", content: `${FOCUS[summary.focus] ?? ""}\n${JSON.stringify(facts)}` },
    ];
}
