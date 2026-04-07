let vietnameseDict = {};
let isDictionaryReady = false;
let lastRenderedWord = "";
let lastDetectedSource = "";
let isUpdating = false;
let lastUpdateAt = 0;
let lastHeavyScanAt = 0;
const learnedHardWords = new Set();
const killerWords = new Set();
let killerWordCounts = {};
let learnedDictionary = {};
let opponentProfiles = {};
let currentOpponentName = '';
let opponentRecentWordState = {};
let latestDetectedWord = "";
let lastLossStateAt = 0;
let lastLossWord = "";
let lastLossWordAt = 0;
let isHomeReviewMode = false;
let nonGameDetectStreak = 0;
let currentMatchOpponentWords = {};
let currentMatchMyWords = {};
let recentLossTopWords = [];
let recentWinTopWords = [];
let recentLossWordSet = new Set();
let recentWinWordSet = new Set();
let lastMatchResultAt = 0;
let isInputTrackingAttached = false;
const HELPER_COLLAPSE_KEY = 'noitu_helper_collapsed';

const TRUSTED_LEARN_SOURCES = new Set(['known-selectors', 'recent-chips']);
const ALLOW_INPUT_FALLBACK_DETECTION = false;
const NON_GAME_STREAK_THRESHOLD = 3;
const MATCH_RESULT_COOLDOWN_MS = 9000;
const BLOCKED_UI_TOKENS = new Set([
    'đấu', 'xếp', 'hạng', 'rank', 'leaderboard', 'ngẫu', 'nhiên', 'mở', 'rộng',
    'chữ', 'nghĩa', 'copy', 'link', 'tháng', 'này', 'vị', 'trí', 'thắng', 'điểm'
]);

function loadLearnedState() {
    try {
        const rawHard = localStorage.getItem('noitu_learned_hard_words');
        const rawKiller = localStorage.getItem('noitu_killer_words');
        const rawKillerCounts = localStorage.getItem('noitu_killer_word_counts');
        const rawDict = localStorage.getItem('noitu_learned_dictionary');
        const rawOppProfiles = localStorage.getItem('noitu_opponent_profiles');
        const rawCurrentOpponent = localStorage.getItem('noitu_current_opponent');
        const rawRecentLoss = localStorage.getItem('noitu_recent_loss_top_words');
        const rawRecentWin = localStorage.getItem('noitu_recent_win_top_words');

        const hardList = rawHard ? JSON.parse(rawHard) : [];
        const killerList = rawKiller ? JSON.parse(rawKiller) : [];
        const killerCountsObj = rawKillerCounts ? JSON.parse(rawKillerCounts) : {};
        const dictObj = rawDict ? JSON.parse(rawDict) : {};
        const opponentObj = rawOppProfiles ? JSON.parse(rawOppProfiles) : {};
        const recentLossList = rawRecentLoss ? JSON.parse(rawRecentLoss) : [];
        const recentWinList = rawRecentWin ? JSON.parse(rawRecentWin) : [];

        hardList.forEach(w => {
            const n = normalizeText(w);
            if (n) learnedHardWords.add(n);
        });

        killerList.forEach(w => {
            const n = normalizeText(w);
            if (n) killerWords.add(n);
        });

        killerWordCounts = killerCountsObj && typeof killerCountsObj === 'object' ? killerCountsObj : {};

        learnedDictionary = dictObj && typeof dictObj === 'object' ? dictObj : {};
        opponentProfiles = opponentObj && typeof opponentObj === 'object' ? opponentObj : {};
        recentLossTopWords = Array.isArray(recentLossList) ? recentLossList.map(normalizeText).filter(Boolean) : [];
        recentWinTopWords = Array.isArray(recentWinList) ? recentWinList.map(normalizeText).filter(Boolean) : [];
        refreshRecentWordSets();
        currentOpponentName = normalizePlayerName(rawCurrentOpponent || '');
        sanitizeLearnedData();
    } catch (err) {
        console.warn('Không tải được dữ liệu từ đã học:', err);
        killerWordCounts = {};
        learnedDictionary = {};
        opponentProfiles = {};
        recentLossTopWords = [];
        recentWinTopWords = [];
        refreshRecentWordSets();
        currentOpponentName = '';
    }
}

function refreshRecentWordSets() {
    recentLossWordSet = new Set((recentLossTopWords || []).map(normalizeText).filter(Boolean));
    recentWinWordSet = new Set((recentWinTopWords || []).map(normalizeText).filter(Boolean));
}

function getTopWordsFromCounter(counterObj, limit = 6) {
    return Object.entries(counterObj || {})
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
        .slice(0, limit)
        .map(([word]) => normalizeText(word))
        .filter(Boolean);
}

function resetCurrentMatchTracking() {
    currentMatchOpponentWords = {};
    currentMatchMyWords = {};
}

function isUiNoiseWord(rawWord) {
    const normalized = normalizeText(rawWord);
    if (!normalized) return true;

    const tokens = normalized.split(' ').filter(Boolean);
    if (tokens.length === 0) return true;

    // Nếu cụm dài và phần lớn là token UI thì bỏ.
    // Không áp điều kiện này cho cụm 2 từ để tránh chặn nhầm từ hợp lệ như "này nọ".
    const blockedCount = tokens.filter(t => BLOCKED_UI_TOKENS.has(t)).length;
    if (tokens.length >= 3 && blockedCount >= Math.ceil(tokens.length / 2)) return true;

    // Chặn một số cụm đặc trưng của trang chủ/xếp hạng.
    if (/đấu xếp hạng|xếp hạng|đấu rank|copy link|ngẫu nhiên|mở rộng|chữ nghĩa/.test(normalized)) {
        return true;
    }

    return false;
}

function sanitizeLearnedData() {
    let changed = false;

    for (const word of Array.from(killerWords)) {
        if (isUiNoiseWord(word)) {
            killerWords.delete(word);
            delete killerWordCounts[word];
            changed = true;
        }
    }

    Object.keys(learnedDictionary || {}).forEach(key => {
        const filtered = (learnedDictionary[key] || []).filter(w => !isUiNoiseWord(w));
        if (filtered.length !== (learnedDictionary[key] || []).length) {
            changed = true;
        }

        if (filtered.length === 0) {
            delete learnedDictionary[key];
            changed = true;
        } else {
            learnedDictionary[key] = filtered;
        }
    });

    Object.keys(killerWordCounts || {}).forEach(word => {
        if (isUiNoiseWord(word)) {
            delete killerWordCounts[word];
            changed = true;
        }
    });

    if (changed) {
        persistLearnedState();
    }
}

function persistLearnedState() {
    try {
        localStorage.setItem('noitu_learned_hard_words', JSON.stringify(Array.from(learnedHardWords)));
        localStorage.setItem('noitu_killer_words', JSON.stringify(Array.from(killerWords)));
        localStorage.setItem('noitu_killer_word_counts', JSON.stringify(killerWordCounts));
        localStorage.setItem('noitu_learned_dictionary', JSON.stringify(learnedDictionary));
        localStorage.setItem('noitu_opponent_profiles', JSON.stringify(opponentProfiles));
        localStorage.setItem('noitu_current_opponent', currentOpponentName || '');
        localStorage.setItem('noitu_recent_loss_top_words', JSON.stringify(recentLossTopWords));
        localStorage.setItem('noitu_recent_win_top_words', JSON.stringify(recentWinTopWords));
    } catch (err) {
        console.warn('Không lưu được dữ liệu từ đã học:', err);
    }
}

function mergeLearnedDictionaryIntoMainDict() {
    const keys = Object.keys(learnedDictionary || {});
    keys.forEach(key => {
        if (!vietnameseDict[key]) vietnameseDict[key] = [];
        learnedDictionary[key].forEach(word => {
            if (!vietnameseDict[key].includes(word)) {
                vietnameseDict[key].push(word);
            }
        });
    });
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getNextKey(text) {
    const normalized = normalizeText(text);
    if (!normalized) return '';
    const tokens = normalized.split(' ').filter(Boolean);
    return tokens[tokens.length - 1] || '';
}

function getBranchCountByNextKey(nextKey) {
    if (!nextKey) return 0;
    return (vietnameseDict[nextKey] || []).length;
}

function getKillerCount(text) {
    const normalized = normalizeText(text);
    if (!normalized) return 0;
    return Number(killerWordCounts[normalized] || 0);
}

function getBaseDifficultyPercent(text) {
    const nextKey = getNextKey(text);
    const branchCount = getBranchCountByNextKey(nextKey);

    if (branchCount <= 0) {
        return 98;
    }

    const inverseBranchScore = 100 - (Math.log2(branchCount + 1) * 14);
    return Math.round(clamp(inverseBranchScore, 10, 98));
}

function getDifficultyPercent(text) {
    const normalized = normalizeText(text);
    if (!normalized) return 0;

    const base = getBaseDifficultyPercent(normalized);
    const killerCount = getKillerCount(normalized);
    const killerBonus = Math.min(killerCount * 5, 25);
    const learnedBonus = learnedHardWords.has(normalized) ? 4 : 0;

    return Math.round(clamp(base + killerBonus + learnedBonus, 10, 99));
}

function getDifficultyClass(percent) {
    if (percent >= 75) return 'diff-hard';
    if (percent >= 50) return 'diff-mid';
    return 'diff-easy';
}

function getCounterRiskPercent(nextKey, opponentName) {
    const branchCount = getBranchCountByNextKey(nextKey);
    const opponentStrength = getOpponentStrengthForKey(opponentName, nextKey);

    // Nhánh càng nhiều và đối thủ càng quen key đó thì càng dễ bị phản đòn.
    if (branchCount <= 0) return 4;

    const branchRisk = Math.log2(branchCount + 1) * 16;
    const opponentRisk = Math.log2(opponentStrength + 1) * 22;
    const baseRisk = 8;

    return Math.round(clamp(baseRisk + branchRisk + opponentRisk, 4, 99));
}

function getMoveAnalysis(moveText, opponentName) {
    const normalizedMove = normalizeText(moveText);
    const nextKey = getNextKey(normalizedMove);
    const opponentMoves = (vietnameseDict[nextKey] || []).slice();

    if (opponentMoves.length === 0) {
        return {
            risk: 4,
            survivalRate: 100,
            opponentMoveCount: 0,
            opponentRedupCount: 0,
            opponentRedupRate: 0,
            twoStepTrapRate: 0,
            bestCounterReplies: 0,
            reason: 'Khóa nhánh đối thủ ngay lượt tới'
        };
    }

    const opponentRedupCount = opponentMoves.filter(isSimpleReduplication).length;
    const opponentRedupRate = Math.round((opponentRedupCount / opponentMoves.length) * 100);

    const simulated = opponentMoves.map(oppMove => {
        const myReplyKey = getNextKey(oppMove);
        const myReplyCount = getBranchCountByNextKey(myReplyKey);
        const oppFavForReplyKey = getOpponentStrengthForKey(opponentName, myReplyKey);

        let twoStepTrapRate = 0;
        const myReplies = (vietnameseDict[myReplyKey] || []).slice(0, 8);
        if (myReplies.length === 0) {
            twoStepTrapRate = 100;
        } else {
            let trapReplies = 0;
            myReplies.forEach(myReply => {
                const oppSecondKey = getNextKey(myReply);
                const oppSecondMoves = (vietnameseDict[oppSecondKey] || []).slice(0, 8);
                const canLockMe = oppSecondMoves.some(oppSecondMove => {
                    const myFinalKey = getNextKey(oppSecondMove);
                    return getBranchCountByNextKey(myFinalKey) === 0;
                });
                if (canLockMe) trapReplies += 1;
            });
            twoStepTrapRate = Math.round((trapReplies / myReplies.length) * 100);
        }

        return {
            oppMove,
            myReplyKey,
            myReplyCount,
            oppFavForReplyKey,
            twoStepTrapRate
        };
    });

    simulated.sort((a, b) => {
        if (a.myReplyCount !== b.myReplyCount) return a.myReplyCount - b.myReplyCount;
        return b.oppFavForReplyKey - a.oppFavForReplyKey;
    });

    const sampled = simulated.slice(0, 10);
    const survivable = sampled.filter(item => item.myReplyCount > 0).length;
    const survivalRate = Math.round((survivable / sampled.length) * 100);
    const bestCounterReplies = sampled[0].myReplyCount;
    const strongestFav = sampled[0].oppFavForReplyKey;
    const twoStepTrapRate = Math.round(sampled.reduce((sum, item) => sum + Number(item.twoStepTrapRate || 0), 0) / sampled.length);

    const pressureFromBestCounter = bestCounterReplies === 0
        ? 68
        : clamp(56 - Math.log2(bestCounterReplies + 1) * 12, 10, 56);
    const pressureFromOptions = Math.log2(opponentMoves.length + 1) * 8;
    const pressureFromOpponentHabit = Math.log2(strongestFav + 1) * 12;
    const pressureFromLowSurvival = (100 - survivalRate) * 0.35;
    const pressureFromRedup = opponentRedupRate * 0.12;
    const pressureFromTwoStepTrap = twoStepTrapRate * 0.2;

    const risk = Math.round(clamp(
        pressureFromBestCounter + pressureFromOptions + pressureFromOpponentHabit + pressureFromLowSurvival + pressureFromRedup + pressureFromTwoStepTrap,
        4,
        99
    ));

    let reason = `Đối thủ có ${opponentMoves.length} nhánh phản`; 
    if (bestCounterReplies === 0) {
        reason = 'Có nước phản đòn khóa bạn';
    } else if (twoStepTrapRate >= 55) {
        reason = `Nguy cơ bẫy 2 bước cao (${twoStepTrapRate}%)`;
    } else if (survivalRate <= 35) {
        reason = `Tỷ lệ sống thấp (${survivalRate}%)`;
    } else if (opponentRedupRate >= 40) {
        reason = `Nước phản có nhiều từ láy (${opponentRedupRate}%)`;
    } else if (strongestFav >= 4) {
        reason = 'Đối thủ quen key phản đòn này';
    }

    return {
        risk,
        survivalRate,
        opponentMoveCount: opponentMoves.length,
        opponentRedupCount,
        opponentRedupRate,
        twoStepTrapRate,
        bestCounterReplies,
        reason
    };
}

function isCheckmateMove(analysis) {
    return !!analysis && Number(analysis.opponentMoveCount || 0) === 0;
}

function getRiskClass(percent) {
    if (percent >= 70) return 'risk-high';
    if (percent >= 40) return 'risk-mid';
    return 'risk-low';
}

function getKillPotentialPercent(analysis, nextKey, opponentName) {
    if (!analysis) return 0;
    if (isCheckmateMove(analysis)) return 100;

    const opponentMoveCount = Number(analysis.opponentMoveCount || 0);
    const survivalRate = Number(analysis.survivalRate || 0);
    const risk = Number(analysis.risk || 0);
    const opponentStrength = getOpponentStrengthForKey(opponentName, nextKey);

    const trapPressure = clamp(100 - Math.log2(opponentMoveCount + 1) * 26, 10, 92);
    const survivalBonus = clamp(survivalRate, 0, 100);
    const safetyBonus = clamp(100 - risk, 0, 100);
    const unfamiliarityBonus = clamp(100 - Math.log2(opponentStrength + 1) * 30, 25, 100);

    return Math.round(clamp(
        trapPressure * 0.5 + survivalBonus * 0.2 + safetyBonus * 0.15 + unfamiliarityBonus * 0.15,
        5,
        99
    ));
}

function getKillClass(percent) {
    if (percent >= 70) return 'kill-high';
    if (percent >= 45) return 'kill-mid';
    return 'kill-low';
}

function isSimpleReduplication(text) {
    const normalized = normalizeText(text);
    if (!normalized) return false;
    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length !== 2) return false;
    return parts[0] === parts[1];
}

function normalizePlayerName(name) {
    return (name || '').replace(/\s+/g, ' ').trim();
}

function getOrCreateOpponentProfile(name) {
    const normalizedName = normalizePlayerName(name);
    if (!normalizedName) return null;

    if (!opponentProfiles[normalizedName]) {
        opponentProfiles[normalizedName] = {
            playedWords: {},
            startKeys: {},
            killerWordsAgainstMe: {}
        };
    }

    return opponentProfiles[normalizedName];
}

function registerOpponentWord(opponentName, rawWord) {
    const normalizedWord = normalizeText(rawWord);
    if (!isLikelyWord(normalizedWord)) return;

    const normalizedName = normalizePlayerName(opponentName);
    if (!normalizedName) return;
    const now = Date.now();
    const recent = opponentRecentWordState[normalizedName];
    if (recent && recent.word === normalizedWord && now - recent.at < 7000) {
        return;
    }
    opponentRecentWordState[normalizedName] = { word: normalizedWord, at: now };

    const profile = getOrCreateOpponentProfile(normalizedName);
    if (!profile) return;

    currentMatchOpponentWords[normalizedWord] = Number(currentMatchOpponentWords[normalizedWord] || 0) + 1;

    profile.playedWords[normalizedWord] = Number(profile.playedWords[normalizedWord] || 0) + 1;

    const startKey = normalizedWord.split(' ')[0] || '';
    if (startKey) {
        profile.startKeys[startKey] = Number(profile.startKeys[startKey] || 0) + 1;
    }

    persistLearnedState();
}

function registerMyPlayedWord(rawWord) {
    const normalizedWord = normalizeText(rawWord);
    if (!isLikelyWord(normalizedWord) || isUiNoiseWord(normalizedWord)) return;
    currentMatchMyWords[normalizedWord] = Number(currentMatchMyWords[normalizedWord] || 0) + 1;
}

function attachInputTrackingOnce() {
    if (isInputTrackingAttached) return;
    const input = document.querySelector('input.input.is-large, input[type="text"], textarea');
    if (!input) return;

    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        registerMyPlayedWord(input.value || '');
    });

    isInputTrackingAttached = true;
}

function registerOpponentKillerWord(opponentName, rawWord) {
    const normalizedWord = normalizeText(rawWord);
    if (!isLikelyWord(normalizedWord)) return;

    const profile = getOrCreateOpponentProfile(opponentName);
    if (!profile) return;

    profile.killerWordsAgainstMe[normalizedWord] = Number(profile.killerWordsAgainstMe[normalizedWord] || 0) + 1;
    persistLearnedState();
}

function getOpponentStrengthForKey(opponentName, key) {
    const normalizedName = normalizePlayerName(opponentName);
    if (!normalizedName || !key) return 0;

    const profile = opponentProfiles[normalizedName];
    if (!profile || !profile.startKeys) return 0;
    return Number(profile.startKeys[key] || 0);
}

function inferCurrentOpponentName() {
    const textNodes = Array.from(document.querySelectorAll('div, span, p, h2, h3'))
        .filter(node => node && !node.closest('#noitu-helper-box') && node.children.length === 0)
        .map(node => (node.innerText || '').trim())
        .filter(Boolean);

    for (const text of textNodes) {
        const match = text.match(/^(.{2,40})\s+đang trả lời$/i);
        if (match && match[1]) {
            const name = normalizePlayerName(match[1]);
            if (
                name &&
                !/^(bạn|you|me|tôi|minh|mình)$/i.test(name) &&
                !/\((bạn|you|me)\)/i.test(name) &&
                !/nối từ|đấu rank|copy link|gợi ý/i.test(name)
            ) {
                return name;
            }
        }
    }

    return '';
}

function markKillerWord(rawWord) {
    const normalized = normalizeText(rawWord);
    if (!isLikelyWord(normalized)) return;
    if (isUiNoiseWord(normalized)) return;

    killerWords.add(normalized);
    killerWordCounts[normalized] = Number(killerWordCounts[normalized] || 0) + 1;
    if (currentOpponentName) {
        registerOpponentKillerWord(currentOpponentName, normalized);
    }
    persistLearnedState();
    refreshKillerListUI();
    console.log(`⭐ Đã lưu từ giết chết: ${normalized} (x${killerWordCounts[normalized]})`);
}

function unmarkKillerWord(rawWord) {
    const normalized = normalizeText(rawWord);
    if (!normalized) return;
    if (!killerWords.has(normalized)) return;

    killerWords.delete(normalized);
    delete killerWordCounts[normalized];
    persistLearnedState();
    refreshKillerListUI();
    if (latestDetectedWord) showSuggestions(latestDetectedWord);
    console.log(`🗑 Đã xóa khỏi từ đã lưu: ${normalized}`);
}

function registerLearnedWord(rawWord) {
    const normalized = normalizeText(rawWord);
    if (!isLikelyWord(normalized)) return;
    if (isUiNoiseWord(normalized)) return;

    const firstPart = normalized.split(' ')[0];
    if (!firstPart) return;

    let changed = false;
    const existing = vietnameseDict[firstPart] || [];
    const wasKnown = existing.includes(normalized);

    if (!vietnameseDict[firstPart]) vietnameseDict[firstPart] = [];
    if (!vietnameseDict[firstPart].includes(normalized)) {
        vietnameseDict[firstPart].push(normalized);
        changed = true;
    }

    if (!learnedDictionary[firstPart]) learnedDictionary[firstPart] = [];
    if (!learnedDictionary[firstPart].includes(normalized)) {
        learnedDictionary[firstPart].push(normalized);
        changed = true;
    }

    const baseDifficulty = getBaseDifficultyPercent(normalized);
    const isHardWord = !wasKnown || baseDifficulty >= 78;
    if (isHardWord && !learnedHardWords.has(normalized)) {
        learnedHardWords.add(normalized);
        changed = true;
        console.log(`🧠 Đã học từ hiểm: ${normalized} (120%)`);
    }

    if (changed) persistLearnedState();
}

loadLearnedState();

function normalizeText(text) {
    return (text || "")
        .toLowerCase()
        .replace(/["'`~!@#$%^&*()_+=\[\]{}\\|;:,.<>/?-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isLikelyWord(text) {
    if (!text) return false;
    if (text.length > 40) return false;
    const parts = text.split(" ").filter(Boolean);
    if (parts.length === 0 || parts.length > 4) return false;
    return /[a-zA-ZÀ-ỹ]/.test(text);
}

function isLikelyGamePage() {
    const path = (window.location.pathname || '').toLowerCase();
    const hasInput = !!document.querySelector('input.input.is-large, input[type="text"], textarea');
    const hasWordLane = !!document.querySelector('.is-flex.is-flex-wrap-nowrap');

    // Một số trận rank vẫn nằm trong đường dẫn có chứa "xep-hang",
    // nên không khóa cứng theo path nữa; ưu tiên nhận diện theo dấu hiệu UI trận.
    const hasLiveMatchHint = hasInput || hasWordLane;
    if (hasLiveMatchHint) return true;

    const isHomeLikePath = /trang-chu|home/.test(path);
    if (isHomeLikePath && !hasInput && !hasWordLane) return false;

    return false;
}

function isExplicitNonGamePath() {
    const path = (window.location.pathname || '').toLowerCase();
    return /trang-chu|home/.test(path);
}

function renderHomeReviewMode() {
    const listDiv = document.getElementById('suggestion-list');
    const metaDiv = document.getElementById('difficulty-meta');
    if (!listDiv || !metaDiv) return;

    isHomeReviewMode = true;
    lastRenderedWord = '';
    latestDetectedWord = '';
    metaDiv.innerHTML = 'Chế độ xem lại: vào trận để bật gợi ý theo từ đối thủ.';
    listDiv.innerHTML = '<div class="no-word">Đang ở trang chủ/xếp hạng. Mở trận để hiện gợi ý.</div>';
    refreshReviewInfoUI();
}

// 1. Load từ điển từ file JSON
fetch(chrome.runtime.getURL('dictionary.json'))
    .then(res => res.json())
    .then(data => {
        vietnameseDict = data;
        mergeLearnedDictionaryIntoMainDict();
        isDictionaryReady = true;
        console.log("✅ Từ điển đã sẵn sàng!");
        updateFromPage();
    })
    .catch(err => {
        console.error("Không đọc được dictionary.json", err);
    });

// 2. Tạo giao diện Helper
const helperBox = document.createElement('div');
helperBox.id = 'noitu-helper-box';
helperBox.innerHTML = `
    <div class="helper-header" id="helper-header">
        <span class="helper-title">💡 Gợi ý cho bạn</span>
        <button id="toggle-collapse-btn" class="toggle-collapse-btn" type="button" title="Thu gọn">−</button>
    </div>
    <div id="helper-content" class="helper-content">
        <div id="difficulty-meta" class="difficulty-meta">Độ khó từ hiện tại: --%</div>
        <div class="helper-actions">
            <button id="mark-killer-btn" class="helper-action-btn" type="button">⭐ Lưu từ này</button>
            <button id="toggle-killer-list-btn" class="helper-action-btn helper-action-secondary" type="button">📚 Từ đã lưu (0)</button>
            <button id="toggle-opponent-review-btn" class="helper-action-btn helper-action-secondary" type="button">🧠 Xem lại đối thủ</button>
        </div>
        <div id="killer-list-panel" class="killer-list-panel" style="display:none;">
            <div id="killer-list-content" class="killer-list-content">Chưa có từ nào được lưu.</div>
        </div>
        <div id="opponent-review-panel" class="opponent-review-panel" style="display:none;">
            <div id="opponent-review-content" class="opponent-review-content">Chưa có dữ liệu đối thủ.</div>
        </div>
        <div id="suggestion-list">Đang đợi đối thủ...</div>
    </div>
`;
document.body.appendChild(helperBox);

const helperHeader = document.getElementById('helper-header');
const toggleCollapseBtn = document.getElementById('toggle-collapse-btn');
const markKillerBtn = document.getElementById('mark-killer-btn');
const toggleKillerListBtn = document.getElementById('toggle-killer-list-btn');
const toggleOpponentReviewBtn = document.getElementById('toggle-opponent-review-btn');
const killerListPanel = document.getElementById('killer-list-panel');
const killerListContent = document.getElementById('killer-list-content');
const opponentReviewPanel = document.getElementById('opponent-review-panel');
const opponentReviewContent = document.getElementById('opponent-review-content');
const reviewInfoDiv = document.getElementById('review-info');

function setHelperCollapsed(nextCollapsed) {
    if (!helperBox) return;

    const isCollapsed = !!nextCollapsed;
    helperBox.classList.toggle('collapsed', isCollapsed);
    if (toggleCollapseBtn) {
        toggleCollapseBtn.innerText = isCollapsed ? '+' : '−';
        toggleCollapseBtn.title = isCollapsed ? 'Mở rộng' : 'Thu gọn';
    }

    localStorage.setItem(HELPER_COLLAPSE_KEY, isCollapsed ? '1' : '0');
}

if (toggleCollapseBtn) {
    toggleCollapseBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const next = !helperBox.classList.contains('collapsed');
        setHelperCollapsed(next);
    });
}

if (helperHeader) {
    helperHeader.addEventListener('click', () => {
        if (helperBox.classList.contains('collapsed')) {
            setHelperCollapsed(false);
        }
    });
}

setHelperCollapsed(localStorage.getItem(HELPER_COLLAPSE_KEY) === '1');

function getTotalKillerHits() {
    return Object.values(killerWordCounts).reduce((sum, n) => sum + Number(n || 0), 0);
}

function getOpponentTotalWordCount(profile) {
    if (!profile || !profile.playedWords) return 0;
    return Object.values(profile.playedWords).reduce((sum, n) => sum + Number(n || 0), 0);
}

function getSortedOpponentNames() {
    return Object.keys(opponentProfiles).sort((a, b) => {
        const aCount = getOpponentTotalWordCount(opponentProfiles[a]);
        const bCount = getOpponentTotalWordCount(opponentProfiles[b]);
        if (aCount !== bCount) return bCount - aCount;
        return a.localeCompare(b, 'vi');
    });
}

function getTopStartKeysByOpponent(opponentName, limit = 3) {
    const profile = opponentProfiles[opponentName];
    if (!profile || !profile.startKeys) return [];

    return Object.entries(profile.startKeys)
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
        .slice(0, limit);
}

function refreshReviewInfoUI() {
    if (!reviewInfoDiv) return;

    const opponentNames = getSortedOpponentNames();
    const opponentCount = opponentNames.length;
    const topOpponent = opponentNames[0] || '';
    const topOpponentPlayed = topOpponent ? getOpponentTotalWordCount(opponentProfiles[topOpponent]) : 0;
    const activeOpponent = currentOpponentName || topOpponent;
    const topKeys = activeOpponent ? getTopStartKeysByOpponent(activeOpponent, 3) : [];

    const keyLine = topKeys.length > 0
        ? topKeys.map(([k, n]) => `${k} (${n})`).join(' · ')
        : 'Chưa có dữ liệu key';

    reviewInfoDiv.innerHTML = `
        <div class="review-title">Xem lại nhanh</div>
        <div class="review-row">Đối thủ đã học: <b>${opponentCount}</b></div>
        <div class="review-row">Đối thủ gần nhất: <b>${activeOpponent || 'Chưa có'}</b></div>
        <div class="review-row">Từ giết đã lưu: <b>${killerWords.size}</b> · Lượt bị giết: <b>${getTotalKillerHits()}</b></div>
        <div class="review-row">Key đối thủ hay mở: <b>${keyLine}</b></div>
        ${topOpponent ? `<div class="review-sub">Top đối thủ: ${topOpponent} (${topOpponentPlayed} lượt)</div>` : ''}
    `;
}

function refreshOpponentReviewUI() {
    if (!opponentReviewContent) return;

    const opponentNames = getSortedOpponentNames();
    if (opponentNames.length === 0) {
        opponentReviewContent.innerHTML = 'Chưa có dữ liệu đối thủ.';
        return;
    }

    const topList = opponentNames.slice(0, 6).map(name => {
        const profile = opponentProfiles[name] || {};
        const totalPlayed = getOpponentTotalWordCount(profile);
        const topKeys = getTopStartKeysByOpponent(name, 3);
        const keyLine = topKeys.length > 0
            ? topKeys.map(([k, n]) => `${k} (${n})`).join(' · ')
            : 'Chưa có key mạnh';

        return `
            <div class="op-row ${name === currentOpponentName ? 'op-row-active' : ''}">
                <div class="op-head">
                    <div class="op-name">${name}</div>
                    <button class="op-remove-btn" type="button" data-user="${name}" title="Xóa user này">xóa</button>
                </div>
                <div class="op-meta">Lượt ghi nhận: <b>${totalPlayed}</b></div>
                <div class="op-meta">Key hay dùng: <b>${keyLine}</b></div>
            </div>
        `;
    }).join('');

    opponentReviewContent.innerHTML = topList;
}

function removeOpponentProfile(userName) {
    const normalizedName = normalizePlayerName(userName);
    if (!normalizedName) return;
    if (!opponentProfiles[normalizedName]) return;

    delete opponentProfiles[normalizedName];

    if (currentOpponentName === normalizedName) {
        currentOpponentName = '';
    }

    delete opponentRecentWordState[normalizedName];
    persistLearnedState();
    refreshReviewInfoUI();
    refreshOpponentReviewUI();
    console.log(`🧹 Đã xóa profile đối thủ: ${normalizedName}`);
}

function getSortedKillerWords() {
    return Array.from(killerWords).sort((a, b) => {
        const diff = getKillerCount(b) - getKillerCount(a);
        if (diff !== 0) return diff;
        return a.localeCompare(b, 'vi');
    });
}

function refreshKillerListUI() {
    const words = getSortedKillerWords();
    if (toggleKillerListBtn) {
        toggleKillerListBtn.innerText = `📚 Từ đã lưu (${words.length})`;
    }

    if (!killerListContent) return;
    if (words.length === 0) {
        killerListContent.innerHTML = 'Chưa có từ nào được lưu.';
        return;
    }

    const topWords = words.slice(0, 40);
    const chips = topWords.map(w => `
        <span class="killer-chip">
            <span class="killer-chip-label">⭐ ${w} (x${getKillerCount(w)})</span>
            <button class="killer-chip-remove" type="button" data-word="${w}" title="Xóa từ này">×</button>
        </span>
    `).join('');
    const extra = words.length > topWords.length
        ? `<div class="killer-list-more">... và ${words.length - topWords.length} từ khác</div>`
        : '';

    killerListContent.innerHTML = `<div class="killer-list-chips">${chips}</div>${extra}`;
    refreshReviewInfoUI();
    refreshOpponentReviewUI();
}

if (toggleKillerListBtn) {
    toggleKillerListBtn.addEventListener('click', () => {
        if (!killerListPanel) return;
        const isOpen = killerListPanel.style.display !== 'none';
        killerListPanel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) refreshKillerListUI();
    });
}

if (toggleOpponentReviewBtn) {
    toggleOpponentReviewBtn.addEventListener('click', () => {
        if (!opponentReviewPanel) return;
        const isOpen = opponentReviewPanel.style.display !== 'none';
        opponentReviewPanel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) refreshOpponentReviewUI();
    });
}

if (opponentReviewContent) {
    opponentReviewContent.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.classList.contains('op-remove-btn')) return;

        const userName = target.getAttribute('data-user') || '';
        if (!userName) return;
        removeOpponentProfile(userName);
    });
}

if (killerListContent) {
    killerListContent.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.classList.contains('killer-chip-remove')) return;

        const word = target.getAttribute('data-word') || '';
        if (!word) return;
        unmarkKillerWord(word);
    });
}

if (markKillerBtn) {
    markKillerBtn.addEventListener('click', () => {
        if (!latestDetectedWord) return;
        markKillerWord(latestDetectedWord);
        showSuggestions(latestDetectedWord);
    });
}

refreshKillerListUI();
refreshReviewInfoUI();
refreshOpponentReviewUI();

// 3. Hàm cập nhật danh sách gợi ý
function showSuggestions(word) {
    if (isHomeReviewMode) {
        renderHomeReviewMode();
        return;
    }

    const normalized = normalizeText(word);
    if (isUiNoiseWord(normalized)) {
        const listDiv = document.getElementById('suggestion-list');
        const metaDiv = document.getElementById('difficulty-meta');
        if (metaDiv) metaDiv.innerHTML = `Độ khó từ hiện tại: --%`;
        if (listDiv) listDiv.innerHTML = `<div class="no-word">Đang đợi từ đối thủ...</div>`;
        return;
    }
    const lastWord = normalized.split(' ').pop();
    const listDiv = document.getElementById('suggestion-list');
    const metaDiv = document.getElementById('difficulty-meta');

    if (!listDiv) return;
    if (!isDictionaryReady) {
        if (metaDiv) metaDiv.innerHTML = `Độ khó từ hiện tại: --%`;
        listDiv.innerHTML = `<div class="no-word">Đang tải từ điển...</div>`;
        return;
    }

    if (!lastWord) {
        if (metaDiv) metaDiv.innerHTML = `Độ khó từ hiện tại: --%`;
        listDiv.innerHTML = `<div class="no-word">Đang đợi đối thủ...</div>`;
        return;
    }

    const currentDifficulty = getDifficultyPercent(normalized);
    const currentBranchCount = getBranchCountByNextKey(getNextKey(normalized));
    const currentKillerCount = getKillerCount(normalized);
    const isKillerWord = currentKillerCount > 0;
    const opponentLabel = currentOpponentName ? ` · Đối thủ: <b>${currentOpponentName}</b>` : '';
    if (metaDiv) {
        metaDiv.innerHTML = isKillerWord
            ? `Từ cần nối: <b>${lastWord}</b> · Nhánh tiếp: <b>${currentBranchCount}</b> · Độ khó: <b>${currentDifficulty}%</b>${opponentLabel} · <span class="killer-mark">⭐ Giết bạn x${currentKillerCount}</span>`
            : `Từ cần nối: <b>${lastWord}</b> · Nhánh tiếp: <b>${currentBranchCount}</b> · Độ khó: <b>${currentDifficulty}%</b>${opponentLabel}`;
    }

    if (lastRenderedWord === lastWord) return;
    lastRenderedWord = lastWord;

    const suggestions = (vietnameseDict[lastWord] || []).slice();
    const moveAnalysisCache = {};

    function getCachedAnalysis(phrase) {
        const cacheKey = `${currentOpponentName}::${phrase}`;
        if (!moveAnalysisCache[cacheKey]) {
            moveAnalysisCache[cacheKey] = getMoveAnalysis(phrase, currentOpponentName);
        }
        return moveAnalysisCache[cacheKey];
    }

    suggestions.sort((a, b) => {
        const aNorm = normalizeText(a);
        const bNorm = normalizeText(b);
        const aNext = getNextKey(aNorm);
        const bNext = getNextKey(bNorm);

        const aSaved = killerWords.has(aNorm) ? 1 : 0;
        const bSaved = killerWords.has(bNorm) ? 1 : 0;
        // Ưu tiên từ đã lưu lên đầu theo yêu cầu.
        if (aSaved !== bSaved) return bSaved - aSaved;

        const aAnalysis = getCachedAnalysis(a);
        const bAnalysis = getCachedAnalysis(b);
        const aMate = isCheckmateMove(aAnalysis) ? 1 : 0;
        const bMate = isCheckmateMove(bAnalysis) ? 1 : 0;
        // Ưu tiên tuyệt đối nước kết liễu (đối thủ hết nhánh ngay).
        if (aMate !== bMate) return bMate - aMate;

        const aRecentLoss = recentLossWordSet.has(aNorm) ? 1 : 0;
        const bRecentLoss = recentLossWordSet.has(bNorm) ? 1 : 0;
        // Né nhóm từ từng khiến bạn thua ở trận gần nhất.
        if (aRecentLoss !== bRecentLoss) return aRecentLoss - bRecentLoss;

        const aRecentWin = recentWinWordSet.has(aNorm) ? 1 : 0;
        const bRecentWin = recentWinWordSet.has(bNorm) ? 1 : 0;
        // Đẩy nhóm từ từng giúp bạn thắng ở trận gần nhất.
        if (aRecentWin !== bRecentWin) return bRecentWin - aRecentWin;

        const aNextRedupRate = Number(aAnalysis.opponentRedupRate || 0);
        const bNextRedupRate = Number(bAnalysis.opponentRedupRate || 0);
        // Ưu tiên nhánh mà nước phản của đối thủ ít từ láy lặp hơn.
        if (aNextRedupRate !== bNextRedupRate) return aNextRedupRate - bNextRedupRate;

        const aKillPotential = getKillPotentialPercent(aAnalysis, aNext, currentOpponentName);
        const bKillPotential = getKillPotentialPercent(bAnalysis, bNext, currentOpponentName);
        if (aKillPotential !== bKillPotential) return bKillPotential - aKillPotential;

        const aRisk = aAnalysis.risk;
        const bRisk = bAnalysis.risk;
        if (aRisk !== bRisk) return aRisk - bRisk;

        const aOppStrength = getOpponentStrengthForKey(currentOpponentName, aNext);
        const bOppStrength = getOpponentStrengthForKey(currentOpponentName, bNext);
        // Ưu tiên từ khắc chế: ép đối thủ vào key mà họ ít dùng.
        if (aOppStrength !== bOppStrength) return aOppStrength - bOppStrength;

        return getDifficultyPercent(bNorm) - getDifficultyPercent(aNorm);
    });

    listDiv.innerHTML = "";

    const displaySuggestions = suggestions;
    
    if (displaySuggestions.length === 0) {
        listDiv.innerHTML = `<div class="no-word">Không tìm thấy từ nối cho "${lastWord}"</div>`;
    } else {
        // Lấy tối đa 10 từ gợi ý và hiển thị mức độ khó.
        displaySuggestions.slice(0, 10).forEach(s => {
            const difficulty = getDifficultyPercent(s);
            const killCount = getKillerCount(s);
            const nextKey = getNextKey(s);
            const opponentStrength = getOpponentStrengthForKey(currentOpponentName, nextKey);
            const analysis = getCachedAnalysis(s);
            const counterRisk = analysis.risk;
            const killPotential = getKillPotentialPercent(analysis, nextKey, currentOpponentName);
            const nextRedupRate = Number(analysis.opponentRedupRate || 0);
            const nextRedupCount = Number(analysis.opponentRedupCount || 0);
            const twoStepTrapRate = Number(analysis.twoStepTrapRate || 0);
            const normalizedSuggestion = normalizeText(s);
            const inRecentLoss = recentLossWordSet.has(normalizedSuggestion);
            const inRecentWin = recentWinWordSet.has(normalizedSuggestion);
            const counterBadge = currentOpponentName ? `<span class="counter-badge" title="Đối thủ quen key này: ${opponentStrength}">khắc chế ${opponentStrength}</span>` : '';
            const killerBadge = killCount > 0 ? `<span class="killer-star" title="Từng giết bạn x${killCount}">⭐x${killCount}</span>` : '';
            const mateBadge = isCheckmateMove(analysis) ? '<span class="mate-badge" title="Đối thủ không còn nhánh phản">KẾT LIỄU</span>' : '';
            const redupBadge = nextRedupRate > 0
                ? `<span class="redup-badge" title="Trong nhánh phản của đối thủ có ${nextRedupCount} từ láy lặp">láy sau ${nextRedupRate}%</span>`
                : '';
            const trapBadge = twoStepTrapRate >= 30
                ? `<span class="trap-badge ${twoStepTrapRate >= 60 ? 'trap-high' : 'trap-mid'}" title="Nguy cơ bị khóa ở 2 lượt kế: ${twoStepTrapRate}%">bẫy 2 bước ${twoStepTrapRate}%</span>`
                : '';
            const memoryBadge = inRecentLoss
                ? '<span class="memory-badge mem-loss" title="Trận gần nhất: từ này thuộc nhóm làm bạn thua">né (trận thua)</span>'
                : (inRecentWin ? '<span class="memory-badge mem-win" title="Trận gần nhất: từ này thuộc nhóm giúp bạn thắng">đẩy (trận thắng)</span>' : '');
            const killBadge = `<span class="kill-badge ${getKillClass(killPotential)}" title="Tỉ lệ có thể kết liễu sớm: ${killPotential}%">giết ${killPotential}%</span>`;
            const btn = document.createElement('button');
            btn.className = 'suggest-btn';
            btn.innerHTML = `
                <span class="suggest-main">
                    <span class="suggest-word">${killerBadge}${s}</span>
                    <span class="suggest-reason">${analysis.reason} · sống ${analysis.survivalRate}%</span>
                </span>
                <span class="suggest-tags">
                    ${mateBadge}
                    ${memoryBadge}
                    ${redupBadge}
                    ${trapBadge}
                    ${killBadge}
                    ${counterBadge}
                    <span class="risk-badge ${getRiskClass(counterRisk)}" title="Rủi ro phản đòn: ${counterRisk}%">rủi ro ${counterRisk}%</span>
                    <span class="suggest-diff ${getDifficultyClass(difficulty)}">${difficulty}%</span>
                </span>
            `;
            btn.onclick = () => {
                registerMyPlayedWord(s);
                const input = document.querySelector('input.input.is-large, input[type="text"], textarea');
                if (input) {
                    input.value = s;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.focus();
                }
            };
            listDiv.appendChild(btn);
        });
    }
}

function isLossText(text) {
    if (!text) return false;
    return /(bạn thua|đã thua|thua rồi|thất bại|game over|bị loại|trả lời sai|sai rồi|hết giờ|hết thời gian|you lose|you lost)/i.test(text);
}

function isWinText(text) {
    if (!text) return false;
    return /(trả lời đúng|chiến thắng|thắng rồi|thắng cuộc|you win|victory)/i.test(text);
}

function collectStatusTextCandidates() {
    const candidates = [];
    const selectors = [
        '[class*="toast"]',
        '[class*="Toast"]',
        '[class*="alert"]',
        '[class*="result"]',
        '[class*="status"]',
        '[class*="modal"]',
        '[class*="popup"]',
        '[role="alert"]',
        '[role="status"]',
        '[aria-live]'
    ];

    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(node => {
            if (!node || node.closest('#noitu-helper-box')) return;
            const text = (node.innerText || '').trim();
            if (text) candidates.push(text);
        });
    });

    // Fallback: quét các text ngắn đang hiển thị, bắt các trạng thái kiểu "Bạn đã trả lời sai".
    const shortTexts = Array.from(document.querySelectorAll('div, span, p, h1, h2, h3'))
        .filter(node => node && !node.closest('#noitu-helper-box') && node.children.length === 0)
        .map(node => {
            const text = (node.innerText || '').trim();
            const rect = node.getBoundingClientRect();
            return { text, rect };
        })
        .filter(item => item.text && item.text.length <= 90 && item.rect.width > 40 && item.rect.height > 12)
        .slice(0, 220);

    shortTexts.forEach(item => candidates.push(item.text));

    const titleText = (document.title || '').trim();
    if (titleText) candidates.push(titleText);
    return candidates;
}

function detectAndStoreLossKillerWord() {
    const now = Date.now();
    if (now - lastLossStateAt < 1200) return;
    lastLossStateAt = now;

    const candidates = collectStatusTextCandidates();

    const hasLoss = candidates.some(t => isLossText(t));
    const hasWin = candidates.some(t => isWinText(t));
    if (!hasLoss || hasWin) return;

    if (!latestDetectedWord) return;
    if (latestDetectedWord === lastLossWord && now - lastLossWordAt < 8000) return;
    markKillerWord(latestDetectedWord);
    lastLossWord = latestDetectedWord;
    lastLossWordAt = now;
}

function detectAndStoreRecentMatchResult() {
    const now = Date.now();
    if (now - lastMatchResultAt < MATCH_RESULT_COOLDOWN_MS) return;

    const candidates = collectStatusTextCandidates();
    const hasLoss = candidates.some(t => isLossText(t));
    const hasWin = candidates.some(t => isWinText(t));
    if (!hasLoss && !hasWin) return;
    if (hasLoss && hasWin) return;

    if (hasLoss) {
        const topLossWords = getTopWordsFromCounter(currentMatchOpponentWords, 6);
        recentLossTopWords = topLossWords.length > 0
            ? topLossWords
            : (latestDetectedWord ? [normalizeText(latestDetectedWord)] : []);
        refreshRecentWordSets();
        console.log(`📉 Top từ làm bạn thua (trận gần nhất): ${recentLossTopWords.join(' · ') || 'không có'}`);
    } else {
        recentWinTopWords = getTopWordsFromCounter(currentMatchMyWords, 6);
        refreshRecentWordSets();
        console.log(`📈 Top từ giúp bạn thắng (trận gần nhất): ${recentWinTopWords.join(' · ') || 'không có'}`);
    }

    persistLearnedState();
    resetCurrentMatchTracking();
    lastMatchResultAt = now;
}

function getWordFromInputValue() {
    const input = document.querySelector('input.input.is-large, input[type="text"], textarea');
    if (!input) return "";

    const text = normalizeText(input.value || "");
    if (isLikelyWord(text)) return text;
    return "";
}

function getWordFromRecentChips() {
    const chipSelectors = [
        'button',
        '[role="button"]',
        '.tag',
        '.chip'
    ];

    for (const selector of chipSelectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        const candidates = nodes
            .filter(node => !node.closest('#noitu-helper-box'))
            .map(node => {
                const text = normalizeText(node.innerText);
                const rect = node.getBoundingClientRect();
                return { text, rect };
            })
            .filter(item => isLikelyWord(item.text) && item.rect.width > 40 && item.rect.height > 16)
            .sort((a, b) => b.rect.top - a.rect.top);

        if (candidates.length > 0) {
            return candidates[0].text;
        }
    }

    return "";
}

function getWordFromKnownSelectors() {
    const wordSpans = document.querySelectorAll('.is-flex.is-flex-wrap-nowrap span');
    if (wordSpans.length > 0) {
        const latestWord = normalizeText(wordSpans[wordSpans.length - 1].innerText);
        if (isLikelyWord(latestWord)) return latestWord;
    }

    const altSelectors = [
        '[class*="word"]',
        '[class*="Word"]'
    ];

    for (const selector of altSelectors) {
        const nodes = document.querySelectorAll(selector);
        for (const node of nodes) {
            if (node.closest('#noitu-helper-box')) continue;
            const text = normalizeText(node.innerText);
            if (isLikelyWord(text)) return text;
        }
    }

    return "";
}

function getWordFromVisibleTextRanking() {
    const now = Date.now();
    if (now - lastHeavyScanAt < 3500) return "";
    lastHeavyScanAt = now;

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const all = Array.from(document.querySelectorAll('h1, h2, h3, p, div, span, button'));
    const elements = all.slice(0, 260);
    let best = "";
    let bestScore = -Infinity;

    for (const el of elements) {
        if (!el || el.closest('#noitu-helper-box')) continue;
        if (el.children.length > 0) continue;

        const text = normalizeText(el.innerText);
        if (!isLikelyWord(text)) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 16) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize || '16');
        const midX = rect.left + rect.width / 2;
        const midY = rect.top + rect.height / 2;
        const distance = Math.hypot(midX - centerX, midY - centerY);
        const words = text.split(' ').filter(Boolean).length;

        const score = fontSize * 4 + words * 8 - distance / 20;
        if (score > bestScore) {
            bestScore = score;
            best = text;
        }
    }

    return best;
}

function getWordFromCenterPoint() {
    const probes = [
        [0.5, 0.45],
        [0.5, 0.5],
        [0.5, 0.55]
    ];

    for (const [xRatio, yRatio] of probes) {
        const x = Math.floor(window.innerWidth * xRatio);
        const y = Math.floor(window.innerHeight * yRatio);
        const elements = document.elementsFromPoint(x, y);

        for (const el of elements) {
            if (!el || el.closest('#noitu-helper-box')) continue;
            const text = normalizeText(el.innerText);
            if (isLikelyWord(text)) return text;
        }
    }

    return "";
}

function updateFromPage() {
    const now = Date.now();
    if (isUpdating || now - lastUpdateAt < 260) return;
    isUpdating = true;
    lastUpdateAt = now;

    try {
        const gameLike = isLikelyGamePage();
        if (!gameLike) {
            nonGameDetectStreak += 1;
            if (isExplicitNonGamePath() || nonGameDetectStreak >= NON_GAME_STREAK_THRESHOLD) {
                renderHomeReviewMode();
            }
            return;
        }

        nonGameDetectStreak = 0;
        isHomeReviewMode = false;
        attachInputTrackingOnce();
        detectAndStoreRecentMatchResult();

        const inferredOpponent = inferCurrentOpponentName();
        if (inferredOpponent && inferredOpponent !== currentOpponentName) {
            currentOpponentName = inferredOpponent;
            persistLearnedState();
            refreshReviewInfoUI();
            refreshOpponentReviewUI();
            console.log(`🧩 Nhận diện đối thủ: ${currentOpponentName}`);
        }

        let source = "";
        let foundWord = getWordFromKnownSelectors();

        if (foundWord) {
            source = "known-selectors";
        } else {
            foundWord = getWordFromRecentChips();
            if (foundWord) source = "recent-chips";
        }

        if (!foundWord && ALLOW_INPUT_FALLBACK_DETECTION) {
            foundWord = getWordFromInputValue();
            if (foundWord) source = "input-value";
        }

        if (!foundWord) {
            foundWord = getWordFromVisibleTextRanking();
            if (foundWord) source = "visible-ranking";
        }

        if (!foundWord) {
            foundWord = getWordFromCenterPoint();
            if (foundWord) source = "center-point";
        }

        if (source && (source !== lastDetectedSource || normalizeText(foundWord) !== lastRenderedWord)) {
            lastDetectedSource = source;
            console.log(`🔎 Bắt từ từ nguồn: ${source} -> ${foundWord}`);
        }

        latestDetectedWord = normalizeText(foundWord);
        if (isUiNoiseWord(latestDetectedWord)) {
            latestDetectedWord = '';
            showSuggestions('');
            return;
        }

        const canLearn = TRUSTED_LEARN_SOURCES.has(source);

        if (currentOpponentName && latestDetectedWord && canLearn) {
            registerOpponentWord(currentOpponentName, latestDetectedWord);
            refreshReviewInfoUI();
            refreshOpponentReviewUI();
        }
        if (canLearn) {
            detectAndStoreLossKillerWord();
            registerLearnedWord(foundWord);
        }
        showSuggestions(foundWord);
    } finally {
        isUpdating = false;
    }
}

// 4. Theo dõi từ mới xuất hiện (Dựa trên class bạn đã chụp)
const observer = new MutationObserver(() => {
    updateFromPage();
});

// Chờ web ổn định rồi mới bắt đầu theo dõi
setTimeout(() => {
    const target = document.querySelector('.is-flex.is-flex-wrap-nowrap') || document.body;
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    updateFromPage();

    // Một số trang không phát sinh mutation đúng chỗ, nên quét nhẹ theo chu kỳ.
    setInterval(updateFromPage, 1800);
    console.log("🚀 Noitu Helper đã kích hoạt!");
}, 3000);