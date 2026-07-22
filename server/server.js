const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
require('dotenv').config();

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const { GoogleGenerativeAI } = require('@google/generative-ai');
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

const FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-3-flash",
    "gemini-2-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite"
];

// Helper: Clean and normalize audio using FFmpeg for maximum AI phonetic clarity
async function normalizeAudio(inputPath) {
    const outputPath = path.join('uploads', `processed_${Date.now()}.wav`);
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('wav')
            .audioChannels(1) // Mono
            .audioFrequency(16000) // 16kHz sample rate optimal for speech/phonetics
            .audioFilter('highpass=f=200, lowpass=f=3000') // Strip background rumble and hiss
            .on('end', () => resolve(outputPath))
            .on('error', (err) => {
                console.warn("⚠️ FFmpeg processing failed, falling back to raw audio:", err);
                resolve(inputPath); // Fallback to raw file if ffmpeg fails
            })
            .save(outputPath);
    });
}

async function fetchSurahReferenceText(surahId) {
    try {
        const response = await fetch(`https://api.alquran.cloud/v1/surah/${surahId}/quran-uthmani`);
        const data = await response.json();
        if (data && data.data && data.data.ayahs) {
            return data.data.ayahs.map(a => `[Verse ${a.numberInSurah}]: ${a.text}`).join('\n');
        }
    } catch (err) {
        console.warn("⚠️ Could not fetch ground truth reference text:", err);
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

        console.log(`\n🎙️ Processing Crystal-Clear Audio for Surah ID: ${surahId}`);

        // Step 1: Normalize and clean audio via FFmpeg
        processedAudioPath = await normalizeAudio(rawAudioPath);

        // Step 2: Fetch Ground Truth Reference Text
        const groundTruthText = await fetchSurahReferenceText(surahId);

        // Step 3: Upload cleaned audio to Gemini
        uploadedFileRef = await fileManager.uploadFile(processedAudioPath, {
            mimeType: "audio/wav",
            displayName: `Clean_Recitation_Surah_${surahId}`,
        });

        const promptText = `
            You are an elite, world-class Master Quran Tajweed and Qira'at Coach.
            Listen carefully to the user's audio recitation.

            GROUND TRUTH REFERENCE TEXT (Official Uthmani Text):
            ${groundTruthText}

            INSTRUCTIONS FOR EVALUATION:
            1. Compare the audio against the Ground Truth Reference Text to check word-for-word memorization (Hifz) accuracy.
            2. Evaluate precise Tajweed rules (such as Makharij al-Huruf, Ghunnah timing, Qalqalah bounces, and Madd elongation). Pay explicit attention to heavy letters (ص, ض, ط, ظ) vs light counterparts.
            3. Score accurately from 0-100 across overallScore, pronunciation, memorization, and tajweed.
            
            ${language === 'ml' 
                ? 'PROVIDE ALL FEEDBACK (msgMl, actionMl) IN CLEAR, ENCOURAGING, AND FRIENDLY MALAYALAM WITH A WARM KERALA LOCAL FLAVOR.' 
                : 'Provide feedback clearly, professionally, and constructively in English.'}

            Respond ONLY with a valid JSON object matching this exact structure, with no markdown code blocks outside:
            {
                "overallScore": number,
                "pronunciation": number,
                "memorization": number,
                "tajweed": number,
                "feedback": [
                    { 
                        "type": "perfect" | "warning" | "error", 
                        "verse": "e.g. Verse 2", 
                        "msgEn": "Detailed evaluation.", 
                        "msgMl": "വിശദമായ വിവരണം മലയാളത്തിൽ.", 
                        "ar": "The specific Arabic word",
                        "actionEn": "Actionable advice.", 
                        "actionMl": "എങ്ങനെ തിരുത്തണം എന്നതിനുള്ള നിർദ്ദേശം." 
                    }
                ]
            }
        `;

        let parsedData = null;
        let lastError = null;

        for (const modelName of FALLBACK_MODELS) {
            try {
                console.log(`🤖 Requesting evaluation using model: ${modelName}...`);
                const model = genAI.getGenerativeModel({ model: modelName });
                
                const result = await model.generateContent({
                    contents: [
                        { role: "user", parts: [
                            { fileData: { mimeType: uploadedFileRef.file.mimeType, fileUri: uploadedFileRef.file.uri } },
                            { text: promptText }
                        ]}
                    ],
                    generationConfig: { responseMimeType: "application/json" }
                });

                const rawText = result.response.text();
                parsedData = JSON.parse(rawText);
                console.log(`✅ Success with model: ${modelName}`);
                break;
            } catch (err) {
                console.warn(`⚠️ Model ${modelName} failed. Trying fallback...`);
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