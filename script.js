// グローバル変数
let video;
let canvas;
let ctx;
let stream = null;
let detector = null;
let animationId = null;
let detectedMarkers = new Map(); // マーカーIDと検出時刻を保存

// 盤面関連の変数
let boardCalibrated = false;
let boardBounds = null; // {minX, maxX, minY, maxY}
let boardCorners = null; // {a1, h1, a8, h8} - 盤面の四隅の座標
let boardState = Array(8).fill(null).map(() => Array(8).fill(null)); // 8x8の盤面（表示用）
let boardTracking = []; // 追跡用：各マスのピースIDと信頼度
let lastBoardUpdateTime = 0; // 最後に盤面を更新した時刻

// boardTrackingを初期化
for (let i = 0; i < 8; i++) {
    boardTracking[i] = [];
    for (let j = 0; j < 8; j++) {
        boardTracking[i][j] = { pieceId: null, confidence: 0 };
    }
}

// 信頼性設定
const CONFIDENCE_THRESHOLD = 2; // この回数以上連続検出されたら表示
const CONFIDENCE_DECAY = 1; // 検出されない時の信頼度減少量
const CONFIDENCE_INCREASE = 2; // 検出された時の信頼度増加量
const CONFIDENCE_INITIAL = 3; // 新規検出時の初期信頼度
const MAX_CONFIDENCE = 10; // 最大信頼度

// ピース名のマッピング
const pieceNames = {
    0: { name: 'キング', color: 'white', symbol: '♔' },
    1: { name: 'クイーン', color: 'white', symbol: '♕' },
    2: { name: 'ルーク1', color: 'white', symbol: '♖' },
    3: { name: 'ルーク2', color: 'white', symbol: '♖' },
    4: { name: 'ビショップ1', color: 'white', symbol: '♗' },
    5: { name: 'ビショップ2', color: 'white', symbol: '♗' },
    6: { name: 'ナイト1', color: 'white', symbol: '♘' },
    7: { name: 'ナイト2', color: 'white', symbol: '♘' },
    8: { name: 'ポーン1', color: 'white', symbol: '♙' },
    9: { name: 'ポーン2', color: 'white', symbol: '♙' },
    10: { name: 'ポーン3', color: 'white', symbol: '♙' },
    11: { name: 'ポーン4', color: 'white', symbol: '♙' },
    12: { name: 'ポーン5', color: 'white', symbol: '♙' },
    13: { name: 'ポーン6', color: 'white', symbol: '♙' },
    14: { name: 'ポーン7', color: 'white', symbol: '♙' },
    15: { name: 'ポーン8', color: 'white', symbol: '♙' },
    16: { name: 'キング', color: 'black', symbol: '♚' },
    17: { name: 'クイーン', color: 'black', symbol: '♛' },
    18: { name: 'ルーク1', color: 'black', symbol: '♜' },
    19: { name: 'ルーク2', color: 'black', symbol: '♜' },
    20: { name: 'ビショップ1', color: 'black', symbol: '♝' },
    21: { name: 'ビショップ2', color: 'black', symbol: '♝' },
    22: { name: 'ナイト1', color: 'black', symbol: '♞' },
    23: { name: 'ナイト2', color: 'black', symbol: '♞' },
    24: { name: 'ポーン1', color: 'black', symbol: '♟' },
    25: { name: 'ポーン2', color: 'black', symbol: '♟' },
    26: { name: 'ポーン3', color: 'black', symbol: '♟' },
    27: { name: 'ポーン4', color: 'black', symbol: '♟' },
    28: { name: 'ポーン5', color: 'black', symbol: '♟' },
    29: { name: 'ポーン6', color: 'black', symbol: '♟' },
    30: { name: 'ポーン7', color: 'black', symbol: '♟' },
    31: { name: 'ポーン8', color: 'black', symbol: '♟' },
    // 盤面の四隅用マーカー
    32: { name: '盤面マーカー a1', color: 'board', symbol: '⊙' },
    33: { name: '盤面マーカー h1', color: 'board', symbol: '⊙' },
    34: { name: '盤面マーカー a8', color: 'board', symbol: '⊙' },
    35: { name: '盤面マーカー h8', color: 'board', symbol: '⊙' }
};

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', () => {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    // js-aruco2のディテクターを初期化（ARUCO辞書を明示的に指定）
    detector = new AR.Detector({ dictionaryName: 'ARUCO' });

    const startButton = document.getElementById('startCamera');
    const stopButton = document.getElementById('stopCamera');
    const calibrateButton = document.getElementById('calibrateBoard');

    startButton.addEventListener('click', startCamera);
    stopButton.addEventListener('click', stopCamera);
    // イベントリスナーを削除（onclick属性を使用）
    // calibrateButton.addEventListener('click', calibrateBoard);

    // 盤面を初期化して描画
    initializeChessBoard();

    updateStatus('準備完了 - カメラを起動してください');
    console.log('js-aruco2 detector initialized');
});

// ステータステキストを更新
function updateStatus(message, type = 'info') {
    const statusDiv = document.querySelector('.status');
    const statusText = document.getElementById('statusText');

    statusText.textContent = message;

    // 以前のステータスクラスを削除
    statusDiv.classList.remove('status-success', 'status-error', 'status-info');

    // 新しいステータスクラスを追加
    if (type === 'success') {
        statusDiv.classList.add('status-success');
    } else if (type === 'error') {
        statusDiv.classList.add('status-error');
    } else {
        statusDiv.classList.add('status-info');
    }
}

// デバッグ情報を更新（スマホでも見えるように）
function updateDebugInfo(message) {
    const debugInfo = document.getElementById('debugInfo');
    if (debugInfo) {
        const timestamp = new Date().toLocaleTimeString();
        debugInfo.textContent = `[${timestamp}] ${message}`;
        console.log(message);
    }
}

// カメラ起動
async function startCamera() {
    try {
        updateDebugInfo('カメラ起動を試行中...');

        // カメラストリームを取得（解像度を小さめに）
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // 背面カメラを優先
                width: { ideal: 640 },
                height: { ideal: 480 }
            }
        });

        video.srcObject = stream;

        await video.play();

        // ビデオのサイズを強制的に設定
        setTimeout(() => {
            // 最大幅を350pxに制限
            const maxWidth = 350;
            const videoWidth = video.videoWidth || 640;
            const videoHeight = video.videoHeight || 480;
            const scale = maxWidth / videoWidth;

            canvas.width = videoWidth;
            canvas.height = videoHeight;

            // 表示サイズを強制的に制限（setAttributeを使用）
            video.setAttribute('style', `width: ${maxWidth}px !important; height: ${Math.round(videoHeight * scale)}px !important; max-width: ${maxWidth}px !important;`);
            canvas.setAttribute('style', `width: ${maxWidth}px !important; height: ${Math.round(videoHeight * scale)}px !important; max-width: ${maxWidth}px !important;`);

            // video-containerも強制的にサイズ制限
            const container = video.parentElement;
            if (container) {
                container.setAttribute('style', `max-width: ${maxWidth}px !important; width: ${maxWidth}px !important; margin: 0 auto 20px !important;`);
            }

            updateDebugInfo('カメラサイズ設定: ' + maxWidth + 'px (元: ' + videoWidth + 'x' + videoHeight + ')');
        }, 500);

        document.getElementById('startCamera').disabled = true;
        document.getElementById('stopCamera').disabled = false;
        document.getElementById('calibrateBoard').disabled = false;

        updateStatus('カメラ起動中 - マーカーを検出しています...');
        updateDebugInfo('カメラ起動成功！キャリブレーションボタンが有効になりました');

        // マーカー検出ループ開始
        detectMarkers();

    } catch (error) {
        console.error('カメラアクセスエラー:', error);
        updateStatus('カメラへのアクセスに失敗しました: ' + error.message);
        updateDebugInfo('エラー: ' + error.message);
    }
}

// カメラ停止
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    video.srcObject = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    document.getElementById('startCamera').disabled = false;
    document.getElementById('stopCamera').disabled = true;
    document.getElementById('calibrateBoard').disabled = true;

    detectedMarkers.clear();
    updateMarkerList();
    updateStatus('カメラ停止');
}

// マーカー検出処理
function detectMarkers() {
    if (!video.srcObject) return;

    try {
        // ビデオフレームをキャンバスに描画
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // キャンバスからImageDataを取得
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // js-aruco2でマーカー検出
        const markers = detector.detect(imageData);

        // 検出されたマーカーを描画
        drawMarkers(markers);

        // マーカー情報を更新
        updateDetectedMarkers(markers);

    } catch (error) {
        console.error('マーカー検出エラー:', error);
    }

    // 次のフレームを処理
    animationId = requestAnimationFrame(detectMarkers);
}

// マーカーをキャンバスに描画
function drawMarkers(markers) {
    ctx.lineWidth = 3;

    for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        const corners = marker.corners;

        // マーカーの輪郭を描画
        ctx.strokeStyle = 'red';
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let j = 1; j < corners.length; j++) {
            ctx.lineTo(corners[j].x, corners[j].y);
        }
        ctx.closePath();
        ctx.stroke();

        // マーカーIDを描画
        const centerX = corners.reduce((sum, c) => sum + c.x, 0) / corners.length;
        const centerY = corners.reduce((sum, c) => sum + c.y, 0) / corners.length;

        ctx.fillStyle = 'red';
        ctx.font = '20px Arial';
        ctx.fillText('ID: ' + marker.id, centerX - 20, centerY - 10);

        // 各コーナーに小さな円を描画
        ctx.fillStyle = 'lime';
        for (let j = 0; j < corners.length; j++) {
            ctx.beginPath();
            ctx.arc(corners[j].x, corners[j].y, 5, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

// 検出されたマーカー情報を更新
function updateDetectedMarkers(markers) {
    const currentTime = Date.now();
    const newMarkers = new Map();

    // 検出されたマーカーを処理
    for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        const corners = marker.corners;

        // マーカーの中心座標を計算
        const centerX = Math.round(corners.reduce((sum, c) => sum + c.x, 0) / corners.length);
        const centerY = Math.round(corners.reduce((sum, c) => sum + c.y, 0) / corners.length);

        newMarkers.set(marker.id, {
            id: marker.id,
            x: centerX,
            y: centerY,
            lastSeen: currentTime,
            corners: corners
        });
    }

    // 古いマーカー情報を削除（3秒以上検出されていないもの）
    for (const [id, marker] of detectedMarkers) {
        if (currentTime - marker.lastSeen < 3000 || newMarkers.has(id)) {
            if (newMarkers.has(id)) {
                detectedMarkers.set(id, newMarkers.get(id));
            }
        } else {
            detectedMarkers.delete(id);
        }
    }

    // 新規マーカーを追加
    for (const [id, marker] of newMarkers) {
        if (!detectedMarkers.has(id)) {
            detectedMarkers.set(id, marker);
        }
    }

    updateMarkerList();

    // 四隅マーカーを検出したら自動的に盤面設定
    autoCalibrateFromCorners();

    // 盤面状態を更新（200msに1回：信頼度システムがあるので頻繁に更新）
    if (boardCalibrated && currentTime - lastBoardUpdateTime > 200) {
        updateBoardState();
        lastBoardUpdateTime = currentTime;
    }
}

// マーカーリスト表示を更新
function updateMarkerList() {
    const markerListDiv = document.getElementById('markerList');

    if (detectedMarkers.size === 0) {
        markerListDiv.innerHTML = 'マーカーが検出されていません';
        return;
    }

    let html = '';
    const sortedMarkers = Array.from(detectedMarkers.values()).sort((a, b) => a.id - b.id);

    for (const marker of sortedMarkers) {
        const timeSinceLastSeen = Date.now() - marker.lastSeen;
        const isActive = timeSinceLastSeen < 1000;
        const statusIndicator = isActive ? '🟢' : '🟡';

        html += `
            <div class="marker-item" style="opacity: ${isActive ? 1 : 0.6}">
                <span class="marker-id">${statusIndicator} マーカーID: ${marker.id}</span>
                <span class="marker-position">位置: (${marker.x}, ${marker.y})</span>
            </div>
        `;
    }

    markerListDiv.innerHTML = html;
    updateStatus(`${detectedMarkers.size}個のマーカーを検出中`);
}

// チェス盤を初期化して描画
function initializeChessBoard() {
    const boardDiv = document.getElementById('chessBoard');
    boardDiv.innerHTML = '';

    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement('div');
            square.className = 'chess-square';
            square.classList.add((row + col) % 2 === 0 ? 'light' : 'dark');
            square.dataset.row = row;
            square.dataset.col = col;

            // マス目のラベル（a1, b2など）
            const label = document.createElement('span');
            label.className = 'square-label';
            label.textContent = files[col] + ranks[row];
            square.appendChild(label);

            boardDiv.appendChild(square);
        }
    }
}

// 四隅マーカーから自動キャリブレーション
function autoCalibrateFromCorners() {
    // 四隅のマーカー（ID: 32=a1, 33=h1, 34=a8, 35=h8）を取得
    const a1Marker = detectedMarkers.get(32);
    const h1Marker = detectedMarkers.get(33);
    const a8Marker = detectedMarkers.get(34);
    const h8Marker = detectedMarkers.get(35);

    // 検出されたマーカーの数を確認
    const detected = [a1Marker, h1Marker, a8Marker, h8Marker].filter(m => m !== undefined);

    if (detected.length < 2) {
        // 2つ未満の場合はキャリブレーション不可
        if (boardCalibrated) {
            boardCalibrated = false;
            boardBounds = null;
            boardCorners = null;
            updateStatus('四隅マーカーが2つ以上必要です', 'error');
        }
        return;
    }

    // マーカー位置を推定・補完
    let a1Pos = a1Marker;
    let h1Pos = h1Marker;
    let a8Pos = a8Marker;
    let h8Pos = h8Marker;

    // 3つ検出されている場合、4つ目を計算
    if (detected.length === 3) {
        // 平行四辺形の性質を利用：対角線の交点が中点
        // h8 = h1 + a8 - a1 (a1が欠けている場合以外)
        if (!a1Marker && h1Marker && a8Marker && h8Marker) {
            // a1 を計算: a1 = h1 + a8 - h8
            a1Pos = { x: h1Marker.x + a8Marker.x - h8Marker.x, y: h1Marker.y + a8Marker.y - h8Marker.y };
        } else if (a1Marker && !h1Marker && a8Marker && h8Marker) {
            // h1 を計算: h1 = a1 + h8 - a8
            h1Pos = { x: a1Marker.x + h8Marker.x - a8Marker.x, y: a1Marker.y + h8Marker.y - a8Marker.y };
        } else if (a1Marker && h1Marker && !a8Marker && h8Marker) {
            // a8 を計算: a8 = a1 + h8 - h1
            a8Pos = { x: a1Marker.x + h8Marker.x - h1Marker.x, y: a1Marker.y + h8Marker.y - h1Marker.y };
        } else if (a1Marker && h1Marker && a8Marker && !h8Marker) {
            // h8 を計算: h8 = h1 + a8 - a1
            h8Pos = { x: h1Marker.x + a8Marker.x - a1Marker.x, y: h1Marker.y + a8Marker.y - a1Marker.y };
        }
    }
    // 2つ検出されている場合、残り2つを推定
    else if (detected.length === 2) {
        // 対角線上のペア
        if (a1Marker && h8Marker && !h1Marker && !a8Marker) {
            // a1とh8から、h1とa8を推定
            // 中心点を計算
            const centerX = (a1Marker.x + h8Marker.x) / 2;
            const centerY = (a1Marker.y + h8Marker.y) / 2;
            // h1とa8は中心から等距離、a1-h8に垂直方向
            const dx = h8Marker.x - a1Marker.x;
            const dy = h8Marker.y - a1Marker.y;
            // 90度回転（時計回りと反時計回り）
            h1Pos = { x: centerX + dy / 2, y: centerY - dx / 2 };
            a8Pos = { x: centerX - dy / 2, y: centerY + dx / 2 };
        } else if (h1Marker && a8Marker && !a1Marker && !h8Marker) {
            // h1とa8から、a1とh8を推定
            const centerX = (h1Marker.x + a8Marker.x) / 2;
            const centerY = (h1Marker.y + a8Marker.y) / 2;
            const dx = a8Marker.x - h1Marker.x;
            const dy = a8Marker.y - h1Marker.y;
            a1Pos = { x: centerX + dy / 2, y: centerY - dx / 2 };
            h8Pos = { x: centerX - dy / 2, y: centerY + dx / 2 };
        }
        // 隣接するペア（底辺）
        else if (a1Marker && h1Marker && !a8Marker && !h8Marker) {
            // a1-h1から上辺を推定（90度回転して同じ長さのベクトル）
            const dx = h1Marker.x - a1Marker.x;
            const dy = h1Marker.y - a1Marker.y;
            a8Pos = { x: a1Marker.x - dy, y: a1Marker.y + dx };
            h8Pos = { x: h1Marker.x - dy, y: h1Marker.y + dx };
        }
        // 隣接するペア（上辺）
        else if (a8Marker && h8Marker && !a1Marker && !h1Marker) {
            const dx = h8Marker.x - a8Marker.x;
            const dy = h8Marker.y - a8Marker.y;
            a1Pos = { x: a8Marker.x + dy, y: a8Marker.y - dx };
            h1Pos = { x: h8Marker.x + dy, y: h8Marker.y - dx };
        }
        // 隣接するペア（左辺）
        else if (a1Marker && a8Marker && !h1Marker && !h8Marker) {
            const dx = a8Marker.x - a1Marker.x;
            const dy = a8Marker.y - a1Marker.y;
            h1Pos = { x: a1Marker.x + dy, y: a1Marker.y - dx };
            h8Pos = { x: a8Marker.x + dy, y: a8Marker.y - dx };
        }
        // 隣接するペア（右辺）
        else if (h1Marker && h8Marker && !a1Marker && !a8Marker) {
            const dx = h8Marker.x - h1Marker.x;
            const dy = h8Marker.y - h1Marker.y;
            a1Pos = { x: h1Marker.x - dy, y: h1Marker.y + dx };
            a8Pos = { x: h8Marker.x - dy, y: h8Marker.y + dx };
        }
    }

    // すべての位置が揃っているか確認
    if (!a1Pos || !h1Pos || !a8Pos || !h8Pos) {
        if (boardCalibrated) {
            boardCalibrated = false;
            boardBounds = null;
            boardCorners = null;
            updateStatus('マーカー位置の推定に失敗しました', 'error');
        }
        return;
    }

    // 中心点を計算
    const centerX = (a1Pos.x + h1Pos.x + a8Pos.x + h8Pos.x) / 4;
    const centerY = (a1Pos.y + h1Pos.y + a8Pos.y + h8Pos.y) / 4;

    // 盤面の四隅を計算
    // マーカーは盤面の外側にあるので、中心方向に少し内側に調整
    // 実際の印刷物では、マーカーは20cm×20cmの範囲の隅にあり、
    // 盤面は16cm×16cmなので、80%の位置が実際の盤面の角
    const shrinkFactor = 0.80; // 80% = 16cm / 20cm

    // 各マーカーから中心への方向に shrinkFactor 倍移動した位置が盤面の角
    const a1Corner = {
        x: a1Pos.x + (centerX - a1Pos.x) * (1 - shrinkFactor),
        y: a1Pos.y + (centerY - a1Pos.y) * (1 - shrinkFactor)
    };

    const h1Corner = {
        x: h1Pos.x + (centerX - h1Pos.x) * (1 - shrinkFactor),
        y: h1Pos.y + (centerY - h1Pos.y) * (1 - shrinkFactor)
    };

    const a8Corner = {
        x: a8Pos.x + (centerX - a8Pos.x) * (1 - shrinkFactor),
        y: a8Pos.y + (centerY - a8Pos.y) * (1 - shrinkFactor)
    };

    const h8Corner = {
        x: h8Pos.x + (centerX - h8Pos.x) * (1 - shrinkFactor),
        y: h8Pos.y + (centerY - h8Pos.y) * (1 - shrinkFactor)
    };

    // 盤面の四隅を保存（座標変換に使用）
    boardCorners = {
        a1: a1Corner,  // 左下（白から見て）
        h1: h1Corner,  // 右下
        a8: a8Corner,  // 左上
        h8: h8Corner   // 右上
    };

    // 盤面の範囲を設定（計算した四隅から最小・最大を取得）
    const allX = [a1Corner.x, h1Corner.x, a8Corner.x, h8Corner.x];
    const allY = [a1Corner.y, h1Corner.y, a8Corner.y, h8Corner.y];

    boardBounds = {
        minX: Math.min(...allX),
        maxX: Math.max(...allX),
        minY: Math.min(...allY),
        maxY: Math.max(...allY)
    };

    // キャリブレーション成功
    const missingCount = 4 - detected.length;
    if (!boardCalibrated) {
        boardCalibrated = true;
        const statusMsg = missingCount > 0
            ? `キャリブレーション成功！(${detected.length}/4マーカー検出、${missingCount}個を推定)`
            : '自動キャリブレーション成功！四隅マーカーを検出';
        updateStatus(statusMsg, 'success');
        updateDebugInfo('盤面自動設定完了（検出:' + detected.length + '/4）');
    }
}

// 盤面のキャリブレーション（手動：キングとクイーンを使用）
function calibrateBoard() {
    try {
        // 白のキング(ID:0)とクイーン(ID:1)を探す
        const king = detectedMarkers.get(0);
        const queen = detectedMarkers.get(1);

        if (!king || !queen) {
            updateStatus('エラー: 白のキング(ID:0)とクイーン(ID:1)の両方を検出してください', 'error');
            updateDebugInfo('キャリブレーション失敗: キング=' + (king ? 'あり' : 'なし') + ', クイーン=' + (queen ? 'あり' : 'なし'));
            return;
        }

        // 2つのマーカーの距離を計算（これが1マスの幅）
        const dx = queen.x - king.x;
        const dy = queen.y - king.y;
        const squareSize = Math.sqrt(dx * dx + dy * dy);

        // キングの位置をe1として、盤面全体の範囲を計算
        // チェス盤は8x8なので、e1は右から4マス目、下から1マス目
        // d1(クイーン)はe1(キング)の左隣

        // 盤面の向き（クイーン→キングの方向）
        const angle = Math.atan2(dy, dx);

        // キングがe1にあると仮定して、盤面の左下(a1)の位置を計算
        // e1から左に4マス分移動
        const a1_x = king.x - 4 * squareSize * Math.cos(angle);
        const a1_y = king.y - 4 * squareSize * Math.sin(angle);

        // a1から右に8マス、上に8マス分の範囲が盤面
        const boardWidth = 8 * squareSize;
        const boardHeight = 8 * squareSize;

        // 盤面の範囲を設定（簡易版：角度を考慮せず、axis-alignedとして扱う）
        const angleX = Math.cos(angle);
        const angleY = Math.sin(angle);

        // 盤面の4隅の座標を計算
        const corner_a1 = { x: a1_x, y: a1_y };
        const corner_h1 = { x: a1_x + boardWidth * angleX, y: a1_y + boardWidth * angleY };
        const corner_a8 = { x: a1_x - boardHeight * angleY, y: a1_y + boardHeight * angleX };
        const corner_h8 = { x: a1_x + boardWidth * angleX - boardHeight * angleY, y: a1_y + boardWidth * angleY + boardHeight * angleX };

        // 範囲の最小・最大を計算
        const allX = [corner_a1.x, corner_h1.x, corner_a8.x, corner_h8.x];
        const allY = [corner_a1.y, corner_h1.y, corner_a8.y, corner_h8.y];

        boardBounds = {
            minX: Math.min(...allX),
            maxX: Math.max(...allX),
            minY: Math.min(...allY),
            maxY: Math.max(...allY)
        };

        boardCalibrated = true;

        updateStatus('キャリブレーション成功！ マスサイズ=' + Math.round(squareSize) + 'px', 'success');
        updateDebugInfo('盤面設定: マスサイズ=' + Math.round(squareSize) + 'px, 角度=' + Math.round(angle * 180 / Math.PI) + '度');

        // 盤面状態は自動更新（500msごと）で表示されます

    } catch (error) {
        updateStatus('エラー: ' + error.message, 'error');
        updateDebugInfo('エラー: ' + error.message);
        console.error('Calibration error:', error);
    }
}

// マーカー位置からマス目を計算（四隅の位置を使った正確な座標変換）
function getSquareFromPosition(x, y) {
    if (!boardCalibrated || !boardCorners) {
        return null;
    }

    const { a1, h1, a8, h8 } = boardCorners;

    // a1を原点として、位置ベクトルを計算
    const px = x - a1.x;
    const py = y - a1.y;

    // 盤面の基底ベクトルを計算
    // fileDirection: a1 -> h1 (aファイルからhファイルへの方向)
    const fileDirX = h1.x - a1.x;
    const fileDirY = h1.y - a1.y;
    const fileLength = Math.sqrt(fileDirX * fileDirX + fileDirY * fileDirY);

    // rankDirection: a1 -> a8 (1ランクから8ランクへの方向)
    const rankDirX = a8.x - a1.x;
    const rankDirY = a8.y - a1.y;
    const rankLength = Math.sqrt(rankDirX * rankDirX + rankDirY * rankDirY);

    // 位置ベクトルを基底ベクトルに射影して、盤面座標系での位置を求める
    // 内積を使って射影
    const fileProj = (px * fileDirX + py * fileDirY) / (fileLength * fileLength);
    const rankProj = (px * rankDirX + py * rankDirY) / (rankLength * rankLength);

    // 0-1の範囲に正規化された座標
    // fileProj: 0(a) -> 1(h)
    // rankProj: 0(1) -> 1(8)

    // 範囲外チェック（少しマージンを持たせる）
    if (fileProj < -0.1 || fileProj > 1.1 || rankProj < -0.1 || rankProj > 1.1) {
        return null;
    }

    // 0-7の範囲に変換
    const col = Math.floor(fileProj * 8);  // 0=a, 1=b, ..., 7=h
    const row = Math.floor(rankProj * 8);  // 0=1, 1=2, ..., 7=8

    // 範囲チェック
    if (col < 0 || col > 7 || row < 0 || row > 7) {
        return null;
    }

    // rowを反転（0=8ランク, 7=1ランクになるように）
    return { row: 7 - row, col: col };
}

// 盤面状態を更新（信頼度ベースのフィルタリング付き）
function updateBoardState() {
    try {
        if (!boardCalibrated) {
            return;
        }

        // 現在のフレームで検出された位置を記録
        const currentFrameDetections = Array(8).fill(null).map(() => Array(8).fill(null));

        let placedCount = 0;
        let markerInfo = [];

        // 検出されたマーカーを盤面に配置
        for (const marker of detectedMarkers.values()) {
            // 四隅マーカー（ID 32-35）は盤面に配置しない
            if (marker.id >= 32 && marker.id <= 35) {
                continue;
            }

            const square = getSquareFromPosition(marker.x, marker.y);
            markerInfo.push('ID' + marker.id + ':(' + marker.x + ',' + marker.y + ')');
            if (square) {
                currentFrameDetections[square.row][square.col] = marker.id;
                placedCount++;
                markerInfo[markerInfo.length - 1] += '->' + String.fromCharCode(97 + square.col) + (8 - square.row);
            } else {
                markerInfo[markerInfo.length - 1] += '->範囲外';
            }
        }

        // 信頼度を更新
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const detectedPiece = currentFrameDetections[row][col];
                const tracking = boardTracking[row][col];

                if (detectedPiece !== null) {
                    // このマスでピースが検出された
                    if (detectedPiece === tracking.pieceId) {
                        // 同じピースが継続して検出されている - 信頼度を上げる
                        tracking.confidence = Math.min(
                            tracking.confidence + CONFIDENCE_INCREASE,
                            MAX_CONFIDENCE
                        );
                    } else {
                        // 異なるピースが検出された - 新しいピースとしてリセット
                        tracking.pieceId = detectedPiece;
                        tracking.confidence = CONFIDENCE_INITIAL;
                    }
                } else {
                    // このマスでピースが検出されなかった
                    if (tracking.pieceId !== null) {
                        // 以前ピースがあった場合、信頼度を減少
                        tracking.confidence -= CONFIDENCE_DECAY;
                        if (tracking.confidence <= 0) {
                            // 信頼度がゼロになったらピースを削除
                            tracking.pieceId = null;
                            tracking.confidence = 0;
                        }
                    }
                }
            }
        }

        // 重複チェック：同じピースIDが複数の場所にある場合、最も信頼度が高い場所のみを残す
        const pieceLocations = new Map(); // pieceId -> [{row, col, confidence}, ...]

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const tracking = boardTracking[row][col];
                if (tracking.pieceId !== null && tracking.confidence >= CONFIDENCE_THRESHOLD) {
                    if (!pieceLocations.has(tracking.pieceId)) {
                        pieceLocations.set(tracking.pieceId, []);
                    }
                    pieceLocations.get(tracking.pieceId).push({ row, col, confidence: tracking.confidence });
                }
            }
        }

        // 各ピースについて、複数の場所にある場合は最も信頼度が高い場所のみを表示
        for (const [pieceId, locations] of pieceLocations) {
            if (locations.length > 1) {
                // 信頼度でソート（降順）
                locations.sort((a, b) => b.confidence - a.confidence);

                // 最も信頼度が高い場所以外の信頼度を減少
                for (let i = 1; i < locations.length; i++) {
                    const loc = locations[i];
                    boardTracking[loc.row][loc.col].confidence = Math.max(
                        boardTracking[loc.row][loc.col].confidence - CONFIDENCE_INCREASE,
                        0
                    );
                    if (boardTracking[loc.row][loc.col].confidence === 0) {
                        boardTracking[loc.row][loc.col].pieceId = null;
                    }
                }
            }
        }

        // 表示用配列に反映（信頼度が閾値以上のもののみ）
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const tracking = boardTracking[row][col];
                if (tracking.confidence >= CONFIDENCE_THRESHOLD) {
                    boardState[row][col] = tracking.pieceId;
                } else {
                    boardState[row][col] = null;
                }
            }
        }

        // 信頼度のある全ピースをカウント
        let displayedPieces = [];
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const tracking = boardTracking[row][col];
                if (tracking.pieceId !== null && tracking.confidence > 0) {
                    const square = String.fromCharCode(97 + col) + (8 - row);
                    displayedPieces.push(`ID${tracking.pieceId}@${square}(信頼度${tracking.confidence})`);
                }
            }
        }

        updateDebugInfo('検出: ' + placedCount + '個 | 追跡中: ' + displayedPieces.slice(0, 5).join(', ') + (displayedPieces.length > 5 ? '...' : ''));

        // 盤面を描画
        drawBoard();
    } catch (error) {
        updateStatus('updateBoardState エラー: ' + error.message, 'error');
        updateDebugInfo('updateBoardState エラー: ' + error.message);
        console.error('updateBoardState error:', error);
    }
}

// 盤面を描画
function drawBoard() {
    try {
        const squares = document.querySelectorAll('.chess-square');

        squares.forEach(square => {
            const row = parseInt(square.dataset.row);
            const col = parseInt(square.dataset.col);
            const pieceId = boardState[row][col];

            // 既存のピース情報を削除
            const existingPiece = square.querySelector('.piece');
            const existingInfo = square.querySelector('.piece-info');
            if (existingPiece) existingPiece.remove();
            if (existingInfo) existingInfo.remove();

            // ピースがある場合は描画
            if (pieceId !== null && pieceNames[pieceId]) {
                const piece = pieceNames[pieceId];

                const pieceElement = document.createElement('div');
                pieceElement.className = 'piece';
                pieceElement.textContent = piece.symbol;
                pieceElement.style.color = piece.color === 'white' ? '#fff' : '#000';
                pieceElement.style.textShadow = piece.color === 'white'
                    ? '1px 1px 2px #000, -1px -1px 2px #000'
                    : '1px 1px 2px #fff, -1px -1px 2px #fff';
                square.appendChild(pieceElement);

                const info = document.createElement('div');
                info.className = 'piece-info';
                info.textContent = 'ID:' + pieceId;
                square.appendChild(info);
            }
        });
    } catch (error) {
        alert('drawBoard エラー: ' + error.message);
        console.error('drawBoard error:', error);
    }
}

// エラーハンドリング
window.addEventListener('error', (event) => {
    console.error('エラー:', event.error);
    updateStatus('エラーが発生しました: ' + event.error.message);
});
