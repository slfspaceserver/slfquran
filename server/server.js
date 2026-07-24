const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("❌ GEMINI_API_KEY is missing from environment variables!");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

// Load Master Tajweed Rules Document from root directory
let tajweedRules = "";
try {
    const rulesPath = path.join(__dirname, 'tajweed_rules.txt');
    if (fs.existsSync(rulesPath)) {
        tajweedRules = fs.readFileSync(rulesPath, 'utf8');
        console.log("📜 Master Tajweed Rules document successfully loaded.");
    } else {
        console.warn("⚠️ tajweed_rules.txt not found. Running with built-in prompt rubric.");
    }
} catch (err) {
    console.warn("⚠️ Could not read tajweed_rules.txt file:", err.message);
}

// Prioritizing models for intelligence and precision
const FALLBACK_MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-3-flash",
    "gemini-2-flash",
    "gemini-2.5-flash-lite"
];

const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        overallScore: { type: SchemaType.INTEGER, description: "Overall accuracy score from 0 to 100" },
        pronunciation: { type: SchemaType.INTEGER, description: "Pronunciation score from 0 to 100" },
        memorization: { type: SchemaType.INTEGER, description: "Memorization score from 0 to 100" },
        tajweed: { type: SchemaType.INTEGER, description: "Tajweed score from 0 to 100" },
        feedback: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    type: { type: SchemaType.STRING, enum: ["perfect", "warning", "error"] },
                    verse: { type: SchemaType.STRING, description: "e.g., 'Verse 1'" },
                    ar: { type: SchemaType.STRING, description: "Arabic word or phrase evaluated" },
                    msgEn: { type: SchemaType.STRING, description: "Feedback in English" },
                    msgMl: { type: SchemaType.STRING, description: "Feedback in Malayalam" },
                    actionEn: { type: SchemaType.STRING, description: "Correction tip in English" },
                    actionMl: { type: SchemaType.STRING, description: "Correction tip in Malayalam" }
                },
                required: ["type", "verse", "msgEn", "msgMl"]
            }
        }
    },
    required: ["overallScore", "pronunciation", "memorization", "tajweed", "feedback"]
};

async function fetchSurahReferenceText(surahId) {
    try {
        const response = await fetch(`https://api.alquran.cloud/v1/surah/${surahId}/ar.tajweed`);
        const data = await response.json();
        if (data && data.data && data.data.ayahs) {
            return data.data.ayahs.map(a => `[Verse ${a.numberInSurah}]: ${a.text}`).join('\n');
        }
    } catch (err) {
        console.warn("⚠️ Could not fetch Tajweed reference text:", err);
    }
    return "Reference text unavailable.";
}

app.post('/api/analyze', upload.single('audioFile'), async (req, res) => {
    let rawAudioPath = req.file ? req.file.path : null;

    try {
        if (!rawAudioPath) {
            return res.status(400).json({ error: "No audio file received." });
        }

        const surahId = req.body.surahId || 1;
        const language = req.body.language || 'en';

        console.log(`\n🎙️ Analyzing Audio for Surah ID: ${surahId}`);

        // Direct Buffer Handling - Prevents FFmpeg/Render crashes
        const audioBuffer = fs.readFileSync(rawAudioPath);
        const base64Audio = audioBuffer.toString('base64');
        const mimeType = req.file.mimetype === 'application/octet-stream' ? 'audio/webm' : req.file.mimetype;

        const groundTruthText = await fetchSurahReferenceText(surahId);

        // HYPER-STRICT TAJWEED EVALUATION PROMPT
        const promptText = `
You are an elite, highly rigorous Master Qari and expert Tajweed Examiner. 
Your task is to analyze the user's recitation audio against the Reference Text strictly using the Official Tajweed Rules rubric provided below.

### OFFICIAL TAJWEED RULES RUBRIC:
${tajweedRules ? tajweedRules : "Apply strict classical Tajweed rules for Makharij, Sifat, Qalqalah, Ghunnah, and Madd."}

### REFERENCE TEXT FOR SURAH ID ${surahId}:
${groundTruthText}

### MANDATORY EVALUATION STEPS FOR 100% ACCURACY:
1. TRANSCRIBE FIRST: Mentally transcribe exactly what the user pronounced, word-by-word.
2. ISOLATE ATTEMPTED VERSES: Only evaluate the words/verses the user actually recited. DO NOT penalize for unrecited verses.
3. PHONETIC MATRIX & TAJWEED MATCH: Cross-reference your mental transcription against the Reference Text and Official Tajweed Rules:
   - Check heavy vs light letter substitutions (e.g., 'س' vs 'ص', 'ح' vs 'ه', 'ذ' vs 'ز', 'ت' vs 'ط', 'ك' vs 'ق').
   - Check missing Qalqalah on stopped/sukun letters (ق, ط, ب, ج, د).
   - Check missing Ghunnah (2 beats) on Nun/Meem Shaddah or Ikhfa/Idgham rules.
   - Check improper Madd (elongation) timings.
4. NO HALLUCINATIONS: Only flag an error if you clearly hear a mistake that violates a rule.
5. STRICT ERROR PHRASING RULES:
   - When reporting an error, you MUST explicitly separate what the user spoke from what was required.
   - CORRECT PHRASING: "You pronounced the letter 'ه' instead of the correct letter 'ح' in the word 'الرَّحِيمِ'."
   - WRONG PHRASING: "Incorrect articulation of 'ح' in 'الرَّحِيمِ'." (NEVER use this vague phrasing).

### SCORING SYSTEM:
- Start at 100 points.
- Minor Tajweed mistake (e.g., short Madd, missed Ghunnah): Deduct 2-3 points.
- Major Pronunciation mistake (changed letter/Makhraj): Deduct 5 points.
- Memorization mistake (skipped or added word): Deduct 10 points.

### LANGUAGE OUTPUT: 
${language === 'ml' 
   ? 'Provide msgMl and actionMl in natural Malayalam. Clearly distinguish the wrong spoken letter from the correct letter.' 
   : 'Provide msgEn and actionEn in clear, direct English.'}
`;

        let parsedData = null;
        let lastError = null;

        for (const modelName of FALLBACK_MODELS) {
            try {
                console.log(`🤖 Requesting evaluation using model: ${modelName}...`);
                const model = genAI.getGenerativeModel({ model: modelName });
                
                const result = await model.generateContent({
                    contents: [
                        { 
                            role: "user", 
                            parts: [
                                { inlineData: { mimeType: mimeType, data: base64Audio } },
                                { text: promptText }
                            ]
                        }
                    ],
                    generationConfig: { 
                        responseMimeType: "application/json",
                        responseSchema: responseSchema,
                        temperature: 0.0 // Zero temperature for strict, deterministic logic
                    }
                });

                const rawText = result.response.text();
                parsedData = JSON.parse(rawText);
                console.log(`✅ Success with model: ${modelName}`);
                break;
            } catch (err) {
                console.warn(`⚠️ Model ${modelName} failed. Trying next model...`, err.message);
                lastError = err;
            }
        }

        if (!parsedData) throw lastError || new Error("All models failed.");

        if (fs.existsSync(rawAudioPath)) fs.unlinkSync(rawAudioPath);

        res.json({
            status: "success",
            message: "Recitation successfully analyzed.",
            data: parsedData
        });

    } catch (error) {
        console.error("❌ Error during processing:", error);
        if (rawAudioPath && fs.existsSync(rawAudioPath)) fs.unlinkSync(rawAudioPath);
        res.status(500).json({ error: "Failed to process audio." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});