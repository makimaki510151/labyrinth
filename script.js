// Web Audio APIのコンテキストを保持する変数 (ユーザー操作で初期化するためnullで開始)
let audioCtx = null;
// 💡 追加: 全体の音量を調整するためのマスターゲインノード
let masterGainNode = null;

// 💡 修正: 迷路表示に関する定数
const CONTAINER_SIZE = 500; // 迷路コンテナの固定サイズ (CSSと合わせる)
const MIN_CELL_SIZE = 20; // 💡 修正: プレイヤーのセルがこれより小さくならないようにする最小サイズ (40pxから25pxに緩和)
const MAX_VISIBLE_CELLS = 25; // 💡 修正: 画面に表示したい最大のグリッド数 (19x19)

// 音を生成して再生する汎用関数
// type: 'move', 'hit', 'clear'
function playSound(type) {
    // コンテキストまたはマスターゲインノードが未初期化の場合は中断
    if (!audioCtx || !masterGainNode) {
        return;
    }

    // オシレーター（音源）と個別サウンドのゲイン（音量）を作成
    const oscillator = audioCtx.createOscillator();
    const soundGainNode = audioCtx.createGain(); // 個別サウンドのゲイン

    // 接続: オシレーター -> 個別ゲイン -> マスターゲイン -> 出力
    oscillator.connect(soundGainNode);
    soundGainNode.connect(masterGainNode); // 💡 マスターゲインに接続

    // サウンドパラメータを設定
    let freq, duration, initialVolume;

    switch (type) {
        case 'move':
            // 移動音: 短いクリック音
            freq = 440; // A4
            duration = 0.05;
            initialVolume = 0.3; // 個別の音量設定
            break;
        case 'hit':
            // 壁衝突音: 低いノイズ音
            freq = 120; // 低い周波数
            duration = 0.1;
            initialVolume = 0.5;
            break;
        case 'clear':
            // クリア音: ファンファーレのような上昇音
            freq = 660; // E5
            duration = 0.5;
            initialVolume = 0.4;
            // 周波数を時間経過で上昇させる（簡単なファンファーレ）
            oscillator.frequency.linearRampToValueAtTime(880, audioCtx.currentTime + 0.2); // G#5 -> A5
            break;
        default:
            return;
    }

    // 周波数を設定
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
    soundGainNode.gain.setValueAtTime(initialVolume, audioCtx.currentTime); // 個別ゲインに初期音量を設定

    // サウンドの開始と終了
    oscillator.start();

    // フェードアウト
    soundGainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    // オシレーターを停止してリソースを解放
    oscillator.stop(audioCtx.currentTime + duration);
}


// ゲーム状態管理
class GameState {
    constructor() {
        this.currentLevel = 1;
        // 💡 変更: 初期値は0とし、後にMazeGame.initで動的に設定される
        this.maxLevel = 0;
        this.progress = this.loadProgress();
        this.currentScreen = 'title';
    }

    // 💡 追加: maxLevelを設定するメソッド
    setMaxLevel(level) {
        this.maxLevel = level;
    }

    // 保存データを読み込む
    loadProgress() {
        const saved = localStorage.getItem('mazeGameProgress');
        // 保存形式を { level: { completed: boolean, path: ['x,y', ...] } } のような形式に変更
        return saved ? JSON.parse(saved) : {};
    }

    // 保存データを保存する
    saveProgress() {
        localStorage.setItem('mazeGameProgress', JSON.stringify(this.progress));
    }

    // レベルをクリア
    completeLevel(level, pathSet) {
        // pathSet (Setオブジェクト) を配列に変換して保存
        const pathArray = Array.from(pathSet);

        // progressオブジェクトを更新
        this.progress[level] = {
            completed: true,
            path: pathArray
        };

        this.saveProgress();
    }

    // 訪問済みパスを取得
    getCompletedPath(level) {
        // progress[level] が存在し、path配列を持つ場合、Setに変換して返す
        return this.progress[level] && this.progress[level].path
            ? new Set(this.progress[level].path)
            : new Set();
    }

    // レベルがアンロックされているか
    isLevelUnlocked(level) {
        // レベル1は常にアンロック、または (level-1) がクリア済みならアンロック
        return level === 1 || (this.progress[level - 1] && this.progress[level - 1].completed);
    }

    // レベルがクリアされているか
    isLevelCompleted(level) {
        return this.progress[level] && this.progress[level].completed;
    }
}

/**
 * 指定されたレベル番号に対応する迷路画像ファイル名を取得
 * @param {number} level 
 * @returns {object} { filename: string } 
 */
function getMazeConfig(level) {
    // 1.png, 2.png, ... という連番のファイルを想定
    return { filename: `maps/${level}.png` };
}

// 迷路解析のためのカラーコード定数 (RGB形式)
const COLOR_MAP = {
    WALL: '0,0,0',       // 黒 (壁)
    PATH: '255,255,255', // 白 (通路) - 解析では無視される
    START: '0,0,255',    // 青 (スタート地点)
    GOAL: '255,0,0'      // 赤 (ゴール地点)
};

/**
 * 迷路画像を解析し、迷路データオブジェクトを生成する非同期関数
 * @param {string} imageUrl 迷路画像のURL ('maps/mazeX.png'など)
 * @returns {Promise<object>} { width, height, start, goal, walls } を含むPromise
 */
function parseMazeFromImage(imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        // 💡 クロスオリジンエラー対策
        img.crossOrigin = 'Anonymous';

        img.onload = function () {
            const width = img.width;
            const height = img.height;

            // 一時的なCanvasを作成し、画像を描画
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            ctx.drawImage(img, 0, 0, width, height);

            try {
                // ピクセルデータを取得
                const imageData = ctx.getImageData(0, 0, width, height);
                const data = imageData.data;

                const walls = [];
                let start = null;
                let goal = null;

                // 1ドットずつ解析 (R, G, B, A の4要素)
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const i = (y * width + x) * 4;
                        const r = data[i];
                        const g = data[i + 1];
                        const b = data[i + 2];

                        // 💡 許容範囲を持たせるため、完全一致ではなく近似値で判定するのが望ましいが、
                        // 既存のコードを維持するため、RGB完全一致で判定
                        const colorKey = `${r},${g},${b}`;

                        if (colorKey === COLOR_MAP.WALL) {
                            walls.push({ x: x, y: y });
                        } else if (colorKey === COLOR_MAP.START) {
                            start = { x: x, y: y };
                        } else if (colorKey === COLOR_MAP.GOAL) {
                            goal = { x: x, y: y };
                        }
                        // 白 (PATH) のピクセルはwallsリストに追加しない
                    }
                }

                if (!start || !goal) {
                    // 💡 エラーメッセージをより詳細に
                    throw new Error(`迷路画像 ${imageUrl} のスタート(青: 0,0,255)またはゴール(赤: 255,0,0)が見つかりませんでした。`);
                }

                resolve({
                    width: width,
                    height: height,
                    start: start,
                    goal: goal,
                    walls: walls
                });

            } catch (error) {
                console.error("迷路解析エラー:", error);
                reject(error);
            }
        };

        img.onerror = function () {
            // 💡 404エラーなどで画像が読み込めなかった場合もreject
            reject(new Error(`迷路画像 ${imageUrl} を読み込めませんでした。ファイルが存在しないか、パスが間違っています。`));
        };

        img.src = imageUrl;
    });
}

// プレイヤークラス
class Player {
    constructor(startX, startY) {
        this.x = startX;
        this.y = startY;
        this.visitedCells = new Set(); // 💡 通ったセルを記録するSet
        this.markVisited(); // 初期位置を記録
    }

    // 訪問したセルを記録
    markVisited() {
        this.visitedCells.add(`${this.x},${this.y}`);
    }

    // セルが訪問済みかチェック
    hasVisited(x, y) {
        return this.visitedCells.has(`${x},${y}`);
    }

    // 移動処理
    move(dx, dy, maze) {
        const newX = this.x + dx;
        const newY = this.y + dy;

        // 境界チェック
        if (newX < 0 || newX >= maze.width || newY < 0 || newY >= maze.height) {
            return false;
        }

        if (!maze.isWall(newX, newY)) {
            this.x = newX;
            this.y = newY;
            this.markVisited(); // 💡 移動後の位置を記録
            return true;
        }
        return false;
    }

    // 💡 追加: ゴールに到達したかチェック
    isAtGoal(maze) {
        return this.x === maze.goal.x && this.y === maze.goal.y;
    }
}

// 迷路クラス
class Maze {
    constructor(data) {
        this.width = data.width;
        this.height = data.height;
        this.start = data.start;
        this.goal = data.goal;
        this.walls = new Set();

        // 壁データをSetに追加
        if (data.walls && Array.isArray(data.walls)) {
            data.walls.forEach(wall => {
                this.walls.add(`${wall.x},${wall.y}`);
            });
        }
    }

    isWall(x, y) {
        return this.walls.has(`${x},${y}`);
    }

    isValidMove(x, y) {
        return x >= 0 && x < this.width && y >= 0 && y < this.height && !this.isWall(x, y);
    }
}

// ゲームクラス
class MazeGame {
    constructor() {
        this.gameState = new GameState();
        this.maze = null;
        this.player = null;
        this.canvas = null; // メイン迷路Canvas
        this.ctx = null;
        this.minimapCanvas = null; // 💡 追加: ミニマップCanvas
        this.minimapCtx = null; // 💡 追加: ミニマップCtx
        this.cellSize = 25;
        this.parsedMazes = {}; // 💡 保持: 一度読み込んだマップをキャッシュ

        // 💡 追加: 長押し移動のためのタイマー
        this.moveTimer = null;
        this.moveInterval = 100; // 連続移動の間隔 (ms)

        // 💡 追加: ジョイスティックの状態
        this.joystick = {
            active: false,
            direction: { dx: 0, dy: 0 }
        };

        this.init();
    }

    // 💡 変更: initをasyncにし、最大レベルを動的に設定する処理を追加
    async init() {
        await this.determineMaxLevel(); // 💡 変更: 最大レベルを決定
        this.setupEventListeners();
        this.setupJoystick(); // 💡 追加: ジョイスティックのセットアップ
        this.initAudio(); // 💡 追加: オーディオコンテキストの初期化
        this.showScreen('title');
    }

    /**
     * 💡 変更: mapsフォルダ内の連番ファイル数を検知し、最大レベルを設定（画像データは読み込まない）
     */
    async determineMaxLevel() {
        const MAX_CHECK_LIMIT = 99; // 念のためチェックの上限を設定
        let maxLevel = 0;

        for (let i = 1; i <= MAX_CHECK_LIMIT; i++) {
            const config = getMazeConfig(i);
            try {
                // 💡 変更: 実際のパース処理ではなく、画像の存在チェックのみを行う
                const img = new Image();
                img.crossOrigin = 'Anonymous';

                const loadPromise = new Promise((resolve, reject) => {
                    img.onload = () => resolve(true);
                    img.onerror = () => reject(new Error('Load failed'));
                    img.src = config.filename;
                });

                await loadPromise;
                maxLevel = i;
            } catch (error) {
                // 読み込みに失敗した場合、そこで連番が途切れたと判断して終了
                break;
            }
        }

        this.gameState.setMaxLevel(maxLevel);
        console.log(`検知された最大レベル数: ${maxLevel}`);

        if (maxLevel === 0) {
            console.error("マップファイル(maps/1.png, maps/2.png...)が一つも見つかりませんでした。");
        }

        // 💡 追加: レベル1は常に最初に読み込みを試みる (preloadMazeDataは非同期で実行されるため、awaitは不要)
        this.preloadMazeData(1);
    }

    /**
     * 💡 新規追加: 指定されたレベルの迷路データを非同期で読み込み、キャッシュする
     * @param {number} level 
     */
    async preloadMazeData(level) {
        if (level > this.gameState.maxLevel || this.parsedMazes[level]) return; // 存在しないか、既にキャッシュされている場合はスキップ

        const config = getMazeConfig(level);
        try {
            // 💡 変更: 実際のパース処理を非同期で実行し、結果をキャッシュ
            this.parsedMazes[level] = await parseMazeFromImage(config.filename);
            console.log(`レベル ${level} のマップデータがバックグラウンドで読み込まれました。`);
        } catch (error) {
            // 読み込みに失敗しても、ゲームプレイをブロックしない
            console.warn(`レベル ${level} のマップデータ読み込みに失敗しました:`, error.message || error);
        }
    }


    // 💡 修正・拡張: オーディオコンテキストとマスターゲインノードの初期化
    initAudio() {
        const slider = document.getElementById('volume-slider');

        // 💡 localStorageから保存された音量を読み込み、スライダーに適用
        const savedVolume = localStorage.getItem('gameVolume');
        if (savedVolume !== null) {
            slider.value = savedVolume;
        }

        // 最初のユーザー操作時（どのボタンでもOK）にオーディオコンテキストを再開/作成
        const audioInitHandler = () => {
            if (!audioCtx) {
                try {
                    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    // 💡 マスターゲインノードの作成
                    masterGainNode = audioCtx.createGain();
                    masterGainNode.connect(audioCtx.destination);

                    // 初期音量をスライダーの値に設定
                    masterGainNode.gain.setValueAtTime(parseFloat(slider.value), audioCtx.currentTime);
                } catch (e) {
                    console.warn('Web Audio APIはサポートされていません:', e);
                    // サポートされていない場合は以降の処理を中断
                    return;
                }
            }

            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }

            // 最初の操作後にリスナーを削除
            document.removeEventListener('click', audioInitHandler);
            document.removeEventListener('keydown', audioInitHandler);
        };

        // ページ全体にリスナーを設定
        document.addEventListener('click', audioInitHandler);
        document.addEventListener('keydown', audioInitHandler);

        // 💡 音量スライダーのイベントリスナーを設定
        slider.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            // masterGainNodeが存在すれば音量を設定
            if (masterGainNode) {
                // 即座に値を設定する
                masterGainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
            }
            // localStorageに音量を保存
            localStorage.setItem('gameVolume', volume);
        });
    }

    setupEventListeners() {
        // 画面遷移ボタン
        document.getElementById('start-button').addEventListener('click', () => {
            this.showLevelSelect();
        });

        document.getElementById('back-to-title').addEventListener('click', () => {
            this.showScreen('title');
        });

        document.getElementById('back-to-select').addEventListener('click', () => {
            this.showLevelSelect();
        });

        document.getElementById('back-to-select-clear').addEventListener('click', () => {
            this.showLevelSelect();
        });

        document.getElementById('next-level-btn').addEventListener('click', () => {
            this.startLevel(this.gameState.currentLevel + 1);
        });

        // 💡 修正: キーボード操作を全体で処理するように変更し、画面ごとにハンドラーを切り替える
        document.addEventListener('keydown', (e) => {
            if (this.gameState.currentScreen === 'game') {
                this.handleGameKeyPress(e.key);
            } else if (this.gameState.currentScreen === 'clear') {
                this.handleClearScreenKeyPress(e); // 💡 追加: クリア画面のキー操作ハンドラー
            }
        });

        // 💡 削除: 従来のモバイルコントロールボタンのイベントリスナーを削除

        // 💡 追加: クリア画面のキーボードナビゲーションを初期設定
        this.setupClearScreenKeyNavigation();
    }

    /**
     * 💡 新規追加: ジョイスティックのタッチ/マウスイベントを設定
     */
    setupJoystick() {
        const base = document.getElementById('joystick-base');
        const handle = document.getElementById('joystick-handle');
        const container = document.getElementById('joystick-container');

        if (!base || !handle || !container) return; // 要素がない場合はスキップ

        // コンテナのサイズを動的に取得
        let containerRect = container.getBoundingClientRect();

        // コンテナの中心座標
        const centerX = containerRect.width / 2;
        const centerY = containerRect.height / 2;
        // ハンドルの最大移動距離（ベースの半径）
        const maxDist = (containerRect.width / 2) - (handle.offsetWidth / 2); // ベース半径 - ハンドル半径

        // 💡 連続移動のためのタイマー処理を管理する関数
        const startContinuousMove = () => {
            if (this.moveTimer) return; // 既に実行中の場合は何もしない

            // 最初の移動を実行
            this.movePlayer(this.joystick.direction.dx, this.joystick.direction.dy);

            // 連続移動タイマーを設定
            this.moveTimer = setInterval(() => {
                this.movePlayer(this.joystick.direction.dx, this.joystick.direction.dy);
            }, this.moveInterval);
        };

        // 💡 連続移動のためのタイマー処理を停止する関数
        const stopContinuousMove = () => {
            if (this.moveTimer) {
                clearInterval(this.moveTimer);
                this.moveTimer = null;
            }
        };

        const handleMove = (clientX, clientY) => {
            // 💡 ジョイスティックコンテナに対する相対位置を計算
            containerRect = container.getBoundingClientRect(); // 位置が変わりうるため毎回再取得
            const x = clientX - containerRect.left - centerX;
            const y = clientY - containerRect.top - centerY;
            const distance = Math.sqrt(x * x + y * y);

            let normalizedX = x;
            let normalizedY = y;
            let currentDist = distance;

            // 💡 ハンドルがベースからはみ出さないようにクランプ
            if (distance > maxDist) {
                const angle = Math.atan2(y, x);
                normalizedX = maxDist * Math.cos(angle);
                normalizedY = maxDist * Math.sin(angle);
                currentDist = maxDist;
            }

            // 💡 ハンドルの位置を更新 (中心からの移動量として適用)
            handle.style.transform = `translate(${normalizedX}px, ${normalizedY}px)`;


            // 💡 移動方向を計算（4方向を想定。斜め移動は無効化）
            let dx = 0;
            let dy = 0;
            const threshold = maxDist * 0.4; // 閾値を最大移動距離の40%に設定

            if (currentDist > threshold) {
                const absX = Math.abs(normalizedX);
                const absY = Math.abs(normalizedY);

                if (absX > absY) {
                    // X軸方向の判断
                    dx = normalizedX > 0 ? 1 : -1;
                    dy = 0;
                } else {
                    // Y軸方向の判断
                    dx = 0;
                    dy = normalizedY > 0 ? 1 : -1;
                }
            }


            // 💡 方向が変更されたか、または移動が開始された場合
            if (dx !== this.joystick.direction.dx || dy !== this.joystick.direction.dy || !this.joystick.active) {
                // 古いタイマーを停止
                stopContinuousMove();

                this.joystick.direction = { dx, dy };
                this.joystick.active = true;

                // 新しい方向でタイマーを開始
                if (dx !== 0 || dy !== 0) {
                    startContinuousMove();
                }
            } else if (dx === 0 && dy === 0 && this.joystick.active) {
                // 閾値以下に戻った場合は移動を停止
                this.joystick.active = false;
                stopContinuousMove();
            }
        };

        // 💡 終了処理（指を離した/マウスを離した時）
        const endMove = () => {
            this.joystick.active = false;
            this.joystick.direction = { dx: 0, dy: 0 };
            stopContinuousMove();

            // ハンドルを中央に戻す
            handle.style.transform = 'translate(-50%, -50%)';

            // リスナーを削除
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
            document.removeEventListener('touchcancel', onTouchEnd);
        };

        // 💡 実際のマウス/タッチイベントハンドラー
        const onMouseMove = (e) => {
            if (this.gameState.currentScreen === 'game') {
                handleMove(e.clientX, e.clientY);
            }
        };
        const onMouseUp = (e) => {
            endMove();
        };

        const onTouchMove = (e) => {
            if (this.gameState.currentScreen === 'game' && e.touches.length === 1) {
                // スクロールを防止し、ジョイスティック操作に専念させる
                e.preventDefault();
                handleMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        };
        const onTouchEnd = (e) => {
            // 複数の指で操作している場合は、最後の指が離れた時のみ終了させる
            if (e.touches.length === 0) {
                endMove();
            }
        };

        // 💡 開始処理 (mousedown/touchstart)
        const startMove = (clientX, clientY) => {
            if (this.gameState.currentScreen !== 'game') return;

            // 移動/終了リスナーを設定
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
            document.addEventListener('touchcancel', onTouchEnd);

            // 初回の位置計算と移動開始
            handleMove(clientX, clientY);
        };

        // イベントリスナーをハンドルに追加
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault(); // ドラッグ選択を防止
            startMove(e.clientX, e.clientY);
        });
        // 💡 コンテナ全体をタッチエリアとする
        container.addEventListener('touchstart', (e) => {
            e.preventDefault(); // デフォルトのタッチ操作を防止
            if (e.touches.length === 1) {
                startMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: false });

        // リサイズ時などにジョイスティックの中心座標を再計算
        window.addEventListener('resize', () => {
            if (container) {
                containerRect = container.getBoundingClientRect();
            }
        });
    }

    setupClearScreenKeyNavigation() {
        // ボタンを配列として取得
        this.clearScreenButtons = [
            document.getElementById('next-level-btn'),
            document.getElementById('back-to-select-clear')
        ].filter(btn => btn); // 存在しないボタン (next-level-btnが非表示の場合など) を除外

        // すべてのクリア画面ボタンにtabindexを設定
        this.clearScreenButtons.forEach((btn, index) => {
            btn.setAttribute('tabindex', index + 1); // 1から開始
        });
    }

    // 💡 追加: クリア画面のキー操作を処理するハンドラー
    handleClearScreenKeyPress(e) {
        const buttons = this.clearScreenButtons.filter(btn => btn.style.display !== 'none'); // 現在表示されているボタンのみ
        if (buttons.length === 0) return;

        let focusedButton = document.activeElement;
        let currentIndex = buttons.indexOf(focusedButton);

        // Enter/Spaceでクリック
        if (e.key === 'Enter' || e.key === ' ') {
            if (focusedButton && focusedButton.classList.contains('menu-button')) {
                e.preventDefault();
                focusedButton.click();
            }
            // 上/下矢印キーでフォーカス移動
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); // 画面スクロールを防ぐ

            let nextIndex = currentIndex;

            if (e.key === 'ArrowDown') {
                nextIndex = (currentIndex + 1) % buttons.length;
            } else if (e.key === 'ArrowUp') {
                nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            }

            // 初回 (currentIndexが-1) は最初のボタンにフォーカス
            if (currentIndex === -1) {
                nextIndex = 0;
            }

            buttons[nextIndex].focus();
        }
    }

    // 💡 修正: ゲーム画面のキーボード操作を処理するハンドラーとして独立させる
    handleGameKeyPress(key) {
        let dx = 0, dy = 0;

        switch (key.toLowerCase()) {
            case 'w':
            case 'arrowup':
                dy = -1;
                break;
            case 's':
            case 'arrowdown':
                dy = 1;
                break;
            case 'a':
            case 'arrowleft':
                dx = -1;
                break;
            case 'd':
            case 'arrowright':
                dx = 1;
                break;
            default:
                return;
        }

        this.movePlayer(dx, dy);
    }

    // 💡 修正: showScreenで画面遷移時の処理を追加
    showScreen(screenName) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(`${screenName}-screen`).classList.add('active');
        this.gameState.currentScreen = screenName;

        // 💡 追記: 画面切り替え時に適切な要素にフォーカスを当てる
        if (screenName === 'title') {
            document.getElementById('start-button').focus();
        } else if (screenName === 'level-select') {
            document.getElementById('back-to-title').focus();
        } else {
            // ゲーム画面など、その他の画面ではフォーカスを解除
            if (document.activeElement) document.activeElement.blur();
        }
    }

    showLevelSelect() {
        // 💡 追加: レベルが一つもない場合はエラーメッセージ
        if (this.gameState.maxLevel === 0) {
            alert("マップファイルが見つかりません。レベル1.pngをmapsフォルダに配置してください。");
            return;
        }

        this.showScreen('level-select');
        this.updateLevelGrid();
    }

    updateLevelGrid() {
        const grid = document.getElementById('level-grid');
        grid.innerHTML = '';
        let firstUnlocked = null; // 💡 追加: 最初にアンロックされたレベル

        for (let i = 1; i <= this.gameState.maxLevel; i++) {
            const button = document.createElement('button');
            button.className = 'level-button';
            button.textContent = i;

            // 💡 追加: レベルボタンにtabindexを設定
            button.setAttribute('tabindex', 0); // tabで選択可能にする

            if (this.gameState.isLevelCompleted(i)) {
                button.classList.add('completed');
                this.addLevelPreview(button, i);
            } else if (this.gameState.isLevelUnlocked(i)) {
                button.classList.add('available');
                if (!firstUnlocked) {
                    firstUnlocked = i; // 💡 最初のアンロックされたレベルを特定
                }
            } else {
                button.classList.add('locked');
            }

            if (this.gameState.isLevelUnlocked(i)) {
                button.addEventListener('click', () => this.startLevel(i));
            }

            grid.appendChild(button);
        }

        // 💡 追加: 最初にプレイする可能性が高いレベルをバックグラウンドで読み込む
        if (firstUnlocked) {
            this.preloadMazeData(firstUnlocked);
        }
    }

    async addLevelPreview(button, level) {
        const mapCanvas = document.createElement('canvas');
        mapCanvas.width = 100;
        mapCanvas.height = 100;
        mapCanvas.className = 'level-preview-canvas';
        button.appendChild(mapCanvas);

        if (this.gameState.isLevelCompleted(level)) {
            try {
                // 💡 変更: キャッシュ済み（preloadMazeDataで読み込まれているはず）または、非同期で読み込み
                let mazeData = this.parsedMazes[level];

                // データがない場合は同期的に読み込みを待つ
                if (!mazeData) {
                    const config = getMazeConfig(level);
                    mazeData = await parseMazeFromImage(config.filename);
                    this.parsedMazes[level] = mazeData;
                }

                const ctx = mapCanvas.getContext('2d');
                const pathSet = this.gameState.getCompletedPath(level);
                const cellSize = mapCanvas.width / mazeData.width;

                for (let y = 0; y < mazeData.height; y++) {
                    for (let x = 0; x < mazeData.width; x++) {
                        const drawX = x * cellSize;
                        const drawY = y * cellSize;

                        const isWall = mazeData.walls.some(w => w.x === x && w.y === y);

                        if (isWall) {
                            ctx.fillStyle = 'rgba(51, 51, 51, 0.7)';
                        } else {
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                        }

                        if (pathSet.has(`${x},${y}`)) {
                            ctx.fillStyle = '#4CAF50';
                        }

                        ctx.fillRect(drawX, drawY, cellSize, cellSize);

                        if (x === mazeData.start.x && y === mazeData.start.y) {
                            ctx.fillStyle = '#0000FF';
                            ctx.fillRect(drawX, drawY, cellSize, cellSize);
                        } else if (x === mazeData.goal.x && y === mazeData.goal.y) {
                            ctx.fillStyle = '#F44336';
                            ctx.fillRect(drawX, drawY, cellSize, cellSize);
                        }
                    }
                }
            } catch (error) {
                console.error(`レベル ${level} のプレビュー描画に失敗しました:`, error);
            }
        }
    }

    async startLevel(level) {
        const config = getMazeConfig(level);
        if (level > this.gameState.maxLevel || !config) {
            alert('このレベルはまだ実装されていません。');
            return;
        }

        if (!this.gameState.isLevelUnlocked(level)) {
            alert("このレベルはまだアンロックされていません。");
            return;
        }

        this.gameState.currentLevel = level;

        try {
            let mazeData = this.parsedMazes[level];

            if (!mazeData) {
                // 💡 変更: キャッシュがない場合、同期的に読み込みを待つ
                const config = getMazeConfig(level);
                mazeData = await parseMazeFromImage(config.filename);
                this.parsedMazes[level] = mazeData;
            }

            this.maze = new Maze(mazeData);
            this.player = new Player(this.maze.start.x, this.maze.start.y);

            this.canvas = document.getElementById('maze-canvas');
            this.ctx = this.canvas.getContext('2d');

            this.minimapCanvas = document.getElementById('minimap-canvas');
            this.minimapCtx = this.minimapCanvas.getContext('2d');

            // 💡 修正: cellSizeの計算ロジックを変更
            // 1. 常に500px / 19マスでセルサイズを計算 (約26.31px)
            const fixedVisibleCellSize = CONTAINER_SIZE / MAX_VISIBLE_CELLS;

            // 2. 迷路全体が収まる最大のセルサイズ
            const maxFitCellSize = Math.min(CONTAINER_SIZE / this.maze.width, CONTAINER_SIZE / this.maze.height);

            // 3. 最終的なcellSizeの決定
            if (this.maze.width <= MAX_VISIBLE_CELLS && this.maze.height <= MAX_VISIBLE_CELLS) {
                // 迷路全体が19x19より小さい場合:
                // 迷路全体が収まる最大のサイズを採用し、MIN_CELL_SIZEを下回らないようにする
                this.cellSize = Math.max(MIN_CELL_SIZE, maxFitCellSize);
            } else {
                // 迷路が19x19より大きい場合（カメラ追従が必要な場合）:
                // 500px/19のサイズを採用し、MIN_CELL_SIZEを下回らないようにする
                this.cellSize = Math.max(MIN_CELL_SIZE, fixedVisibleCellSize);
            }

            // Canvasのサイズは500pxに固定（CSSと合わせる）
            this.canvas.width = CONTAINER_SIZE;
            this.canvas.height = CONTAINER_SIZE;

            document.getElementById('current-level').textContent = `レベル ${level}`;

            this.showScreen('game');
            this.render();

            // 💡 追加: プレイ開始後、次のレベルをバックグラウンドで読み込む
            this.preloadMazeData(level + 1);

        } catch (error) {
            alert(`レベル ${level} の読み込みに失敗しました。\nエラー: ${error.message || error}`);
            console.error(error);
            this.showLevelSelect();
        }
    }

    movePlayer(dx, dy) {
        // ゲーム画面でのみ移動を許可
        if (this.gameState.currentScreen !== 'game') return;

        const moved = this.player.move(dx, dy, this.maze);

        if (moved) {
            playSound('move'); // 💡 移動成功音
            this.render();

            if (this.player.isAtGoal(this.maze)) {
                // ゴールに到達したら連続移動を停止
                if (this.moveTimer) {
                    clearInterval(this.moveTimer);
                    this.moveTimer = null;
                }
                this.completeLevel();
            }
        } else {
            // 壁に衝突した場合
            const newX = this.player.x + dx;
            const newY = this.player.y + dy;
            if (this.maze.isWall(newX, newY) || newX < 0 || newX >= this.maze.width || newY < 0 || newY >= this.maze.height) {
                playSound('hit'); // 💡 壁衝突音
            }
        }
    }

    completeLevel() {
        playSound('clear'); // 💡 クリア音

        this.gameState.completeLevel(this.gameState.currentLevel, this.player.visitedCells);

        const nextLevel = this.gameState.currentLevel + 1;
        const hasNextLevel = nextLevel <= this.gameState.maxLevel; // 💡 変更: maxLevelは動的に設定されている

        document.getElementById('clear-message').textContent =
            hasNextLevel ? 'おめでとうございます！次のレベルに挑戦しましょう！' : 'すべてのレベルをクリアしました！';

        const nextBtn = document.getElementById('next-level-btn');
        const backBtn = document.getElementById('back-to-select-clear');

        if (hasNextLevel) {
            nextBtn.style.display = 'inline-block';
            // 💡 追加: 次のレベルがある場合、「次のレベル」ボタンにフォーカスを当てる
            nextBtn.focus();
        } else {
            nextBtn.style.display = 'none';
            // 💡 追加: 次のレベルがない場合、「レベル選択に戻る」ボタンにフォーカスを当てる
            backBtn.focus();
        }

        this.showScreen('clear');
    }

    render() {
        this.renderMaze();
        this.renderMinimap(); // 💡 復活: ミニマップの描画を呼び出し
    }

    renderMaze() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        const viewRange = 1; // 視界範囲（3x3）はそのまま

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let startX, startY, endX, endY;
        let offsetX = 0;
        let offsetY = 0;

        const W_MAZE = this.maze.width;
        const H_MAZE = this.maze.height;
        const W_VIEW = MAX_VISIBLE_CELLS;
        const H_VIEW = MAX_VISIBLE_CELLS;
        const HALF_VIEW = Math.floor(W_VIEW / 2); // 9

        // 迷路の幅/高さが MAX_VISIBLE_CELLS より小さい場合
        if (W_MAZE <= W_VIEW && H_MAZE <= H_VIEW) {
            // 迷路全体を描画し、中央に配置
            startX = 0;
            startY = 0;
            endX = W_MAZE - 1;
            endY = H_MAZE - 1;
            // 描画オフセット: 迷路をCanvasの中央に寄せる
            offsetX = (canvas.width - W_MAZE * this.cellSize) / 2;
            offsetY = (canvas.height - H_MAZE * this.cellSize) / 2;
        } else {
            // 迷路が19x19より大きい場合 (カメラ追従)

            // X軸方向の描画開始座標 (viewPortStartX) を計算し、迷路の端にクランプする
            let viewPortStartX = this.player.x - HALF_VIEW;
            viewPortStartX = Math.max(0, viewPortStartX); // 左端 (0) にクランプ
            viewPortStartX = Math.min(W_MAZE - W_VIEW, viewPortStartX); // 右端 (W_MAZE - W_VIEW) にクランプ

            // Y軸方向の描画開始座標 (viewPortStartY) を計算し、迷路の端にクランプする
            let viewPortStartY = this.player.y - HALF_VIEW;
            viewPortStartY = Math.max(0, viewPortStartY); // 上端 (0) にクランプ
            viewPortStartY = Math.min(H_MAZE - H_VIEW, viewPortStartY); // 下端 (H_MAZE - H_VIEW) にクランプ

            // 描画オフセット: 画面の左上隅 (0,0) が迷路のどこに相当するか
            offsetX = -viewPortStartX * this.cellSize;
            offsetY = -viewPortStartY * this.cellSize;

            // 実際に描画するセル範囲を調整
            startX = viewPortStartX;
            endX = viewPortStartX + W_VIEW - 1;
            startY = viewPortStartY;
            endY = viewPortStartY + H_VIEW - 1;
        }

        // 迷路の描画ループ
        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                const drawX = x * this.cellSize + offsetX;
                const drawY = y * this.cellSize + offsetY;

                // 迷路の境界外はスキップ (このロジックでは基本的に不要だが安全のため)
                if (x < 0 || x >= W_MAZE || y < 0 || y >= H_MAZE) continue;

                const isInView = Math.abs(x - this.player.x) <= viewRange &&
                    Math.abs(y - this.player.y) <= viewRange;
                const hasVisited = this.player.hasVisited(x, y);

                if (isInView || hasVisited) {

                    if (this.maze.isWall(x, y)) {
                        ctx.fillStyle = '#333';
                        ctx.fillRect(drawX, drawY, this.cellSize, this.cellSize);
                    } else {
                        // 通路の描画
                        ctx.fillStyle = isInView ? '#fff' : '#f0f0f0';
                        ctx.fillRect(drawX, drawY, this.cellSize, this.cellSize);

                        // グリッド線
                        ctx.strokeStyle = '#ddd';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(drawX, drawY, this.cellSize, this.cellSize);

                        // ゴール
                        if (x === this.maze.goal.x && y === this.maze.goal.y) {
                            ctx.fillStyle = '#F44336';
                            ctx.fillRect(drawX + 2, drawY + 2, this.cellSize - 4, this.cellSize - 4);
                        }
                    }
                }
            }
        }

        // プレイヤーの描画
        // プレイヤーの画面上での座標を計算
        const playerScreenX = this.player.x * this.cellSize + offsetX;
        const playerScreenY = this.player.y * this.cellSize + offsetY;

        ctx.fillStyle = '#4CAF50';
        ctx.beginPath();
        ctx.arc(playerScreenX + this.cellSize / 2, playerScreenY + this.cellSize / 2, this.cellSize / 3, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * 💡 復活: ミニマップの描画関数
     */
    renderMinimap() {
        const ctx = this.minimapCtx;
        const canvas = this.minimapCanvas;
        const maze = this.maze;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. 背景を未探索エリア（壁の色）で塗りつぶす
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 迷路全体が収まるようにセルサイズを計算
        const cellSize = Math.min(canvas.width / maze.width, canvas.height / maze.height);

        // 迷路全体を中央に配置するためのオフセットを計算
        const totalWidth = maze.width * cellSize;
        const totalHeight = maze.height * cellSize;
        const offsetX = (canvas.width - totalWidth) / 2;
        const offsetY = (canvas.height - totalHeight) / 2;

        for (let y = 0; y < maze.height; y++) {
            for (let x = 0; x < maze.width; x++) {
                const drawX = x * cellSize + offsetX;
                const drawY = y * cellSize + offsetY;
                const hasVisited = this.player.hasVisited(x, y);

                const isWall = maze.isWall(x, y);

                // 2. 描画するのは「壁」または「訪問済みセル」のみ
                if (isWall) {
                    // 壁は常に描画
                    ctx.fillStyle = '#333';
                    ctx.fillRect(drawX, drawY, cellSize, cellSize);
                } else if (hasVisited) {
                    // 訪問済みの通路
                    ctx.fillStyle = '#ADD8E6'; // 訪問済み通路: 明るい水色
                    ctx.fillRect(drawX, drawY, cellSize, cellSize);
                }
                // 未訪問の通路は描画しない（背景色(#333)のまま）

                // 3. スタートとゴール (通路が描画された後に上書きする)
                if (x === maze.start.x && y === maze.start.y) {
                    ctx.fillStyle = '#0000FF'; // スタート: 青
                    ctx.fillRect(drawX, drawY, cellSize, cellSize);
                } else if (x === maze.goal.x && y === maze.goal.y) {
                    // ゴールは、訪問済みの場合のみ描画する
                    if (hasVisited) {
                        ctx.fillStyle = '#FF0000'; // ゴール: 赤
                        ctx.fillRect(drawX, drawY, cellSize, cellSize);
                    }
                }

                // プレイヤーの位置
                if (x === this.player.x && y === this.player.y) {
                    ctx.fillStyle = '#4CAF50'; // プレイヤー: 緑
                    ctx.beginPath();
                    ctx.arc(drawX + cellSize / 2, drawY + cellSize / 2, cellSize / 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }
}

// ゲーム開始
document.addEventListener('DOMContentLoaded', () => {
    // 💡 変更: MazeGameの初期化が非同期になったため、DOMContentLoadedでインスタンスを作成し、initを呼び出す
    window.game = new MazeGame();
});