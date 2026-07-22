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

// Fallback Model Hierarchy using valid next-gen models to bypass Rate Limits
const FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-3-flash",
    "gemini-2-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite"
];

app.post('/api/analyze', upload.single('audioFile'), async (req, res) => {
    let audioFilePath = req.file ? req.file.path : null;
    let uploadedFileRef = null;

    try {
        if (!audioFilePath) {
            return res.status(400).json({ error: "No audio file received." });
        }

        const surahId = req.body.surahId || 1;
        const language = req.body.language || 'en';

        console.log(`\n🎙️ Analyzing Surah ID: ${surahId} | Feedback Mode: ${language}`);

        // Upload audio to Gemini File API
        uploadedFileRef = await fileManager.uploadFile(audioFilePath, {
            mimeType: "audio/webm",
            displayName: `Recitation_Surah_${surahId}`,
        });

const promptText = `
            You are an elite, world-class Master Quran Tajweed and Qira'at Coach with years of experience teaching students.
            Listen carefully to the user's audio recitation of Surah ID ${surahId}.
            
            Evaluate their recitation strictly and accurately across 4 pillars:
            1. overallScore (0-100)
            2. pronunciation (Makharij al-Huruf - exact articulation of letters) (0-100)
            3. memorization (Hifz accuracy, missing or wrong words) (0-100)
            4. tajweed (Rules like Ghunnah, Qalqalah, Madd, Ikhfa, Idgham) (0-100)

            ${language === 'ml' 
                ? 'PROVIDE ALL FEEDBACK (msgMl, actionMl) IN CLEAR, ENCOURAGING, AND FRIENDLY MALAYALAM WITH A WARM KERALA COASTAL/LOCAL FLAVOR.' 
                : 'Provide feedback clearly, professionally, and constructively in English.'}

            You MUST point out specific errors or areas of improvement. Give concrete, actionable advice on how to fix their tongue position or breathing.

            Respond ONLY with a valid JSON object matching this exact structure, with no markdown formatting outside the JSON:
            {
                "overallScore": number,
                "pronunciation": number,
                "memorization": number,
                "tajweed": number,
                "feedback": [
                    { 
                        "type": "perfect" | "warning" | "error", 
                        "verse": "e.g. Verse 3", 
                        "msgEn": "Detailed English explanation of what went wrong or right.", 
                        "msgMl": "Detailed Malayalam explanation with friendly local tone.", 
                        "ar": "The specific Arabic word or letter involved (or empty string)",
                        "actionEn": "Step-by-step actionable advice in English.",
                        "actionMl": "Step-by-step actionable advice in Malayalam."
                    }
                ]
            }
        `;

        // Execute Model Fallback Loop
        let parsedData = null;
        let lastError = null;

        for (const modelName of FALLBACK_MODELS) {
            try {
                console.log(`🤖 Requesting analysis using model: ${modelName}...`);
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
                break; // Exit loop on success
            } catch (err) {
                console.warn(`⚠️ Model ${modelName} failed/rate limited. Switching to next fallback...`);
                lastError = err;
            }
        }

        if (!parsedData) {
            throw lastError || new Error("All fallback models failed.");
        }

        // Cleanup temporary files
        if (fs.existsSync(audioFilePath)) fs.unlinkSync(audioFilePath);
        if (uploadedFileRef) await fileManager.deleteFile(uploadedFileRef.file.name);

        res.json({
            status: "success",
            message: "Recitation analyzed successfully.",
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