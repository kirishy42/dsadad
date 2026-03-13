/**
 * 戦略カードゲーム - リアルタイム通信版 (v4.1 報酬同期改善Ver)
 * 1. ホストによる一括報酬配布 (アトミック更新)
 * 2. インベントリ表示の強制同期
 */

class GameController {
    constructor() {
        this.players = [];
        this.myPlayerId = null;
        this.roomRef = null;
        this.isHost = false;

        this.round = 1;
        this.centerCards = [];
        this.timer = 60;

        this.syncTimer = null;
        this.gameTimer = null;

        this.currentPhase = "";
        this.gameStatus = null;

        this.bgm = null;
        this.audioInitialized = false;

        this.log("Game system initialized. v4.1 stable.");
    }

    stopAllTimers() {
        if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null; }
        if (this.gameTimer) { clearInterval(this.gameTimer); this.gameTimer = null; }
    }

    initAudio() {
        if (this.audioInitialized) return;
        this.bgm = document.getElementById('bgm');
        this.loadVolume();
        this.audioInitialized = true;
    }

    loadVolume() {
        const saved = localStorage.getItem('game_volume');
        const vol = (saved !== null) ? parseFloat(saved) : 0.15;
        if (this.bgm) this.bgm.volume = vol;
        const slider = document.getElementById('volume-slider');
        if (slider) slider.value = vol;
    }

    setVolume(val) {
        const vol = parseFloat(val);
        if (this.bgm) this.bgm.volume = vol;
        localStorage.setItem('game_volume', vol);
    }

    log(msg) {
        console.log("[SYSTEM]", msg);
        const logEl = document.getElementById('debug-log');
        if (logEl) {
            const div = document.createElement('div');
            div.textContent = `> ${msg}`;
            logEl.appendChild(div);
            logEl.scrollTop = logEl.scrollHeight;
        }
    }

    playSE(type) {
        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = this.audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            if (type === 'select') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(440, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.1, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.1);
            } else if (type === 'resolve') {
                osc.type = 'square'; osc.frequency.setValueAtTime(220, ctx.currentTime);
                gain.gain.setValueAtTime(0.05, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.2);
            } else if (type === 'match') {
                osc.type = 'triangle'; osc.frequency.setValueAtTime(523, ctx.currentTime);
                gain.gain.setValueAtTime(0.1, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.3);
            }
        } catch (e) { }
    }

    async resetRoom() {
        if (!confirm("ルームを強制リセットしますか？進行中のゲームは破棄されます。")) return;
        if (!window.database) return;
        this.log("Emergency Reset Triggered.");
        await window.database.ref('rooms/room_official').remove();
        alert("ルームを清掃しました。マッチングを開始してください。");
        location.reload();
    }

    tryLogin() {
        const uIn = document.getElementById('username-input');
        const username = uIn ? uIn.value.trim() : "";
        if (!username) { alert("名乗る名を入力してください。"); return; }
        if (!window.database) { alert("DB接続エラー。"); return; }

        this.initAudio();
        this.myPlayerId = "p_" + Date.now();
        this.roomRef = window.database.ref('rooms/room_official');
        this.joinRoom(username);
    }

    async joinRoom(username) {
        this.playSE('select');
        this.switchTo('matching-screen');

        const playersSnap = await this.roomRef.child('players').once('value');
        if (!playersSnap.exists()) {
            await this.roomRef.child('gameStatus').set({ phase: "waiting" });
        }

        const myData = {
            id: this.myPlayerId, name: username, isHuman: true,
            hand: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], inventory: [],
            character: null, selectedValue: null, hasPlayed: false,
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        };

        await this.roomRef.child('players').child(this.myPlayerId).set(myData);
        this.roomRef.child('players').child(this.myPlayerId).onDisconnect().remove();

        this.roomRef.on('value', (snap) => {
            const root = snap.val();
            if (!root) return;

            const playersData = root.players || {};
            let hasStaleData = false;
            Object.keys(playersData).forEach(pid => {
                const p = playersData[pid];
                if (!p.isHuman || p.isBot) {
                    this.roomRef.child('players').child(pid).remove();
                    hasStaleData = true;
                }
            });
            if (hasStaleData) return;

            this.players = Object.values(playersData).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
            this.isHost = (this.players.length > 0 && this.players[0].id === this.myPlayerId);

            const status = root.gameStatus || { phase: "waiting" };
            this.gameStatus = status;
            this.syncUI(status);
        });
    }

    syncUI(status) {
        const phase = status.phase;

        if (phase === 'waiting') {
            if (this.currentPhase !== 'waiting') {
                this.currentPhase = 'waiting';
                this.stopAllTimers();
                this.switchTo('matching-screen');
            }
            this.updateMatchingUI();
        }
        else if (phase === 'counting') {
            if (this.currentPhase !== 'counting') {
                this.currentPhase = 'counting';
                this.executeCounting();
            }
        }
        else if (phase === 'selection') {
            if (this.currentPhase !== 'selection') {
                this.currentPhase = 'selection';
                this.executeSelection();
            }
            const allPicked = this.players.every(p => p.character);
            if (allPicked && this.isHost) {
                this.roomRef.child('gameStatus').transaction(cur => {
                    if (cur && cur.phase === 'selection') return { phase: 'transitioning' };
                }, (err, commit) => {
                    if (commit) this.prepareNextRound(1);
                });
            }
        }
        else if (phase === 'playing') {
            if (this.currentPhase !== 'playing' || this.round !== status.round) {
                this.currentPhase = 'playing';
                this.round = status.round;
                this.centerCards = status.centerCards || [];
                this.executePlaying();
            } else {
                this.updateOpponentsUI();
                this.renderMyHand();
                this.updateInventoryCount(); // インベントリ表示を更新
                if (this.isHost && this.players.every(p => p.hasPlayed)) {
                    this.roomRef.child('gameStatus/phase').set('resolving');
                    setTimeout(() => this.processResolution(), 1000);
                }
            }
        }
        else if (phase === 'resolving') {
            if (this.currentPhase !== 'resolving') {
                this.currentPhase = 'resolving';
                this.updateInventoryCount();
                this.runResolutionUI();
            }
        }
    }

    updateInventoryCount() {
        const me = this.players.find(p => p.id === this.myPlayerId);
        if (me) {
            const countEl = document.getElementById('my-inventory-count');
            if (countEl) countEl.textContent = (me.inventory || []).length;

            const listEl = document.getElementById('my-inventory-list');
            if (listEl) {
                listEl.innerHTML = '';
                (me.inventory || []).forEach(val => {
                    const card = document.createElement('div');
                    card.className = 'mini-card';
                    card.textContent = val;
                    listEl.appendChild(card);
                });
            }
        }
    }

    updateMatchingUI() {
        const listEl = document.getElementById('matched-players');
        if (!listEl) return;
        listEl.innerHTML = '';
        this.players.forEach(p => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.textContent = p.id === this.myPlayerId ? `${p.name} (あなた)` : p.name;
            listEl.appendChild(chip);
        });

        const countEl = document.getElementById('matching-count');
        const num = this.players.length;
        if (countEl) countEl.textContent = `現在 ${num} 名待機中。`;

        const hostBtn = document.getElementById('host-controls');
        if (hostBtn) hostBtn.style.display = (this.isHost && num >= 2) ? 'block' : 'none';
    }

    updateOpponentsUI() {
        this.players.forEach(p => {
            if (p.id !== this.myPlayerId) {
                const el = document.getElementById(`player-stat-${p.id}`);
                if (el) {
                    if (p.hasPlayed) el.classList.add('has-played');
                    else el.classList.remove('has-played');
                    const inv = p.inventory ? p.inventory.length : 0;
                    const hand = p.hand ? p.hand.length : 10;
                    const cc = el.querySelector('.card-count');
                    if (cc) cc.textContent = `🃏 ${hand}枚`;
                    // 獲得エリアのテキスト更新
                    const invText = el.querySelector('div:nth-child(2)');
                    if (invText) invText.textContent = `獲得: ${inv}枚`;
                }
            }
        });
    }

    startCountingState() {
        if (!this.isHost) return;
        this.roomRef.child('gameStatus').set({ phase: 'counting' });
    }

    executeCounting() {
        this.stopAllTimers();
        this.playSE('match');
        this.switchTo('matching-screen');
        let sec = 5;
        this.syncTimer = setInterval(() => {
            const el = document.getElementById('matching-count');
            if (el) el.innerHTML = `<span style="font-size:2rem; color:var(--gold);">軍議開始まで ${sec}...</span>`;
            if (sec <= 0) {
                if (this.isHost) this.roomRef.child('gameStatus').set({ phase: 'selection', round: 1 });
                clearInterval(this.syncTimer);
            }
            sec--;
        }, 1000);
    }

    executeSelection() {
        this.stopAllTimers();
        this.switchTo('char-selection-screen');
        this.renderSelectionCards();
    }

    renderSelectionCards() {
        const container = document.getElementById('char-options');
        if (!container) return;
        container.innerHTML = '';
        const pool = [...CHARACTERS].sort(() => Math.random() - 0.5).slice(0, 2);
        pool.forEach(char => {
            const card = document.createElement('div');
            card.className = 'card character selectable-char';
            card.innerHTML = `<img src="${char.img}"><div class="info-box"><div class="name">${char.name}</div><div class="selection-effect-text">${char.effect}</div></div>`;
            card.onclick = () => {
                this.playSE('select');
                this.roomRef.child('players').child(this.myPlayerId).update({ character: char });
                container.innerHTML = `<h2 class="glow-text" style="grid-column:1/-1;">全軍師の決断を待っています...</h2>`;
                if (this.bgm && this.bgm.paused) this.bgm.play().catch(() => { });
            };
            container.appendChild(card);
        });
    }

    prepareNextRound(r) {
        if (!this.isHost) return;
        const deck = [];
        for (let i = 0; i < 15; i++) for (let v = 1; v <= 7; v++) deck.push(v);
        deck.sort(() => Math.random() - 0.5);
        const center = deck.splice(0, this.players.length);

        const updates = {};
        this.players.forEach(p => {
            updates[`players/${p.id}/hasPlayed`] = false;
            updates[`players/${p.id}/selectedValue`] = null;
        });
        updates['gameStatus'] = { phase: 'playing', round: r, centerCards: center };
        this.roomRef.update(updates);
    }

    executePlaying() {
        this.stopAllTimers();
        this.switchTo('main-game-screen');
        if (this.round > 10) { this.showFinalResults(); return; }
        const rd = document.getElementById('current-round');
        if (rd) rd.textContent = this.round;
        this.setupGameUI();
        this.renderGameField();
        this.renderMyHand();
        this.startRoundTimer();
    }

    setupGameUI() {
        const bar = document.getElementById('opponents-bar');
        if (!bar) return; bar.innerHTML = '';
        this.players.forEach(p => {
            if (p.id !== this.myPlayerId) {
                const el = document.createElement('div');
                el.className = 'opponent-stat'; el.id = `player-stat-${p.id}`;
                const inv = p.inventory ? p.inventory.length : 0;
                const hand = p.hand ? p.hand.length : 10;
                el.innerHTML = `<div class="avatar">${p.name[0]}</div><div>獲得: ${inv}枚</div><div class="card-count">🃏 ${hand}枚</div>`;
                bar.appendChild(el);
            }
        });
        const me = this.players.find(p => p.id === this.myPlayerId);
        if (me && me.character) {
            const cp = document.getElementById('my-character-card');
            if (cp) cp.innerHTML = `<div class="card character"><img src="${me.character.img}"><div class="info-box"><div class="name">${me.character.name}</div></div></div>`;
            const et = document.getElementById('panel-effect-text');
            if (et) et.textContent = me.character.effect;
        }
    }

    renderGameField() {
        // ラウンド開始時に前回のログを掃除
        const log = document.getElementById('resolution-log');
        if (log) log.innerHTML = '';

        const grid = document.getElementById('reward-slots');
        if (!grid) return; grid.innerHTML = '';
        this.centerCards.forEach((v, i) => {
            const s = document.createElement('div');
            s.className = 'reward-slot';
            s.innerHTML = `<div class="acquirer-name" id="acquirer-${i}">?</div><div class="card"><div class="number">${v}</div></div>`;
            grid.appendChild(s);
        });
    }

    renderMyHand() {
        const container = document.getElementById('my-hand');
        if (!container) return; container.innerHTML = '';
        const me = this.players.find(p => p.id === this.myPlayerId);
        if (!me || !me.hand) return;
        [...me.hand].sort((a, b) => a - b).forEach(v => {
            const card = document.createElement('div');
            card.className = 'card';
            if (me.hasPlayed) card.classList.add('face-down');
            card.innerHTML = `<div class="number">${v}</div>`;
            card.onclick = () => !me.hasPlayed && this.handleCardSubmission(v);
            container.appendChild(card);
        });
    }

    startRoundTimer() {
        this.timer = 60;
        const el = document.getElementById('timer-sec');
        if (!el) return; el.textContent = this.timer;
        this.gameTimer = setInterval(() => {
            this.timer--; el.textContent = this.timer;
            if (this.timer <= 0) {
                clearInterval(this.gameTimer);
                const me = this.players.find(p => p.id === this.myPlayerId);
                if (me && !me.hasPlayed) this.handleCardSubmission(me.hand[0]);
            }
        }, 1000);
    }

    handleCardSubmission(val) {
        const me = this.players.find(p => p.id === this.myPlayerId);
        if (!me) return;
        this.playSE('select');
        const nh = me.hand.filter(v => v !== val);
        this.roomRef.child('players').child(this.myPlayerId).update({
            selectedValue: val, hand: nh, hasPlayed: true
        });
    }

    async processResolution() {
        if (!this.isHost) return;

        // ホストが最終的な判定結果を確定させ、DBに書き込む
        const snap = await this.roomRef.child('players').once('value');
        const ps = Object.values(snap.val() || {});
        const bids = ps.map(p => ({ pId: p.id, val: p.selectedValue }));
        // 【修正】報酬カードをソートせず、配列の順序（左から順）を使用する
        const rwrds = [...this.centerCards];
        const vC = {};
        bids.forEach(b => vC[b.val] = (vC[b.val] || 0) + 1);
        const valid = bids.filter(b => vC[b.val] === 1).sort((a, b) => b.val - a.val);

        const updates = {};
        valid.forEach((bid, i) => {
            if (i < rwrds.length) {
                const player = ps.find(x => x.id === bid.pId);
                const currentInv = player.inventory || [];
                currentInv.push(rwrds[i]);
                updates[`players/${bid.pId}/inventory`] = currentInv;
            }
        });

        // インベントリの更新（演出は各自が自動で実行する）
        await this.roomRef.update(updates);

        // 次のラウンドへの遷移（演出時間を考慮して2秒待つ）
        setTimeout(() => this.prepareNextRound(this.round + 1), 2000);
    }

    async runResolutionUI() {
        this.playSE('resolve');
        this.log("Running Resolution UI...");

        const ps = this.players;
        const bids = ps.map(p => ({ pId: p.id, val: p.selectedValue, name: p.name }));
        const rwrds = [...this.centerCards]; // 【重要】ここもソートしない
        const vC = {};
        bids.forEach(b => vC[b.val] = (vC[b.val] || 0) + 1);
        const valid = bids.filter(b => vC[b.val] === 1).sort((a, b) => b.val - a.val);

        const logContainer = document.getElementById('resolution-log');
        if (logContainer) logContainer.innerHTML = '';

        // まずバッティング（被り）のログを表示
        const duplicates = bids.filter(b => vC[b.val] > 1);
        const dupValues = [...new Set(duplicates.map(d => d.val))];
        dupValues.forEach(v => {
            const names = bids.filter(b => b.val === v).map(b => b.name).join(' と ');
            const logItem = document.createElement('div');
            logItem.className = 'log-item conflict';
            logItem.textContent = `⚠️ [${v}] が被り！ (${names})`;
            logContainer.appendChild(logItem);
        });

        // 提出された数字を相手のバーに一時的に表示
        ps.forEach(p => {
            if (p.id !== this.myPlayerId) {
                const el = document.getElementById(`player-stat-${p.id}`);
                if (el) {
                    const bidVal = p.selectedValue || "?";
                    const reveal = document.createElement('div');
                    reveal.className = 'reveal-val';
                    reveal.textContent = bidVal;
                    el.appendChild(reveal);
                }
            } else {
                // 自分の出したカードも再確認表示
                const hand = document.getElementById('my-hand');
                if (hand) hand.classList.remove('selectable');
            }
        });

        const anims = [];
        valid.forEach((bid, i) => {
            if (i < rwrds.length) {
                const p = ps.find(x => x.id === bid.pId);
                const idx = i; // 左からの配布なのでインデックス i がそのまま centerCards のスロットに対応
                anims.push(this.startFlyAnim(idx, p));

                // 獲得ログの追加
                if (logContainer) {
                    const logItem = document.createElement('div');
                    logItem.className = 'log-item success';
                    logItem.textContent = `✨ ${p.name}: [${bid.val}] を出し [${rwrds[idx]}] を獲得！`;
                    logContainer.appendChild(logItem);
                }
            }
        });

        await Promise.all(anims);
    }

    startFlyAnim(sIdx, player) {
        return new Promise(res => {
            const slots = document.querySelectorAll('.reward-slot');
            const slot = slots[sIdx]; if (!slot) return res();
            const card = slot.querySelector('.card');
            const rect = card.getBoundingClientRect();
            const flyer = card.cloneNode(true);
            flyer.classList.add('animating-card');
            flyer.style.cssText = `left:${rect.left}px; top:${rect.top}px; width:${rect.width}px; height:${rect.height}px;`;
            document.body.appendChild(flyer);
            card.style.visibility = 'hidden';
            const acq = document.getElementById(`acquirer-${sIdx}`);
            if (acq) acq.textContent = player.name;

            const isMe = (player.id === this.myPlayerId);
            const target = isMe ? document.getElementById('my-inventory-count') : document.getElementById(`player-stat-${player.id}`);
            if (!target) { flyer.remove(); return res(); }

            const tRect = target.getBoundingClientRect();
            setTimeout(() => {
                flyer.style.left = (tRect.left + tRect.width / 2 - 20) + 'px';
                flyer.style.top = (tRect.top + tRect.height / 2 - 20) + 'px';
                flyer.style.transform = 'scale(0.2)'; flyer.style.opacity = '0';
            }, 50);
            setTimeout(() => {
                flyer.remove();
                if (isMe) this.updateInventoryCount();
                res();
            }, 850);
        });
    }

    showFinalResults() {
        this.switchTo('result-screen');
        const container = document.getElementById('final-results');
        if (!container) return; container.innerHTML = '';
        const list = this.players.map(p => {
            const sO = calculateFinalScore(p.inventory || [], p.character, this.players);
            return { ...p, score: sO.score, sp: sO.isSpecialWin };
        });
        list.sort((a, b) => (b.sp ? 999 : b.score) - (a.sp ? 999 : a.score));
        list.forEach(r => {
            const row = document.createElement('div');
            row.className = `result-row ${r.id === list[0].id ? 'winner' : ''}`;
            const sText = r.sp ? "【特殊勝利】" : `${r.score}点`;
            row.innerHTML = `<div class="char-thumb"><img src="${r.character.img}" width="50"></div><div style="flex:1; padding-left:15px; text-align:left;"><strong>${r.name}</strong><br><small>${r.character.effect}</small></div><div class="score">${sText}</div>`;
            container.appendChild(row);
        });
    }

    switchTo(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(id);
        if (target) {
            target.classList.add('active');
            this.log(`UI Active: ${id}`);
        }
    }
}
const game = new GameController(); window.game = game;
