/**
 * 戦略カードゲーム - リアルタイム通信版 (Firebase 強制開始ボタン対応版)
 */

class GameController {
    constructor() {
        this.players = [];
        this.myPlayerId = null;
        this.roomId = "lobby";
        this.roomRef = null;
        this.isHost = false;
        this.gameStarted = false;

        this.round = 1;
        this.centerCards = [];
        this.deck = [];
        this.timer = 60;
        this.timerInterval = null;
        this.currentPhase = "";

        this.audioCtx = null;
        this.bgm = document.getElementById('bgm');
        if (this.bgm) this.bgm.volume = 0.15;
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

    tryLogin() {
        const uIn = document.getElementById('username-input');
        const pIn = document.getElementById('password-input');
        const username = uIn ? uIn.value.trim() : "";
        const password = pIn ? pIn.value : "";
        if (!username) { alert("名乗る名を入力してください。"); return; }
        if (password !== "456123") { alert("合言葉が違うようです。"); return; }
        if (!window.database) { alert("通信の準備ができていません。Firebaseの設定を確認してください。"); return; }

        this.myPlayerId = "p_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
        this.roomId = "room_" + password;
        this.roomRef = window.database.ref('rooms/' + this.roomId);
        this.joinRoom(username);
    }

    joinRoom(username) {
        this.playSE('select');
        this.switchTo('matching-screen');

        const myData = {
            id: this.myPlayerId,
            name: username,
            isHuman: true,
            hand: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            inventory: [],
            character: null,
            selectedValue: null,
            hasPlayed: false,
            joinedAt: firebase.database.ServerValue.TIMESTAMP
        };

        this.roomRef.child('players').child(this.myPlayerId).set(myData);
        this.roomRef.child('players').child(this.myPlayerId).onDisconnect().remove();

        // ルーム全体をクリア（ホストが最初に入った時のみ、古いゴミデータを削除）
        this.roomRef.child('players').once('value', (snap) => {
            if (!snap.val() || Object.keys(snap.val()).length <= 1) {
                this.roomRef.child('gameStatus').remove();
            }
        });

        // プレイヤー監視
        this.roomRef.child('players').on('value', (snap) => {
            const data = snap.val();
            if (!data) return;
            const plist = Object.values(data).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
            this.players = plist;

            this.isHost = (this.players[0].id === this.myPlayerId);
            this.updateMatchingUI();

            if (this.isHost && this.currentPhase === "") {
                const hostControls = document.getElementById('host-controls');
                if (hostControls) hostControls.style.display = 'block';
                this.checkAutoStart();
            }
        });

        // 進行管理監視
        this.roomRef.child('gameStatus').on('value', (snap) => {
            const status = snap.val();
            if (!status) return;

            if (status.phase === 'counting' && this.currentPhase !== 'counting') {
                this.handleCounting();
            } else if (status.phase === 'selection' && this.currentPhase !== 'selection') {
                this.goToCharSelection();
            } else if (status.phase === 'playing' && (this.currentPhase !== 'playing' || this.round !== status.round)) {
                this.round = status.round;
                this.centerCards = status.centerCards || [];
                this.startRound();
            }
        });
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
        if (this.currentPhase !== 'counting') {
            countEl.textContent = `現在 ${this.players.length} 名待機中... (3名以上で自動開始)`;
        }
    }

    checkAutoStart() {
        if (!this.isHost || this.currentPhase !== "") return;
        if (this.players.length >= 3) {
            this.startCountingPhase();
        }
    }

    forceStartWithAI() {
        if (!this.isHost || this.currentPhase !== "") return;
        this.playSE('select');
        this.fillBotsSync();
        setTimeout(() => this.startCountingPhase(), 500);
    }

    fillBotsSync() {
        const botNames = ["信長", "秀吉", "家康", "謙信", "信玄", "幸村", "政宗"];
        let currentCount = this.players.length;
        while (currentCount < 3) {
            const bId = "bot_" + Math.random().toString(36).substr(2, 9);
            const bName = botNames.splice(Math.floor(Math.random() * botNames.length), 1)[0] + "(AI)";
            const bData = {
                id: bId,
                name: bName,
                isHuman: false,
                hand: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                inventory: [],
                character: CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)],
                joinedAt: Date.now() + currentCount
            };
            this.roomRef.child('players').child(bId).set(bData);
            currentCount++;
        }
    }

    startCountingPhase() {
        if (this.currentPhase !== "") return;
        this.roomRef.child('gameStatus').set({
            phase: 'counting',
            serverTime: firebase.database.ServerValue.TIMESTAMP
        });
    }

    handleCounting() {
        this.currentPhase = "counting";
        this.playSE('match');
        const countEl = document.getElementById('matching-count');
        const hostControls = document.getElementById('host-controls');
        if (hostControls) hostControls.style.display = 'none';

        let left = 5;
        const iv = setInterval(() => {
            if (countEl) countEl.innerHTML = `<span style="font-size:1.8rem; color:var(--gold); font-weight:bold;">軍議開始まで ${left}...</span>`;
            left--;
            if (left < 0) {
                clearInterval(iv);
                if (this.isHost) {
                    this.roomRef.child('gameStatus').set({
                        phase: 'selection',
                        round: 1,
                        seed: Math.random()
                    });
                }
            }
        }, 1000);
    }

    goToCharSelection() {
        this.currentPhase = 'selection';
        this.switchTo('char-selection-screen');
        this.renderCharOptions();
        if (this.bgm) this.bgm.play().catch(() => { });

        // 全員の選択完了を監視
        const unsubscribe = this.roomRef.child('players').on('value', (snap) => {
            const players = Object.values(snap.val() || {});
            if (players.length >= 3 && players.every(p => p.character)) {
                this.roomRef.child('players').off('value', unsubscribe);
                if (this.isHost) {
                    setTimeout(() => this.prepareRound(1), 1000);
                }
            }
        });
    }

    renderCharOptions() {
        const container = document.getElementById('char-options');
        if (!container) return;
        container.innerHTML = '';
        const pool = [...CHARACTERS].sort(() => Math.random() - 0.5).slice(0, 2);
        pool.forEach(char => {
            const card = document.createElement('div');
            card.className = 'card character selectable-char';
            card.innerHTML = `
                <img src="${char.img}" style="width:100%; height:110px; object-fit:cover;">
                <div style="padding:10px; color:#fff;">
                    <div style="font-weight:bold; color:var(--gold); margin-bottom:5px;">${char.name}</div>
                    <div style="font-size:0.75rem; color:#ccc;">${char.effect}</div>
                </div>
            `;
            card.onclick = () => {
                this.playSE('select');
                this.roomRef.child('players').child(this.myPlayerId).update({ character: char });
                container.innerHTML = `<div class="glass-panel"><h2 class="glow-text">他の軍師を待っています...</h2></div>`;
            };
            container.appendChild(card);
        });
    }

    prepareRound(round) {
        if (!this.isHost) return;
        this.deck = [];
        for (let i = 0; i < 15; i++) for (let v = 1; v <= 7; v++) this.deck.push(v);
        this.deck.sort(() => Math.random() - 0.5);
        const center = this.deck.splice(0, this.players.length);

        this.players.forEach(p => {
            this.roomRef.child('players').child(p.id).update({ hasPlayed: false, selectedValue: null });
        });

        this.roomRef.child('gameStatus').update({
            phase: 'playing',
            round: round,
            centerCards: center
        });
    }

    startRound() {
        this.currentPhase = 'playing';
        if (this.round > 10) { this.finishGame(); return; }
        document.getElementById('current-round').textContent = this.round;
        this.updateBoard();
        this.renderField();
        this.renderHand();
        this.startTimer();

        const resolveSub = this.roomRef.child('players').on('value', (snap) => {
            const players = Object.values(snap.val() || {});
            if (players.every(p => p.hasPlayed)) {
                this.roomRef.child('players').off('value', resolveSub);
                this.currentPhase = 'resolving';
                setTimeout(() => this.executeResolution(), 1000);
            }
        });

        if (this.isHost) this.handleBotsPlay();
    }

    updateBoard() {
        const bar = document.getElementById('opponents-bar');
        if (!bar) return;
        bar.innerHTML = '';
        this.players.forEach(p => {
            if (p.id !== this.myPlayerId) {
                const el = document.createElement('div');
                el.className = 'opponent-stat'; el.id = `player-stat-${p.id}`;
                const invC = p.inventory ? p.inventory.length : 0;
                const handC = p.hand ? p.hand.length : 10;
                el.innerHTML = `<div class="avatar">${p.name[0]}</div><div>獲得: ${invC}枚</div><div class="card-count">🃏 ${handC}枚</div>`;
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

    renderField() {
        const grid = document.getElementById('reward-slots');
        if (!grid) return;
        grid.innerHTML = '';
        this.centerCards.forEach((v, i) => {
            const s = document.createElement('div');
            s.className = 'reward-slot';
            s.innerHTML = `<div class="acquirer-name" id="acquirer-${i}">?</div><div class="card"><div class="number">${v}</div></div>`;
            grid.appendChild(s);
        });
    }

    renderHand() {
        const container = document.getElementById('my-hand');
        if (!container) return;
        container.innerHTML = '';
        const me = this.players.find(p => p.id === this.myPlayerId);
        if (!me || !me.hand) return;
        [...me.hand].sort((a, b) => a - b).forEach(v => {
            const card = document.createElement('div');
            card.className = 'card';
            if (me.hasPlayed) card.classList.add('face-down');
            card.innerHTML = `<div class="number">${v}</div>`;
            card.onclick = () => !me.hasPlayed && this.submitCard(v);
            container.appendChild(card);
        });
    }

    startTimer() {
        this.timer = 60;
        const el = document.getElementById('timer-sec');
        if (!el) return;
        el.textContent = this.timer;
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            this.timer--; el.textContent = this.timer;
            if (this.timer <= 0) {
                clearInterval(this.timerInterval);
                const me = this.players.find(p => p.id === this.myPlayerId);
                if (me && !me.hasPlayed) this.submitCard(me.hand[0]);
            }
        }, 1000);
    }

    submitCard(val) {
        this.playSE('select');
        const me = this.players.find(p => p.id === this.myPlayerId);
        const nh = me.hand.filter(v => v !== val);
        this.roomRef.child('players').child(this.myPlayerId).update({
            selectedValue: val, hand: nh, hasPlayed: true
        });
    }

    handleBotsPlay() {
        this.players.forEach(p => {
            if (!p.isHuman && !p.hasPlayed) {
                setTimeout(() => {
                    if (this.currentPhase !== 'playing') return;
                    const val = p.hand[Math.floor(Math.random() * p.hand.length)];
                    const nh = p.hand.filter(v => v !== val);
                    this.roomRef.child('players').child(p.id).update({
                        selectedValue: val, hand: nh, hasPlayed: true
                    });
                }, 2000 + Math.random() * 3000);
            }
        });
    }

    async executeResolution() {
        this.playSE('resolve');
        const snap = await this.roomRef.child('players').once('value');
        const players = Object.values(snap.val() || {});
        const bids = players.map(p => ({ pId: p.id, val: p.selectedValue }));

        const rewards = [...this.centerCards].sort((a, b) => b - a);
        const vCount = {};
        bids.forEach(b => vCount[b.val] = (vCount[b.val] || 0) + 1);
        const valid = bids.filter(b => vCount[b.val] === 1).sort((a, b) => b.val - a.val);

        const anims = [];
        valid.forEach((bid, i) => {
            if (i < rewards.length) {
                const p = players.find(x => x.id === bid.pId);
                const sIdx = this.centerCards.indexOf(rewards[i]);
                anims.push(this.animateFly(sIdx, p));
                if (p.id === this.myPlayerId) {
                    const inv = p.inventory || []; inv.push(rewards[i]);
                    this.roomRef.child('players').child(this.myPlayerId).update({ inventory: inv });
                }
            }
        });
        await Promise.all(anims);
        if (this.isHost) setTimeout(() => this.prepareRound(this.round + 1), 2000);
    }

    animateFly(sIdx, player) {
        return new Promise(res => {
            const slots = document.querySelectorAll('.reward-slot');
            const slot = slots[sIdx];
            if (!slot) return res();
            const card = slot.querySelector('.card');
            const rect = card.getBoundingClientRect();
            const flyer = card.cloneNode(true);
            flyer.classList.add('animating-card');
            flyer.style.cssText = `left:${rect.left}px; top:${rect.top}px; width:${rect.width}px; height:${rect.height}px;`;
            document.body.appendChild(flyer);
            card.style.visibility = 'hidden';
            document.getElementById(`acquirer-${sIdx}`).textContent = player.name;
            const target = (player.id === this.myPlayerId) ? document.getElementById('my-inventory-count') : document.getElementById(`player-stat-${player.id}`);
            if (!target) { flyer.remove(); return res(); }
            const tRect = target.getBoundingClientRect();
            setTimeout(() => {
                flyer.style.left = (tRect.left + tRect.width / 2 - 20) + 'px';
                flyer.style.top = (tRect.top + tRect.height / 2 - 20) + 'px';
                flyer.style.transform = 'scale(0.2)'; flyer.style.opacity = '0';
            }, 50);
            setTimeout(() => { flyer.remove(); res(); }, 850);
        });
    }

    finishGame() {
        this.switchTo('result-screen');
        const container = document.getElementById('final-results');
        if (!container) return;
        container.innerHTML = '';
        const resList = this.players.map(p => {
            const sObj = calculateFinalScore(p.inventory || [], p.character, this.players);
            return { ...p, score: sObj.score, sp: sObj.isSpecialWin };
        });
        resList.sort((a, b) => (b.sp ? 999 : b.score) - (a.sp ? 999 : a.score));
        resList.forEach(r => {
            const row = document.createElement('div');
            row.className = `result-row ${r.id === resList[0].id ? 'winner' : ''}`;
            const sText = r.sp ? "【特殊勝利】" : `${r.score}点`;
            row.innerHTML = `<div class="char-thumb"><img src="${r.character.img}" width="50"></div><div style="flex:1; padding-left:15px; text-align:left;"><strong>${r.name}</strong><br><small>${r.character.effect}</small></div><div class="score">${sText}</div>`;
            container.appendChild(row);
        });
    }

    switchTo(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(id); if (target) target.classList.add('active');
    }
}
const game = new GameController(); window.game = game;
