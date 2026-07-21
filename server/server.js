const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

// Import Google AI SDK
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configure Multer for audio uploads
const upload = multer({ dest: 'uploads/' });

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Initialize Gemini SDK using the key from your environment variables
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("⚠️ GEMINI_API_KEY is missing from your environment variables!");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

/**
 * API ROUTE: Receive audio and return REAL AI analysis
 */
app.post('/api/analyze', upload.single('audioFile'), async (req, res) => {
    try {
        const audioFile = req.file;
        const surahId = req.body.surahId;
        const language = req.body.language;

        if (!audioFile) {
            return res.status(400).json({ error: "No audio file received." });
        }

        console.log(`\n🎙️ Processing Surah ID: ${surahId} in ${language}`);

        // 1. Upload the audio to Gemini using the File API
        console.log("1️⃣ Uploading audio to Gemini...");
        const uploadResponse = await fileManager.uploadFile(audioFile.path, {
            mimeType: "audio/webm",
            displayName: `Recitation_Surah_${surahId}`,
        });
        
        // 2. Prepare the AI Model
        // We use gemini-2.5-flash because it is lightning fast for multimodal tasks
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // 3. Craft the strict System Prompt with Kerala Slang Malayalam instruction
        const promptText = `
            You are an expert, compassionate Quran Tajweed coach. 
            Listen to the user's recitation of Surah ID ${surahId}.
            Evaluate their recitation based on pronunciation, memorization, and Tajweed rules.

            The user prefers Malayalam. You must analyze the audio and provide your feedback strictly in easy-to-understand Malayalam text. Use a warm, conversational Kerala slang to make the user feel comfortable.
            
            Respond ONLY with a valid JSON object matching this exact structure:
            {
                "overallScore": number (0-100),
                "pronunciation": number (0-100),
                "memorization": number (0-100),
                "tajweed": number (0-100),
                "feedback": [
                    { 
                        "type": "perfect" | "warning" | "error", 
                        "verse": "Verse number", 
                        "msgEn": "English feedback", 
                        "msgMl": "Malayalam feedback (Use conversational Kerala slang)", 
                        "ar": "The arabic text of the specific mistake (leave empty string if not needed)",
                        "actionEn": "Actionable advice on how to fix this mistake in English",
                        "actionMl": "Actionable advice on how to fix this mistake in Malayalam (Use conversational Kerala slang)"
                    }
                ]
            }
        `;

        // 4. Request the analysis from Gemini
        console.log("2️⃣ Analyzing recitation (this takes a few seconds)...");
        const result = await model.generateContent({
            contents: [
                { role: "user", parts: [
                    { fileData: { mimeType: uploadResponse.file.mimeType, fileUri: uploadResponse.file.uri } },
                    { text: promptText }
                ]}
            ],
            // Force the AI to return strict JSON data so our frontend doesn't break
            generationConfig: {
                responseMimeType: "application/json",
            }
        });

        const rawAiResponse = result.response.text();
        const parsedData = JSON.parse(rawAiResponse);
        
        console.log("3️⃣ Analysis complete! Sending back to frontend.");

        // 5. Clean up local and remote files to save space and protect privacy
        fs.unlinkSync(audioFile.path); 
        await fileManager.deleteFile(uploadResponse.file.name); 

        // 6. Send the real AI response back to the frontend
        res.json({
            status: "success",
            message: "Audio analyzed successfully by Gemini.",
            data: parsedData
        });

    } catch (error) {
        console.error("❌ AI Error:", error);
        
        // Clean up local file if something broke
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({ error: "Failed to process audio with AI." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Quran AI Backend is running on http://localhost:${PORT}`);
});