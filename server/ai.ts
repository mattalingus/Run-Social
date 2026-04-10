import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not set. AI features will be disabled or fallback to defaults.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy",
});

export async function generateRunSummary(stats: any) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an elite AI running coach. Provide a concise, motivating summary of a run based on the provided stats. Keep it under 150 characters. Use a supportive, professional tone. Avoid emojis.",
        },
        {
          role: "user",
          content: `Stats: Distance ${stats.distanceMiles} miles, Pace ${stats.paceMinPerMile} min/mile, Duration ${Math.floor(stats.durationSeconds / 60)} minutes, Elevation gain ${stats.elevationGainFt} ft.`,
        },
      ],
      max_tokens: 60,
    });
    return response.choices[0].message.content?.trim() || null;
  } catch (err) {
    console.error("[AI] generateRunSummary error:", err);
    return null;
  }
}

export async function generateCrewRecap(crewName: string, runTitle: string, participantCount: number, avgPace: string) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an AI assistant for a running crew. Write a quick, enthusiastic recap of a group run for the crew chat. Mention the crew name and basic stats. Keep it under 200 characters. No emojis.",
        },
        {
          role: "user",
          content: `Crew: ${crewName}. Run: ${runTitle}. Participants: ${participantCount}. Avg Pace: ${avgPace}.`,
        },
      ],
      max_tokens: 100,
    });
    return response.choices[0].message.content?.trim() || null;
  } catch (err) {
    console.error("[AI] generateCrewRecap error:", err);
    return null;
  }
}

export async function generateSearchFilters(query: string) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Extract running/cycling search filters from natural language. Return JSON with keys: paceMax (number), distMin (number), distMax (number), tags (string array). If a filter isn't mentioned, omit it. Only return the JSON.",
        },
        {
          role: "user",
          content: query,
        },
      ],
      response_format: { type: "json_object" },
    });
    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (err) {
    console.error("[AI] generateSearchFilters error:", err);
    return null;
  }
}

export async function generateWeeklyInsight(userName: string, stats: any) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a performance analyst. Provide one insightful sentence for a runner's weekly summary. Compare to typical progress or highlight a specific achievement in the data. No emojis.",
        },
        {
          role: "user",
          content: `Runner: ${userName}. This week: ${stats.runs} runs, ${stats.totalMi.toFixed(1)} miles, ${Math.floor(stats.totalSeconds / 60)} minutes.`,
        },
      ],
      max_tokens: 80,
    });
    return response.choices[0].message.content?.trim() || null;
  } catch (err) {
    console.error("[AI] generateWeeklyInsight error:", err);
    return null;
  }
}

const ALLOWED_VOICES = ["alloy", "echo", "fable", "nova", "onyx", "shimmer"] as const;
type TTSVoice = (typeof ALLOWED_VOICES)[number];

export async function generateTTS(text: string, voice: string = "nova") {
  if (!process.env.OPENAI_API_KEY) return null;
  const safeVoice: TTSVoice = (ALLOWED_VOICES as readonly string[]).includes(voice)
    ? (voice as TTSVoice)
    : "nova";
  try {
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: safeVoice,
      input: text,
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    return buffer;
  } catch (err) {
    console.error("[AI] generateTTS error:", err);
    return null;
  }
}
