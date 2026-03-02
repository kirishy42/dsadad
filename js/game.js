/**
 * 戦略カードゲーム - リアルタイム通信版 (Firebase)
 */

class GameController {
    constructor() {
        this.players = [];
        this.myPlayerId = null;
        this.roomId = "lobby"; // 固定ルームまたはパスワードベース
        this.roomRef = null;

        this.round = 1;
        this.centerCards = [];
        this.deck = [];
        this.timer = 60;
        this.timerInterval = null;
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

        this.myPlayerId = "player_" + Date.now();
        this.roomId = "room_" + password; // 全員同じパスワードなら同じ部屋に入る
        this.roomRef = database.ref('rooms/' + this.roomId);

        this.joinRoom(username);
    }

    joinRoom(username) {
        this.playSE('select');
        this.switchTo('matching-screen');

        // 自分の情報を登録
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
        // ブラウザを閉じたら削除
        this.roomRef.child('players').child(this.myPlayerId).onDisconnect().remove();

        // 参加者の変更を監視
        this.roomRef.child('players').on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            this.players = Object.values(data).sort((a, b) => a.joinedAt - b.joinedAt);
            this.updateMatchingUI();

            // 3人以上かつ全員がメイン等へ移行するフラグを監視（簡易的な進行管理）
            this.checkGameStartCondition();
        });

        // 山札（ホストが生成）
        this.roomRef.child('gameStatus').on('value', (snapshot) => {
            const status = snapshot.val();
            if (status && status.phase === 'selection' && this.currentPhase !== 'selection') {
                this.goToCharSelection();
            }
            if (status && status.phase === 'playing' && this.currentPhase !== 'playing') {
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

        countEl.textContent = `現在 ${this.players.length} 名待機中...`;
    }

    checkGameStartCondition() {
        // ホスト（最初に入った人）が開始か、一定人数で自動開始
        if (this.players[0].id === this.myPlayerId && this.players.length >= 3 && !this.gameStarted) {
            this.gameStarted = true;
            this.roomRef.child('gameStatus').set({
                phase: 'selection',
                round: 1,
                seed: Math.random()
            });
        }
    }

    goToCharSelection() {
        this.currentPhase = 'selection';
        this.switchTo('char-selection-screen');
        this.renderCharOptions();
        if (this.bgm) this.bgm.play().catch(() => { });
    }

    renderCharOptions() {
        const container = document.getElementById('char-options');
        container.innerHTML = '';
        // シード値に基づいて全員同じ選択肢が出るようにすることも可能だが、個人でランダムでもOK
        const pool = [...CHARACTERS].sort(() => Math.random() - 0.5);
        pool.slice(0, 2).forEach(char => {
            const card = document.createElement('div');
            card.className = 'card character selectable-char';
            card.innerHTML = `
                <img src="${char.img}" style="display:block; width:100%; height:110px;">
                <div class="info-box" style="padding:10px; color:#fff;">
                    <div class="name" style="font-weight:bold; color:var(--gold); font-size:1.1rem; margin-bottom:5px;">${char.name}</div>
                    <div class="selection-effect-text" style="font-size:0.75rem; color:#eee; line-height:1.4;">${char.effect}</div>
                </div>
            `;
            card.onclick = () => this.selectCharacter(char);
            container.appendChild(card);
        });
    }

    selectCharacter(char) {
        this.playSE('select');
        // Firebase上で更新
        this.roomRef.child('players').child(this.myPlayerId).update({ character: char });

        // 全員がキャラを選んだか監視
        const unsubscribe = this.roomRef.child('players').on('value', (snapshot) => {
            const players = Object.values(snapshot.val());
            const allSelected = players.every(p => p.character);
            if (allSelected) {
                unsubscribe();
                if (players[0].id === this.myPlayerId) {
                    this.prepareNextRound(1);
                }
            }
        });

        this.switchTo('main-game-screen'); // 先に画面だけ変えて待機っぽく
        document.getElementById('panel-effect-text').textContent = "他のプレイヤーを待っています...";
    }

    prepareNextRound(round) {
        this.deck = [];
        for (let i = 0; i < 15; i++) for (let v = 1; v <= 7; v++) this.deck.push(v);
        // 今回は単純なランダムだが、共通シードがあると良い
        this.deck.sort(() => Math.random() - 0.5);
        const center = this.deck.splice(0, this.players.length);

        this.roomRef.child('gameStatus').update({
            phase: 'playing',
            round: round,
            centerCards: center
        });

        // 全員のプレイ情報をリセット
        this.players.forEach(p => {
            this.roomRef.child('players').child(p.id).update({ hasPlayed: false, selectedValue: null });
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

        // 他人のカード提出を監視
        this.roomRef.child('players').on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data) return;
            this.players = Object.values(data).sort((a, b) => a.joinedAt - b.joinedAt);
            this.updateOpponentsUI();

            // 全員がプレイしたか確認
            const allReady = this.players.every(p => p.hasPlayed);
            if (allReady && this.currentPhase === 'playing') {
                this.currentPhase = 'resolving'; // 重複防止
                setTimeout(() => this.resolveRoundSync(), 1000);
            }
        });
    }

    setupBoard() {
        const bar = document.getElementById('opponents-bar');
        bar.innerHTML = '';
        this.players.forEach(p => {
            if (p.id !== this.myPlayerId) {
                const el = document.createElement('div');
                el.className = 'opponent-stat'; el.id = `player-stat-${p.id}`;
                el.innerHTML = `<div class="avatar">${p.name[0]}</div><div class="status">獲得: ${p.inventory?.length || 0}枚</div><div class="status card-count">🃏 ${p.hand?.length || 10}</div>`;
                bar.appendChild(el);
            }
        });

        const me = this.players.find(p => p.id === this.myPlayerId);
        if (me && me.character) {
            document.getElementById('my-character-card').innerHTML = `
                <div class="card character">
                    <img src="${me.character.img}">
                    <div class="info-box"><div class="name">${me.character.name}</div></div>
                </div>
            `;
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
        me.hand.sort((a, b) => a - b).forEach(v => {
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
        el.textContent = this.timer; el.parentElement.classList.remove('low');
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            this.timer--; el.textContent = this.timer;
            if (this.timer <= 10) el.parentElement.classList.add('low');
            if (this.timer <= 0) {
                clearInterval(this.timerInterval);
                const me = this.players.find(p => p.id === this.myPlayerId);
                if (!me.hasPlayed) this.autoPlay();
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
        const val = me.hand[Math.floor(Math.random() * me.hand.length)];
        this.playCard(val);
    }

    updateOpponentsUI() {
        this.players.forEach(p => {
            if (p.id !== this.myPlayerId) {
                const el = document.getElementById(`player-stat-${p.id}`);
                if (el) {
                    if (p.hasPlayed) el.classList.add('has-played');
                    else el.classList.remove('has-played');
                    el.querySelector('.card-count').textContent = `🃏 ${p.hand?.length || 0}`;
                    el.querySelector('.status').textContent = `獲得: ${p.inventory?.length || 0}枚`;
                }
            }
        });
    }

    async resolveRoundSync() {
        this.playSE('resolve');
        const bids = this.players.map(p => ({ playerId: p.id, value: p.selectedValue }));
        const allocations = resolveBidding(bids, this.centerCards);

        const sortedRewards = [...this.centerCards].sort((a, b) => b - a);
        const valueCounts = {};
        bids.forEach(b => { valueCounts[b.value] = (valueCounts[b.value] || 0) + 1; });
        const validBids = bids.filter(b => valueCounts[b.value] === 1).sort((a, b) => b.value - a.value);

        const animPromises = [];
        validBids.forEach((bid, i) => {
            if (i < sortedRewards.length) {
                const player = this.players.find(p => p.id === bid.playerId);
                const slotIdx = this.centerCards.indexOf(sortedRewards[i]);
                animPromises.push(this.flyCard(slotIdx, player));

                // 自分の獲得なら登録
                if (player.id === this.myPlayerId) {
                    const inv = player.inventory || [];
                    inv.push(sortedRewards[i]);
                    this.roomRef.child('players').child(this.myPlayerId).update({ inventory: inv });
                }
            }
        });

        await Promise.all(animPromises);

        if (this.players[0].id === this.myPlayerId) {
            setTimeout(() => this.prepareNextRound(this.round + 1), 1000);
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

            const targetEl = player.id === this.myPlayerId
                ? document.getElementById('my-inventory-count')
                : document.getElementById(`player-stat-${player.id}`);

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
        const container = document.getElementById('final-results'); container.innerHTML = '';
        const results = this.players.map(p => {
            const res = calculateFinalScore(p.inventory || [], p.character, this.players);
            return { ...p, score: res.score, isSpecial: res.isSpecialWin };
        });
        results.sort((a, b) => (b.isSpecial ? Infinity : b.score) - (a.isSpecial ? Infinity : a.score));
        const winner = results[0];
        document.getElementById('winner-announcement').textContent = `${winner.name} の勝利！`;

        results.forEach(res => {
            const row = document.createElement('div');
            row.className = `result-row ${res.id === winner.id ? 'winner' : ''}`;
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
