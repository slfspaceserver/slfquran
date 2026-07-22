const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

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

// Helper to fetch official Surah text for ground-truth verification
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
    let audioFilePath = req.file ? req.file.path : null;
    let uploadedFileRef = null;

    try {
        if (!audioFilePath) {
            return res.status(400).json({ error: "No audio file received." });
        }

        const surahId = req.body.surahId || 1;
        const language = req.body.language || 'en';

        console.log(`\n🎙️ High-Accuracy Analysis for Surah ID: ${surahId} | Language: ${language}`);

        // Fetch Ground Truth Text to eliminate hallucinations
        const groundTruthText = await fetchSurahReferenceText(surahId);

        uploadedFileRef = await fileManager.uploadFile(audioFilePath, {
            mimeType: "audio/webm",
            displayName: `Recitation_Surah_${surahId}`,
        });

        const promptText = `
            You are an elite, world-class Master Quran Tajweed and Qira'at Coach.
            Listen carefully to the user's audio recitation of Surah ID ${surahId}.

            GROUND TRUTH REFERENCE TEXT (Official Uthmani Text):
            ${groundTruthText}

            INSTRUCTIONS FOR EVALUATION:
            1. Compare the user's audio against the Ground Truth Reference Text above to check word-for-word memorization (Hifz) accuracy.
            2. Evaluate strict Tajweed rules (Ghunnah, Qalqalah, Madd length, Makharij al-Huruf).
            3. Score them accurately from 0-100 across overallScore, pronunciation, memorization, and tajweed.
            
            ${language === 'ml' 
                ? 'PROVIDE ALL FEEDBACK (msgMl, actionMl) IN CLEAR, ENCOURAGING, AND FRIENDLY MALAYALAM WITH A WARM KERALA LOCAL FLAVOR.' 
                : 'Provide feedback clearly, professionally, and constructively in English.'}

            EXAMPLE OF EXPECTED JSON FORMAT:
            {
                "overallScore": 88,
                "pronunciation": 85,
                "memorization": 95,
                "tajweed": 84,
                "feedback": [
                    { 
                        "type": "warning", 
                        "verse": "Verse 2", 
                        "msgEn": "The Madd length was too short.", 
                        "msgMl": "മദ്ഡ് കുറച്ചുകൂടി നീട്ടി ഓതുക.", 
                        "ar": "الرَّحْمَٰنِ",
                        "actionEn": "Hold the vowel for 4 counts.", 
                        "actionMl": "4 അലിഫ് നീളം നൽകുക." 
                    }
                ]
            }

            Respond ONLY with a valid JSON object matching this exact structure, with no markdown code blocks outside.
        `;

        let parsedData = null;
        let lastError = null;

        for (const modelName of FALLBACK_MODELS) {
            try {
                console.log(`🤖 Requesting high-accuracy analysis using model: ${modelName}...`);
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
                console.log(`✅ Success using model: ${modelName}`);
                break;
            } catch (err) {
                console.warn(`⚠️ Model ${modelName} failed/rate limited. Switching fallback...`);
                lastError = err;
            }
        }

        if (!parsedData) {
            throw lastError || new Error("All fallback models failed.");
        }

        if (fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
        if (uploadedFileRef) await fileManager.deleteFile(uploadedFileRef.file.name);

        res.json({
            status: "success",
            message: "Recitation analyzed with high accuracy.",
            data: parsedData
        });

    } catch (error) {
        console.error("❌ Final AI Error:", error);
        if (audioFilePath && fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
        res.status(500).json({ error: "Failed to process audio with AI." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});