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
const { GoogleAIFileManager } = require('@google/generative-ai/server');

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
const fileManager = new GoogleAIFileManager(apiKey);

// Models prioritized for audio phonetics and high-accuracy analysis
const FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-3-flash",
    "gemini-2-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite"
];

// Strict JSON Schema Enforcement
const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        overallScore: { type: SchemaType.INTEGER, description: "Overall accuracy score from 0 to 100" },
        pronunciation: { type: SchemaType.INTEGER, description: "Pronunciation score from 0 to 100" },
        memorization: { type: SchemaType.INTEGER, description: "Memorization accuracy score from 0 to 100" },
        tajweed: { type: SchemaType.INTEGER, description: "Tajweed precision score from 0 to 100" },
        feedback: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    type: { type: SchemaType.STRING, enum: ["perfect", "warning", "error"] },
                    verse: { type: SchemaType.STRING, description: "e.g., 'Verse 1'" },
                    ar: { type: SchemaType.STRING, description: "Specific Arabic word or phrase flagged" },
                    msgEn: { type: SchemaType.STRING, description: "Detailed feedback in English" },
                    msgMl: { type: SchemaType.STRING, description: "Detailed feedback in Malayalam" },
                    actionEn: { type: SchemaType.STRING, description: "How to fix in English" },
                    actionMl: { type: SchemaType.STRING, description: "How to fix in Malayalam" }
                },
                required: ["type", "verse", "msgEn", "msgMl"]
            }
        }
    },
    required: ["overallScore", "pronunciation", "memorization", "tajweed", "feedback"]
};

// Helper: Clean and normalize audio using FFmpeg
async function normalizeAudio(inputPath) {
    const outputPath = path.join('uploads', `processed_${Date.now()}.wav`);
    return new Promise((resolve) => {
        ffmpeg(inputPath)
            .toFormat('wav')
            .audioChannels(1) // Mono
            .audioFrequency(16000) // 16kHz optimal speech frequency
            .audioFilter('highpass=f=200, lowpass=f=3000') // Noise reduction
            .on('end', () => resolve(outputPath))
            .on('error', (err) => {
                console.warn("⚠️ FFmpeg processing failed, falling back to raw audio:", err);
                resolve(inputPath);
            })
            .save(outputPath);
    });
}

// UPDATE: Fetching the Annotated Tajweed Version
async function fetchSurahReferenceText(surahId) {
    try {
        // Changed from quran-uthmani to ar.tajweed
        const response = await fetch(`https://api.alquran.cloud/v1/surah/${surahId}/ar.tajweed`);
        const data = await response.json();
        if (data && data.data && data.data.ayahs) {
            // Returns text with [h:...], [m:...] tags that map where Tajweed rules apply
            return data.data.ayahs.map(a => `[Verse ${a.numberInSurah}]: ${a.text}`).join('\n');
        }
    } catch (err) {
        console.warn("⚠️ Could not fetch Tajweed ground truth reference text:", err);
    }
    return "Reference text unavailable.";
}

app.post('/api/analyze', upload.single('audioFile'), async (req, res) => {
    let rawAudioPath = req.file ? req.file.path : null;
    let processedAudioPath = null;
    let uploadedFileRef = null;

    try {
        if (!rawAudioPath) {
            return res.status(400).json({ error: "No audio file received." });
        }

        const surahId = req.body.surahId || 1;
        const language = req.body.language || 'en';

        console.log(`\n🎙️ Processing High-Accuracy Audio for Surah ID: ${surahId}`);

        // Step 1: Normalize audio via FFmpeg
        processedAudioPath = await normalizeAudio(rawAudioPath);

        // Step 2: Fetch Annotated Tajweed Ground Truth
        const groundTruthText = await fetchSurahReferenceText(surahId);

        // Step 3: Upload audio to Gemini File Manager
        uploadedFileRef = await fileManager.uploadFile(processedAudioPath, {
            mimeType: "audio/wav",
            displayName: `Recitation_Surah_${surahId}`,
        });

        // Step 4: Chain-of-Thought (CoT) Prompting with Tajweed Map
        const promptText = `
You are an expert Qari, Master Tajweed Evaluator, and Hafiz.
Analyze the user's recitation audio strictly against the mapped Tajweed text below.

### OFFICIAL TAJWEED REFERENCE MAP:
${groundTruthText}
(Note: The text contains markup indicating exact Tajweed rules. Use this as your absolute grading key).

### STEP-BY-STEP EVALUATION METHOD:
1. CHEAT SHEET VERIFICATION: Compare the audio directly against the Tajweed Reference Map provided above. 
2. HIFZ (MEMORIZATION): Identify skipped words, misread diacritics (Harakat), or omitted verses.
3. STRICT TAJWEED ALIGNMENT: Only penalize the user if they miss a rule that is explicitly marked in the Reference Map (e.g., Madd, Ghunnah, Qalqalah, Ikhfa). Check heavy/light letter pronunciation.
4. FAIR DEDUCTIONS:
   - Start at 100%.
   - Deduct 5-10 points per clear error.
   - Do NOT penalize natural pauses between verses or minor dialect variations.

### FEEDBACK LANGUAGE REQUIREMENT:
${language === 'ml' 
    ? 'Provide msgMl and actionMl in natural, clear Malayalam (മലയാളം).' 
    : 'Provide msgEn and actionEn in concise, encouraging English.'}
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
                                { fileData: { mimeType: uploadedFileRef.file.mimeType, fileUri: uploadedFileRef.file.uri } },
                                { text: promptText }
                            ]
                        }
                    ],
                    generationConfig: { 
                        responseMimeType: "application/json",
                        responseSchema: responseSchema,
                        temperature: 0.1 // Stops score volatility
                    }
                });

                const rawText = result.response.text();
                parsedData = JSON.parse(rawText);
                console.log(`✅ Evaluation success with model: ${modelName}`);
                break;
            } catch (err) {
                console.warn(`⚠️ Model ${modelName} failed. Trying fallback...`, err.message);
                lastError = err;
            }
        }

        if (!parsedData) throw lastError || new Error("All fallback models failed.");

        // Cleanup temporary files
        if (rawAudioPath && fs.existsSync(rawAudioPath)) fs.unlinkSync(rawAudioPath);
        if (processedAudioPath && fs.existsSync(processedAudioPath) && processedAudioPath !== rawAudioPath) fs.unlinkSync(processedAudioPath);
        if (uploadedFileRef) await fileManager.deleteFile(uploadedFileRef.file.name);

        res.json({
            status: "success",
            message: "High-accuracy processed recitation analyzed.",
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