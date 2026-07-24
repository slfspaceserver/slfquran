/**
 * Quran AI Coach - Complete Updated JS
 * Fixes: Real Backend Errors only (No Fake Scores), iOS Audio Hanging Fixed.
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

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

const app = (() => {
    let currentView = 'home-view';
    let viewHistory = ['home-view'];
    let surahs = []; 
    let selectedSurah = null;
    let recordingTimer = null;
    let seconds = 0;
    let isRecording = false;
    let currentLang = 'en';
    let loadingInterval = null;

    let mediaRecorder = null;
    let audioChunks = [];
    let hasAnimatedDashboard = false; 
    let currentViewDate = new Date();

    let goalAnimFrame = null;
    let goalAnimTimeout = null;

    let appData = {
        history: [],
        theme: 'dark',
        profile: { name: '' },
        goals: { targetSessions: 5 },
        bookmark: null 
    };

    let currentUser = null;

    const els = {
        backBtnContainer: document.getElementById('back-btn-container'), surahList: document.getElementById('surah-list'), surahSearch: document.getElementById('surah-search'),
        recordSurahName: document.getElementById('record-surah-name'), micWaves: document.getElementById('mic-waves'), recordTimer: document.getElementById('record-timer'),
        recordStatus: document.getElementById('record-status'), btnMic: document.getElementById('btn-mic'), resultSurahName: document.getElementById('result-surah-name'),
        feedbackList: document.getElementById('feedback-list'), weeklyChart: document.getElementById('weekly-chart'), langBtn: document.getElementById('lang-btn'),
        historyList: document.getElementById('history-list'), progressDetails: document.getElementById('progress-details'), currentViewDate: document.getElementById('current-view-date'),
        recordingPopup: document.getElementById('recording-popup'), initialLoader: document.getElementById('initial-loader'),
        historySearch: document.getElementById('history-search'), progressSearch: document.getElementById('progress-search'),
        recordActionBar: document.getElementById('record-action-bar'), mainBottomNav: document.getElementById('main-bottom-nav')
    };

    const formatLifetimeTime = (totalSec) => {
        if (!totalSec || totalSec <= 0) return "0m";
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        if (hours > 0) return `${hours}h ${mins}m`;
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
    };

    const updateHeaderProfile = () => {
        const nameDisplay = document.getElementById('header-username-display');
        const avatarDisplay = document.getElementById('header-avatar');
        if (appData.profile && appData.profile.name) {
            const firstName = appData.profile.name.split(' ')[0];
            if(nameDisplay) nameDisplay.textContent = firstName;
            if(avatarDisplay) avatarDisplay.textContent = firstName.charAt(0).toUpperCase();
        } else {
            if(nameDisplay) nameDisplay.textContent = "Profile";
            if(avatarDisplay) avatarDisplay.textContent = "U";
        }
    };

    const showToast = (message) => {
        const toast = document.getElementById('toast-notification');
        if(toast) {
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => { toast.classList.remove('show'); }, 3000);
        }
    };

    const switchProgressTab = (tabName) => {
        document.querySelectorAll('.ptab').forEach(tab => tab.classList.remove('active'));
        const activeTab = document.getElementById(`ptab-${tabName}`);
        if (activeTab) activeTab.classList.add('active');

        const detailsContainer = document.getElementById('progress-details');
        const overviewContent = document.getElementById('progress-overview-content');
        
        if (!detailsContainer || !overviewContent) return;

        if (tabName !== 'overview') {
            overviewContent.style.display = 'none';
        } else {
            overviewContent.style.display = 'block';
        }

        const totalLifetimeSeconds = appData.history.reduce((sum, item) => sum + (item.duration || 0), 0);
        const lifetimeTimeFormatted = formatLifetimeTime(totalLifetimeSeconds);

        if (tabName === 'accuracy') {
            const avg = appData.history.length > 0 ? Math.round(appData.history.reduce((a,b)=>a+b.score,0)/appData.history.length) : 0;
            detailsContainer.innerHTML = `
                <div class="glass-card text-center mt-4" style="padding: 2rem;">
                    <h3>Average Accuracy</h3>
                    <p class="text-primary" style="font-size: 2.5rem; font-weight: 700; margin-top: 10px;">${avg}%</p>
                </div>`;
        } else if (tabName === 'streak') {
            const uniqueDays = new Set(appData.history.map(h => new Date(h.date).toDateString()));
            detailsContainer.innerHTML = `
                <div class="glass-card text-center mt-4" style="padding: 2rem;">
                    <h3>Current Active Streak</h3>
                    <p class="text-accent" style="font-size: 2.5rem; font-weight: 700; margin-top: 10px;">🔥 ${uniqueDays.size} Days</p>
                </div>`;
        } else if (tabName === 'sessions') {
            detailsContainer.innerHTML = `
                <div class="glass-card text-center mt-4" style="padding: 2rem;">
                    <h3>Total Completed Sessions</h3>
                    <p class="text-primary" style="font-size: 2.5rem; font-weight: 700; margin-top: 10px;">🎙️ ${appData.history.length}</p>
                    <p class="text-secondary mt-2" style="font-size:0.9rem;">Lifetime Practice Time: <strong>${lifetimeTimeFormatted}</strong></p>
                </div>`;
        } else {
            updateDateDisplay(); 
        }
    };

    // FIXED: Added timeout so iOS Safari doesn't freeze the app forever
    const checkIfAudioHasSound = (audioBlob) => {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(true), 1500); 
            const reader = new FileReader();
            reader.readAsArrayBuffer(audioBlob);
            reader.onloadend = () => {
                try {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (!AudioContext) {
                        clearTimeout(timeout);
                        return resolve(true);
                    }
                    const audioCtx = new AudioContext();
                    audioCtx.decodeAudioData(reader.result, 
                        (audioBuffer) => {
                            clearTimeout(timeout);
                            const rawData = audioBuffer.getChannelData(0);
                            let sum = 0;
                            for (let i = 0; i < rawData.length; i++) {
                                sum += rawData[i] * rawData[i];
                            }
                            const rms = Math.sqrt(sum / rawData.length);
                            resolve(rms > 0.005);
                        },
                        (err) => {
                            clearTimeout(timeout);
                            resolve(true);
                        }
                    );
                } catch (e) {
                    clearTimeout(timeout);
                    resolve(true); 
                }
            };
        });
    };

    const animateNumber = (element, start, end, duration, suffix = "") => {
        if (!element) return;
        element.textContent = start + suffix;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const currentNumber = Math.floor(progress * (end - start) + start);
            element.textContent = currentNumber + suffix; 
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    };

    const animateGoal = (textEl, barEl, ringEl, endPct, duration) => {
        if (goalAnimFrame) cancelAnimationFrame(goalAnimFrame);
        if (goalAnimTimeout) clearTimeout(goalAnimTimeout);

        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const currentPct = Math.floor(progress * endPct);
            
            if (textEl) textEl.textContent = currentPct + "%";
            if (ringEl) ringEl.style.background = `conic-gradient(var(--primary) ${currentPct}%, rgba(255,255,255,0.05) 0)`;
            
            if (progress < 1) goalAnimFrame = window.requestAnimationFrame(step);
        };
        if (barEl) { 
            barEl.style.transition = 'none'; 
            barEl.style.width = '0%'; 
            goalAnimTimeout = setTimeout(() => { 
                barEl.style.transition = 'width 0.5s ease'; 
                barEl.style.width = `${endPct}%`; 
            }, 50); 
        }
        goalAnimFrame = window.requestAnimationFrame(step);
    };

    const init = () => {
        applyLanguage();
        fetchQuranData(); 
        
        let localDataLoaded = false;

        const cachedHistory = localStorage.getItem('quranCachedHistory');
        if (cachedHistory) {
            try { appData.history = JSON.parse(cachedHistory); localDataLoaded = true; } catch(e) {}
        }

        const cachedBookmark = localStorage.getItem('quranCachedBookmark');
        if (cachedBookmark && cachedBookmark !== "undefined" && cachedBookmark !== "null") {
            try { appData.bookmark = JSON.parse(cachedBookmark); localDataLoaded = true; } catch(e) {}
        }

        if (localDataLoaded) {
            updateDashboard(false); 
        }
        
        auth.onAuthStateChanged(user => {
            if (user) {
                loadUserData(user);
                navigateTo('home-view');
            } else {
                currentUser = null;
                navigateTo('auth-view');
            }
            if(els.initialLoader) els.initialLoader.classList.add('hidden');
        });
    };

    const fetchQuranData = async () => {
        try {
            const res = await fetch('https://api.alquran.cloud/v1/surah');
            const data = await res.json();
            surahs = data.data.map(s => ({
                id: s.number, number: s.number, nameEn: s.englishName, nameAr: s.name, verses: s.numberOfAyahs
            }));
            renderSurahList(surahs);
            generateDailyRecommendation();
            updateDashboard(); 
        } catch (e) { console.error("Failed to load surahs", e); }
    };

    const loadUserData = async (user) => {
        currentUser = user;
        try {
            appData.profile = { name: user.displayName || '' };
            appData.goals = { targetSessions: 5 };
            appData.bookmark = null;
            appData.history = [];
            
            if(document.getElementById('profile-name')) document.getElementById('profile-name').value = '';
            if(document.getElementById('profile-username')) document.getElementById('profile-username').value = '';
            if(document.getElementById('profile-phone')) document.getElementById('profile-phone').value = '';
            
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
                if (userDoc.data().profile) appData.profile = userDoc.data().profile;
                if (userDoc.data().goals) appData.goals = userDoc.data().goals;
                
                if (userDoc.data().bookmark) {
                    appData.bookmark = userDoc.data().bookmark;
                    localStorage.setItem('quranCachedBookmark', JSON.stringify(appData.bookmark));
                } else {
                    localStorage.removeItem('quranCachedBookmark'); 
                }
                
                if(document.getElementById('profile-name')) document.getElementById('profile-name').value = appData.profile.name || '';
                if(document.getElementById('profile-username')) document.getElementById('profile-username').value = appData.profile.username || '';
                if(document.getElementById('profile-phone')) document.getElementById('profile-phone').value = appData.profile.phone || '';
                if(document.getElementById('goal-target-sessions')) document.getElementById('goal-target-sessions').value = appData.goals.targetSessions || 5;
            }
            
            if(document.getElementById('profile-email')) {
                document.getElementById('profile-email').value = user.email || '';
            }

            updateHeaderProfile();

            const localSettings = JSON.parse(localStorage.getItem(`quranTheme_${user.uid}`));
            if (localSettings) appData.theme = localSettings.theme;

            const snapshot = await db.collection('users').doc(user.uid).collection('history').orderBy('date', 'desc').get();
            appData.history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            localStorage.setItem('quranCachedHistory', JSON.stringify(appData.history));

            applyTheme();
            updateDashboard(true); 
        } catch (error) { console.error("Error loading user data:", error); }
    };

    const saveData = async (newEntry = null) => {
        if (!currentUser) return;
        localStorage.setItem(`quranTheme_${currentUser.uid}`, JSON.stringify({ theme: appData.theme }));
        localStorage.setItem('quranCachedHistory', JSON.stringify(appData.history));
        
        if (appData.bookmark) {
            localStorage.setItem('quranCachedBookmark', JSON.stringify(appData.bookmark));
        }
        
        try {
            await db.collection('users').doc(currentUser.uid).set({ bookmark: appData.bookmark }, { merge: true });
            
            if (newEntry) {
                await db.collection('users').doc(currentUser.uid).collection('history').doc(newEntry.id.toString()).set(newEntry);
            }
        } catch (error) { console.error("Error saving data:", error); }
    };

    const logout = () => { 
        localStorage.removeItem('quranCachedHistory');
        localStorage.removeItem('quranCachedBookmark');
        
        appData = {
            history: [],
            theme: 'dark',
            profile: { name: '' },
            goals: { targetSessions: 5 },
            bookmark: null 
        };
        
        updateHeaderProfile();
        const bookmarkSection = document.getElementById('continue-practice-section');
        if(bookmarkSection) bookmarkSection.style.display = 'none';
        
        auth.signOut(); 
    };

    const saveProfile = async () => {
        if(!currentUser) return;
        
        const name = document.getElementById('profile-name').value;
        const username = document.getElementById('profile-username').value;
        const phone = document.getElementById('profile-phone').value;
        const newPassword = document.getElementById('profile-password').value;

        appData.profile = { ...appData.profile, name, username, phone };
        
        try {
            await db.collection('users').doc(currentUser.uid).set({ profile: appData.profile }, { merge: true });
            
            if (newPassword && newPassword.trim() !== '') {
                await currentUser.updatePassword(newPassword);
                document.getElementById('profile-password').value = '';
            }

            updateHeaderProfile();
            showToast(currentLang === 'en' ? "Saved successfully" : "സേവ് ചെയ്തു!");
            
            setTimeout(() => { goBack(); }, 1200);

        } catch(error) { 
            alert("Error saving profile: " + error.message); 
        }
    };

    const saveGoals = async () => {
        if(!currentUser) return;
        const target = parseInt(document.getElementById('goal-target-sessions').value) || 5;
        appData.goals = { targetSessions: target };
        try {
            await db.collection('users').doc(currentUser.uid).set({ goals: appData.goals }, { merge: true });
            showToast(currentLang === 'en' ? "Goals Saved Successfully!" : "ലക്ഷ്യങ്ങൾ സേവ് ചെയ്തു!");
            updateDashboard(true);
            setTimeout(() => { goBack(); }, 1200);
        } catch(error) { alert("Error saving goals."); }
    };

    const i18n = {
        en: {
            app_title: "Quran AI Coach", hero_title: "Practice. Improve.<br><span class='text-primary'>Recite with Confidence.</span>", hero_sub: "Your personal AI-powered Quran recitation assistant.",
            daily_streak: "Daily Streak", avg_accuracy: "Avg Accuracy", sessions: "Sessions", start_practice: "Start Practice", recent_practice: "Recent Practice", see_all: "See All",
            disclaimer: "<strong>Important:</strong> This application is an AI-assisted learning tool intended to support Quran recitation practice. AI feedback may not always be accurate.",
            search_placeholder: "Search Surah...", tap_to_start: "Tap to start", recording: "Recording...", paused: "Paused", cancel: "Cancel", finish: "Finish & Analyze",
            analyzing: "Analyzing your recitation...", step_1: "Processing audio...", step_2: "Converting speech to text...", step_3: "Evaluating Tajweed rules...", step_4: "Generating feedback...",
            analysis_complete: "Analysis Complete", overall_accuracy: "Overall Accuracy", pronunciation: "Pronunciation", memorization: "Memorization", tajweed: "Tajweed",
            detailed_feedback: "Detailed Feedback", done: "Done", progress: "Your Progress", history: "Practice History", settings: "Settings", dark_mode: "Dark Mode",
            nav_home: "Home", nav_progress: "Progress", nav_history: "History", nav_settings: "Settings", verses: "Verses", verse: "Verse", mic_error: "Microphone access denied.",
            recording_in_progress: "Recording in progress...",
            todays_goal: "Today's Goal", completed: "Completed", daily_recommendation: "Daily Recommendation", goals_title: "Goals & Improvement", goals_sub: "Set your daily practice targets to build consistency.", target_sessions: "Daily Target Sessions", save_goals: "Save Goals",
            prev_score: "Last Score", continue_practice: "Continue Practice", last_recited: "Last Recited"
        },
        ml: {
            app_title: "ഖുർആൻ AI കോച്ച്", hero_title: "പരിശീലിക്കുക. മെച്ചപ്പെടുത്തുക.<br><span class='text-primary'>ആത്മവിശ്വാസത്തോടെ പാരായണം ചെയ്യുക.</span>", hero_sub: "നിങ്ങളുടെ സ്വന്തം AI ഖുർആൻ പാരായണ സഹായി.",
            daily_streak: "തുടർച്ചയായ ദിനങ്ങൾ", avg_accuracy: "ശരാശരി കൃത്യത", sessions: "സെഷനുകൾ", start_practice: "പരിശീലനം തുടങ്ങുക", recent_practice: "അവസാനത്തെ പരിശീലനം", see_all: "എല്ലാം കാണുക",
            disclaimer: "<strong>പ്രധാനപ്പെട്ടത്:</strong> ഇതൊരു AI സഹായത്തോടെ പ്രവർത്തിക്കുന്ന പഠന സഹായിയാണ്. ഖുർആൻ അധ്യാപകനുമായി നിങ്ങളുടെ പാരായണം എപ്പോഴും പരിശോധിക്കുക.",
            search_placeholder: "സൂറത്ത് തിരയുക...", tap_to_start: "തുടങ്ങാൻ ടാപ്പ് ചെയ്യുക", recording: "റെക്കോർഡ് ചെയ്യുന്നു...", paused: "നിർത്തിവെച്ചിരിക്കുന്നു", cancel: "റദ്ദാക്കുക", finish: "പൂർത്തിയാക്കി പരിശോധിക്കുക",
            analyzing: "നിങ്ങളുടെ പാരായണം പരിശോധിക്കുന്നു...", step_1: "ശബ്ദം പരിശോധിക്കുന്നു...", step_2: "വാക്കുകൾ വേർതിരിക്കുന്നു...", step_3: "തജ്‌വീദ് നിയമങ്ങൾ പരിശോധിക്കുന്നു...", step_4: "ഫീഡ്‌ബാക്ക് തയ്യാറാക്കുന്നു...",
            analysis_complete: "പരിശോധന പൂർത്തിയായി", overall_accuracy: "മൊത്തത്തിലുള്ള കൃത്യത", pronunciation: "ഉച്ചാരണം", memorization: "മനഃപാഠം", tajweed: "തജ്‌വീദ്",
            detailed_feedback: "വിശദമായ ഫീഡ്‌ബാക്ക്", done: "പൂർത്തിയായി", progress: "നിങ്ങളുടെ പുരോഗതി", history: "പരിശീലന ചരിത്രം", settings: "ക്രമീകരണങ്ങൾ", dark_mode: "ഡാർക്ക് മോഡ്",
            nav_home: "ഹോം", nav_progress: "പുരോഗതി", nav_history: "ചരിത്രം", nav_settings: "ക്രമീകരണങ്ങൾ", verses: "വരികൾ", verse: "വരി", mic_error: "മൈക്രോഫോൺ ഉപയോഗിക്കാൻ അനുമതിയില്ല.",
            recording_in_progress: "റെക്കോർഡിംഗ് നടക്കുന്നു...",
            todays_goal: "ഇന്നത്തെ ലക്ഷ്യം", completed: "പൂർത്തിയായി", daily_recommendation: "ഇന്നത്തെ നിർദ്ദേശം", goals_title: "ലക്ഷ്യങ്ങളും പുരോഗതിയും", goals_sub: "തുടർച്ചയായ പരിശീലനത്തിനായി ലക്ഷ്യങ്ങൾ ക്രമീകരിക്കുക.", target_sessions: "പ്രതിദിന ലക്ഷ്യം (സെഷനുകൾ)", save_goals: "ലക്ഷ്യങ്ങൾ സേവ് ചെയ്യുക",
            prev_score: "മുൻപത്തെ സ്കോർ", continue_practice: "തുടർന്നു വായിക്കുക", last_recited: "അവസാനം വായിച്ചത്"
        }
    };

    const switchAuth = (mode) => {
        if(mode === 'login') {
            document.getElementById('login-form').classList.remove('hidden');
            document.getElementById('signup-form').classList.add('hidden');
            document.getElementById('tab-login').classList.add('active');
            document.getElementById('tab-signup').classList.remove('active');
        } else {
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('signup-form').classList.remove('hidden');
            document.getElementById('tab-login').classList.remove('active');
            document.getElementById('tab-signup').classList.add('active');
        }
    };

    const signup = async () => { 
        const n = document.getElementById('signup-name').value;
        const e = document.getElementById('signup-email').value; 
        const p = document.getElementById('signup-password').value; 
        if(!n || !e || !p) { alert("Please fill all fields."); return; }
        try { 
            const cred = await auth.createUserWithEmailAndPassword(e, p); 
            await db.collection('users').doc(cred.user.uid).set({ profile: { name: n } }, { merge: true });
            appData.profile.name = n;
        } catch(err) { alert(err.message); } 
    };

    const login = async () => { 
        const e = document.getElementById('login-email').value; 
        const p = document.getElementById('login-password').value; 
        try { await auth.signInWithEmailAndPassword(e, p); } catch(err) { alert(err.message); } 
    };

    const googleLogin = async () => {
        try {
            const result = await auth.signInWithPopup(googleProvider);
            const userDoc = await db.collection('users').doc(result.user.uid).get();
            if (!userDoc.exists || !userDoc.data().profile || !userDoc.data().profile.name) {
                await db.collection('users').doc(result.user.uid).set({ profile: { name: result.user.displayName } }, { merge: true });
                appData.profile.name = result.user.displayName;
            }
        } catch(err) { alert(err.message); }
    };

    const toggleLanguage = () => {
        currentLang = currentLang === 'en' ? 'ml' : 'en';
        els.langBtn.textContent = currentLang === 'en' ? 'മലയാളം' : 'English';
        applyLanguage();
        renderSurahList(surahs);
        updateDashboard(false); 
        updateDateDisplay();
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

    const toggleTheme = () => { appData.theme = appData.theme === 'dark' ? 'light' : 'dark'; saveData(); applyTheme(); };
    const applyTheme = () => {
        const toggleBtn = document.querySelector('.toggle');
        if (appData.theme === 'light') { document.body.classList.add('light-mode'); if(toggleBtn) toggleBtn.classList.remove('active'); } 
        else { document.body.classList.remove('light-mode'); if(toggleBtn) toggleBtn.classList.add('active'); }
    };

    const navigateTo = (viewId, event = null, isBack = false) => {
        if (event) event.preventDefault();
        
        if (viewId !== 'analysis-view') {
            stopLoadingAnimation();
        }
        
        if (viewId === 'auth-view') document.body.classList.add('on-auth');
        else document.body.classList.remove('on-auth');

        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.remove('active');
            if (el.dataset.target === viewId) el.classList.add('active');
        });
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        
        const targetView = document.getElementById(viewId);
        if (targetView) targetView.classList.add('active');

        window.scrollTo(0, 0);

        if (['home-view', 'progress-view', 'history-view', 'settings-view', 'surah-view'].includes(viewId)) {
            if (els.mainBottomNav) els.mainBottomNav.style.display = 'flex';
        } else {
            if (els.mainBottomNav) els.mainBottomNav.style.display = 'none';
        }

        if (['home-view', 'progress-view', 'history-view', 'settings-view'].includes(viewId)) {
            if(els.backBtnContainer) els.backBtnContainer.style.display = 'none';
            if(document.getElementById('header-profile-pill')) document.getElementById('header-profile-pill').style.display = 'flex';
        } else {
            if(els.backBtnContainer) els.backBtnContainer.style.display = 'block';
            if(document.getElementById('header-profile-pill')) document.getElementById('header-profile-pill').style.display = 'none';
        }

        if (viewId === 'record-view') {
            if (els.recordActionBar) els.recordActionBar.style.display = 'flex';
        } else {
            if (els.recordActionBar) els.recordActionBar.style.display = 'none';
        }

        if (viewId !== currentView) {
            if (['home-view', 'progress-view', 'history-view', 'settings-view'].includes(viewId)) {
                viewHistory = [viewId]; 
            } else if (!isBack) {
                viewHistory.push(viewId); 
            }

            if(viewId === 'home-view') {
                updateDashboard(true); 
            } else if(viewId === 'history-view') {
                updateDashboard(false);
            } else if(viewId === 'progress-view') { 
                updateDashboard(false); 
                updateDateDisplay(); 
            } else if(viewId === 'surah-view') {
                renderSurahList(surahs);
            }
        }
        currentView = viewId;
    };

    const goBack = () => {
        if (viewHistory.length > 1) {
            viewHistory.pop(); 
            if (viewHistory[viewHistory.length - 1] === 'analysis-view') {
                viewHistory.pop();
            }
            const previousView = viewHistory[viewHistory.length - 1];
            if (currentView === 'result-view' || currentView === 'record-view') {
                resetRecording();
            }
            navigateTo(previousView, null, true); 
        }
    };

    const renderSurahList = (data) => {
        if(els.surahList) {
            if (!data || data.length === 0) {
                els.surahList.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-sec);">Loading Quran data...</div>`;
                return;
            }

            const verseText = i18n[currentLang].verses;
            els.surahList.innerHTML = data.map(s => {
                const displayName = currentLang === 'en' ? s.nameEn : (s.nameMl || s.nameEn);
                
                const lastSession = appData.history.find(h => h.surahId === s.id);
                const scoreBadge = lastSession 
                    ? `<span style="background: rgba(0, 230, 184, 0.15); color: var(--primary); font-weight:700; font-size:0.85rem; padding: 4px 8px; border-radius: 8px;">${lastSession.score}%</span>` 
                    : ``;

                return `
                <div class="surah-item glass-card" onclick="app.selectSurah(${s.id})">
                    <div class="recent-info">
                        <span class="surah-number">${s.number}</span>
                        <div>
                            <h3>${displayName}</h3>
                            <p>${s.verses} ${verseText}</p>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap: 10px;">
                        ${scoreBadge}
                        <div class="surah-item-ar">${s.nameAr}</div>
                    </div>
                </div>`;
            }).join('');
        }
    };

    const filterSurahs = () => {
        const query = els.surahSearch.value.toLowerCase();
        const filtered = surahs.filter(s => s.nameEn.toLowerCase().includes(query) || (s.nameMl && s.nameMl.includes(query)) || s.number.toString().includes(query));
        renderSurahList(filtered);
    };

    const toArabicNumeral = (n) => n.toString().replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

    const resumeBookmark = () => {
        if (appData.bookmark && appData.bookmark.surahId) {
            selectSurah(appData.bookmark.surahId, appData.bookmark.verse);
        }
    };

    const selectSurah = async (id, targetVerse = null) => {
        if(els.initialLoader) els.initialLoader.classList.remove('hidden');
        selectedSurah = surahs.find(s => s.id === id);
        
        try {
            const res = await fetch(`https://api.alquran.cloud/v1/surah/${id}/quran-uthmani`);
            const data = await res.json();
            
            const isFatiha = id === 1;
            const isTawbah = id === 9;

            const bismillahEl = document.getElementById('practice-bismillah');
            if (bismillahEl) {
                bismillahEl.style.display = (isFatiha || isTawbah) ? 'none' : 'block';
            }

            const ayahText = data.data.ayahs.map((a, index) => {
                let cleanText = a.text;
                if (index === 0 && !isFatiha && !isTawbah) {
                    cleanText = cleanText.replace(/^بِسْمِ\s+ٱللَّهِ\s+ٱلرَّحْمَٰنِ\s+ٱلرَّحِيمِ\s*/, '')
                                         .replace(/^بِسْمِ\s+اللَّهِ\s+الرَّحْمَٰنِ\s+الرَّحِيمِ\s*/, '');
                }
                return `<span id="verse-${a.numberInSurah}" style="border-radius: 8px; transition: background-color 1s ease;">${cleanText} <span style="color:var(--primary);">﴿${toArabicNumeral(a.numberInSurah)}﴾</span></span>`;
            }).join(' &nbsp; ');

            document.getElementById('record-surah-text').innerHTML = ayahText;
            
            const lastSession = appData.history.find(h => h.surahId === id);
            const prevScoreText = lastSession 
                ? ` • ${i18n[currentLang].prev_score}: ${lastSession.score}%` 
                : '';

            els.recordSurahName.textContent = currentLang === 'en' ? selectedSurah.nameEn : (selectedSurah.nameMl || selectedSurah.nameEn);
            document.getElementById('record-surah-meta').textContent = `${data.data.numberOfAyahs} ${i18n[currentLang].verses}${prevScoreText}`;

            resetRecording();
            if(els.initialLoader) els.initialLoader.classList.add('hidden');
            navigateTo('record-view');

            if (targetVerse) {
                setTimeout(() => {
                    const targetEl = document.getElementById(`verse-${targetVerse}`);
                    if (targetEl) {
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        targetEl.style.backgroundColor = 'rgba(15, 174, 150, 0.25)';
                        setTimeout(() => {
                            targetEl.style.backgroundColor = 'transparent';
                        }, 2000);
                    }
                }, 400); 
            }

        } catch(e) {
            if(els.initialLoader) els.initialLoader.classList.add('hidden');
            alert("Error loading Surah text from API.");
        }
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
        els.btnMic.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
        els.recordStatus.textContent = i18n[currentLang].tap_to_start;
        els.recordStatus.classList.add('stopped');
        if (els.recordingPopup) els.recordingPopup.classList.add('hidden');
    };

    const toggleRecording = async () => {
        if (isRecording) {
            clearInterval(recordingTimer);
            isRecording = false;
            if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.pause();
            els.micWaves.classList.remove('active');
            els.btnMic.classList.remove('active');
            els.btnMic.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
            els.recordStatus.textContent = i18n[currentLang].paused;
            els.recordStatus.classList.add('stopped');
            if (els.recordingPopup) els.recordingPopup.classList.add('hidden');
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
            if (els.recordingPopup) els.recordingPopup.classList.remove('hidden');
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
        if(loadingInterval) clearInterval(loadingInterval);
        const steps = document.querySelectorAll('.analysis-steps .step');
        steps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); });
    };

    // --- FIX: NO MORE FAKE SCORES. STRICT ERROR HANDLING ---
    const finishRecording = () => {
        if (seconds === 0) {
            cancelRecording();
            return;
        }
        clearInterval(recordingTimer);
        const recordingDuration = seconds; 
        if (els.recordingPopup) els.recordingPopup.classList.add('hidden');

        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                
                if(els.initialLoader) els.initialLoader.classList.remove('hidden');
                const hasSound = await checkIfAudioHasSound(audioBlob);
                if(els.initialLoader) els.initialLoader.classList.add('hidden');
                
                if (!hasSound) {
                    alert(currentLang === 'en' ? "⚠️ No voice detected! Please speak clearly into the microphone and try again." : "⚠️ ശബ്ദം കേൾക്കാൻ കഴിയുന്നില്ല! വ്യക്തമായി സംസാരിച്ച് വീണ്ടും ശ്രമിക്കുക.");
                    resetRecording();
                    goBack(); 
                    return; 
                }

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
                    generateAIResults(aiResult.data, recordingDuration);
                    navigateTo('result-view');
                } catch (error) {
                    console.error("Failed to send audio to backend:", error);
                    stopLoadingAnimation();
                    // SHOW ERROR ALERT INSTEAD OF FAKE RESULTS
                    alert(currentLang === 'en' ? "Server timeout or AI connection error. Please try again." : "സെർവർ എറർ. ദയവായി വീണ്ടും ശ്രമിക്കുക.");
                    resetRecording();
                    goBack();
                }
            };
            mediaRecorder.stop();
        } else {
            resetRecording();
            goBack();
        }
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
            generateAIResults(historicalData, session.duration || 0);
            navigateTo('result-view');
        }
    };

    const generateAIResults = (realData = null, recDuration = 0) => {
        els.resultSurahName.textContent = selectedSurah ? (currentLang === 'en' ? selectedSurah.nameEn : (selectedSurah.nameMl || selectedSurah.nameEn)) : "Practice Session";

        const overall = realData ? realData.overallScore : 0;
        const pronun = realData ? realData.pronunciation : 0;
        const memor = realData ? realData.memorization : 0;
        const tajw = realData ? realData.tajweed : 0;

        let lastVerseRecited = 1;
        if (realData && realData.feedback && realData.feedback.length > 0) {
            const verses = realData.feedback.map(f => parseInt(f.verse.replace(/\D/g, ''))).filter(v => !isNaN(v));
            if (verses.length > 0) lastVerseRecited = Math.max(...verses);
        }

        if(selectedSurah && (!realData || !realData.isHistory)) {
            const newEntry = {
                id: Date.now(),
                surahId: selectedSurah.id,
                surahNameEn: selectedSurah.nameEn,
                surahNameMl: selectedSurah.nameMl || selectedSurah.nameEn,
                score: overall,
                duration: recDuration, 
                date: new Date().toISOString(),
                fullData: realData
            };
            appData.history.unshift(newEntry);
            
            appData.bookmark = { 
                surahId: selectedSurah.id, 
                verse: lastVerseRecited,
                nameEn: selectedSurah.nameEn,
                nameMl: selectedSurah.nameMl || selectedSurah.nameEn
            };
            saveData(newEntry); 
            renderSurahList(surahs); 
        }

        const overallTextElement = document.getElementById('score-overall-text');
        if(overallTextElement) {
            animateNumber(overallTextElement, 0, overall, 1200, "%");
        }
        
        const circle = document.querySelector('.circle-value');
        if(circle) {
            circle.style.strokeDasharray = `${overall}, 100`;
            circle.style.stroke = overall >= 90 ? 'var(--primary)' : 'var(--accent)';
        }

        setTimeout(() => {
            const bp = document.getElementById('bar-pronunciation');
            const vp = document.getElementById('val-pronunciation');
            if(bp) bp.style.width = `${pronun}%`;
            if(vp) animateNumber(vp, 0, pronun, 1200, "%");
            
            const bm = document.getElementById('bar-memorization');
            const vm = document.getElementById('val-memorization');
            if(bm) bm.style.width = `${memor}%`;
            if(vm) animateNumber(vm, 0, memor, 1200, "%");
            
            const bt = document.getElementById('bar-tajweed');
            const vt = document.getElementById('val-tajweed');
            if(bt) bt.style.width = `${tajw}%`;
            if(vt) animateNumber(vt, 0, tajw, 1200, "%");
        }, 300);

        const feedbacks = realData && realData.feedback ? realData.feedback : [{ type: 'error', verse: `System`, msgEn: 'No valid data returned.', msgMl: 'ഡാറ്റ ലഭ്യമല്ല.' }];
        
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

    const generateDailyRecommendation = () => {
        if (!surahs.length) return;
        
        const recNameEl = document.getElementById('rec-surah-name');
        const recReasonEl = document.getElementById('rec-surah-reason');
        const recCard = document.getElementById('rec-card');
        
        const weakSession = appData.history.find(h => h.score < 85);
        let recommendedSurah;
        let reasonTextEn = "";
        let reasonTextMl = "";

        if (weakSession) {
            recommendedSurah = surahs.find(s => s.id === weakSession.surahId);
            reasonTextEn = `Improve your ${weakSession.score}% accuracy`;
            reasonTextMl = `നിങ്ങളുടെ ${weakSession.score}% കൃത്യത മെച്ചപ്പെടുത്തുക`;
        } else {
            const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
            const surahIndex = dayOfYear % surahs.length;
            recommendedSurah = surahs[surahIndex];
            reasonTextEn = "Daily suggested practice";
            reasonTextMl = "ഇന്നത്തെ പരിശീലന നിർദ്ദേശം";
        }

        if (recommendedSurah && recNameEl && recReasonEl && recCard) {
            const displayName = currentLang === 'en' ? recommendedSurah.nameEn : (recommendedSurah.nameMl || recommendedSurah.nameEn);
            recNameEl.textContent = displayName;
            recReasonEl.textContent = currentLang === 'en' ? reasonTextEn : reasonTextMl;
            recCard.onclick = () => selectSurah(recommendedSurah.id);
        }
    };

    const updateDashboard = (animate = false) => {
        
        const bookmarkSection = document.getElementById('continue-practice-section');
        const bookmarkName = document.getElementById('bookmark-surah-name');
        
        if (bookmarkSection && bookmarkName && appData.bookmark && appData.bookmark.surahId) {
            let bName = currentLang === 'en' ? "Surah" : "സൂറത്ത്";
            
            if (appData.bookmark.nameEn) {
                bName = currentLang === 'en' ? appData.bookmark.nameEn : (appData.bookmark.nameMl || appData.bookmark.nameEn);
            } else if (surahs.length > 0) {
                const bSurah = surahs.find(s => s.id === appData.bookmark.surahId);
                if (bSurah) bName = currentLang === 'en' ? bSurah.nameEn : (bSurah.nameMl || bSurah.nameEn);
            }

            if (bName !== "Surah" || surahs.length > 0) {
                const verseLabel = currentLang === 'en' ? 'Verse' : 'വരി';
                bookmarkName.textContent = `${bName} • ${verseLabel} ${appData.bookmark.verse || 1}`;
                bookmarkSection.style.display = 'block';
            }
        } else if (bookmarkSection) {
            bookmarkSection.style.display = 'none';
        }

        const todayStr = new Date().toDateString();
        const todaySessions = appData.history.filter(h => new Date(h.date).toDateString() === todayStr).length;
        const targetSessions = appData.goals ? appData.goals.targetSessions : 5;
        const progressPct = Math.min(Math.round((todaySessions / targetSessions) * 100), 100);

        const goalTextEl = document.getElementById('goal-progress-text');
        const goalBarEl = document.getElementById('goal-bar-fill');
        const goalRingEl = document.getElementById('goal-ring');
        const goalRingTextEl = document.getElementById('goal-ring-text');

        if (goalTextEl) goalTextEl.innerHTML = `${todaySessions} / ${targetSessions} <span class="text-secondary" style="font-size:0.8rem; font-weight:normal;">Sessions</span>`;
        
        if (animate) {
            animateGoal(goalRingTextEl, goalBarEl, goalRingEl, progressPct, 1200);
        } else {
            if (goalRingTextEl) goalRingTextEl.textContent = `${progressPct}%`;
            if (goalBarEl) { goalBarEl.style.transition = 'none'; goalBarEl.style.width = `${progressPct}%`; }
            if (goalRingEl) goalRingEl.style.background = `conic-gradient(var(--primary) ${progressPct}%, rgba(255,255,255,0.05) 0)`;
        }

        generateDailyRecommendation();

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
            if (animate) {
                animateNumber(statValues[0], 0, streak, 1200, ""); 
                animateNumber(statValues[1], 0, avgScore, 1200, "%"); 
                animateNumber(statValues[2], 0, totalSessions, 1200, ""); 
            } else {
                statValues[0].textContent = streak;
                statValues[1].textContent = `${avgScore}%`;
                statValues[2].textContent = totalSessions;
            }
        }

        const recentCard = document.querySelector('.recent-practice .recent-card');
        if (recentCard) {
            if (totalSessions > 0) {
                const last = appData.history[0];
                const name = currentLang === 'en' ? last.surahNameEn : (last.surahNameMl || last.surahNameEn);
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

        renderHistoryList(appData.history);
        renderProgressChart();
    };

    const filterHistory = () => {
        if(!els.historySearch) return;
        const query = els.historySearch.value.toLowerCase();
        const filtered = appData.history.filter(h => 
            h.surahNameEn.toLowerCase().includes(query) || 
            (h.surahNameMl && h.surahNameMl.includes(query))
        );
        renderHistoryList(filtered);
    };

    const renderHistoryList = (dataList) => {
        if(els.historyList) {
            if (dataList.length === 0) {
                els.historyList.innerHTML = `<p class="text-center text-secondary mt-4">No sessions recorded yet.</p>`;
                return;
            }
            els.historyList.innerHTML = dataList.map(h => {
                const name = currentLang === 'en' ? h.surahNameEn : (h.surahNameMl || h.surahNameEn);
                const dateStr = new Date(h.date).toLocaleDateString(currentLang === 'en' ? 'en-US' : 'ml-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const durFormatted = formatLifetimeTime(h.duration || 0);

                return `
                <div class="glass-card history-item" style="margin-bottom: 0.75rem;" onclick="app.viewPastSession('${h.id}')">
                    <div>
                        <h4>${name}</h4>
                        <p class="history-item-date">${dateStr} • ⏱️ ${durFormatted}</p>
                    </div>
                    <div class="text-primary" style="font-size: 1.25rem; font-weight: 700;">${h.score}%</div>
                </div>`;
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

    const filterProgress = () => {
        if(!els.progressSearch) return;
        const query = els.progressSearch.value.toLowerCase();
        const dateStr = currentViewDate.toDateString();
        const dayRecords = appData.history.filter(h => new Date(h.date).toDateString() === dateStr);
        const filtered = dayRecords.filter(h => 
            h.surahNameEn.toLowerCase().includes(query) || 
            (h.surahNameMl && h.surahNameMl.includes(query))
        );
        renderProgressDetails(filtered);
    };

    const updateDateDisplay = () => {
        if (!els.currentViewDate || !els.progressDetails) return;
        const isToday = new Date().toDateString() === currentViewDate.toDateString();
        els.currentViewDate.textContent = isToday ? (currentLang === 'en' ? 'Today' : 'ഇന്ന്') : currentViewDate.toLocaleDateString(currentLang === 'en' ? 'en-US' : 'ml-IN', { month: 'short', day: 'numeric', year: 'numeric' });

        if (els.customDatePicker) {
            const tzOffset = currentViewDate.getTimezoneOffset() * 60000;
            const localISOTime = (new Date(currentViewDate - tzOffset)).toISOString().split('T')[0];
            els.customDatePicker.value = localISOTime;
        }

        const dateStr = currentViewDate.toDateString();
        const dayRecords = appData.history.filter(h => new Date(h.date).toDateString() === dateStr);
        renderProgressDetails(dayRecords);
        if (els.progressSearch) els.progressSearch.value = ""; 
    };

    const renderProgressDetails = (records) => {
        if (records.length === 0) {
            els.progressDetails.innerHTML = `<p class="text-center text-secondary mt-2">${currentLang === 'en' ? 'No practice data for this date.' : 'ഈ തീയതിയിൽ പരിശീലന വിവരങ്ങളില്ല.'}</p>`;
            return;
        }

        const dayTotalSec = records.reduce((sum, item) => sum + (item.duration || 0), 0);
        const dayFormattedTime = formatLifetimeTime(dayTotalSec);

        const summaryHeader = `
            <div class="glass-card mb-3" style="padding: 12px 15px; display:flex; justify-content:space-between; align-items:center;">
                <span class="text-secondary" style="font-size:0.85rem;">Date Recited Time</span>
                <span class="text-primary" style="font-weight:700; font-size:1rem;">⏱️ ${dayFormattedTime}</span>
            </div>`;

        const listHTML = records.map(h => {
            const name = currentLang === 'en' ? h.surahNameEn : (h.surahNameMl || h.surahNameEn);
            const timeStr = new Date(h.date).toLocaleTimeString(currentLang === 'en' ? 'en-US' : 'ml-IN', { hour: '2-digit', minute: '2-digit' });
            const sessionDuration = formatLifetimeTime(h.duration || 0);

            return `
            <div class="glass-card history-item" style="margin-bottom: 0.75rem;" onclick="app.viewPastSession('${h.id}')">
                <div>
                    <h4>${name}</h4>
                    <p class="history-item-date">${timeStr} • ⏱️ ${sessionDuration}</p>
                </div>
                <div class="text-primary" style="font-size: 1.25rem; font-weight: 700;">${h.score}%</div>
            </div>`;
        }).join('');

        els.progressDetails.innerHTML = summaryHeader + listHTML;
    };

    const changeDate = (days) => {
        const targetDate = new Date(currentViewDate);
        targetDate.setDate(targetDate.getDate() + days);
        targetDate.setHours(0,0,0,0);
        const today = new Date();
        today.setHours(0,0,0,0);

        if (days > 0 && targetDate > today) {
            alert(currentLang === 'en' ? "Cannot view future dates." : "ഭാവിയിലെ തീയതികൾ കാണാൻ കഴിയില്ല.");
            return;
        }

        if (days < 0 && appData.history.length > 0) {
            const oldestDate = new Date(appData.history[appData.history.length - 1].date);
            oldestDate.setHours(0,0,0,0);
            if (targetDate < oldestDate) {
                alert(currentLang === 'en' ? "No practice history before this date." : "ഇതിന് മുൻപ് പരിശീലന ചരിത്രമില്ല.");
                return;
            }
        } else if (days < 0 && appData.history.length === 0) {
             alert(currentLang === 'en' ? "No practice history yet." : "പരിശീലന ചരിത്രമില്ല.");
             return;
        }

        currentViewDate = targetDate;
        updateDateDisplay();
    };

    const selectCustomDate = (dateStr) => {
        if(!dateStr) return;
        currentViewDate = new Date(dateStr);
        updateDateDisplay();
    };

    document.addEventListener('DOMContentLoaded', init);

    return {
        navigateTo, goBack, filterSurahs, filterHistory, filterProgress, selectSurah, 
        toggleRecording, cancelRecording, finishRecording, saveProfile, saveGoals,
        toggleLanguage, toggleTheme, viewPastSession, switchAuth, googleLogin, resumeBookmark,
        login, signup, logout, changeDate, selectCustomDate, switchProgressTab
    };
})();