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
let latestDetectedWord = "";
let lastLossStateAt = 0;
let lastLossWord = "";
let lastLossWordAt = 0;

function loadLearnedState() {
    try {
        const rawHard = localStorage.getItem('noitu_learned_hard_words');
        const rawKiller = localStorage.getItem('noitu_killer_words');
        const rawKillerCounts = localStorage.getItem('noitu_killer_word_counts');
        const rawDict = localStorage.getItem('noitu_learned_dictionary');

        const hardList = rawHard ? JSON.parse(rawHard) : [];
        const killerList = rawKiller ? JSON.parse(rawKiller) : [];
        const killerCountsObj = rawKillerCounts ? JSON.parse(rawKillerCounts) : {};
        const dictObj = rawDict ? JSON.parse(rawDict) : {};

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
    } catch (err) {
        console.warn('Không tải được dữ liệu từ đã học:', err);
        killerWordCounts = {};
        learnedDictionary = {};
    }
}

function persistLearnedState() {
    try {
        localStorage.setItem('noitu_learned_hard_words', JSON.stringify(Array.from(learnedHardWords)));
        localStorage.setItem('noitu_killer_words', JSON.stringify(Array.from(killerWords)));
        localStorage.setItem('noitu_killer_word_counts', JSON.stringify(killerWordCounts));
        localStorage.setItem('noitu_learned_dictionary', JSON.stringify(learnedDictionary));
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

function markKillerWord(rawWord) {
    const normalized = normalizeText(rawWord);
    if (!isLikelyWord(normalized)) return;

    killerWords.add(normalized);
    killerWordCounts[normalized] = Number(killerWordCounts[normalized] || 0) + 1;
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
    <div class="helper-header">💡 Gợi ý cho bạn</div>
    <div id="difficulty-meta" class="difficulty-meta">Độ khó từ hiện tại: --%</div>
    <div class="helper-actions">
        <button id="mark-killer-btn" class="helper-action-btn" type="button">⭐ Lưu từ này</button>
        <button id="toggle-killer-list-btn" class="helper-action-btn helper-action-secondary" type="button">📚 Từ đã lưu (0)</button>
    </div>
    <div id="killer-list-panel" class="killer-list-panel" style="display:none;">
        <div id="killer-list-content" class="killer-list-content">Chưa có từ nào được lưu.</div>
    </div>
    <div id="suggestion-list">Đang đợi đối thủ...</div>
`;
document.body.appendChild(helperBox);

const markKillerBtn = document.getElementById('mark-killer-btn');
const toggleKillerListBtn = document.getElementById('toggle-killer-list-btn');
const killerListPanel = document.getElementById('killer-list-panel');
const killerListContent = document.getElementById('killer-list-content');

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
}

if (toggleKillerListBtn) {
    toggleKillerListBtn.addEventListener('click', () => {
        if (!killerListPanel) return;
        const isOpen = killerListPanel.style.display !== 'none';
        killerListPanel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) refreshKillerListUI();
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

// 3. Hàm cập nhật danh sách gợi ý
function showSuggestions(word) {
    const normalized = normalizeText(word);
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
    if (metaDiv) {
        metaDiv.innerHTML = isKillerWord
            ? `Từ cần nối: <b>${lastWord}</b> · Nhánh tiếp: <b>${currentBranchCount}</b> · Độ khó: <b>${currentDifficulty}%</b> · <span class="killer-mark">⭐ Giết bạn x${currentKillerCount}</span>`
            : `Từ cần nối: <b>${lastWord}</b> · Nhánh tiếp: <b>${currentBranchCount}</b> · Độ khó: <b>${currentDifficulty}%</b>`;
    }

    if (lastRenderedWord === lastWord) return;
    lastRenderedWord = lastWord;

    const suggestions = (vietnameseDict[lastWord] || []).slice();

    suggestions.sort((a, b) => {
        const aKiller = killerWords.has(normalizeText(a)) ? 1 : 0;
        const bKiller = killerWords.has(normalizeText(b)) ? 1 : 0;
        if (aKiller !== bKiller) return bKiller - aKiller;
        return getDifficultyPercent(b) - getDifficultyPercent(a);
    });

    listDiv.innerHTML = "";
    
    if (suggestions.length === 0) {
        listDiv.innerHTML = `<div class="no-word">Không tìm thấy từ nối cho "${lastWord}"</div>`;
    } else {
        // Lấy tối đa 10 từ gợi ý và hiển thị mức độ khó.
        suggestions.slice(0, 10).forEach(s => {
            const difficulty = getDifficultyPercent(s);
            const killCount = getKillerCount(s);
            const killerBadge = killCount > 0 ? `<span class="killer-star" title="Từng giết bạn x${killCount}">⭐x${killCount}</span>` : '';
            const btn = document.createElement('button');
            btn.className = 'suggest-btn';
            btn.innerHTML = `
                <span class="suggest-word">${killerBadge}${s}</span>
                <span class="suggest-diff ${getDifficultyClass(difficulty)}">${difficulty}%</span>
            `;
            btn.onclick = () => {
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
        '[class*="Word"]',
        'h1',
        'h2'
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
        let source = "";
        let foundWord = getWordFromKnownSelectors();

        if (foundWord) {
            source = "known-selectors";
        } else {
            foundWord = getWordFromRecentChips();
            if (foundWord) source = "recent-chips";
        }

        if (!foundWord) {
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
        detectAndStoreLossKillerWord();
        registerLearnedWord(foundWord);
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