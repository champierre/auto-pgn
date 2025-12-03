// グローバル変数
let video;
let canvas;
let ctx;
let stream = null;
let detector = null;
let animationId = null;
let detectedMarkers = new Map(); // マーカーIDと検出時刻を保存

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', () => {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    // js-aruco2のディテクターを初期化（デフォルトでARUCO辞書を使用）
    detector = new AR.Detector();

    const startButton = document.getElementById('startCamera');
    const stopButton = document.getElementById('stopCamera');

    startButton.addEventListener('click', startCamera);
    stopButton.addEventListener('click', stopCamera);

    updateStatus('準備完了 - カメラを起動してください');
    console.log('js-aruco2 detector initialized');
});

// ステータステキストを更新
function updateStatus(message) {
    document.getElementById('statusText').textContent = message;
}

// カメラ起動
async function startCamera() {
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
