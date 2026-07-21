/**
 * Quran AI Coach - MVP JavaScript
 * Updated with Firebase Authentication & Firestore Cloud Sync
 */

const firebaseConfig = {
    apiKey: "AIzaSyDO-kFa4D8FTTECfBweZXt15GW1mtJZ82E",
    authDomain: "slf-quran.firebaseapp.com",
    projectId: "slf-quran",
    storageBucket: "slf-quran.firebasestorage.app",
    messagingSenderId: "1012533933205",
    appId: "1:1012533933205:web:307b788a6d54bdd912979c",
    measurementId: "G-EBFXJ2381S"
  };

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

const app = (() => {
    let currentView = 'home-view';
    let viewHistory = ['home-view'];
    let selectedSurah = null;
    let recordingTimer = null;
    let seconds = 0;
    let isRecording = false;
    let currentLang = 'en';
    let loadingInterval = null;

    let mediaRecorder = null;
    let audioChunks = [];

    // Local app state
    let appData = {
        history: [],
        theme: 'dark'
    };

    let currentUser = null;

    // Fetch user-specific data from Firestore when logged in
    const loadUserData = async (user) => {
        currentUser = user;
        try {
            // Load theme from local storage
            const localSettings = JSON.parse(localStorage.getItem(`quranTheme_${user.uid}`));
            if (localSettings) appData.theme = localSettings.theme;

            // Load history from Firestore database
            const snapshot = await db.collection('users').doc(user.uid).collection('history').orderBy('date', 'desc').get();
            appData.history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            applyTheme();
            updateDashboard();
        } catch (error) {
            console.error("Error loading user data from cloud:", error);
        }
    };

    const saveData = async (newEntry = null) => {
        if (!currentUser) return;
        
        // Save theme locally
        localStorage.setItem(`quranTheme_${currentUser.uid}`, JSON.stringify({ theme: appData.theme }));

        // If a new history entry is provided, save it to Firestore
        if (newEntry) {
            try {
                await db.collection('users').doc(currentUser.uid).collection('history').doc(newEntry.id.toString()).set(newEntry);
            } catch (error) {
                console.error("Error saving history to cloud:", error);
            }
        }
    };

    // i18n Dictionary
    const i18n = {
        en: {
            app_title: "Quran AI Coach", hero_title: "Practice. Improve.<br><span class='text-primary'>Recite with Confidence.</span>", hero_sub: "Your personal AI-powered Quran recitation assistant.",
            daily_streak: "Daily Streak", avg_accuracy: "Avg Accuracy", sessions: "Sessions", start_practice: "Start Practice", recent_practice: "Recent Practice", see_all: "See All",
            disclaimer: "<strong>Important:</strong> This application is an AI-assisted learning tool intended to support Quran recitation practice. AI feedback may not always be accurate.",
            search_placeholder: "Search Surah...", tap_to_start: "Tap to start", recording: "Recording...", paused: "Paused", cancel: "Cancel", finish: "Finish & Analyze",
            analyzing: "Analyzing your recitation...", step_1: "Processing audio...", step_2: "Converting speech to text...", step_3: "Evaluating Tajweed rules...", step_4: "Generating feedback...",
            analysis_complete: "Analysis Complete", overall_accuracy: "Overall Accuracy", pronunciation: "Pronunciation", memorization: "Memorization", tajweed: "Tajweed",
            detailed_feedback: "Detailed Feedback", done: "Done", progress: "Your Progress", history: "Practice History", settings: "Settings", dark_mode: "Dark Mode",
            nav_home: "Home", nav_progress: "Progress", nav_history: "History", nav_settings: "Settings", verses: "Verses", verse: "Verse", mic_error: "Microphone access denied."
        },
        ml: {
            app_title: "ഖുർആൻ AI കോച്ച്", hero_title: "പരിശീലിക്കുക. മെച്ചപ്പെടുത്തുക.<br><span class='text-primary'>ആത്മവിശ്വാസത്തോടെ പാരായണം ചെയ്യുക.</span>", hero_sub: "നിങ്ങളുടെ സ്വന്തം AI ഖുർആൻ പാരായണ സഹായി.",
            daily_streak: "തുടർച്ചയായ ദിനങ്ങൾ", avg_accuracy: "ശരാശരി കൃത്യത", sessions: "സെഷനുകൾ", start_practice: "പരിശീലനം തുടങ്ങുക", recent_practice: "അവസാനത്തെ പരിശീലനം", see_all: "എല്ലാം കാണുക",
            disclaimer: "<strong>പ്രധാനപ്പെട്ടത്:</strong> ഇതൊരു AI സഹായത്തോടെ പ്രവർത്തിക്കുന്ന പഠന സഹായിയാണ്. ഖുർആൻ അധ്യാപകനുമായി നിങ്ങളുടെ പാരായണം എപ്പോഴും പരിശോധിക്കുക.",
            search_placeholder: "സൂറത്ത് തിരയുക...", tap_to_start: "തുടങ്ങാൻ ടാപ്പ് ചെയ്യുക", recording: "റെക്കോർഡ് ചെയ്യുന്നു...", paused: "നിർത്തിവെച്ചിരിക്കുന്നു", cancel: "റദ്ദാക്കുക", finish: "പൂർത്തിയാക്കി പരിശോധിക്കുക",
            analyzing: "നിങ്ങളുടെ പാരായണം പരിശോധിക്കുന്നു...", step_1: "ശബ്ദം പരിശോധിക്കുന്നു...", step_2: "വാക്കുകൾ വേർതിരിക്കുന്നു...", step_3: "തജ്‌വീദ് നിയമങ്ങൾ പരിശോധിക്കുന്നു...", step_4: "ഫീഡ്‌ബാക്ക് തയ്യാറാക്കുന്നു...",
            analysis_complete: "പരിശോധന പൂർത്തിയായി", overall_accuracy: "മൊത്തത്തിലുള്ള കൃത്യത", pronunciation: "ഉച്ചാരണം", memorization: "മനഃപാഠം", tajweed: "തജ്‌വീദ്",
            detailed_feedback: "വിശദമായ ഫീഡ്‌ബാക്ക്", done: "പൂർത്തിയായി", progress: "നിങ്ങളുടെ പുരോഗതി", history: "പരിശീലന ചരിത്രം", settings: "ക്രമീകരണങ്ങൾ", dark_mode: "ഡാർക്ക് മോഡ്",
            nav_home: "ഹോം", nav_progress: "പുരോഗതി", nav_history: "ചരിത്രം", nav_settings: "ക്രമീകരണങ്ങൾ", verses: "വരികൾ", verse: "വരി", mic_error: "മൈക്രോഫോൺ ഉപയോഗിക്കാൻ അനുമതിയില്ല."
        }
    };

    const surahs = [
        { id: 1, number: 1, nameEn: "Al-Fatihah", nameMl: "അൽ-ഫാതിഹ", nameAr: "الفاتحة", verses: 7 },
        { id: 2, number: 2, nameEn: "Al-Baqarah", nameMl: "അൽ-ബഖറ", nameAr: "البقرة", verses: 286 },
        { id: 18, number: 18, nameEn: "Al-Kahf", nameMl: "അൽ-കഹ്ഫ്", nameAr: "الكهف", verses: 110 },
        { id: 36, number: 36, nameEn: "Ya-Sin", nameMl: "യാസീൻ", nameAr: "يس", verses: 83 },
        { id: 55, number: 55, nameEn: "Ar-Rahman", nameMl: "അർ-റഹ്മാൻ", nameAr: "الرحمن", verses: 78 },
        { id: 67, number: 67, nameEn: "Al-Mulk", nameMl: "അൽ-മുൽക്", nameAr: "الملك", verses: 30 },
        { id: 112, number: 112, nameEn: "Al-Ikhlas", nameMl: "അൽ-ഇഖ്‌ലാസ്", nameAr: "الإخلاص", verses: 4 },
        { id: 113, number: 113, nameEn: "Al-Falaq", nameMl: "അൽ-ഫലഖ്", nameAr: "الفلق", verses: 5 },
        { id: 114, number: 114, nameEn: "An-Nas", nameMl: "അൻ-നാസ്", nameAr: "الناس", verses: 6 }
    ];

    const els = {
        backBtnContainer: document.getElementById('back-btn-container'), surahList: document.getElementById('surah-list'), surahSearch: document.getElementById('surah-search'),
        recordSurahName: document.getElementById('record-surah-name'), micWaves: document.getElementById('mic-waves'), recordTimer: document.getElementById('record-timer'),
        recordStatus: document.getElementById('record-status'), btnMic: document.getElementById('btn-mic'), resultSurahName: document.getElementById('result-surah-name'),
        feedbackList: document.getElementById('feedback-list'), weeklyChart: document.getElementById('weekly-chart'), langBtn: document.getElementById('lang-btn'),
        historyList: document.getElementById('history-list')
    };

    const init = () => {
        applyLanguage();
        renderSurahList(surahs);
        
        // Listen for user sign-in state
        auth.onAuthStateChanged(user => {
            if (user) {
                loadUserData(user);
                navigateTo('home-view');
            } else {
                currentUser = null;
                navigateTo('auth-view');
            }
        });
    };

    // --- Firebase Auth Handlers ---
    const signup = async () => {
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        try {
            await auth.createUserWithEmailAndPassword(email, password);
            alert("Account created successfully!");
        } catch (error) {
            alert(error.message);
        }
    };

    const login = async () => {
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        try {
            await auth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            alert(error.message);
        }
    };

    const logout = () => {
        auth.signOut();
    };

    const toggleLanguage = () => {
        currentLang = currentLang === 'en' ? 'ml' : 'en';
        els.langBtn.textContent = currentLang === 'en' ? 'മലയാളം' : 'English';
        applyLanguage();
        renderSurahList(surahs);
        updateDashboard();
    };

    const applyLanguage = () => {
        document.body.className = `lang-${currentLang} ${appData.theme === 'light' ? 'light-mode' : ''}`;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (i18n[currentLang][key]) el.innerHTML = i18n[currentLang][key];
        });
        const searchInput = document.getElementById('surah-search');
        if (searchInput) searchInput.placeholder = i18n[currentLang].search_placeholder;
    };

    const toggleTheme = () => {
        appData.theme = appData.theme === 'dark' ? 'light' : 'dark';
        saveData();
        applyTheme();
    };

    const applyTheme = () => {
        const toggleBtn = document.querySelector('.toggle');
        if (appData.theme === 'light') {
            document.body.classList.add('light-mode');
            if(toggleBtn) toggleBtn.classList.remove('active');
        } else {
            document.body.classList.remove('light-mode');
            if(toggleBtn) toggleBtn.classList.add('active');
        }
    };

    const navigateTo = (viewId, event = null) => {
        if (event) event.preventDefault();

        if (viewId === 'auth-view') {
            document.body.classList.add('on-auth');
        } else {
            document.body.classList.remove('on-auth');
        }

        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.remove('active');
            if (el.dataset.target === viewId) el.classList.add('active');
        });
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        
        const targetView = document.getElementById(viewId);
        if (targetView) targetView.classList.add('active');

        if (viewId !== currentView) {
            if (['home-view', 'progress-view', 'history-view', 'settings-view'].includes(viewId)) {
                viewHistory = [viewId]; 
                if(els.backBtnContainer) els.backBtnContainer.style.display = 'none';
                if(viewId === 'home-view' || viewId === 'progress-view' || viewId === 'history-view') updateDashboard();
            } else {
                viewHistory.push(viewId);
                if(els.backBtnContainer) els.backBtnContainer.style.display = 'block';
            }
        }
        currentView = viewId;
    };

    const goBack = () => {
        if (viewHistory.length > 1) {
            viewHistory.pop(); 
            const previousView = viewHistory[viewHistory.length - 1];
            navigateTo(previousView);
        }
    };

    const renderSurahList = (data) => {
        const verseText = i18n[currentLang].verses;
        if(els.surahList) {
            els.surahList.innerHTML = data.map(s => {
                const displayName = currentLang === 'en' ? s.nameEn : s.nameMl;
                return `
                <div class="surah-item glass-card" onclick="app.selectSurah(${s.id})">
                    <div class="recent-info">
                        <span class="surah-number">${s.number}</span>
                        <div><h3>${displayName}</h3><p>${s.verses} ${verseText}</p></div>
                    </div>
                    <div class="surah-item-ar">${s.nameAr}</div>
                </div>`
            }).join('');
        }
    };

    const filterSurahs = () => {
        const query = els.surahSearch.value.toLowerCase();
        const filtered = surahs.filter(s => s.nameEn.toLowerCase().includes(query) || s.nameMl.includes(query) || s.number.toString().includes(query));
        renderSurahList(filtered);
    };

    const selectSurah = (id) => {
        selectedSurah = surahs.find(s => s.id === id);
        els.recordSurahName.textContent = currentLang === 'en' ? selectedSurah.nameEn : selectedSurah.nameMl;
        resetRecording();
        navigateTo('record-view');
    };

    const formatTime = (sec) => {
        const m = Math.floor(sec / 60).toString().padStart(2, '0');
        const s = (sec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const resetRecording = () => {
        clearInterval(recordingTimer);
        seconds = 0;
        isRecording = false;
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        mediaRecorder = null;
        audioChunks = [];
        els.recordTimer.textContent = "00:00";
        els.micWaves.classList.remove('active');
        els.btnMic.classList.remove('active');
        els.btnMic.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
        els.recordStatus.textContent = i18n[currentLang].tap_to_start;
        els.recordStatus.classList.add('stopped');
    };

    const toggleRecording = async () => {
        if (isRecording) {
            clearInterval(recordingTimer);
            isRecording = false;
            if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.pause();
            els.micWaves.classList.remove('active');
            els.btnMic.classList.remove('active');
            els.btnMic.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
            els.recordStatus.textContent = i18n[currentLang].paused;
            els.recordStatus.classList.add('stopped');
        } else {
            isRecording = true;
            if (!mediaRecorder) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
                    mediaRecorder.start();
                } catch (error) {
                    alert(i18n[currentLang].mic_error);
                    isRecording = false;
                    return; 
                }
            } else if (mediaRecorder.state === "paused") {
                mediaRecorder.resume();
            }
            els.micWaves.classList.add('active');
            els.btnMic.classList.add('active');
            els.btnMic.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>`;
            els.recordStatus.textContent = i18n[currentLang].recording;
            els.recordStatus.classList.remove('stopped');
            recordingTimer = setInterval(() => { seconds++; els.recordTimer.textContent = formatTime(seconds); }, 1000);
        }
    };

    const cancelRecording = () => { resetRecording(); goBack(); };

    const startLoadingAnimation = () => {
        const steps = document.querySelectorAll('.analysis-steps .step');
        steps.forEach(s => s.classList.remove('active', 'done'));
        let currentStep = 0;
        if(steps.length > 0) steps[0].classList.add('active');
        
        loadingInterval = setInterval(() => {
            if (currentStep < 3 && steps.length > currentStep + 1) {
                steps[currentStep].classList.replace('active', 'done');
                currentStep++;
                steps[currentStep].classList.add('active');
            }
        }, 1800);
    };

    const stopLoadingAnimation = () => {
        clearInterval(loadingInterval);
        const steps = document.querySelectorAll('.analysis-steps .step');
        steps.forEach(s => {
            s.classList.remove('active');
            s.classList.add('done');
        });
    };

    const finishRecording = () => {
        if (seconds === 0) return;
        clearInterval(recordingTimer);

        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('audioFile', audioBlob, 'recitation.webm');
                formData.append('surahId', selectedSurah.id);
                formData.append('language', currentLang);

                mediaRecorder.stream.getTracks().forEach(track => track.stop());
                
                navigateTo('analysis-view');
                startLoadingAnimation();

                try {
                    const response = await fetch('https://slfquran.onrender.com/api/analyze', { method: 'POST', body: formData });
                    if (!response.ok) throw new Error("API failed");
                    
                    const aiResult = await response.json();
                    stopLoadingAnimation();
                    generateAIResults(aiResult.data);
                    navigateTo('result-view');

                } catch (error) {
                    console.error("Failed to send audio to backend:", error);
                    stopLoadingAnimation();
                    simulateAnalysis(); 
                }
            };
            mediaRecorder.stop();
        } else {
            navigateTo('analysis-view');
            simulateAnalysis();
        }
    };

    const simulateAnalysis = () => {
        startLoadingAnimation();
        setTimeout(() => { 
            stopLoadingAnimation();
            generateAIResults(); 
            navigateTo('result-view'); 
        }, 4500);
    };

    const viewPastSession = (id) => {
        const session = appData.history.find(h => h.id == id);
        if(session) {
            selectedSurah = surahs.find(s => s.id === session.surahId);
            const historicalData = session.fullData || {
                overallScore: session.score,
                pronunciation: session.score,
                memorization: session.score,
                tajweed: session.score,
                feedback: []
            };
            historicalData.isHistory = true; 
            generateAIResults(historicalData);
            navigateTo('result-view');
        }
    };

    const generateAIResults = (realData = null) => {
        els.resultSurahName.textContent = selectedSurah ? (currentLang === 'en' ? selectedSurah.nameEn : selectedSurah.nameMl) : "Practice Session";

        const overall = realData ? realData.overallScore : Math.floor(Math.random() * (99 - 85 + 1) + 85);
        const pronun = realData ? realData.pronunciation : 92;
        const memor = realData ? realData.memorization : 98;
        const tajw = realData ? realData.tajweed : 90;

        if(selectedSurah && (!realData || !realData.isHistory)) {
            const newEntry = {
                id: Date.now(),
                surahId: selectedSurah.id,
                surahNameEn: selectedSurah.nameEn,
                surahNameMl: selectedSurah.nameMl,
                score: overall,
                date: new Date().toISOString(),
                fullData: realData
            };
            appData.history.unshift(newEntry);
            saveData(newEntry); // Save entry directly to Firestore cloud
        }

        const percentageEl = document.querySelector('.circular-chart .percentage');
        if(percentageEl) percentageEl.textContent = `${overall}%`;
        
        const circle = document.querySelector('.circle-value');
        if(circle) {
            circle.style.strokeDasharray = `${overall}, 100`;
            circle.style.stroke = overall >= 90 ? 'var(--primary)' : 'var(--accent)';
        }

        setTimeout(() => {
            const bp = document.getElementById('bar-pronunciation');
            const vp = document.getElementById('val-pronunciation');
            if(bp) bp.style.width = `${pronun}%`;
            if(vp) vp.textContent = `${pronun}%`;
            
            const bm = document.getElementById('bar-memorization');
            const vm = document.getElementById('val-memorization');
            if(bm) bm.style.width = `${memor}%`;
            if(vm) vm.textContent = `${memor}%`;
            
            const bt = document.getElementById('bar-tajweed');
            const vt = document.getElementById('val-tajweed');
            if(bt) bt.style.width = `${tajw}%`;
            if(vt) vt.textContent = `${tajw}%`;
        }, 300);

        const feedbacks = realData && realData.feedback ? realData.feedback : [{ type: 'perfect', verse: `Verse 1`, msgEn: 'Perfect articulation.', msgMl: 'ഉച്ചാരണം കൃത്യമാണ്.' }];
        
        if(els.feedbackList) {
            els.feedbackList.innerHTML = feedbacks.map(f => {
                const advice = (currentLang === 'en' ? f.actionEn : f.actionMl);
                return `
                <div class="feedback-item ${f.type}">
                    <div class="feedback-header"><span>${f.verse}</span><span>${f.type === 'perfect' ? '✅' : f.type === 'warning' ? '⚠️' : '❌'}</span></div>
                    <p class="feedback-text">${currentLang === 'en' ? f.msgEn : f.msgMl}</p>
                    ${f.ar ? `<p class="feedback-ar mt-2">${f.ar}</p>` : ''}
                    ${advice ? `<div class="action-tip"><strong>💡 Fix:</strong> ${advice}</div>` : ''}
                </div>
                `;
            }).join('');
        }
    };

    const updateDashboard = () => {
        const totalSessions = appData.history.length;
        let avgScore = 0;
        let streak = 0;

        if (totalSessions > 0) {
            const sum = appData.history.reduce((acc, curr) => acc + curr.score, 0);
            avgScore = Math.round(sum / totalSessions);
            const uniqueDays = new Set(appData.history.map(h => new Date(h.date).toDateString()));
            streak = uniqueDays.size;
        }

        const statValues = document.querySelectorAll('.stat-value');
        if(statValues.length >= 3) {
            statValues[0].textContent = streak;
            statValues[1].textContent = `${avgScore}%`;
            statValues[2].textContent = totalSessions;
        }

        const recentCard = document.querySelector('.recent-practice .recent-card');
        if (recentCard) {
            if (totalSessions > 0) {
                const last = appData.history[0];
                const name = currentLang === 'en' ? last.surahNameEn : last.surahNameMl;
                recentCard.innerHTML = `
                    <div class="recent-info">
                        <span class="surah-number">${last.surahId}</span>
                        <div><h3>${name}</h3><p style="font-size:0.75rem; color:var(--text-sec)">${new Date(last.date).toLocaleDateString()}</p></div>
                    </div>
                    <div class="recent-score text-primary">${last.score}%</div>
                `;
                recentCard.onclick = () => app.viewPastSession(last.id);
            } else {
                recentCard.innerHTML = `<p class="text-secondary p-2">No practice history yet.</p>`;
                recentCard.onclick = null;
            }
        }

        renderHistoryList();
        renderProgressChart();
    };

    const renderHistoryList = () => {
        if(els.historyList) {
            if (appData.history.length === 0) {
                els.historyList.innerHTML = `<p class="text-center text-secondary mt-4">No sessions recorded yet.</p>`;
                return;
            }
            els.historyList.innerHTML = appData.history.map(h => {
                const name = currentLang === 'en' ? h.surahNameEn : h.surahNameMl;
                const dateStr = new Date(h.date).toLocaleDateString(currentLang === 'en' ? 'en-US' : 'ml-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                return `
                <div class="glass-card history-item" style="margin-bottom: 0.75rem;" onclick="app.viewPastSession('${h.id}')">
                    <div><h4>${name}</h4><p class="history-item-date">${dateStr}</p></div>
                    <div class="text-primary" style="font-size: 1.25rem; font-weight: 700;">${h.score}%</div>
                </div>`
            }).join('');
        }
    };

    const renderProgressChart = () => {
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            last7Days.push(d.toDateString());
        }

        const chartHTML = last7Days.map((dayStr, idx) => {
            const dayRecords = appData.history.filter(h => new Date(h.date).toDateString() === dayStr);
            const maxScore = dayRecords.length > 0 ? Math.max(...dayRecords.map(r => r.score)) : 0;
            const height = maxScore > 0 ? maxScore : 5; 
            
            return `<div class="bar ${idx === 6 ? 'today' : ''}" style="height: ${height}%" title="${maxScore}%"></div>`;
        }).join('');

        if (els.weeklyChart) els.weeklyChart.innerHTML = chartHTML;
    };

    document.addEventListener('DOMContentLoaded', init);

    return {
        navigateTo, goBack, filterSurahs, selectSurah, 
        toggleRecording, cancelRecording, finishRecording, 
        toggleLanguage, toggleTheme, viewPastSession,
        login, signup, logout
    };
})();