// グローバル変数
let video;
let canvas;
let ctx;
let stream = null;
let isOpenCvReady = false;
let animationId = null;
let detectedMarkers = new Map(); // マーカーIDと検出時刻を保存

// OpenCV.jsの読み込み完了時に呼ばれる
function onOpenCvReady() {
    isOpenCvReady = true;
    updateStatus('OpenCV.js読み込み完了 - カメラを起動してください');
    console.log('OpenCV.js is ready');
}

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', () => {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    const startButton = document.getElementById('startCamera');
    const stopButton = document.getElementById('stopCamera');

    startButton.addEventListener('click', startCamera);
    stopButton.addEventListener('click', stopCamera);

    updateStatus('初期化中...');
});

// ステータステキストを更新
function updateStatus(message) {
    document.getElementById('statusText').textContent = message;
}

// カメラ起動
async function startCamera() {
    if (!isOpenCvReady) {
        updateStatus('OpenCV.jsの読み込みを待っています...');
        return;
    }

    try {
        // カメラストリームを取得
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // 背面カメラを優先
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        video.srcObject = stream;

        // ビデオのメタデータが読み込まれたらキャンバスのサイズを設定
        video.addEventListener('loadedmetadata', () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        });

        await video.play();

        document.getElementById('startCamera').disabled = true;
        document.getElementById('stopCamera').disabled = false;

        updateStatus('カメラ起動中 - マーカーを検出しています...');

        // マーカー検出ループ開始
        detectMarkers();

    } catch (error) {
        console.error('カメラアクセスエラー:', error);
        updateStatus('カメラへのアクセスに失敗しました: ' + error.message);
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

        // OpenCVでマーカー検出
        const src = cv.imread(canvas);
        const gray = new cv.Mat();

        // グレースケール変換
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // ArUcoマーカー検出の準備
        const dictionary = new cv.aruco_Dictionary(cv.DICT_4X4_50);
        const markerCorners = new cv.MatVector();
        const markerIds = new cv.Mat();
        const rejectedCandidates = new cv.MatVector();
        const parameters = new cv.aruco_DetectorParameters();

        // マーカー検出
        cv.detectMarkers(gray, dictionary, markerCorners, markerIds, parameters, rejectedCandidates);

        // 検出されたマーカーを描画
        if (markerIds.rows > 0) {
            cv.drawDetectedMarkers(src, markerCorners, markerIds);

            // マーカー情報を更新
            updateDetectedMarkers(markerIds, markerCorners);
        }

        // 結果をキャンバスに表示
        cv.imshow(canvas, src);

        // メモリ解放
        src.delete();
        gray.delete();
        dictionary.delete();
        markerCorners.delete();
        markerIds.delete();
        rejectedCandidates.delete();
        parameters.delete();

    } catch (error) {
        console.error('マーカー検出エラー:', error);
    }

    // 次のフレームを処理
    animationId = requestAnimationFrame(detectMarkers);
}

// 検出されたマーカー情報を更新
function updateDetectedMarkers(markerIds, markerCorners) {
    const currentTime = Date.now();
    const newMarkers = new Map();

    for (let i = 0; i < markerIds.rows; i++) {
        const id = markerIds.data32S[i];

        // マーカーの中心座標を計算
        const corners = markerCorners.get(i);
        let centerX = 0;
        let centerY = 0;

        for (let j = 0; j < 4; j++) {
            centerX += corners.data32F[j * 2];
            centerY += corners.data32F[j * 2 + 1];
        }

        centerX = Math.round(centerX / 4);
        centerY = Math.round(centerY / 4);

        newMarkers.set(id, {
            id: id,
            x: centerX,
            y: centerY,
            lastSeen: currentTime
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

// エラーハンドリング
window.addEventListener('error', (event) => {
    console.error('エラー:', event.error);
    updateStatus('エラーが発生しました: ' + event.error.message);
});
