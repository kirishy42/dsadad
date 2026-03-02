/**
 * 戦略カードゲーム - ゲームロジック (コア判定)
 */

const CHARACTERS = [
    { id: 1, name: "軍師", effect: "[2]のカードは7点の扱いになります。", img: "bin/1.jpg" },
    { id: 2, name: "もののけ", effect: "[5]以上のカードは0点になりますが、それ以外の合計が2倍になります。", img: "bin/2.jpg" },
    { id: 3, name: "収集家", effect: "7種類すべてのポイントカードが入手できれば特殊勝利。", img: "bin/3.jpg" },
    { id: 4, name: "影響者", effect: "奇数カードの得点が2倍、偶数カードは0点。", img: "bin/4.jpg" },
    { id: 5, name: "巫女", effect: "偶数カードの得点が2倍、奇数カードは0点。", img: "bin/5.jpg" },
    { id: 6, name: "隠者", effect: "最終的な入手カード枚数が2枚以下のとき特殊勝利。", img: "bin/6.jpg" },
    { id: 7, name: "計算家", effect: "合計点数が10の倍数のとき、得点が2倍。", img: "bin/7.jpg" },
    { id: 8, name: "革命児", effect: "[1]のカードが10点になるが、それ以外の得点は半分になる。", img: "bin/8.jpg" },
    { id: 9, name: "孤高の問題児", effect: "[キャラ10]を誰も使っていない場合、得点に+20点。", img: "bin/9.png" },
    { id: 10, name: "光の執行者", effect: "[キャラ9]を誰も使っていない場合、得点に+20点。", img: "bin/10.jpg" }
];

function calculateFinalScore(cardList, chara, allPlayers = []) {
    let score = 0;
    let isSpecialWin = false;

    if (chara.id === 3) {
        const uniqueCards = new Set(cardList);
        if (uniqueCards.size >= 7) isSpecialWin = true;
    }
    if (chara.id === 6) {
        if (cardList.length <= 2) isSpecialWin = true;
    }

    if (isSpecialWin) return { score: Infinity, isSpecialWin: true };

    const processedCards = cardList.map(val => {
        let v = val;
        if (chara.id === 1 && v === 2) v = 7;
        if (chara.id === 8 && v === 1) v = 10;
        return v;
    });

    if (chara.id === 2) {
        let sum = 0;
        processedCards.forEach(v => { if (v < 5) sum += v; });
        score = sum * 2;
    }
    else if (chara.id === 4) {
        processedCards.forEach(v => { if (v % 2 !== 0) score += v * 2; });
    }
    else if (chara.id === 5) {
        processedCards.forEach(v => { if (v % 2 === 0) score += v * 2; });
    }
    else if (chara.id === 8) {
        processedCards.forEach(v => {
            if (v === 10) score += 10;
            else score += v * 0.5;
        });
    }
    else {
        score = processedCards.reduce((a, b) => a + b, 0);
    }

    if (chara.id === 7 && score > 0 && score % 10 === 0) score *= 2;

    if (chara.id === 9) {
        if (!allPlayers.some(p => p.character && p.character.id === 10)) score += 20;
    }
    if (chara.id === 10) {
        if (!allPlayers.some(p => p.character && p.character.id === 9)) score += 20;
    }

    return { score, isSpecialWin: false };
}

/**
 * 入札解決ロジック (3-5人対応)
 */
function resolveBidding(bids, centerCards) {
    const sortedCenter = [...centerCards].sort((a, b) => b - a);
    const valueCounts = {};
    bids.forEach(b => { valueCounts[b.value] = (valueCounts[b.value] || 0) + 1; });

    const validBids = bids.filter(b => valueCounts[b.value] === 1);
    validBids.sort((a, b) => b.value - a.value);

    // 全員にnull（未獲得）をセット
    const result = {};
    bids.forEach(b => result[b.playerId] = null);

    // 上位から報酬を割り当て
    validBids.forEach((bid, index) => {
        if (index < sortedCenter.length) {
            result[bid.playerId] = sortedCenter[index];
        }
    });

    return result;
}
