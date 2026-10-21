import { params as P } from "./params.js";

const INF = 10000000;
const TURN = 3;
const MAXLOOP = P.maxLoop;
const RT = (P.kT * 1000) / 10;
const SAMPLES = 480;
const BASE = { A: 1, C: 2, G: 3, U: 4 };

const PAIR = new Uint8Array(25);
function setPair(a, b, t) {
  PAIR[a * 5 + b] = t;
}
setPair(1, 4, 5);
setPair(2, 3, 1);
setPair(3, 2, 2);
setPair(3, 4, 3);
setPair(4, 1, 6);
setPair(4, 3, 4);

const ptype = (a, b) => PAIR[a * 5 + b];

function mm(table, type, a, b) {
  return table[((type - 1) * 5 + a) * 5 + b];
}

function stackE(type, type2) {
  return P.stack[(type - 1) * 7 + (type2 - 1)];
}

function loopEnergy(table, size) {
  if (size <= 30) return table[size];
  return table[30] + Math.trunc(P.lxc * Math.log(size / 30));
}

function int11(t, t2, a, b) {
  return P.int11[(((t - 1) * 7 + (t2 - 1)) * 5 + a) * 5 + b];
}

function int21(t, t2, si, sq, sj) {
  return P.int21[((((t - 1) * 7 + (t2 - 1)) * 5 + si) * 5 + sq) * 5 + sj];
}

function int22(t, t2, si, sp, sq, sj) {
  if (t < 1 || t > 6 || t2 < 1 || t2 > 6) return INF;
  if (si < 1 || sp < 1 || sq < 1 || sj < 1) return INF;
  if (si > 4 || sp > 4 || sq > 4 || sj > 4) return INF;
  return P.int22[(((((t - 1) * 6 + (t2 - 1)) * 4 + (si - 1)) * 4 + (sp - 1)) * 4 + (sq - 1)) * 4 + (sj - 1)];
}

function eInt(n1, n2, type, type2, si1, sj1, sp1, sq1) {
  const nl = n1 > n2 ? n1 : n2;
  const ns = n1 > n2 ? n2 : n1;
  if (nl === 0) return stackE(type, type2);
  if (ns === 0) {
    let energy = loopEnergy(P.bulge, nl);
    if (nl === 1) energy += stackE(type, type2);
    else {
      if (type > 2) energy += P.terminalAU;
      if (type2 > 2) energy += P.terminalAU;
    }
    return energy;
  }
  if (ns === 1) {
    if (nl === 1) return int11(type, type2, si1, sj1);
    if (nl === 2) {
      if (n1 === 1) return int21(type, type2, si1, sq1, sj1);
      return int21(type2, type, sq1, si1, sp1);
    }
    let energy = loopEnergy(P.interior, nl + 1);
    energy += Math.min(P.maxNinio, (nl - ns) * P.ninio);
    energy += mm(P.mm1n, type, si1, sj1) + mm(P.mm1n, type2, sq1, sp1);
    return energy;
  }
  if (ns === 2 && nl === 2) return int22(type, type2, si1, sp1, sq1, sj1);
  if (ns === 2 && nl === 3) {
    let energy = P.interior[5] + P.ninio;
    energy += mm(P.mm23, type, si1, sj1) + mm(P.mm23, type2, sq1, sp1);
    return energy;
  }
  const u = nl + ns;
  let energy = loopEnergy(P.interior, u);
  energy += Math.min(P.maxNinio, (nl - ns) * P.ninio);
  energy += mm(P.mmI, type, si1, sj1) + mm(P.mmI, type2, sq1, sp1);
  return energy;
}

function eHairpin(i, j, S, type) {
  const size = j - i - 1;
  let motif = "";
  for (let k = i; k <= j; k += 1) motif += "NACGU"[S[k]];
  let energy = size <= 30 ? P.hairpin[size] : P.hairpin[30] + Math.trunc(P.lxc * Math.log(size / 30));
  if (size === 4 && P.tetra[motif]) return P.tetra[motif];
  if (size === 6 && P.hex[motif]) return P.hex[motif];
  if (size === 3 && P.tri[motif]) return P.tri[motif];
  if (size === 3) return energy + (type > 2 ? P.terminalAU : 0);
  return energy + mm(P.mmH, type, S[i + 1], S[j - 1]);
}

function eStem(type, si1, sj1, ext) {
  let energy = 0;
  const table = ext ? P.mmE : P.mmM;
  if (si1 >= 0 && sj1 >= 0) energy += mm(table, type, si1, sj1);
  else if (si1 >= 0) energy += P.dangle5[(type - 1) * 5 + si1];
  else if (sj1 >= 0) energy += P.dangle3[(type - 1) * 5 + sj1];
  if (type > 2) energy += P.terminalAU;
  if (!ext) energy += P.mlIntern;
  return energy;
}

function boltz(energy) {
  if (energy >= INF / 2) return 0;
  return Math.exp(-energy / RT);
}

function weighted(weights, total) {
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Fold one sensor the way the local API does: RNAfold -p --noLP, Turner 2004, 37 °C.
 * Returns the same fields as POST /api/sensor.
 */
export function foldSensor(raw) {
  const sequence = String(raw || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/T/g, "U");
  if (!sequence) throw new Error("No sensor sequence was provided.");
  if (/[^ACGU]/.test(sequence)) {
    throw new Error("Sensor sequence must contain only A, C, G, T, or U.");
  }
  if (sequence.length < 2) throw new Error("Sensor sequence is too short to fold.");
  if (sequence.length > 300) {
    throw new Error("This sequence is too long to fold in the browser (maximum 300 nt).");
  }

  const n = sequence.length;
  const S = new Uint8Array(n + 2);
  for (let i = 0; i < n; i += 1) S[i + 1] = BASE[sequence[i]];
  const N = n + 1;
  const at = (i, j) => i * N + j;

  const cc = new Int32Array(N * N);
  const c = new Int32Array(N * N);
  const fML = new Int32Array(N * N);
  cc.fill(INF);
  c.fill(INF);
  fML.fill(INF);
  const kind = new Uint8Array(N * N);
  const argP = new Uint16Array(N * N);
  const argQ = new Uint16Array(N * N);

  const Qcc = new Float64Array(N * N);
  const Qb = new Float64Array(N * N);
  const fM1 = new Float64Array(N * N);
  const qm = new Float64Array(N * N);

  for (let span = TURN + 1; span < n; span += 1) {
    for (let i = 1; i + span <= n; i += 1) {
      const j = i + span;
      const type = ptype(S[i], S[j]);
      if (!type) continue;
      let best = eHairpin(i, j, S, type);
      let how = 1;
      let ap = 0;
      let aq = 0;
      let q = boltz(best);
      const pMax = Math.min(j - TURN - 2, i + MAXLOOP + 1);
      for (let p = i + 1; p <= pMax; p += 1) {
        const u1 = p - i - 1;
        let qMin = p + TURN + 1;
        const qCap = j - 1 - (MAXLOOP - u1);
        if (qCap > qMin) qMin = qCap;
        for (let qj = j - 1; qj >= qMin; qj -= 1) {
          const u2 = j - qj - 1;
          if (u1 + u2 === 0) continue;
          const type2 = ptype(S[qj], S[p]);
          if (!type2) continue;
          const inner = c[at(p, qj)];
          const loop = eInt(u1, u2, type, type2, S[i + 1], S[j - 1], S[p - 1], S[qj + 1]);
          if (inner < INF && loop + inner <= best) {
            best = loop + inner;
            how = 3;
            ap = p;
            aq = qj;
          }
          const qb = Qb[at(p, qj)];
          if (qb) q += boltz(loop) * qb;
        }
      }
      let mb = INF;
      let mbk = 0;
      for (let k = i + TURN + 2; k <= j - TURN - 3; k += 1) {
        const left = fML[at(i + 1, k)];
        const right = fML[at(k + 1, j - 1)];
        if (left < INF && right < INF && left + right <= mb) {
          mb = left + right;
          mbk = k;
        }
      }
      let temp = 0;
      for (let k = i + 2; k <= j - 1; k += 1) {
        const qLeft = qm[at(i + 1, k - 1)];
        const qRight = fM1[at(k, j - 1)];
        if (qLeft && qRight) temp += qLeft * qRight;
      }
      if (mb < INF) {
        const tt = ptype(S[j], S[i]);
        const e = mb + eStem(tt, S[j - 1], S[i + 1], 0) + P.mlClosing;
        if (e <= best) {
          best = e;
          how = 4;
          ap = mbk;
        }
      }
      if (temp) {
        const tt = ptype(S[j], S[i]);
        q += temp * boltz(eStem(tt, S[j - 1], S[i + 1], 0) + P.mlClosing);
      }
      let stacked = INF;
      let qs = 0;
      if (i + 1 < j - 1 && cc[at(i + 1, j - 1)] < INF && ptype(S[i + 1], S[j - 1])) {
        const type2 = ptype(S[j - 1], S[i + 1]);
        const se = eInt(0, 0, type, type2, -1, -1, -1, -1);
        stacked = se + cc[at(i + 1, j - 1)];
        if (stacked <= best) {
          best = stacked;
          how = 2;
        }
        if (Qcc[at(i + 1, j - 1)]) qs = boltz(se) * Qcc[at(i + 1, j - 1)];
        q += qs;
      }
      cc[at(i, j)] = best;
      c[at(i, j)] = stacked;
      kind[at(i, j)] = how;
      argP[at(i, j)] = ap;
      argQ[at(i, j)] = aq;
      Qcc[at(i, j)] = q;
      Qb[at(i, j)] = qs;
    }

    for (let i = 1; i + span <= n; i += 1) {
      const j = i + span;
      let energy = INF;
      if (c[at(i, j)] < INF) {
        const type = ptype(S[i], S[j]);
        const si = i > 1 ? S[i - 1] : -1;
        const sj = j < n ? S[j + 1] : -1;
        energy = c[at(i, j)] + eStem(type, si, sj, 0);
      }
      if (fML[at(i, j - 1)] < INF && fML[at(i, j - 1)] + P.mlBase <= energy) {
        energy = fML[at(i, j - 1)] + P.mlBase;
      }
      if (fML[at(i + 1, j)] < INF && fML[at(i + 1, j)] + P.mlBase <= energy) {
        energy = fML[at(i + 1, j)] + P.mlBase;
      }
      for (let k = i + TURN + 1; k <= j - TURN - 2; k += 1) {
        const left = fML[at(i, k)];
        const right = fML[at(k + 1, j)];
        if (left < INF && right < INF && left + right <= energy) energy = left + right;
      }
      fML[at(i, j)] = energy;

      let fm = 0;
      if (Qb[at(i, j)]) {
        const type = ptype(S[i], S[j]);
        const si = i > 1 ? S[i - 1] : -1;
        const sj = j < n ? S[j + 1] : -1;
        fm += Qb[at(i, j)] * boltz(eStem(type, si, sj, 0));
      }
      if (j > i) fm += fM1[at(i, j - 1)];
      fM1[at(i, j)] = fm;
      let total = fm;
      for (let k = i + 1; k <= j; k += 1) {
        const right = fM1[at(k, j)];
        if (!right) continue;
        total += right;
        const left = qm[at(i, k - 1)];
        if (left) total += left * right;
      }
      qm[at(i, j)] = total;
    }
  }

  const f5 = new Int32Array(N);
  const bt = new Uint16Array(N);
  f5[0] = 0;
  const Q5 = new Float64Array(N);
  Q5[0] = 1;
  for (let j = 1; j <= n; j += 1) {
    let best = f5[j - 1];
    let how = 0;
    const sj = j < n ? S[j + 1] : -1;
    let qExt = Q5[j - 1];
    if (j >= TURN + 2 && c[at(1, j)] < INF) {
      const type = ptype(S[1], S[j]);
      const e = c[at(1, j)] + eStem(type, -1, sj, 1);
      if (e <= best) {
        best = e;
        how = 1;
      }
    }
    if (j >= TURN + 2 && Qb[at(1, j)]) {
      qExt += Qb[at(1, j)] * boltz(eStem(ptype(S[1], S[j]), -1, sj, 1));
    }
    for (let i = j - TURN - 1; i > 1; i -= 1) {
      if (c[at(i, j)] < INF) {
        const type = ptype(S[i], S[j]);
        const e = f5[i - 1] + c[at(i, j)] + eStem(type, S[i - 1], sj, 1);
        if (e <= best) {
          best = e;
          how = i;
        }
      }
      if (Qb[at(i, j)]) {
        qExt += Q5[i - 1] * Qb[at(i, j)] * boltz(eStem(ptype(S[i], S[j]), S[i - 1], sj, 1));
      }
    }
    f5[j] = best;
    bt[j] = how;
    Q5[j] = qExt;
  }

  const db = Array(n).fill(".");
  const pairs = [];
  function traceCC(i, j) {
    pairs.push([i, j]);
    const how = kind[at(i, j)];
    if (how === 2) traceCC(i + 1, j - 1);
    else if (how === 3) {
      const p = argP[at(i, j)];
      const q = argQ[at(i, j)];
      pairs.push([p, q]);
      traceCC(p + 1, q - 1);
    } else if (how === 4) {
      const k = argP[at(i, j)];
      traceML(i + 1, k);
      traceML(k + 1, j - 1);
    }
  }
  function traceML(i, j) {
    if (i > j || fML[at(i, j)] >= INF) return;
    const target = fML[at(i, j)];
    if (c[at(i, j)] < INF) {
      const type = ptype(S[i], S[j]);
      const si = i > 1 ? S[i - 1] : -1;
      const sj = j < n ? S[j + 1] : -1;
      if (c[at(i, j)] + eStem(type, si, sj, 0) === target) {
        pairs.push([i, j]);
        traceCC(i + 1, j - 1);
        return;
      }
    }
    if (j > i && fML[at(i, j - 1)] + P.mlBase === target) {
      traceML(i, j - 1);
      return;
    }
    if (fML[at(i + 1, j)] + P.mlBase === target) {
      traceML(i + 1, j);
      return;
    }
    for (let k = i + TURN + 1; k <= j - TURN - 2; k += 1) {
      if (fML[at(i, k)] < INF && fML[at(k + 1, j)] < INF && fML[at(i, k)] + fML[at(k + 1, j)] === target) {
        traceML(i, k);
        traceML(k + 1, j);
        return;
      }
    }
  }
  let end = n;
  while (end > 0) {
    const how = bt[end];
    if (!how) {
      end -= 1;
      continue;
    }
    pairs.push([how, end]);
    traceCC(how + 1, end - 1);
    end = how - 1;
  }
  for (const [a, b] of pairs) {
    if (a >= 1 && a < b && b <= n) {
      db[a - 1] = "(";
      db[b - 1] = ")";
    }
  }
  const structure = db.join("");

  const counts = new Float64Array(N * N);
  function addPair(i, j) {
    if (i < j) counts[at(i, j)] += 1;
  }
  function sampleCC(i, j) {
    addPair(i, j);
    const type = ptype(S[i], S[j]);
    if (!type) return;
    const weights = [];
    const acts = [];
    const push = (w, fn) => {
      if (w > 0) {
        weights.push(w);
        acts.push(fn);
      }
    };
    push(boltz(eHairpin(i, j, S, type)), () => {});
    const pMax = Math.min(j - TURN - 2, i + MAXLOOP + 1);
    for (let p = i + 1; p <= pMax; p += 1) {
      const u1 = p - i - 1;
      let qMin = p + TURN + 1;
      const qCap = j - 1 - (MAXLOOP - u1);
      if (qCap > qMin) qMin = qCap;
      for (let qj = j - 1; qj >= qMin; qj -= 1) {
        const u2 = j - qj - 1;
        if (!u2 && !u1) continue;
        const type2 = ptype(S[qj], S[p]);
        const qb = Qb[at(p, qj)];
        if (!type2 || !qb) continue;
        const w = boltz(eInt(u1, u2, type, type2, S[i + 1], S[j - 1], S[p - 1], S[qj + 1])) * qb;
        const pp = p;
        const qq = qj;
        push(w, () => {
          addPair(pp, qq);
          sampleCC(pp + 1, qq - 1);
        });
      }
    }
    let multi = 0;
    const splits = [];
    for (let k = i + 2; k <= j - 1; k += 1) {
      const w = qm[at(i + 1, k - 1)] * fM1[at(k, j - 1)];
      if (w) {
        multi += w;
        splits.push([k, w]);
      }
    }
    if (multi) {
      const tt = ptype(S[j], S[i]);
      const scale = boltz(eStem(tt, S[j - 1], S[i + 1], 0) + P.mlClosing);
      push(multi * scale, () => {
        let r = Math.random() * multi;
        let k = splits[splits.length - 1][0];
        for (const [kk, w] of splits) {
          r -= w;
          if (r <= 0) {
            k = kk;
            break;
          }
        }
        sampleQM(i + 1, k - 1);
        sampleFM1(k, j - 1);
      });
    }
    if (i + 1 < j - 1 && Qcc[at(i + 1, j - 1)] && ptype(S[i + 1], S[j - 1])) {
      const type2 = ptype(S[j - 1], S[i + 1]);
      push(boltz(eInt(0, 0, type, type2, -1, -1, -1, -1)) * Qcc[at(i + 1, j - 1)], () => sampleCC(i + 1, j - 1));
    }
    if (!weights.length) return;
    let sum = 0;
    for (const w of weights) sum += w;
    acts[weighted(weights, sum)]();
  }
  function sampleFM1(i, j) {
    if (j < i) return;
    const type = ptype(S[i], S[j]);
    let stemW = 0;
    if (type && Qb[at(i, j)]) {
      const si = i > 1 ? S[i - 1] : -1;
      const sj = j < n ? S[j + 1] : -1;
      stemW = Qb[at(i, j)] * boltz(eStem(type, si, sj, 0));
    }
    const extW = j > i ? fM1[at(i, j - 1)] : 0;
    const total = stemW + extW;
    if (total <= 0) return;
    if (Math.random() * total < stemW) {
      addPair(i, j);
      sampleCC(i + 1, j - 1);
    } else sampleFM1(i, j - 1);
  }
  function sampleQM(i, j) {
    if (j < i || !qm[at(i, j)]) return;
    const weights = [];
    const acts = [];
    const push = (w, fn) => {
      if (w > 0) {
        weights.push(w);
        acts.push(fn);
      }
    };
    push(fM1[at(i, j)], () => sampleFM1(i, j));
    for (let k = i + 1; k <= j; k += 1) {
      const right = fM1[at(k, j)];
      if (!right) continue;
      const kk = k;
      push(right, () => sampleFM1(kk, j));
      const left = qm[at(i, k - 1)];
      if (left) push(left * right, () => {
        sampleQM(i, kk - 1);
        sampleFM1(kk, j);
      });
    }
    if (!weights.length) return;
    let sum = 0;
    for (const w of weights) sum += w;
    acts[weighted(weights, sum)]();
  }
  function sampleF5(j) {
    while (j > 0) {
      const sj = j < n ? S[j + 1] : -1;
      const weights = [Q5[j - 1]];
      const stems = [0];
      if (j >= TURN + 2 && Qb[at(1, j)]) {
        weights.push(Qb[at(1, j)] * boltz(eStem(ptype(S[1], S[j]), -1, sj, 1)));
        stems.push(1);
      }
      for (let i = 2; i <= j - TURN - 1; i += 1) {
        if (!Qb[at(i, j)]) continue;
        weights.push(Q5[i - 1] * Qb[at(i, j)] * boltz(eStem(ptype(S[i], S[j]), S[i - 1], sj, 1)));
        stems.push(i);
      }
      let sum = 0;
      for (const w of weights) sum += w;
      const iStem = stems[weighted(weights, sum || 1)];
      if (!iStem) {
        j -= 1;
        continue;
      }
      addPair(iStem, j);
      sampleCC(iStem + 1, j - 1);
      j = iStem - 1;
    }
  }
  for (let s = 0; s < SAMPLES; s += 1) sampleF5(n);

  const pairing = Array(n).fill(0);
  const mfePair = Array(n).fill(0);
  let diversity = 0;
  const partner = Array(n).fill(-1);
  const stack = [];
  for (let i = 0; i < n; i += 1) {
    if (structure[i] === "(") stack.push(i);
    else if (structure[i] === ")") {
      const a = stack.pop();
      partner[a] = i;
      partner[i] = a;
    }
  }
  for (let i = 1; i <= n; i += 1) {
    for (let j = i + 1; j <= n; j += 1) {
      const p = counts[at(i, j)] / SAMPLES;
      if (!p) continue;
      pairing[i - 1] += p;
      pairing[j - 1] += p;
      diversity += 2 * p * (1 - p);
      if (partner[i - 1] === j - 1) {
        mfePair[i - 1] = p;
        mfePair[j - 1] = p;
      }
    }
  }

  const mfeKcal = f5[n] / 100;
  const ensemble = Q5[n] > 0 ? -P.kT * Math.log(Q5[n]) : 0;
  let frequency = Math.exp((ensemble - mfeKcal) / P.kT);
  if (!Number.isFinite(frequency) || frequency > 1) frequency = 1;
  if (frequency < 0) frequency = 0;

  return {
    sequence,
    mfe_structure: structure,
    mfe_kcal: mfeKcal,
    ensemble_energy_kcal: ensemble,
    mfe_frequency: frequency,
    ensemble_diversity: diversity,
    pairing_probability: pairing,
    mfe_pair_probability: mfePair,
    coordinates: null,
    version: "ViennaRNA Turner 2004 · no lonely pairs (in browser)",
  };
}
