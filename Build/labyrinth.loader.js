(function () {
    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    function candidateUrls(primary) {
        var name = String(primary || "").replace(/^.*\//, "");
        return [primary, "./" + name, "Build/" + name];
    }

    async function fetchGzipUtf8Sequential(urls) {
        var list = Array.isArray(urls) ? urls : [urls];
        for (var i = 0; i < list.length; i += 1) {
            try {
                var response = await fetch(list[i], { cache: "no-store" });
                if (!response.ok) {
                    continue;
                }
                var buf = await response.arrayBuffer();
                if (typeof DecompressionStream !== "undefined") {
                    try {
                        var ds = new DecompressionStream("gzip");
                        var outBuf = await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
                        return new TextDecoder("utf-8").decode(outBuf);
                    } catch (err) {
                        return new TextDecoder("utf-8").decode(buf);
                    }
                }
                return new TextDecoder("utf-8").decode(buf);
            } catch (error) {
                /* try next */
            }
        }
        throw new Error("Failed to load: " + list.join(", "));
    }

    async function prefetchGzipBinarySequential(urls) {
        var list = Array.isArray(urls) ? urls : [urls];
        for (var i = 0; i < list.length; i += 1) {
            try {
                var response = await fetch(list[i], { cache: "no-store" });
                if (!response.ok) {
                    continue;
                }
                var buf = await response.arrayBuffer();
                if (typeof DecompressionStream !== "undefined") {
                    try {
                        var ds = new DecompressionStream("gzip");
                        await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
                    } catch (err) {
                        /* ignore */
                    }
                }
                return;
            } catch (error) {
                /* try next */
            }
        }
    }

    function executeScriptText(scriptText) {
        return new Promise(function (resolve, reject) {
            try {
                var inlineScript = document.createElement("script");
                inlineScript.text = "(function(){\n" + scriptText + "\n})();";
                document.body.appendChild(inlineScript);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Unity WebGL の createUnityInstance と同じシグネチャ。
     * CSS を data.gz、ゲーム本体を framework.js.gz として読み込む（WASM は未使用のプレースホルダ）。
     */
    window.createUnityInstance = async function (canvas, config, onProgress) {
        if (typeof onProgress === "function") {
            onProgress(0.12);
        }
        await sleep(40);

        var dataUrl = config && config.dataUrl;
        if (dataUrl) {
            var cssText = await fetchGzipUtf8Sequential(candidateUrls(dataUrl));
            var styleEl = document.createElement("style");
            styleEl.setAttribute("data-labyrinth", "data");
            styleEl.textContent = cssText;
            document.head.appendChild(styleEl);
        }

        if (typeof onProgress === "function") {
            onProgress(0.38);
        }
        await sleep(40);

        var codeUrl = config && config.codeUrl;
        if (codeUrl) {
            await prefetchGzipBinarySequential(candidateUrls(codeUrl));
        }

        if (typeof onProgress === "function") {
            onProgress(0.55);
        }
        await sleep(40);

        var frameworkUrl = (config && config.frameworkUrl) || "Build/labyrinth.framework.js.gz";
        var frameworkText = await fetchGzipUtf8Sequential(candidateUrls(frameworkUrl));
        if (typeof onProgress === "function") {
            onProgress(0.82);
        }
        await executeScriptText(frameworkText);

        if (typeof onProgress === "function") {
            onProgress(1);
        }

        return {
            SetFullscreen: function () {},
        };
    };
})();
