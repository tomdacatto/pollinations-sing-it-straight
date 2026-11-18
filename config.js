// What a visitor's key may spend and for how long. A whole practice session costs a few thousandths of a Pollen.
export const BUDGET = 0.2;
export const EXPIRY_DAYS = 1;

// Models, all free for every visitor (paid_only is false on /v1/models).
export const TUNE_MODEL = "openai/gpt-5.4-nano"; // writes the lyric and the notes
export const COACH_MODEL = "openai/gpt-5.4-nano"; // turns measured numbers into advice
export const VOICE_MODEL = "openai/tts-1"; // reads the advice aloud
export const HEAR_MODEL = "openai/gpt-transcribe"; // writes down the words that were sung

// One note lasts this long, so the tune is slow enough to hit.
export const NOTE_SECONDS = 0.8;

// Voice ranges as MIDI notes (60 is middle C).
export const RANGES = {
    low: { label: "Lower voice (A2 to E4)", low: 45, high: 64 },
    high: { label: "Higher voice (A3 to E5)", low: 57, high: 76 },
};

// The publishable App Key (pk_...), sent as client_id so the consent screen names the app. Empty until it exists.
export const APP_KEY = "";
