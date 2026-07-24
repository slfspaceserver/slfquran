const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
require('dotenv').config();

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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

async function normalizeAudio(inputPath) {
    const outputPath = path.join('uploads', `processed_${Date.now()}.wav`);
    return new Promise((resolve) => {
        ffmpeg(inputPath)
            .toFormat('wav')
            .audioChannels(1) 
            .audioFrequency(16000) 
            .on('end', () => resolve(outputPath))
            .on('error', (err) => {
                console.warn("⚠️ FFmpeg conversion warning, utilizing raw file:", err);
                resolve(inputPath);
            })
            .save(outputPath);
    });
}

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
    let processedAudioPath = null;

    try {
        if (!rawAudioPath) {
            return res.status(400).json({ error: "No audio file received." });
        }

        const surahId = req.body.surahId || 1;
        const language = req.body.language || 'en';

        console.log(`\n🎙️ Analyzing Audio for Surah ID: ${surahId}`);

        processedAudioPath = await normalizeAudio(rawAudioPath);
        const audioBuffer = fs.readFileSync(processedAudioPath);
        const base64Audio = audioBuffer.toString('base64');
        const groundTruthText = await fetchSurahReferenceText(surahId);

        // MAXIMUM ACCURACY PROMPT
        const promptText = `
You are a highly strict, elite Master Qari and Tajweed Examiner. 
Your goal is 100% flawless error detection. Do NOT hallucinate errors, and do NOT ignore subtle mistakes.

### REFERENCE TEXT FOR SURAH ID ${surahId}:
${groundTruthText}

### MANDATORY CHAIN-OF-THOUGHT EVALUATION:
To achieve maximum accuracy, you MUST perform this mental check before scoring:
1. AUDIO ISOLATION: Listen to the audio. Which specific verses did the user actually attempt? Ignore the rest of the text.
2. LITERAL TRANSCRIPTION: Mentally transcribe exactly what the user pronounced. 
3. WORD-BY-WORD ALIGNMENT: Compare your literal transcription to the Reference Text. 
   - Did they mix 'س' (Seen) and 'ص' (Saad)?
   - Did they mix 'ح' (Haa) and 'ه' (Haa)?
   - Did they mix 'ذ' (Thal) and 'ز' (Zay)?
   - Did they miss a Madd (elongation) or Ghunnah (nasalization) indicated by the Tajweed markup?

### CRITICAL ERROR PHRASING RULES:
When reporting an error, you MUST state exactly what the user did wrong.
- CORRECT PHRASING: "You pronounced the letter 'ه' instead of the correct letter 'ح' in the word 'الرَّحِيمِ'."
- NEVER state that a wrong letter exists inside the reference word itself.

### SCORING SYSTEM:
- Start at 100%.
- Deduct 5-10 points for every distinct pronunciation, memorization, or Tajweed error found in the *attempted* audio.
- DO NOT penalize for unread verses.

### LANGUAGE: 
${language === 'ml' 
   ? 'Provide msgMl and actionMl in natural Malayalam. Clearly distinguish the wrong spoken letter from the correct letter.' 
   : 'Provide msgEn and actionEn in clear English.'}
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
                                { inlineData: { mimeType: "audio/wav", data: base64Audio } },
                                { text: promptText }
                            ]
                        }
                    ],
                    generationConfig: { 
                        responseMimeType: "application/json",
                        responseSchema: responseSchema,
                        temperature: 0.0 // Set to absolute zero for strict, deterministic accuracy
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

        if (rawAudioPath && fs.existsSync(rawAudioPath)) fs.unlinkSync(rawAudioPath);
        if (processedAudioPath && fs.existsSync(processedAudioPath) && processedAudioPath !== rawAudioPath) fs.unlinkSync(processedAudioPath);

        res.json({
            status: "success",
            message: "Recitation successfully analyzed.",
            data: parsedData
        });

    } catch (error) {
        console.error("❌ Error during processing:", error);
        if (rawAudioPath && fs.existsSync(rawAudioPath)) fs.unlinkSync(rawAudioPath);
        if (processedAudioPath && fs.existsSync(processedAudioPath) && processedAudioPath !== rawAudioPath) fs.unlinkSync(processedAudioPath);
        res.status(500).json({ error: "Failed to process audio." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});