/**
 * 戦略カードゲーム - リアルタイム通信版 (Firebase 安定化Ver + カウントダウン)
 */

class GameController {
    constructor() {
        this.players = [];
        this.myPlayerId = null;
        this.roomId = "lobby";
        this.roomRef = null;
        this.isHost = false;

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
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = this.audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'select') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(440, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            osc.start(); osc.stop(ctx.currentTime + 0.1);
        } else if (type === 'resolve') {
            osc.type = 'square'; osc.frequency.setValueAtTime(220, ctx.currentTime);
            gain.gain.setValueAtTime(0.05, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.2);
        } else if (type === 'match') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(523, ctx.currentTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.3);
        }
    }

    tryLogin() {
        const usernameInput = document.getElementById('username-input');
        const passwordInput = document.getElementById('password-input');
        const username = usernameInput ? usernameInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";

        if (!username) { alert("名乗る名を入力してくれ。"); return; }
        if (password !== "456123") { alert("合言葉が違うようだ。"); return; }

        if (!window.database) {
            alert("通信の準備ができていません。index.htmlのFirebase設定を確認してください。");
            return;
        }

        this.myPlayerId = "player_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
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

        this.roomRef.child('players').on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            this.players = Object.values(data).sort((a, b) => a.joinedAt - b.joinedAt);
            this.isHost = (this.players[0].id === this.myPlayerId);

            this.updateMatchingUI();
            this.checkStartConditionSync();
        });

        this.roomRef.child('gameStatus').on('value', (snapshot) => {
            const status = snapshot.val();
            if (!status) return;

            // カウントダウン開始命令を受け取った場合
            if (status.phase === 'counting' && this.currentPhase !== 'counting') {
                this.startCountdownUI(status.startTime);
            }

            if (status.phase === 'selection' && this.currentPhase !== 'selection') {
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
        const countEl = document.getElementById('matching-count');
        listEl.innerHTML = '';

        this.players.forEach(p => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.textContent = p.id === this.myPlayerId ? `${p.name} (あなた)` : p.name;
            listEl.appendChild(chip);
        });

        if (this.currentPhase === "counting") return; // カウントダウン中なら表示を変えない
        countEl.textContent = `現在 ${this.players.length} 名待機中... (3名以上で開始)`;
    }

    checkStartConditionSync() {
        if (!this.isHost || this.currentPhase !== "") return;

        if (this.players.length >= 3) {
            this.startCountingPhase();
        } else {
            if (!this.matchingTimeout) {
                this.matchingTimeout = setTimeout(() => {
                    if (this.players.length < 3 && this.isHost && this.currentPhase === "") {
                        this.fillWithAI();
                    }
                }, 15000);
            }
        }
    }

    fillWithAI() {
        const names = ["信長(AI)", "秀吉(AI)", "家康(AI)", "幸村(AI)", "政宗(AI)"];
        while (this.players.length < 3) {
            const aiId = "ai_" + Date.now() + "_" + this.players.length;
            const name = names.splice(Math.floor(Math.random() * names.length), 1)[0];
            const aiData = {
                id: aiId,
                name: name,
                isHuman: false,
                hand: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                inventory: [],
                character: CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)],
                selectedValue: null,
                hasPlayed: false,
                joinedAt: firebase.database.ServerValue.TIMESTAMP + this.players.length
            };
            this.roomRef.child('players').child(aiId).set(aiData);
        }
    }

    startCountingPhase() {
        this.currentPhase = "counting";
        this.roomRef.child('gameStatus').set({
            phase: 'counting',
            startTime: firebase.database.ServerValue.TIMESTAMP
        });

        // 5秒後にゲームメイン開始
        setTimeout(() => {
            if (this.isHost) {
                this.startGamePhase();
            }
        }, 5000);
    }

    startCountdownUI(startTime) {
        this.currentPhase = "counting";
        const countEl = document.getElementById('matching-count');
        this.playSE('match');

        let left = 5;
        const iv = setInterval(() => {
            countEl.innerHTML = `<span style="font-size:2rem; color:var(--gold);">対戦開始まで ${left}...</span>`;
            left--;
            if (left < 0) clearInterval(iv);
        }, 1000);
    }

    startGamePhase() {
        this.currentPhase = "selection";
        this.roomRef.child('gameStatus').set({
            phase: 'selection',
            round: 1,
            seed: Math.random()
        });
    }

    goToCharSelection() {
        this.currentPhase = 'selection';
        this.switchTo('char-selection-screen');
        this.renderCharOptions();
        if (this.bgm) this.bgm.play().catch(() => { });

        const checkReady = (snapshot) => {
            const data = snapshot.val();
            if (!data) return;
            const players = Object.values(data);
            const allSelected = players.every(p => p.character);
            if (allSelected) {
                this.roomRef.child('players').off('value', checkReady);
                if (this.isHost) {
                    setTimeout(() => this.prepareNextRound(1), 1000);
                }
            }
        };
        this.roomRef.child('players').on('value', checkReady);
    }

    renderCharOptions() {
        const container = document.getElementById('char-options');
        container.innerHTML = '';
        const pool = [...CHARACTERS].sort(() => Math.random() - 0.5);
        pool.slice(0, 2).forEach(char => {
            const card = document.createElement('div');
            card.className = 'card character selectable-char';
            card.innerHTML = `
                <img src="${char.img}" style="width:100%; height:110px; object-fit:cover;">
                <div class="info-box" style="padding:10px; color:#fff;">
                    <div class="name" style="font-weight:bold; color:var(--gold);">${char.name}</div>
                    <div class="selection-effect-text" style="font-size:0.75rem; color:#eee;">${char.effect}</div>
                </div>
            `;
            card.onclick = () => {
                this.playSE('select');
                this.roomRef.child('players').child(this.myPlayerId).update({ character: char });
                container.innerHTML = `<h2 class="glow-text">他のプレイヤーを待機中...</h2>`;
            };
            container.appendChild(card);
        });
    }

    prepareNextRound(round) {
        if (!this.isHost) return;

        this.deck = [];
        for (let i = 0; i < 15; i++) for (let v = 1; v <= 7; v++) this.deck.push(v);
        this.deck.sort(() => Math.random() - 0.5);
        const center = this.deck.splice(0, this.players.length);

        this.players.forEach(p => {
            this.roomRef.child('players').child(p.id).update({
                hasPlayed: false,
                selectedValue: null
            });
        });

        this.roomRef.child('gameStatus').update({
            phase: 'playing',
            round: round,
            centerCards: center
        });
    }

    startRound() {
        this.currentPhase = 'playing';
        if (this.round > 10) { this.showResults(); return; }

        document.getElementById('current-round').textContent = this.round;
        this.setupBoard();
        this.renderField();
        this.renderHand();
        this.startTimer();

        const checkResolution = (snapshot) => {
            const data = snapshot.val();
            if (!data) return;
            const players = Object.values(data);
            const allPlayed = players.every(p => p.hasPlayed);

            if (allPlayed && this.currentPhase === 'playing') {
                this.currentPhase = 'resolving';
                this.roomRef.child('players').off('value', checkResolution);
                setTimeout(() => this.resolveRoundSync(), 1000);
            }
        };
        this.roomRef.child('players').on('value', checkResolution);

        if (this.isHost) {
            this.simulateAIPlays();
        }
    }

    setupBoard() {
        const bar = document.getElementById('opponents-bar');
        bar.innerHTML = '';
        this.players.forEach(p => {
            if (p.id !== this.myPlayerId) {
                const el = document.createElement('div');
                el.className = 'opponent-stat'; el.id = `player-stat-${p.id}`;
                const invLen = p.inventory ? p.inventory.length : 0;
                const handLen = p.hand ? p.hand.length : 10;
                el.innerHTML = `<div class="avatar">${p.name[0]}</div><div class="status">獲得: ${invLen}枚</div><div class="status card-count">🃏 ${handLen}</div>`;
                bar.appendChild(el);
            }
        });

        const me = this.players.find(p => p.id === this.myPlayerId);
        if (me && me.character) {
            document.getElementById('my-character-card').innerHTML = `<div class="card character"><img src="${me.character.img}"><div class="info-box"><div class="name">${me.character.name}</div></div></div>`;
            document.getElementById('panel-effect-text').textContent = me.character.effect;
        }
    }

    renderField() {
        const grid = document.getElementById('reward-slots');
        grid.innerHTML = '';
        this.centerCards.forEach((val, i) => {
            const slot = document.createElement('div');
            slot.className = 'reward-slot';
            slot.innerHTML = `<div class="acquirer-name" id="acquirer-${i}">?</div><div class="card"><div class="number">${val}</div></div>`;
            grid.appendChild(slot);
        });
    }

    renderHand() {
        const container = document.getElementById('my-hand');
        container.innerHTML = '';
        const me = this.players.find(p => p.id === this.myPlayerId);
        if (!me || !me.hand) return;
        [...me.hand].sort((a, b) => a - b).forEach(v => {
            const card = document.createElement('div');
            card.className = 'card';
            if (me.hasPlayed) card.classList.add('face-down');
            card.innerHTML = `<div class="number">${v}</div>`;
            card.onclick = () => !me.hasPlayed && this.playCard(v);
            container.appendChild(card);
        });
    }

    startTimer() {
        this.timer = 60;
        const el = document.getElementById('timer-sec');
        el.textContent = this.timer;
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            this.timer--; el.textContent = this.timer;
            if (this.timer <= 0) {
                clearInterval(this.timerInterval);
                const me = this.players.find(p => p.id === this.myPlayerId);
                if (me && !me.hasPlayed) this.autoPlay();
            }
        }, 1000);
    }

    playCard(val) {
        this.playSE('select');
        const me = this.players.find(p => p.id === this.myPlayerId);
        const newHand = me.hand.filter(v => v !== val);
        this.roomRef.child('players').child(this.myPlayerId).update({
            selectedValue: val,
            hand: newHand,
            hasPlayed: true
        });
    }

    autoPlay() {
        const me = this.players.find(p => p.id === this.myPlayerId);
        if (me && me.hand.length > 0) this.playCard(me.hand[0]);
    }

    simulateAIPlays() {
        this.players.forEach(p => {
            if (!p.isHuman && !p.hasPlayed) {
                setTimeout(() => {
                    if (this.currentPhase !== 'playing') return;
                    const val = p.hand[Math.floor(Math.random() * p.hand.length)];
                    const newHand = p.hand.filter(v => v !== val);
                    this.roomRef.child('players').child(p.id).update({
                        selectedValue: val,
                        hand: newHand,
                        hasPlayed: true
                    });
                }, 2000 + Math.random() * 5000);
            }
        });
    }

    async resolveRoundSync() {
        this.playSE('resolve');
        const snapshot = await this.roomRef.child('players').once('value');
        const playersMap = snapshot.val();
        if (!playersMap) return;
        const players = Object.values(playersMap);
        const bids = players.map(p => ({ playerId: p.id, value: p.selectedValue }));

        const sortedRewards = [...this.centerCards].sort((a, b) => b - a);
        const valueCounts = {};
        bids.forEach(b => { valueCounts[b.value] = (valueCounts[b.value] || 0) + 1; });
        const validBids = bids.filter(b => valueCounts[b.value] === 1).sort((a, b) => b.value - a.value);

        const animPromises = [];
        validBids.forEach((bid, i) => {
            if (i < sortedRewards.length) {
                const player = players.find(p => p.id === bid.playerId);
                const slotIdx = this.centerCards.indexOf(sortedRewards[i]);
                animPromises.push(this.flyCard(slotIdx, player));

                if (player.id === this.myPlayerId) {
                    const inv = player.inventory || [];
                    inv.push(sortedRewards[i]);
                    this.roomRef.child('players').child(this.myPlayerId).update({ inventory: inv });
                }
            }
        });

        await Promise.all(animPromises);

        if (this.isHost) {
            setTimeout(() => this.prepareNextRound(this.round + 1), 2000);
        }
    }

    flyCard(slotIdx, player) {
        return new Promise(resolve => {
            const slots = document.querySelectorAll('.reward-slot');
            const slot = slots[slotIdx];
            if (!slot) return resolve();
            const cardEl = slot.querySelector('.card');
            const rect = cardEl.getBoundingClientRect();
            const flyer = cardEl.cloneNode(true);
            flyer.classList.add('animating-card');
            flyer.style.left = rect.left + 'px'; flyer.style.top = rect.top + 'px';
            flyer.style.width = rect.width + 'px'; flyer.style.height = rect.height + 'px';
            document.body.appendChild(flyer);
            cardEl.style.visibility = 'hidden';
            document.getElementById(`acquirer-${slotIdx}`).textContent = player.name;

            let targetEl = document.getElementById(`player-stat-${player.id}`);
            if (player.id === this.myPlayerId) targetEl = document.getElementById('my-inventory-count');

            if (!targetEl) { flyer.remove(); return resolve(); }
            const targetRect = targetEl.getBoundingClientRect();

            setTimeout(() => {
                flyer.style.left = (targetRect.left + targetRect.width / 2 - 20) + 'px';
                flyer.style.top = (targetRect.top + targetRect.height / 2 - 20) + 'px';
                flyer.style.transform = 'scale(0.2)'; flyer.style.opacity = '0';
            }, 50);
            setTimeout(() => { flyer.remove(); resolve(); }, 850);
        });
    }

    showResults() {
        this.switchTo('result-screen');
        const container = document.getElementById('final-results');
        container.innerHTML = '';
        const results = this.players.map(p => {
            const res = calculateFinalScore(p.inventory || [], p.character, this.players);
            return { ...p, score: res.score, isSpecial: res.isSpecialWin };
        });
        results.sort((a, b) => (b.isSpecial ? Infinity : b.score) - (a.isSpecial ? Infinity : a.score));

        results.forEach(res => {
            const row = document.createElement('div');
            row.className = `result-row ${res.id === results[0].id ? 'winner' : ''}`;
            const sText = res.isSpecial ? "特 殊 勝 利" : `${res.score}点`;
            row.innerHTML = `<div class="char-thumb"><img src="${res.character.img}" width="50" height="70"></div><div style="padding:0 20px; text-align:left"><strong>${res.name}</strong><br><small>${res.character.effect}</small></div><div class="score">${sText}</div>`;
            container.appendChild(row);
        });
    }

    switchTo(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    }
}

const game = new GameController();
window.game = game;
