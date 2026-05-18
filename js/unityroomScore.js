/**
 * unityroom スコア送信（unityroom-client-library の HMAC / 間隔 / リトライに準拠）
 * ボード1: クリアステージ、ボード2: 未踏ルートの通過マス数（累計）
 */
(function (global) {
    const INTERVAL_SECONDS = 6;
    const MAX_TRY_COUNT = 2;

    function emit(text, level) {
        global.dispatchEvent(
            new CustomEvent('labyrinth-ranking-status', {
                detail: { text: text || '', level: level || 'info' },
            }),
        );
    }

    function getConfig() {
        return global.LABYRINTH_UNITYROOM;
    }

    function configReady(cfg) {
        return !!(cfg && cfg.hmacKey);
    }

    function boardNo(cfg, key) {
        return cfg && cfg.boards && cfg.boards[key] != null ? cfg.boards[key] : null;
    }

    function base64ToBytes(b64) {
        const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
        const bin = global.atob(normalized);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) {
            out[i] = bin.charCodeAt(i);
        }
        return out;
    }

    function bufferToHex(buf) {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 1) {
            s += bytes[i].toString(16).padStart(2, '0');
        }
        return s;
    }

    async function hmacSha256Hex(dataText, base64Key) {
        const enc = new TextEncoder();
        const keyBytes = base64ToBytes(base64Key);
        const cryptoKey = await global.crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
        );
        const sig = await global.crypto.subtle.sign('HMAC', cryptoKey, enc.encode(dataText));
        return bufferToHex(sig);
    }

    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    async function postScore(boardNoValue, scoreText, hmacKey) {
        const path = `/gameplay_api/v1/scoreboards/${boardNoValue}/scores`;
        const unixTime = String(Math.floor(Date.now() / 1000));
        const payload = `POST\n${path}\n${unixTime}\n${scoreText}`;
        const signature = await hmacSha256Hex(payload, hmacKey);

        const form = new FormData();
        form.append('score', scoreText);

        const res = await global.fetch(path, {
            method: 'POST',
            headers: {
                'X-Unityroom-Timestamp': unixTime,
                'X-Unityroom-Signature': signature,
            },
            body: form,
            credentials: 'same-origin',
        });
        return res;
    }

    function UnityroomScoreSender(resolveBoardNo, formatSuccess) {
        this._resolveBoardNo = resolveBoardNo;
        this._formatSuccess = formatSuccess;
        this._confirmedMax = null;
        this._lockUntil = 0;
        this._processing = false;
        this._queue = [];
    }

    UnityroomScoreSender.prototype._enqueue = function (scoreInt) {
        const cfg = getConfig();
        const bn = this._resolveBoardNo(cfg);
        if (!configReady(cfg) || bn == null || String(bn).trim() === '') {
            return;
        }
        if (typeof global.crypto === 'undefined' || !global.crypto.subtle) {
            emit('ランキング送信には HTTPS 環境が必要です', 'error');
            return;
        }
        const value = Math.max(0, Math.floor(Number(scoreInt)));
        if (this._confirmedMax !== null && value <= this._confirmedMax) {
            return;
        }
        this._queue.push(value);
        void this._drain();
    };

    UnityroomScoreSender.prototype._drain = async function () {
        if (this._processing) {
            return;
        }
        this._processing = true;
        try {
            while (this._queue.length > 0) {
                const batch = Math.max.apply(null, this._queue);
                this._queue.length = 0;

                if (this._confirmedMax !== null && batch <= this._confirmedMax) {
                    continue;
                }

                const nowS = Math.floor(Date.now() / 1000);
                if (nowS < this._lockUntil) {
                    await sleep((this._lockUntil - nowS) * 1000);
                }
                this._lockUntil = Math.floor(Date.now() / 1000) + INTERVAL_SECONDS;

                const cfg = getConfig();
                const bn = this._resolveBoardNo(cfg);
                if (!configReady(cfg) || bn == null) {
                    break;
                }

                const scoreText = String(batch);
                emit('ランキング送信中…', 'info');

                let ok = false;
                for (let attempt = 0; attempt < MAX_TRY_COUNT; attempt += 1) {
                    if (attempt > 0) {
                        await sleep(INTERVAL_SECONDS * 1000);
                    }
                    try {
                        const res = await postScore(bn, scoreText, cfg.hmacKey);
                        if (res.ok) {
                            ok = true;
                            break;
                        }
                    } catch (_) {
                        /* retry */
                    }
                }

                if (ok) {
                    this._confirmedMax = batch;
                    emit(this._formatSuccess(scoreText), 'ok');
                } else {
                    emit('ランキング送信に失敗しました', 'error');
                }
            }
        } finally {
            this._processing = false;
            if (this._queue.length > 0) {
                void this._drain();
            }
        }
    };

    const clearedStageSender = new UnityroomScoreSender(
        function (cfg) {
            return boardNo(cfg, 'clearedStage');
        },
        function (scoreText) {
            return `ランキング送信済み（ステージ ${scoreText}）`;
        },
    );

    const newPathCellsSender = new UnityroomScoreSender(
        function (cfg) {
            return boardNo(cfg, 'newPathCells');
        },
        function (scoreText) {
            return `ランキング送信済み（未踏ルート ${scoreText} マス）`;
        },
    );

    global.LabyrinthUnityroomScore = {
        notifyClearedStage: function (stage) {
            clearedStageSender._enqueue(stage);
        },
        notifyNewPathCells: function (count) {
            newPathCellsSender._enqueue(count);
        },
    };
})(typeof window !== 'undefined' ? window : globalThis);
