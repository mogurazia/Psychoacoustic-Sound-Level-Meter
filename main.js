let audioCtx, analyser, micStream;
let running = false;
let DB_OFFSET = 110;
let drawTimer = null;

const canvas = document.getElementById("psdCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ------------------------------
// UI Events
// ------------------------------
document.getElementById("startStopBtn").onclick = async () => {
  if (!running) startAudio();
  else stopAudio();
};

document.getElementById("calibBtn").onclick = () => {
  document.getElementById("calibDialog").style.display = "block";
  document.getElementById("calibInput").value = DB_OFFSET;
};
document.getElementById("calibOk").onclick = () => {
  DB_OFFSET = parseFloat(document.getElementById("calibInput").value);
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
    alert("マイクの使用を許可してください。");
  }
}

function stopAudio() {
  running = false;
  document.getElementById("startStopBtn").textContent = "Start";
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (drawTimer) clearInterval(drawTimer);
}

function updateAll() {
  if (!running) return;
  const buffer = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(buffer);
  const sampleRate = audioCtx.sampleRate;
  
  const results = calculateAcousticParameters(buffer, sampleRate);
  
  document.getElementById("dbaValue").textContent = results.SPL.toFixed(1);
  document.getElementById("loudnessValue").textContent = results.loudness.toFixed(2);
  document.getElementById("sharpnessValue").textContent = results.sharpness.toFixed(2);

  drawFFT(buffer, sampleRate);
}

// ------------------------------
// Calculation
// ------------------------------
function calculateAcousticParameters(buffer, sampleRate) {
  const BIN_f = sampleRate / analyser.fftSize;

  // 3rd oct
  const F_3RDOCT_CENTER = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
    ];
  const F_3RDOCT_LOWER = [
    17.8, 22.3, 28.1, 35.6, 44.5, 56.1, 71.3, 89.1, 111.4, 142.5,
    178.2, 222.7, 280.6, 356.4, 445.4, 561.3, 712.7, 890.9, 1113.6, 1425.4, 
    1781.8, 2227.2, 2806.3, 3563.6, 4454.5, 5612.7, 7127.2, 8909.0, 11136.2, 14254.4, 17818.0
  ];
  const F_3RDOCT_UPPER = [
    22.4, 28.1, 35.4, 44.9, 56.1, 70.7, 89.8, 112.2, 140.3, 179.6, 
    224.5, 280.6, 353.6, 449.0, 561.2, 707.2, 898.0, 1122.5, 1403.1, 1795.9,
    2244.9, 2806.2, 3535.8, 4489.8, 5612.3, 7071.5, 8979.7, 11224.6, 14030.8, 17959.4, 22449.2
  ];
  const EBR_CENTER = [
    0.198, 0.247, 0.311, 0.395, 0.494, 0.622, 0.790, 0.987, 1.232, 1.575, 
    1.963, 2.445, 3.061, 3.847, 4.736, 5.830, 7.141, 8.511, 9.974, 11.633, 
    13.104, 14.509, 15.888, 17.259, 18.539, 19.894, 21.275, 22.424, 23.345, 24.094, 24.575
  ];
  const EBR_DELTA = [
    0.046, 0.057, 0.072, 0.091, 0.114, 0.144, 0.183, 0.228, 0.284, 0.361, 
    0.448, 0.554, 0.684, 0.841, 1.005, 1.181, 1.350, 1.473, 1.542, 1.545, 
    1.492, 1.416, 1.347, 1.319, 1.340, 1.359, 1.277, 1.078, 0.830, 0.587, 0.422
  ];
  //  外耳ゲイン+中耳ゲイン
  const DB_GAIN = [
    -40, -31.5, -25.5, -21, -18.5, -16, -14, -12, -10.9, -9.2, 
    -8, -6.5, -4.5, -2.9, -2.2, -0.4, 0.1, 0.1, -1.3, 0.6, 
    3.8, 6.8, 8.1, 7.6, 3.7, -3.8, -10.5, -11.7, -10, -30, -57.5
  ];
  //  可聴レベル(0 phone)のエネルギー値
  const E_THRESHOLD = [
    70794578.4, 7413102.4, 891250.9, 128825, 25118.9, 5623.4, 1412.5, 446.7, 162.2, 61.7, 
    27.5, 13.8, 7.2, 4.2, 2.8, 2, 1.7, 1.7, 2.2, 1.5, 
    0.7, 0.4, 0.3, 0.3, 0.7, 4, 18.2, 24.5, 17, 316.2, 100000000 
  ];
  
  let E_3RDOCT_BAND = new Array(31).fill(0);
  let DB_3RDOCT_BAND = new Array(31).fill(0);
  let E_TOTAL_AW = 0;

  // SPA(dBA)計算用
  for (let i = 0; i < buffer.length; i++) {
    let f = i * BIN_f;
    if (f < 17.8 || f > 22449.2) continue;                          // 3rd oct, 20Hz Lower cutoff ~ 20kHz upper cuttoff

    let L_DB = buffer[i] + DB_OFFSET;
    // SPL計算用のA特性
    let L_DBA = L_DB + Aweight(f);
    E_TOTAL_AW += Math.pow(10, L_DBA / 10); // ➡ return SPLへ

    // 1/3オクターブに振り分け。※ここではまだエネルギー
    let L_ENERGY = Math.pow(10, L_DB / 10); // =10^(L_db/10)
    for (let j = 0; j < 31; j++) {
      if (f >= F_3RDOCT_LOWER[j] && f < F_3RDOCT_UPPER[j]) {
        E_3RDOCT_BAND[j] += L_ENERGY;                               // = sumifs(L_ENERGY, f >= Lower_cutoff & f < upper_cuttoff)
        break;
      }
    }
    console.log("E3b: " && E_3RDOCT_BAND[17]);
  }

  // Loudness計算
  let E_BAND_CORRECTED = new Array(31).fill(0);
  let DB_BAND_CORRECTED = new Array(31).fill(0);
  let N_BAND = new Array(31).fill(0);
  let TOTAL_LOUDNESS = 0;

  for (let i = 0; i < 31; i++) {
    if (E_3RDOCT_BAND[i] > 1e-12) {
        DB_3RDOCT_BAND[i] = 10 * Math.log10(E_3RDOCT_BAND[i]);      // 1/3オクターブに振り分けられたエネルギーをdB化
      }
    DB_BAND_CORRECTED[i] = DB_3RDOCT_BAND[i] + DB_GAIN[i];          // 1/3オクターブバントのdBに外耳ゲインと中耳ゲインを足す
    console.log("D3b: " && DB_BAND_CORRECTED[17]); //コンソール
    E_BAND_CORRECTED[i] = Math.pow(10, DB_BAND_CORRECTED[i] / 10);  // 補正されたオクターブバンドdBをエネルギーにする
    console.log("EBC: " && E_BAND_CORRECTED[17]);
    N_BAND[i] = Math.max(
      0.08 * Math.pow(E_THRESHOLD[i] / E_THRESHOLD[17], 0.23) * Math.pow(1 + (E_BAND_CORRECTED[i] / E_THRESHOLD[i]), 0.23) -1 ,
      0
    );  //=MAX(0.08*(Ethr/E0)^0.23*((1+E/Ethr)^0.23-1),0)
    console.log("N': " && N_BAND[17]);
    TOTAL_LOUDNESS += N_BAND[i] / EBR_DELTA[i];
  }

  // Sharpness計算
  let AURES = new Array(31).fill(0);
  let BAND_S = new Array(31).fill(0);
  let TOTAL_SHARPNESS = 0;

  for (let i = 0; i < 31; i++) {
    AURES[i] = 0.078 * (Math.exp(0.171 * EBR_CENTER[i]) / EBR_CENTER[i]) * (TOTAL_LOUDNESS / Math.log(0.05 * TOTAL_LOUDNESS + 1));
    BAND_S[i] = N_BAND[i] * EBR_CENTER[i] * AURES[i];
    TOTAL_SHARPNESS += BAND_S[i];
  }

  return {
    loudness: TOTAL_LOUDNESS,
    sharpness: TOTAL_SHARPNESS,
    SPL: 10 * Math.log10(E_TOTAL_AW + 1e-12),
  };
}

// ------------------------------
// Drawing
// ------------------------------
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
    
    // グラフ描画にもA特性を適用
    const db = buffer[i] + DB_OFFSET + Aweight(f);
    
    const x = freqToX(f, W);
    const y = dBToY(db, H);
    if (first) { ctx.moveTo(x, y); first = false; }
    else { ctx.lineTo(x, y); }
  }
  ctx.stroke();
}

function freqToX(f, W) { return W * (Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)); }

// 縦軸を -40dB ~ +40dB に調整
function dBToY(dB, H) { 
  return H * (40 - dB) / 80; 
}

function drawGrid(W, H) {
  ctx.strokeStyle = "#333";
  ctx.fillStyle = "#888";
  ctx.font = "10px sans-serif";
  
  const freqs = [20, 100, 1000, 10000, 20000];
  for (const f of freqs) {
    const x = freqToX(f, W);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.fillText(f >= 1000 ? (f/1000)+"k" : f, x + 2, H - 5);
  }
  
  // グリッドを -40 から +40 まで 20刻みで描画
  for (let d = -40; d <= 40; d += 20) {
    const y = dBToY(d, H);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillText(d + "dB", 5, y - 5);
  }
}

// ------------------------------
// A-weight
// ------------------------------
function Aweight(x) {
  const f1 = 432.64;    //20.8^2
  const f2 = 11599.29;  //107.7^2
  const f3 = 544496.41; //737.9^2
  const f4 = 148693636; //12194^2
  const x2 = x * x;
  return 20 * Math.log10((f4 * x2 * x2) / ((x2 + f1) * Math.sqrt(x2 + f2) * Math.sqrt(x2 + f3) * (x2 + f4))) + 2;
}

// ------------------------------
// Hz to Bark
// ------------------------------
function hzToBark(x) {
  return 13 * Math.atan(0.00076 * x) + 3.5 * Math.atan(0.0000000177768889 * x * x);
}