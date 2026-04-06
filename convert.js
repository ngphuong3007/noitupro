const fs = require('fs');
const path = require('path');

// Mặc định dùng Viet39K để cân bằng tốc độ và độ phủ.
// Có thể truyền tên file khi chạy: node convert.js Viet74K.txt
const inputName = process.argv[2] || 'Viet39K.txt';
const inputFile = path.join('vietnamese-wordlist-master', inputName);
const outputFile = path.join(__dirname, 'dictionary.json');
const customWordsFile = path.join(__dirname, 'custom_words.txt');
const csvPattern = /^verb\..+\.csv$/i;

// Bổ sung thủ công một số từ 2 chữ phổ biến để tăng vốn từ gợi ý.
const extraTwoWordPhrases = [
    'an nhiên', 'an lành', 'an tâm', 'an toàn',
    'bao dung', 'bao quát', 'bao bọc',
    'bình an', 'bình dị', 'bình minh', 'bình tĩnh',
    'chăm chỉ', 'chăm sóc', 'chân thành', 'chân thật',
    'dũng cảm', 'dứt khoát',
    'giản dị', 'giản đơn', 'giỏi giang',
    'hài hòa', 'hào hứng', 'hào sảng',
    'kiên định', 'kiên trì', 'kiệm lời',
    'linh hoạt', 'linh thiêng',
    'mạnh mẽ', 'mến khách', 'minh bạch',
    'nhanh nhẹn', 'nhân ái', 'nhẹ nhàng',
    'phong phú', 'phấn khởi',
    'quả quyết', 'quyết đoán',
    'rực rỡ', 'rộn ràng',
    'sáng suốt', 'sâu sắc', 'siêng năng',
    'thanh lịch', 'thân thiện', 'thẳng thắn', 'thật thà',
    'tinh tế', 'tinh thông', 'tỉnh táo',
    'vững vàng', 'vui vẻ',
    'xứng đáng',
    'yêu thương', 'yên bình'
];

// Loại các cặp nằm trong tên tỉnh/thành để tránh gợi ý vô nghĩa cho game nối từ.
const blockedProvinceBigrams = new Set([
    'an giang', 'bà rịa', 'vũng tàu', 'bạc liêu', 'bắc giang', 'bắc kạn', 'bắc ninh',
    'bến tre', 'bình định', 'bình dương', 'bình phước', 'bình thuận', 'cà mau',
    'cao bằng', 'cần thơ', 'đà nẵng', 'đắk lắk', 'đắk nông', 'điện biên', 'đồng nai',
    'đồng tháp', 'gia lai', 'hà giang', 'hà nam', 'hà nội', 'hà tĩnh', 'hải dương',
    'hải phòng', 'hậu giang', 'hòa bình', 'hưng yên', 'khánh hòa', 'kiên giang',
    'kon tum', 'lai châu', 'lâm đồng', 'lạng sơn', 'lào cai', 'long an', 'nam định',
    'nghệ an', 'ninh bình', 'ninh thuận', 'phú thọ', 'phú yên', 'quảng bình',
    'quảng nam', 'quảng ngãi', 'quảng ninh', 'quảng trị', 'sóc trăng', 'sơn la',
    'tây ninh', 'thái bình', 'thái nguyên', 'thanh hóa', 'thừa thiên', 'thiên huế',
    'tiền giang', 'trà vinh', 'tuyên quang', 'vĩnh long', 'vĩnh phúc', 'yên bái',
    'hồ chí', 'chí minh'
]);

// Từ lai hoặc thuật ngữ tiếng Anh thường xuất hiện trong wordlist tổng hợp.
const blockedForeignTokens = new Set([
    'app', 'auto', 'best', 'blog', 'chat', 'clip', 'code', 'cool', 'demo', 'fan', 'forum',
    'game', 'hot', 'idol', 'link', 'live', 'livestream', 'mini', 'model', 'offline',
    'ok', 'online', 'plus', 'pro', 'show', 'shock', 'shop', 'style', 'stream', 'super',
    'team', 'test', 'top', 'trend', 'video', 'vip', 'web'
]);

const filterStats = {
    kept: 0,
    removedProvince: 0,
    removedForeign: 0
};

function normalizePhrase(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[_.,;:!?"'`~@#$%^&*()+={}\[\]\\|<>/-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isTwoWordPhrase(text) {
    const parts = text.split(' ').filter(Boolean);
    return parts.length === 2;
}

function isValidToken(token) {
    return /^[a-zA-ZÀ-ỹđ]+$/.test(token);
}

function hasEnglishLikePattern(token) {
    if (!token) return false;
    if (blockedForeignTokens.has(token)) return true;
    if (/[fwjz]/.test(token)) return true;

    // Token thuần ASCII dài thường là từ ngoại lai.
    const isAsciiWord = /^[a-z]+$/.test(token);
    if (!isAsciiWord) return false;

    if (token.length >= 5) return true;
    return /(ing|ed|tion|ment|ship|ness|able|ive)$/.test(token);
}

function shouldKeepPhrase(phrase) {
    if (!phrase) return false;
    if (blockedProvinceBigrams.has(phrase)) {
        filterStats.removedProvince += 1;
        return false;
    }

    const parts = phrase.split(' ').filter(Boolean);
    if (parts.some(hasEnglishLikePattern)) {
        filterStats.removedForeign += 1;
        return false;
    }

    return true;
}

function getTwoWordPhrasesFromLine(text) {
    const parts = text.split(' ').filter(Boolean);
    if (parts.length < 2) return [];

    const phrases = [];

    // Giữ nguyên nếu đã là cụm 2 chữ.
    if (parts.length === 2 && isValidToken(parts[0]) && isValidToken(parts[1])) {
        phrases.push(parts.join(' '));
        return phrases;
    }

    // Với cụm dài hơn, trích từng cặp liền kề để tăng vốn từ 2 chữ.
    for (let i = 0; i < parts.length - 1; i += 1) {
        const a = parts[i];
        const b = parts[i + 1];
        if (!isValidToken(a) || !isValidToken(b)) continue;
        phrases.push(`${a} ${b}`);
    }

    return phrases;
}

function addPhrase(dictionary, phrase) {
    if (!phrase) return;
    if (!shouldKeepPhrase(phrase)) return;

    const firstPart = phrase.split(' ')[0];
    if (!dictionary[firstPart]) {
        dictionary[firstPart] = [];
    }
    if (!dictionary[firstPart].includes(phrase)) {
        dictionary[firstPart].push(phrase);
        filterStats.kept += 1;
    }
}

function loadCustomPhrasesFromFile() {
    if (!fs.existsSync(customWordsFile)) return [];

    const raw = fs.readFileSync(customWordsFile, 'utf8');
    return raw
        .split(/\r?\n/)
        .map(line => normalizePhrase(line))
        .filter(line => line && isTwoWordPhrase(line));
}

function loadPhrasesFromCsvFiles() {
    const files = fs.readdirSync(__dirname).filter(name => csvPattern.test(name));
    const phrases = [];

    files.forEach(fileName => {
        const filePath = path.join(__dirname, fileName);
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split(/\r?\n/).filter(Boolean);

        lines.forEach(line => {
            // CSV này chủ yếu là cụm từ ngăn bởi dấu phẩy, không có quote phức tạp.
            const cells = line.split(',');
            cells.forEach(cell => {
                const phrase = normalizePhrase(cell);
                if (phrase) phrases.push(phrase);
            });
        });
    });

    return { files, phrases };
}

try {
    const data = fs.readFileSync(path.join(__dirname, inputFile), 'utf8');
    const lines = data.split(/\r?\n/);
    const dictionary = {};
    const customPhrases = loadCustomPhrasesFromFile();
    const csvData = loadPhrasesFromCsvFiles();

    lines.forEach(line => {
        const phrase = normalizePhrase(line);
        if (!phrase) return;
        const derivedPhrases = getTwoWordPhrasesFromLine(phrase);
        derivedPhrases.forEach(p => addPhrase(dictionary, p));
    });

    extraTwoWordPhrases.forEach(phrase => {
        const normalized = normalizePhrase(phrase);
        if (!normalized || !isTwoWordPhrase(normalized)) return;
        addPhrase(dictionary, normalized);
    });

    customPhrases.forEach(phrase => {
        addPhrase(dictionary, phrase);
    });

    csvData.phrases.forEach(phrase => {
        const derivedPhrases = getTwoWordPhrasesFromLine(phrase);
        derivedPhrases.forEach(p => addPhrase(dictionary, p));
    });

    Object.keys(dictionary).forEach(key => {
        dictionary[key].sort((a, b) => a.localeCompare(b, 'vi'));
    });

    fs.writeFileSync(outputFile, JSON.stringify(dictionary, null, 2), 'utf8');
    console.log(`✅ Đã tạo dictionary 2 chữ thành công sang ${outputFile}`);
    console.log(`📦 CSV đã nạp: ${csvData.files.length} file`);
    console.log(`📦 Cụm từ đọc từ CSV: ${csvData.phrases.length}`);
    console.log(`📦 Từ custom thêm vào: ${customPhrases.length}`);
    console.log(`📊 Giữ lại: ${filterStats.kept}`);
    console.log(`🚫 Loại tỉnh/thành: ${filterStats.removedProvince}`);
    console.log(`🚫 Loại từ lai Anh: ${filterStats.removedForeign}`);
} catch (err) {
    console.error(`Lỗi rồi: Không đọc được file đầu vào ${inputFile}.`, err);
}