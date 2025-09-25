// ゲーム状態管理
class GameState {
    constructor() {
        this.currentLevel = 1;
        this.maxLevel = 6; // 総レベル数
        this.progress = this.loadProgress();
        this.currentScreen = 'title';
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
    // 💡 修正点: 訪問した道の Set を受け取るように変更
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

// 迷路データ設定 (画像ファイル名と色定義)
const MAZE_CONFIG = {
    // ユーザー様がアップロードされた画像をレベル1として仮設定
    1: { filename: 'maps/1.png' }, 
    2: { filename: 'maps/2.png' },
    3: { filename: 'maps/3.png' },
    4: { filename: 'maps/4.png' },
    5: { filename: 'maps/5.png' },
    6: { filename: 'maps/6.png' }
};

// 迷路解析のためのカラーコード定数 (RGB形式)
const COLOR_MAP = {
    WALL: '0,0,0',       // 黒 (壁)
    PATH: '255,255,255', // 白 (通路) - 解析では無視される
    START: '0,0,255',    // 青 (スタート地点)
    GOAL: '255,0,0'      // 赤 (ゴール地点)
};

/**
 * 迷路画像を解析し、迷路データオブジェクトを生成する関数
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
                    // 9x9の画像が滑らかなグラデーションを持つ可能性があるため、厳密な青/赤がない場合に備え、エラーメッセージを調整
                    throw new Error('迷路のスタート(青: 0,0,255)またはゴール(赤: 255,0,0)が見つかりませんでした。画像を確認してください。');
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
            reject(new Error(`迷路画像を読み込めませんでした: ${imageUrl}`));
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
        this.canvas = null;
        this.ctx = null;
        this.minimapCanvas = null;
        this.minimapCtx = null;
        this.cellSize = 25;
        this.minimapCellSize = 8;
        // 💡 既に読み込んだ迷路データ（レベル選択画面で再利用するため）
        this.parsedMazes = {}; 

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.showScreen('title');
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

        // キーボード操作
        document.addEventListener('keydown', (e) => {
            if (this.gameState.currentScreen === 'game') {
                this.handleKeyPress(e.key);
            }
        });

        // モバイルコントロール
        document.getElementById('up-btn').addEventListener('click', () => this.movePlayer(0, -1));
        document.getElementById('down-btn').addEventListener('click', () => this.movePlayer(0, 1));
        document.getElementById('left-btn').addEventListener('click', () => this.movePlayer(-1, 0));
        document.getElementById('right-btn').addEventListener('click', () => this.movePlayer(1, 0));
    }

    showScreen(screenName) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(`${screenName}-screen`).classList.add('active');
        this.gameState.currentScreen = screenName;
    }

    showLevelSelect() {
        this.showScreen('level-select');
        this.updateLevelGrid();
    }

    updateLevelGrid() {
        const grid = document.getElementById('level-grid');
        grid.innerHTML = '';

        for (let i = 1; i <= this.gameState.maxLevel; i++) {
            const button = document.createElement('button');
            button.className = 'level-button';
            // レベル番号を文字として表示
            button.textContent = i;

            if (this.gameState.isLevelCompleted(i)) {
                button.classList.add('completed');
                this.addLevelPreview(button, i); // 💡 クリア済みの道筋をプレビュー描画
            } else if (this.gameState.isLevelUnlocked(i)) {
                button.classList.add('available');
            } else {
                button.classList.add('locked');
            }

            if (this.gameState.isLevelUnlocked(i)) {
                button.addEventListener('click', () => this.startLevel(i));
            }

            grid.appendChild(button);
        }
    }

    /**
     * 💡 クリア済みのレベルボタンに、通った道を含むマッププレビューを描画
     */
    async addLevelPreview(button, level) {
        // レベル番号を前面に出すため、Canvasを背景として追加
        const mapCanvas = document.createElement('canvas');
        mapCanvas.width = 100; // プレビューサイズ (CSSで調整される)
        mapCanvas.height = 100;
        mapCanvas.className = 'level-preview-canvas';
        button.appendChild(mapCanvas);

        if (this.gameState.isLevelCompleted(level)) {
            try {
                const config = MAZE_CONFIG[level];
                // 迷路データをキャッシュから取得、なければ非同期で読み込む
                const mazeData = this.parsedMazes[level] || await parseMazeFromImage(config.filename);
                this.parsedMazes[level] = mazeData; // 読み込んだらキャッシュに保存

                const ctx = mapCanvas.getContext('2d');
                // 保存されたパスを取得
                const pathSet = this.gameState.getCompletedPath(level);
                // セルサイズを計算
                const cellSize = mapCanvas.width / mazeData.width;

                // 迷路とパスを描画
                for (let y = 0; y < mazeData.height; y++) {
                    for (let x = 0; x < mazeData.width; x++) {
                        const drawX = x * cellSize;
                        const drawY = y * cellSize;

                        const isWall = mazeData.walls.some(w => w.x === x && w.y === y);

                        // 背景色（未訪問の通路/壁）
                        if (isWall) {
                            ctx.fillStyle = 'rgba(51, 51, 51, 0.7)'; // 壁
                        } else {
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'; // 通路（未訪問）
                        }

                        // 通った道の色 (優先)
                        if (pathSet.has(`${x},${y}`)) {
                            ctx.fillStyle = '#4CAF50'; // 通った道
                        }

                        ctx.fillRect(drawX, drawY, cellSize, cellSize);

                        // スタート/ゴール
                        if (x === mazeData.start.x && y === mazeData.start.y) {
                            ctx.fillStyle = '#0000FF'; // 青 (スタート)
                            ctx.fillRect(drawX, drawY, cellSize, cellSize);
                        } else if (x === mazeData.goal.x && y === mazeData.goal.y) {
                            ctx.fillStyle = '#F44336'; // 赤 (ゴール)
                            ctx.fillRect(drawX, drawY, cellSize, cellSize);
                        }
                    }
                }
            } catch (error) {
                console.error(`レベル ${level} のプレビュー描画に失敗しました:`, error);
            }
        }
    }

    /**
     * 指定されたレベルの迷路を画像から読み込み開始する (非同期処理)
     */
    async startLevel(level) {
        const config = MAZE_CONFIG[level];
        if (!config) {
            alert('このレベルはまだ実装されていません。');
            return;
        }

        this.gameState.currentLevel = level;

        try {
            // 迷路データをキャッシュから取得、なければ非同期で読み込む
            const mazeData = this.parsedMazes[level] || await parseMazeFromImage(config.filename);
            this.parsedMazes[level] = mazeData; // 読み込んだらキャッシュに保存

            this.maze = new Maze(mazeData); // 画像から生成されたデータを使用
            this.player = new Player(this.maze.start.x, this.maze.start.y);

            this.canvas = document.getElementById('maze-canvas');
            this.ctx = this.canvas.getContext('2d');
            this.minimapCanvas = document.getElementById('minimap-canvas');
            this.minimapCtx = this.minimapCanvas.getContext('2d');

            // キャンバスサイズを迷路サイズに合わせて調整
            this.cellSize = Math.min(400 / this.maze.width, 400 / this.maze.height);
            this.canvas.width = this.maze.width * this.cellSize;
            this.canvas.height = this.maze.height * this.cellSize;

            // ミニマップサイズも調整
            this.minimapCellSize = Math.min(150 / this.maze.width, 150 / this.maze.height);
            this.minimapCanvas.width = this.maze.width * this.minimapCellSize;
            this.minimapCanvas.height = this.maze.height * this.minimapCellSize;

            document.getElementById('current-level').textContent = `レベル ${level}`;

            this.showScreen('game');
            this.render();

        } catch (error) {
            // 読み込み失敗時の処理
            alert(`レベル ${level} の読み込みに失敗しました。\nエラー: ${error.message || error}`);
            console.error(error);
            this.showLevelSelect(); // エラー時はレベル選択画面に戻る
        }
    }

    handleKeyPress(key) {
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

    movePlayer(dx, dy) {
        if (this.player && this.player.move(dx, dy, this.maze)) {
            this.render();

            if (this.player.isAtGoal(this.maze)) { 
                this.completeLevel();
            }
        }
    }

    completeLevel() {
        // 💡 訪問済みセル (this.player.visitedCells) を保存のために渡す
        this.gameState.completeLevel(this.gameState.currentLevel, this.player.visitedCells);

        const nextLevel = this.gameState.currentLevel + 1;
        const hasNextLevel = nextLevel <= this.gameState.maxLevel;

        document.getElementById('clear-message').textContent =
            hasNextLevel ? 'おめでとうございます！次のレベルに挑戦しましょう！' : 'すべてのレベルをクリアしました！';

        document.getElementById('next-level-btn').style.display =
            hasNextLevel ? 'inline-block' : 'none';

        this.showScreen('clear');
    }

    render() {
        this.renderMaze();
        this.renderMinimap();
    }

    renderMaze() {
        const ctx = this.ctx;
        const canvas = this.canvas;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 視界範囲（3x3）を計算
        const viewRange = 1; // プレイヤーの周り1マス（3x3の範囲）

        for (let y = 0; y < this.maze.height; y++) {
            for (let x = 0; x < this.maze.width; x++) {
                const isInView = Math.abs(x - this.player.x) <= viewRange &&
                    Math.abs(y - this.player.y) <= viewRange;
                const hasVisited = this.player.hasVisited(x, y);

                if (isInView || hasVisited) {
                    const drawX = x * this.cellSize;
                    const drawY = y * this.cellSize;

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

        // プレイヤー
        const playerX = this.player.x * this.cellSize;
        const playerY = this.player.y * this.cellSize;
        ctx.fillStyle = '#4CAF50';
        ctx.beginPath();
        ctx.arc(playerX + this.cellSize / 2, playerY + this.cellSize / 2, this.cellSize / 3, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * ミニマップの描画: 通った跡が残ります
     */
    renderMinimap() {
        const ctx = this.minimapCtx;
        const canvas = this.minimapCanvas;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let y = 0; y < this.maze.height; y++) {
            for (let x = 0; x < this.maze.width; x++) {
                // 💡 訪問済みのセルのみ描画 (通った跡)
                if (this.player.hasVisited(x, y)) {
                    const drawX = x * this.minimapCellSize;
                    const drawY = y * this.minimapCellSize;

                    // 壁の色（通った道にある壁）
                    if (this.maze.isWall(x, y)) {
                        ctx.fillStyle = '#333';
                    } else {
                        // 通路の色 (通った跡の色)
                        ctx.fillStyle = '#333';
                    }
                    ctx.fillRect(drawX, drawY, this.minimapCellSize, this.minimapCellSize);

                    // スタート/ゴールも通った跡として表示
                    if (x === this.maze.goal.x && y === this.maze.goal.y) {
                        ctx.fillStyle = '#F44336';
                        ctx.fillRect(drawX, drawY, this.minimapCellSize, this.minimapCellSize);
                    } else if (x === this.maze.start.x && y === this.maze.start.y) {
                         ctx.fillStyle = '#0000FF';
                        ctx.fillRect(drawX, drawY, this.minimapCellSize, this.minimapCellSize);
                    }
                }
            }
        }

        // プレイヤー位置を上書き
        const playerX = this.player.x * this.minimapCellSize;
        const playerY = this.player.y * this.minimapCellSize;
        ctx.fillStyle = '#4CAF50';
        ctx.fillRect(playerX, playerY, this.minimapCellSize, this.minimapCellSize);
    }
}

// ゲーム開始
document.addEventListener('DOMContentLoaded', () => {
    window.game = new MazeGame();
});