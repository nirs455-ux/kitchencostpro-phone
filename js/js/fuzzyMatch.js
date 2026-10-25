// תרגום של difflib.SequenceMatcher.ratio() + get_close_matches מפייתון, לשימוש בהצעת "התאמה מטושטשת" בסריקה.
// אלגוריתם Ratcliff/Obershelp - אותה שיטה ש-Python משתמש בה.

function findLongestMatch(a, b, aLo, aHi, bHi, bLo, b2j) {
    let bestI = aLo, bestJ = bLo, bestSize = 0;
    let j2len = {};
    for (let i = aLo; i < aHi; i++) {
        const newJ2len = {};
        const indices = b2j[a[i]] || [];
        for (const j of indices) {
            if (j < bLo) continue;
            if (j >= bHi) break;
            const k = (j2len[j - 1] || 0) + 1;
            newJ2len[j] = k;
            if (k > bestSize) {
                bestI = i - k + 1;
                bestJ = j - k + 1;
                bestSize = k;
            }
        }
        j2len = newJ2len;
    }
    return [bestI, bestJ, bestSize];
}

function buildB2j(b) {
    const b2j = {};
    for (let j = 0; j < b.length; j++) {
        const ch = b[j];
        (b2j[ch] = b2j[ch] || []).push(j);
    }
    return b2j;
}

function getMatchingBlocks(a, b) {
    const b2j = buildB2j(b);
    const queue = [[0, a.length, 0, b.length]];
    const matchingBlocks = [];
    while (queue.length) {
        const [aLo, aHi, bLo, bHi] = queue.pop();
        const [i, j, k] = findLongestMatch(a, b, aLo, aHi, bHi, bLo, b2j);
        if (k) {
            matchingBlocks.push([i, j, k]);
            if (aLo < i && bLo < j) queue.push([aLo, i, bLo, j]);
            if (i + k < aHi && j + k < bHi) queue.push([i + k, aHi, j + k, bHi]);
        }
    }
    matchingBlocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return matchingBlocks;
}

export function ratio(a, b) {
    if (!a.length && !b.length) return 1;
    const blocks = getMatchingBlocks(a, b);
    let matches = 0;
    for (const [, , size] of blocks) matches += size;
    return (2.0 * matches) / (a.length + b.length);
}

// מקביל ל-difflib.get_close_matches(word, possibilities, n=1, cutoff=0.75).
export function getCloseMatches(word, possibilities, n = 1, cutoff = 0.75) {
    const scored = [];
    for (const p of possibilities) {
        const r = ratio(word, p);
        if (r >= cutoff) scored.push([r, p]);
    }
    scored.sort((x, y) => y[0] - x[0]);
    return scored.slice(0, n).map(([, p]) => p);
}
