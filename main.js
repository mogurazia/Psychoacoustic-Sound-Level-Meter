// ==========================================
// SPL(dBA), Loudness(sone), Sharpness(acum) Realtime Analyzer
// ==========================================
const DB_OFFSET_DEFAULT = 110;  // AudioContextの仕様 -100 ~ 0 dB ➡ スマホの場合およそ +110dB 程度なのでデフォルト補正値を +100 に設定
const BAND_COUNT = 31;

// 3rd oct center, Hz
const F_3RDOCT_CENTER = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
];
// 3rd oct lower cutoff, Hz
const F_3RDOCT_LOWER = [
    17.8, 22.3, 28.1, 35.6, 44.5, 56.1, 71.3, 89.1, 111.4, 142.5,
    178.2, 222.7, 280.6, 356.4, 445.4, 561.3, 712.7, 890.9, 1113.6, 1425.4,
    1781.8, 2227.2, 2806.3, 3563.6, 4454.5, 5612.7, 7127.2, 8909.0, 11136.2, 14254.4, 17818.0
];
// 3rd Oct upper cutoff, Hz
const F_3RDOCT_UPPER = [
    22.4, 28.1, 35.4, 44.9, 56.1, 70.7, 89.8, 112.2, 140.3, 179.6,
    224.5, 280.6, 353.6, 449.0, 561.2, 707.2, 898.0, 1122.5, 1403.1, 1795.9,
    2244.9, 2806.2, 3535.8, 4489.8, 5612.3, 7071.5, 8979.7, 11224.6, 14030.8, 17959.4, 22449.2
];
// 3rd oct center, bark
const EBR_CENTER = [
    0.198, 0.247, 0.311, 0.395, 0.494, 0.622, 0.790, 0.987, 1.232, 1.575,
    1.963, 2.445, 3.061, 3.847, 4.736, 5.830, 7.141, 8.511, 9.974, 11.633,
    13.104, 14.509, 15.888, 17.259, 18.539, 19.894, 21.275, 22.424, 23.345, 24.094, 24.575
];
// 3rd oct band width, bark
const EBR_DELTA = [
    0.046, 0.057, 0.072, 0.091, 0.114, 0.144, 0.183, 0.228, 0.284, 0.361,
    0.448, 0.554, 0.684, 0.841, 1.005, 1.181, 1.350, 1.473, 1.542, 1.545,
    1.492, 1.416, 1.347, 1.319, 1.340, 1.359, 1.277, 1.078, 0.830, 0.587, 0.422
];
// Outer and middle/inner ear filter, dB, ECMA-418-2
const DB_GAIN = [
    -24.3, -22.4, -20.4, -18.4, -16.5, -14.7, -12.8, -11.2,  -9.7,  -8.2,
     -7.0,  -5.8,  -4.4,  -2.9,  -1.4,   0.2,   1.4,   0,    -3,    -1.8,
      1.3,   3.5,   5.2,   6.4,   3.7,  -3.2,  -9,   -10.2, -10.4,  -15.1, -25.9
];
// Threshold energy of 0 phone
const E_THRESHOLD = [
    70794578.4, 7413102.4, 891250.9, 128825, 25118.9, 5623.4, 1412.5, 446.7, 162.2, 61.7,
    27.5, 13.8, 7.2, 4.2, 2.8, 2, 1.7, 1.7, 2.2, 1.5,
    0.7, 0.4, 0.3, 0.3, 0.7, 4, 18.2, 24.5, 17, 316.2, 100000000
];

// グローバル変数
let audioCtx, analyser, micStream;
let running = false;
let DB_OFFSET = DB_OFFSET_DEFAULT;
let drawTimer = null;

const canvas = document.getElementById("psdCanvas");
const ctx = canvas.getContext("2d");

// FFTグラフ用スライド縦線
let sliderFreq = 1000; // 初期周波数（Hz）
let isSliding = false;
let sliderX = null;

// ==========================================
// 2. UI & Audio Control
// ==========================================
function resizeCanvas() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

document.getElementById("startStopBtn").onclick = async () => {
    if (!running) await startAudio();
    else stopAudio();
};

document.getElementById("calibBtn").onclick = () => {
    document.getElementById("calibDialog").style.display = "block";
    document.getElementById("calibInput").value = DB_OFFSET;
};

document.getElementById("calibOk").onclick = () => {
    DB_OFFSET = parseFloat(document.getElementById("calibInput").value) || DB_OFFSET_DEFAULT;
    document.getElementById("calibDialog").style.display = "none";
};

document.getElementById("calibCancel").onclick = () => {
    document.getElementById("calibDialog").style.display = "none";
};

async function startAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    try {
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        const src = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 16384;
        src.connect(analyser);

        running = true;
        document.getElementById("startStopBtn").textContent = "Stop";
        if (drawTimer) clearInterval(drawTimer);
        drawTimer = setInterval(updateAll, 100);
    } catch (e) {
        alert("Turn on the microphone.");
    }
}

function stopAudio() {
    running = false;
    document.getElementById("startStopBtn").textContent = "Start";
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (drawTimer) clearInterval(drawTimer);
}

// ==========================================
// 3. Calculation Logic
// ==========================================
function updateAll() {
    if (!running) return;
    const buffer = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(buffer);
    const sampleRate = audioCtx.sampleRate;

    const results = calculateAcousticParameters(buffer, sampleRate);

    document.getElementById("dbaValue").textContent = results.SPL.toFixed(1);
    document.getElementById("loudnessValue").textContent = results.loudness.toFixed(2);
    document.getElementById("sharpnessValue").textContent = results.sharpness.toFixed(2);
    // document.getElementById("sharpnessHz").textContent = results.sharpnessPeakHz.toFixed(0);

    drawFFT(buffer, sampleRate);
}

function calculateAcousticParameters(buffer, sampleRate) {
    const BIN_f = sampleRate / analyser.fftSize;
    let E_3RDOCT_BAND = new Float32Array(BAND_COUNT).fill(0);
    let E_TOTAL_AW = 0;
    // let BandMaxHz = new Array(BAND_COUNT).fill(0);
    // let BandMaxDB = new Array(BAND_COUNT).fill(-Infinity);

    // --- 周波数ビンごとの集計 ---
    for (let i = 0; i < buffer.length; i++) {
        const f = i * BIN_f;
        if (f < 17.8 || f > 22449.2) continue;

        const L_DB = buffer[i] + DB_OFFSET;
        
        // SPL計算用(A特性エネルギー)
        const L_DBA = L_DB + Aweight(f);
        E_TOTAL_AW += Math.pow(10, L_DBA / 10);

        // 1/3オクターブバンドへの振り分け
        const L_ENERGY = Math.pow(10, L_DB / 10);
        for (let j = 0; j < BAND_COUNT; j++) {
            if (f >= F_3RDOCT_LOWER[j] && f < F_3RDOCT_UPPER[j]) {
                E_3RDOCT_BAND[j] += L_ENERGY;
            }
                // // バンド毎ピークの保存
                // if (L_DB > BandMaxDB[j]) {
                //    BandMaxDB[j] = L_DB;
                //    BandMaxHz[j] = f;
                // }
        }
    }

    // --- Loudness 計算 ---
    let TOTAL_LOUDNESS = 0;
    const N_BAND = new Float32Array(BAND_COUNT);

    for (let i = 0; i < BAND_COUNT; i++) {
        let dbBand = -Infinity;
        if (E_3RDOCT_BAND[i] > 1e-12) {
            dbBand = 10 * Math.log10(E_3RDOCT_BAND[i]);
        }

        const dbCorrected = dbBand + DB_GAIN[i];
        const eCorrected = Math.pow(10, dbCorrected / 10);

        // Barkごとの比ラウドネス
        N_BAND[i] = Math.max(
            0.08 * Math.pow(E_THRESHOLD[i] / E_THRESHOLD[17], 0.23) * (Math.pow(1 + eCorrected / E_THRESHOLD[i], 0.23) - 1),
            0
        );
        TOTAL_LOUDNESS += N_BAND[i] / EBR_DELTA[i];
    }

    // --- Sharpness 計算 ---
    let TOTAL_SHARPNESS = 0;
    let maxBandS = -1;
    let maxSIndex = -1;
    // 無音付近での NaN 回避
    if (TOTAL_LOUDNESS > 0.0001) {
        const sharpnessLogTerm = TOTAL_LOUDNESS / Math.log(0.05 * TOTAL_LOUDNESS + 1);
        for (let i = 0; i < BAND_COUNT; i++) {
            const aures = 0.078 * (Math.exp(0.171 * EBR_CENTER[i]) / EBR_CENTER[i]) * sharpnessLogTerm;
            const bandS = N_BAND[i] * EBR_CENTER[i] * aures;
            TOTAL_SHARPNESS += 0.11 * bandS / TOTAL_LOUDNESS;
            //
            if (bandS > maxBandS){
                maxBandS = bandS;
                maxSIndex = i;
            }
        }
    }

    return {
        loudness: TOTAL_LOUDNESS,
        sharpness: TOTAL_SHARPNESS,
        SPL: 10 * Math.log10(E_TOTAL_AW + 1e-12),
        // sharpnessPeakHz: F_3RDOCT_CENTER[maxSIndex] //BandMaxHz[maxSIndex],
    };
}

// ==========================================
// 4. Drawing & Utilities
// ==========================================
function drawFFT(buffer, sampleRate) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, W, H);

    drawGrid(W, H);

    const BIN_f = sampleRate / analyser.fftSize;
    ctx.strokeStyle = "#00FF00";
    ctx.lineWidth = 2;
    ctx.beginPath();

    let first = true;
    for (let i = 0; i < buffer.length; i++) {
        const f = i * BIN_f;
        if (f < 20 || f > 20000) continue;

        const db = buffer[i] + DB_OFFSET + Aweight(f);
        const x = freqToX(f, W);
        const y = dBToY(db, H);

        if (first) { ctx.moveTo(x, y); first = false; }
        else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    // --- スライド縦線の描画 ---
    ctx.save();
    ctx.strokeStyle = "#FF0000";
    ctx.lineWidth = 2;
    let x = freqToX(sliderFreq, W);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.restore();

    // 周波数ラベル表示
    ctx.save();
    ctx.fillStyle = "#FF0000";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(sliderFreq.toFixed(1) + " Hz", x + 5, 20);
    ctx.restore();
}

function freqToX(f, W) { 
    return W * (Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)); 
}

function dBToY(dB, H) { 
    return H * (40 - dB) / 80; 
}

function drawGrid(W, H) {
    ctx.strokeStyle = "#888";
    ctx.fillStyle = "#888";
    ctx.font = "10px sans-serif";

    const MajorX = [20, 100, 1000, 10000, 20000];
    for (const f of MajorX) {
        const x = freqToX(f, W);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.fillText(f >= 1000 ? (f / 1000) + "k" : f, x + 2, H - 5);
    }
    for (let d = -40; d <= 40; d += 10) {
        const y = dBToY(d, H);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.fillText(d + "dB", 5, y - 5);
    }

    ctx.strokeStyle = "#333";
    const MinorX = [30,40,50,60,70,80,90,200,300,400,500,600,700,800,900,2000,3000,4000,5000,6000,7000,8000,9000];
    for (const f of MinorX) {
        const x = freqToX(f, W);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
}

function Aweight(x) {
    const f1 = 432.64, f2 = 11599.29, f3 = 544496.41, f4 = 148693636;
    const x2 = x * x;
    return 20 * Math.log10((f4 * x2 * x2) / ((x2 + f1) * Math.sqrt(x2 + f2) * Math.sqrt(x2 + f3) * (x2 + f4))) + 2;
}

// --- FFTグラフスライド縦線のスワイプ操作 ---
canvas.addEventListener("touchstart", function(e) {
    if (e.touches.length === 1) {
        isSliding = true;
        sliderX = e.touches[0].clientX;
        e.preventDefault();
    }
});
canvas.addEventListener("touchmove", function(e) {
    if (isSliding && e.touches.length === 1) {
        let dx = e.touches[0].clientX - sliderX;
        sliderX = e.touches[0].clientX;
        // キャンバス幅に合わせて周波数変換
        let W = canvas.width;
        let x = freqToX(sliderFreq, W) + dx;
        // x座標から周波数へ逆変換
        let minX = freqToX(20, W);
        let maxX = freqToX(20000, W);
        x = Math.max(minX, Math.min(maxX, x));
        sliderFreq = 20 * Math.pow(10, (x / W) * (Math.log10(20000) - Math.log10(20)) + Math.log10(20) - Math.log10(20));
        e.preventDefault();
    }
});
canvas.addEventListener("touchend", function(e) {
    isSliding = false;
    sliderX = null;
    e.preventDefault();
});
// マウス操作にも対応（PC用）
canvas.addEventListener("mousedown", function(e) {
    isSliding = true;
    sliderX = e.clientX;
});
canvas.addEventListener("mousemove", function(e) {
    if (isSliding) {
        let dx = e.clientX - sliderX;
        sliderX = e.clientX;
        let W = canvas.width;
        let x = freqToX(sliderFreq, W) + dx;
        let minX = freqToX(20, W);
        let maxX = freqToX(20000, W);
        x = Math.max(minX, Math.min(maxX, x));
        sliderFreq = 20 * Math.pow(10, (x / W) * (Math.log10(20000) - Math.log10(20)) + Math.log10(20) - Math.log10(20));
    }
});
canvas.addEventListener("mouseup", function(e) {
    isSliding = false;
    sliderX = null;
});
canvas.addEventListener("mouseleave", function(e) {
    isSliding = false;
    sliderX = null;
});