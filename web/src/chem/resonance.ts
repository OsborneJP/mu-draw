// The resonance structure generator (docs/plans/v2-tautomers-resonance.md): RDKit's own
// ResonanceMolSupplier (Code/GraphMol/Resonance.cpp, RDKit 2026.09.1) with its conjugation
// rules (MolOps::setConjugation, ConjugHybrid.cpp; countAtomElec, Aromaticity.cpp), run on
// RDKit.js, which has neither. With decision 2's settings, ALLOW_CHARGE_SEPARATION and
// KEKULE_ALL. resonance.test.ts requires Python RDKit's answers for every test drawing and for
// 304 molecules of RDKit's NCI set: the same structures (bond orders and charges by atom), the
// same conjugated bonds, and RDKit's order, except among structures it ranks equal on every
// measure (their order follows its internal hash values there). RDKit's list depends on the
// atom order, so the panel runs it on the drawing in RDKit's canonical atom order (Jeff's
// decision) and maps each structure back to the drawing's atoms.
//
// Kept as RDKit has it, so the two agree: the search over each conjugated group's bond orders
// (its stacks, walked in atom order), the non-bonded electrons spread over the atoms short of
// an octet, the checks on charges and octets, the statistics that later purge structures, and
// the ranking. Data RDKit keeps in its source or periodic table comes from rdkitTables.json.
//
// Ported from the RDKit (www.rdkit.org): Resonance.cpp, Copyright (C) 2015 Paolo Tosco;
// ConjugHybrid.cpp, Copyright (C) 2001-2024 Greg Landrum and other RDKit contributors;
// Aromaticity.cpp, Copyright (C) 2003-2022 Greg Landrum and other RDKit contributors; under
// RDKit's BSD licence (tests/fixtures/recorded/rdkit/license.txt; rdkitTables.json ships it).
import type { MainModule } from '@rdkit/rdkit';
import {
  atomBonds,
  canonical,
  chiralFlagOf,
  copyForm,
  DATIVE_BOND,
  formOf,
  orderOf,
  otherAtom,
  pieces,
  plainBonds,
  readAsDrawn,
  withChiralFlag,
  withForm,
  ZERO_BOND,
  type Canonical,
  type Form,
} from './rdkitForm';
import tables from './rdkitTables.json';

/** RDKit's ResonanceFlags. */
export const FLAGS = {
  ALLOW_INCOMPLETE_OCTETS: 1,
  ALLOW_CHARGE_SEPARATION: 2,
  KEKULE_ALL: 4,
  UNCONSTRAINED_CATIONS: 8,
  UNCONSTRAINED_ANIONS: 16,
} as const;

/** Decision 2. */
export const SETTINGS = FLAGS.ALLOW_CHARGE_SEPARATION | FLAGS.KEKULE_ALL;

/** Decision 7: up to 32 drawn; a conjugated group of more than 60 bonds is not listed (RDKit's
 * search grows too fast: buckminsterfullerene ran for minutes). RDKit's own cap on structures
 * (maxStructs) is kept as it is. */
export const RESONANCE_LIMITS = { drawn: 32, groupBonds: 60, maxStructs: 1000 } as const;

/** Decision 7: too large to run, too many to draw, or listed. */
export function resonanceOutcome(largestGroup: number, count: number): 'too-large' | 'counted' | 'listed' {
  if (largestGroup > RESONANCE_LIMITS.groupBonds) return 'too-large';
  return count > RESONANCE_LIMITS.drawn ? 'counted' : 'listed';
}

const ELEMENTS = tables.elements;
const EN = tables.electronegativity;

const outer = (z: number) => ELEMENTS[z].outer;

/** The ranking measures of one structure of one group, as CEMetrics holds them. */
export interface Metrics {
  missing: number;
  abs: number;
  wtd: number;
  same: number;
  opp: number;
  sumFc: number;
  sumMb: number;
}

/** Bond::getValenceContrib: a dative bond counts at its end atom only, a zero bond nowhere. */
function valenceContribution(bond: Form['bonds'][number], atom: number): number {
  if (bond.bo === DATIVE_BOND) return atom === bond.atoms[1] ? 1 : 0;
  return bond.bo;
}

/** RDKit's view of one molecule, as the supplier keeps it. */
interface Molecule {
  form: Form;
  atomBonds: number[][];
  /** Total valence from the Kekulé orders (RDKit's on the aromatic form too). */
  valence: number[];
  /** Bonds, every kind (getDegree). */
  degree: number[];
  /** Bonds and Hs (getTotalDegree). */
  totalDegree: number[];
  /** countAtomElec's degree: bonds and Hs, less bonds giving this atom no valence. */
  electronDegree: number[];
  /** AtomElectrons' first total valence: bonds and Hs, less dative and zero bonds. */
  sigma: number[];
  conjugated: boolean[];
  bondGroup: number[];
  atomGroup: number[];
  groups: number;
  totalCharge: number;
  distance: number[][];
  aromaticAtoms: Set<number>;
}

/** MolOps::countAtomElec; only whether it is above 0 is used. */
function atomElectrons(m: Molecule, a: number): number {
  const atom = m.form.atoms[a];
  const dv = ELEMENTS[atom.z].valences[0];
  if (dv <= 1) return -1;
  const degree = m.electronDegree[a];
  if (degree > 3) return -1;
  const lonePairs = Math.max(outer(atom.z) - dv - atom.chg, 0);
  return dv - degree + lonePairs - atom.nRad; // RDKit lowers more than 1 to 1 here; no matter
}

/** MolOps::setConjugation on the aromatic form: aromatic bonds, and each pair of bonds at an
 * atom with 2 or 3 substituents, one of them multiple, both to candidates. */
export function conjugatedBonds(m: Pick<Molecule, 'form' | 'atomBonds' | 'valence' | 'degree' | 'totalDegree' | 'electronDegree'>): boolean[] {
  const aromatic = new Set(m.form.aromaticBonds);
  const conjugated = m.form.bonds.map((_, i) => aromatic.has(i));
  const info = m.form.atoms.map((atom, a) => {
    const valences = ELEMENTS[atom.z].valences;
    let candidate: boolean;
    if (!atom.chg && valences[0] >= 0 && m.valence[a] > valences[0]) candidate = false;
    else {
      const n = outer(atom.z);
      candidate =
        (atom.z <= 10 || (n !== 5 && n !== 6) || (n === 6 && m.totalDegree[a] < 2)) &&
        atomElectrons(m as Molecule, a) > 0;
    }
    return { candidate, substituents: candidate ? m.degree[a] + atom.impHs : 0 };
  });
  const contribution = (b: number, a: number) => (aromatic.has(b) ? 1.5 : valenceContribution(m.form.bonds[b], a));
  m.form.atoms.forEach((_, a) => {
    if (!info[a].candidate || info[a].substituents < 2 || info[a].substituents > 3) return;
    for (const b1 of m.atomBonds[a]) {
      if (contribution(b1, a) < 1.5 || !info[otherAtom(m.form.bonds[b1], a)].candidate) continue;
      for (const b2 of m.atomBonds[a]) {
        if (b1 === b2) continue;
        const other = info[otherAtom(m.form.bonds[b2], a)];
        if (other.substituents > 3) continue;
        if (other.candidate) {
          conjugated[b1] = true;
          conjugated[b2] = true;
        }
      }
    }
  });
  return conjugated;
}

function molecule(form: Form): Molecule {
  const bondsAt = atomBonds(form);
  const degree = bondsAt.map((b) => b.length);
  const totalDegree = form.atoms.map((atom, a) => degree[a] + atom.impHs);
  const without = (a: number, drop: (b: number) => boolean) => totalDegree[a] - bondsAt[a].filter(drop).length;
  const partial = {
    form,
    atomBonds: bondsAt,
    valence: form.atoms.map((atom, a) => bondsAt[a].reduce((sum, b) => sum + valenceContribution(form.bonds[b], a), 0) + atom.impHs),
    degree,
    totalDegree,
    electronDegree: form.atoms.map((_, a) => without(a, (b) => valenceContribution(form.bonds[b], a) === 0)),
    sigma: form.atoms.map((_, a) => without(a, (b) => form.bonds[b].bo === DATIVE_BOND || form.bonds[b].bo === ZERO_BOND)),
  };
  const conjugated = conjugatedBonds(partial);
  // assignConjGrpIdx: each group grown from its first bond, by a stack.
  const bondGroup = form.bonds.map(() => -1);
  const atomGroup = form.atoms.map(() => -1);
  let groups = 0;
  for (; ; groups++) {
    const start = conjugated.findIndex((c, i) => c && bondGroup[i] === -1);
    if (start < 0) break;
    const stack = [start];
    while (stack.length > 0) {
      const i = stack.pop()!;
      for (const atom of form.bonds[i].atoms) {
        for (const next of bondsAt[atom]) {
          if (conjugated[next] && bondGroup[next] === -1) {
            bondGroup[next] = groups;
            stack.push(next);
          }
        }
      }
    }
  }
  form.bonds.forEach((b, i) => {
    if (bondGroup[i] !== -1) for (const a of b.atoms) atomGroup[a] = bondGroup[i];
  });
  const distance = form.atoms.map((_, s) => {
    const d = form.atoms.map(() => Infinity);
    d[s] = 0;
    const queue = [s];
    for (let k = 0; k < queue.length; k++) {
      const x = queue[k];
      for (const b of bondsAt[x]) {
        const y = otherAtom(form.bonds[b], x);
        if (d[y] === Infinity) {
          d[y] = d[x] + 1;
          queue.push(y);
        }
      }
    }
    return d;
  });
  const totalCharge = form.atoms.reduce((sum, atom, a) => sum + (atomGroup[a] !== -1 ? atom.chg : 0), 0);
  return { ...partial, conjugated, bondGroup, atomGroup, groups, totalCharge, distance, aromaticAtoms: new Set(form.aromaticAtoms) };
}

const LAST_BOND = 1;
const DEFINITIVE = 2;
const STACKED = 4;
const HAS_MULTIPLE_BOND = 8;
const HAVE_CATION_RIGHT_OF_N = 1;
const HAVE_CATION = 2;
const HAVE_ANION = 4;
const FP_BONDS = 1;
const FP_ATOMS = 2;

interface AtomState {
  nb: number;
  tv: number;
  fc: number;
  flags: number;
}

interface Stats {
  init: boolean;
  noCationRightOfN: boolean;
  noChargeSeparation: boolean;
  minMissing: number;
}

/** One arrangement of a group's electrons (ConjElectrons). Maps keep index order, as RDKit's
 * std::maps do. */
class Electrons {
  atoms = new Map<number, AtomState>();
  bonds = new Map<number, { bo: number; flags: number }>();
  stack: number[] = [];
  current = 0;
  allowedLeftOfN = 0;
  flags = 0;
  metrics: Metrics = { missing: 0, abs: 0, wtd: 0, same: 0, opp: 0, sumFc: 0, sumMb: 0 };
  hash = '';

  readonly m: Molecule;
  readonly group: number;
  readonly settings: number;

  constructor(m: Molecule, group: number, settings: number) {
    this.m = m;
    this.group = group;
    this.settings = settings;
  }

  static start(m: Molecule, group: number, settings: number): Electrons {
    const e = new Electrons(m, group, settings);
    e.allowedLeftOfN = m.totalCharge;
    const atoms: number[] = [];
    m.form.bonds.forEach((bond, b) => {
      if (m.bondGroup[b] !== group) return;
      e.bonds.set(b, { bo: 1, flags: 0 });
      for (const a of bond.atoms) if (!atoms.includes(a)) atoms.push(a);
    });
    for (const a of atoms.sort((x, y) => x - y)) e.atoms.set(a, { nb: 0, tv: m.sigma[a], fc: 0, flags: 0 });
    let total = 0;
    for (const b of e.bonds.keys()) total += 2 * m.form.bonds[b].bo;
    for (const a of e.atoms.keys()) total += outer(m.form.atoms[a].z) - m.valence[a] - m.form.atoms[a].chg;
    e.current = total;
    return e;
  }

  copy(): Electrons {
    const e = new Electrons(this.m, this.group, this.settings);
    for (const [a, s] of this.atoms) e.atoms.set(a, { ...s });
    for (const [b, s] of this.bonds) e.bonds.set(b, { ...s });
    e.stack = [...this.stack];
    e.current = this.current;
    e.allowedLeftOfN = this.allowedLeftOfN;
    e.flags = this.flags;
    e.metrics = { ...this.metrics };
    e.hash = this.hash;
    return e;
  }

  oe(a: number): number {
    return outer(this.m.form.atoms[a].z);
  }

  needed(a: number): number {
    const s = this.atoms.get(a)!;
    return 8 - (2 * s.tv + s.nb);
  }

  hasOctet(a: number): boolean {
    const s = this.atoms.get(a)!;
    return s.nb + 2 * s.tv === 8;
  }

  use(electrons: number): void {
    if (this.current < electrons) throw new Error('resonance: more electrons used than the group has');
    this.current -= electrons;
  }

  push(a: number): void {
    const s = this.atoms.get(a)!;
    if (s.flags & STACKED) return;
    s.flags |= STACKED;
    this.stack.push(a);
  }

  pop(): number | null {
    while (this.stack.length > 0) {
      const a = this.stack.pop()!;
      const s = this.atoms.get(a)!;
      s.flags &= ~STACKED;
      if (!(s.flags & DEFINITIVE)) return a;
    }
    return null;
  }

  setOrder(b: number, bo: number): void {
    for (const a of this.m.form.bonds[b].atoms) this.atoms.get(a)!.tv += bo - 1;
    const s = this.bonds.get(b)!;
    s.flags |= DEFINITIVE;
    this.use(bo * 2);
    s.bo = bo;
  }

  /** Marks the atom's last bond: all its other bonds in the group are settled. */
  lastBondBut(a: number, b: number): void {
    let all = true;
    for (const other of this.m.atomBonds[a]) {
      if (!all) break;
      if (other !== b && this.m.bondGroup[other] === this.m.atomGroup[a]) all = !!(this.bonds.get(other)!.flags & DEFINITIVE);
    }
    if (all) this.atoms.get(a)!.flags |= LAST_BOND;
  }

  neighbourCharged(a: number, bo: number, oeConstraint = 0): boolean {
    let charged = false;
    for (const b of this.m.atomBonds[a]) {
      if (charged) break;
      if (this.m.bondGroup[b] !== this.m.atomGroup[a]) continue;
      const bond = this.bonds.get(b);
      if (!bond) continue;
      const n = otherAtom(this.m.form.bonds[b], a);
      const neighbour = this.atoms.get(n);
      if (!neighbour) continue;
      charged =
        (((bond.flags & DEFINITIVE) !== 0 && !this.hasOctet(n)) ||
          (!(bond.flags & DEFINITIVE) && (neighbour.flags & DEFINITIVE) !== 0 && this.oe(n) < 5 - bo)) &&
        (!oeConstraint || this.oe(n) === oeConstraint);
    }
    return charged;
  }

  /** Bit 0: can take a bond of order bo; bit 1: then needs a charge. */
  canAdd(a: number, bo: number): number {
    const s = this.atoms.get(a)!;
    let can = s.flags & DEFINITIVE ? 0 : 1;
    if (can) can = s.tv <= 5 - bo ? 1 : 0;
    if (can && s.flags & LAST_BOND) {
      const oe = this.oe(a);
      const rightOfC = oe > 4 ? 1 : 0;
      let fcInc: number;
      if (rightOfC) fcInc = this.neighbourCharged(a, bo, 4) ? 0 : 1;
      else {
        const charged = this.neighbourCharged(a, bo);
        fcInc = (!charged && !(!this.allowedLeftOfN && this.m.totalCharge)) || (charged && bo === 3 && oe < 5) ? 1 : 0;
      }
      const e = oe + s.tv - 1 + bo;
      can = e + fcInc + rightOfC >= 8 ? 1 : 0;
      if (can && e < 8) {
        if (this.m.totalCharge !== 0 || this.settings & (FLAGS.UNCONSTRAINED_CATIONS | FLAGS.UNCONSTRAINED_ANIONS) || rightOfC) can |= 2;
        else can = 0;
      }
    }
    return can;
  }

  allowedBonds(a: number, b: number): number {
    this.lastBondBut(a, b);
    let allowed = 0;
    for (let i = 0; i < 3; i++) allowed |= this.canAdd(a, i + 1) << (i * 2);
    return allowed;
  }

  finalizeAtom(a: number): void {
    if (this.oe(a) >= 5) return;
    const needed = this.needed(a);
    if (!needed) return;
    let fc = Math.floor(needed / 2);
    if (this.allowedLeftOfN) {
      if (this.allowedLeftOfN < 0) fc = -fc;
      this.allowedLeftOfN -= fc;
    }
  }

  fingerprint(fp: number): string {
    const parts: (number | string)[] = [];
    if (fp & FP_ATOMS) for (const s of this.atoms.values()) parts.push(s.tv | (s.nb << 4));
    if (fp & FP_BONDS) {
      parts.push('|');
      for (const s of this.bonds.values()) parts.push(s.bo);
    }
    return parts.join(',');
  }

  initFromMolecule(): void {
    for (const [a, s] of this.atoms) {
      s.tv = this.m.valence[a];
      s.fc = this.m.form.atoms[a].chg;
      s.nb = this.oe(a) - s.tv - s.fc;
    }
    for (const [b, s] of this.bonds) s.bo = this.m.form.bonds[b].bo;
    this.current = 0;
  }

  assignNonBonded(): void {
    for (const [a, s] of this.atoms) {
      const nb = Math.min(this.needed(a), this.current);
      this.use(nb);
      s.nb = nb;
    }
  }

  assignCharges(): void {
    for (const [a, s] of this.atoms) s.fc = this.oe(a) - (s.nb + s.tv);
  }

  /** checkChargesAndBondOrders. */
  acceptable(): boolean {
    let ok = true;
    let incompleteRightOfC = false;
    let nitrogenGroup = false;
    let positiveLeftOfN = false;
    let negativeLeftOfN = false;
    for (const [a, s] of this.atoms) {
      if (!ok) break;
      ok = s.fc < 2 && s.fc > -3;
      if (!ok) break;
      if (s.fc > 0) this.flags |= HAVE_CATION;
      else if (s.fc < 0) this.flags |= HAVE_ANION;
      const oe = this.oe(a);
      if (oe > 4) {
        if (oe === 5) nitrogenGroup = true;
        if (!this.hasOctet(a)) incompleteRightOfC = true;
        if (s.fc > 0 && oe > 5) this.flags |= HAVE_CATION_RIGHT_OF_N;
      } else if (s.fc < 0) negativeLeftOfN = true;
      else if (s.fc > 0) positiveLeftOfN = true;
      ok = !(incompleteRightOfC && negativeLeftOfN);
    }
    if (ok && positiveLeftOfN && !(this.settings & FLAGS.UNCONSTRAINED_CATIONS)) {
      ok = this.m.totalCharge > 0 && !(this.flags & HAVE_ANION) && !nitrogenGroup;
    }
    if (ok && negativeLeftOfN && !(this.settings & FLAGS.UNCONSTRAINED_ANIONS)) {
      ok = this.m.totalCharge < 0 && !(this.flags & HAVE_CATION);
    }
    if (ok && !(this.settings & FLAGS.ALLOW_INCOMPLETE_OCTETS)) ok = !(incompleteRightOfC && this.flags & HAVE_ANION);
    for (const [b, bond] of this.bonds) {
      if (!ok) break;
      const ends = this.m.form.bonds[b].atoms;
      for (let i = 0; ok && i < 2; i++) {
        const s = this.atoms.get(ends[i])!;
        if (bond.bo > 1 && this.m.aromaticAtoms.has(ends[i])) {
          if (s.flags & HAS_MULTIPLE_BOND) ok = false;
          else s.flags |= HAS_MULTIPLE_BOND;
        }
        if (ok && this.oe(ends[i]) < 5) ok = bond.bo === 1 || (bond.bo > 1 && s.fc < 1);
      }
      if (ok) {
        const [p, q] = ends.map((a) => this.atoms.get(a)!);
        ok = !(this.oe(ends[0]) < 5 && p.fc && this.oe(ends[1]) < 5 && q.fc);
      }
    }
    return ok;
  }

  computeMetrics(): void {
    const m = this.metrics;
    for (const [a, s] of this.atoms) {
      m.abs += Math.abs(s.fc);
      const z = this.m.form.atoms[a].z;
      m.wtd += s.fc * (z >= EN.length ? 1000 : EN[z]);
      m.missing += this.needed(a);
    }
    const charged = [...this.atoms].filter(([, s]) => s.fc);
    for (let i = 0; i < charged.length; i++) {
      for (let k = i + 1; k < charged.length; k++) {
        const d = this.m.distance[charged[i][0]][charged[k][0]];
        if (charged[i][1].fc * charged[k][1].fc > 0) m.same += d;
        else m.opp += d;
      }
    }
    for (const [a, s] of this.atoms) if (s.fc) m.sumFc += a;
    for (const [b, s] of this.bonds) if (s.bo > 1) m.sumMb += b;
  }

  countDegenerate(degenerate: Map<string, number>): void {
    const m = this.metrics;
    this.hash = [m.abs, m.same, m.opp, m.missing, m.wtd].join(',');
    degenerate.set(this.hash, (degenerate.get(this.hash) ?? 0) + 1);
  }

  cationRightOfN(): boolean {
    return (this.flags & HAVE_CATION_RIGHT_OF_N) !== 0;
  }

  chargeSeparation(): boolean {
    return (this.flags & HAVE_CATION) !== 0 && (this.flags & HAVE_ANION) !== 0;
  }

  /** checkMetrics: whether this structure stays, and whether the statistics changed. */
  checkMetrics(stats: Stats): { ok: boolean; changed: boolean } {
    let changed = false;
    const missing = this.metrics.missing;
    if (!stats.init || missing < stats.minMissing) {
      changed = stats.init;
      stats.init = true;
      stats.minMissing = missing;
    }
    if (this.settings & FLAGS.ALLOW_INCOMPLETE_OCTETS || missing <= stats.minMissing) {
      if (!this.cationRightOfN() && !stats.noCationRightOfN) {
        stats.noCationRightOfN = true;
        changed = true;
      }
      if (!this.chargeSeparation() && !stats.noChargeSeparation) {
        stats.noChargeSeparation = true;
        changed = true;
      }
    }
    const ok = !(
      (!(this.settings & FLAGS.ALLOW_INCOMPLETE_OCTETS) && missing > stats.minMissing) ||
      (!(this.settings & FLAGS.UNCONSTRAINED_CATIONS) && this.cationRightOfN() && stats.noCationRightOfN) ||
      (!(this.settings & FLAGS.ALLOW_CHARGE_SEPARATION) && this.chargeSeparation() && stats.noChargeSeparation)
    );
    return { ok, changed };
  }

  purge(stored: Map<string, Electrons>, degenerate: Map<string, number>, stats: Stats): boolean {
    let ok = true;
    let changed = true;
    while (changed) {
      changed = false;
      for (const [key, e] of stored) {
        const check = e.checkMetrics(stats);
        changed = check.changed;
        if (!check.ok) {
          const n = degenerate.get(e.hash);
          if (n !== undefined) {
            if (n > 1) degenerate.set(e.hash, n - 1);
            else degenerate.delete(e.hash);
          }
          if (e === this) ok = false;
          stored.delete(key);
          changed = true;
        }
        if (changed) break;
      }
    }
    return ok;
  }

  chargeAndStore(stored: Map<string, Electrons>, degenerate: Map<string, number>, stats: Stats, fp: number): boolean {
    this.assignCharges();
    let ok = this.acceptable();
    let changed = false;
    if (ok) {
      this.computeMetrics();
      ({ ok, changed } = this.checkMetrics(stats));
    }
    if (ok) {
      const key = this.fingerprint(fp);
      if (stored.has(key)) ok = false;
      else stored.set(key, this);
    }
    if (changed) ok = this.purge(stored, degenerate, stats) && ok;
    if (ok) this.countDegenerate(degenerate);
    return ok;
  }

  /** enumerateNonBonded: every way to leave atoms short of an octet when the electrons are
   * too few for all, as RDKit walks them (each next combination by its bit trick). */
  spreadNonBonded(stored: Map<string, Electrons>, degenerate: Map<string, number>, stats: Stats): void {
    const fp = FP_ATOMS | (this.settings & FLAGS.KEKULE_ALL ? FP_BONDS : 0);
    const short: number[] = [];
    let total = 0;
    for (const a of this.atoms.keys()) {
      const n = this.needed(a);
      if (n) {
        total += n;
        short.push(a);
      }
    }
    if (total > this.current) {
      const missing = total - this.current;
      const candidates = Math.floor((missing - 1) / 2) + 1;
      let combinations = 1;
      let v = 0;
      for (let i = 0; i < candidates; i++) {
        combinations *= short.length - i;
        combinations = Math.floor(combinations / (i + 1));
        v |= 1 << i;
      }
      const base = this.copy();
      for (let c = 0; c < combinations; c++) {
        const e = base.copy();
        let bits = v;
        for (const a of short) {
          let n = e.needed(a);
          if (bits & 1) n -= 2;
          e.use(n);
          e.atoms.get(a)!.nb = n;
          bits >>>= 1;
        }
        e.chargeAndStore(stored, degenerate, stats, fp);
        const t = ((v | (v - 1)) + 1) >>> 0;
        v = (t | ((Math.floor(((t & -t) >>> 0) / ((v & -v) >>> 0)) >>> 1) - 1)) >>> 0;
      }
    } else if (total === this.current) {
      const e = this.copy();
      e.assignNonBonded();
      e.chargeAndStore(stored, degenerate, stats, fp);
    }
  }
}

/** buildCEMap for one group: its structures, as RDKit stores them. */
function groupStructures(m: Molecule, group: number, settings: number): Electrons[] {
  const fp = FP_ATOMS | (settings & FLAGS.KEKULE_ALL ? FP_BONDS : 0);
  const fpTmp = settings & FLAGS.KEKULE_ALL ? FP_BONDS : FP_ATOMS;
  const seen = new Set<string>();
  const degenerate = new Map<string, number>();
  const stats: Stats = { init: false, noCationRightOfN: false, noChargeSeparation: false, minMissing: 0 };
  const stored = new Map<string, Electrons>();
  const fresh = Electrons.start(m, group, settings);
  // The drawing's own arrangement is stored as it is (RDKit ignores its checks but needs them
  // run for its flags); a later purge can still remove it.
  const drawn = fresh.copy();
  drawn.initFromMolecule();
  drawn.acceptable();
  drawn.computeMetrics();
  drawn.countDegenerate(degenerate);
  if (!stored.has(drawn.fingerprint(fp))) stored.set(drawn.fingerprint(fp), drawn);
  const stack: Electrons[] = [fresh];
  const atomCount = m.form.atoms.length;
  while (stack.length > 0) {
    let e: Electrons | null = stack.pop()!;
    if (e.stack.length === 0) {
      let a = 0;
      while (a < atomCount && m.atomGroup[a] !== group) a++;
      if (a >= atomCount) continue;
      e.push(a);
    }
    let begin: number | null;
    while (e && (begin = e.pop()) !== null) {
      const ends = [begin, atomCount];
      let bond = -1;
      for (const b of m.atomBonds[begin]) {
        const n = otherAtom(m.form.bonds[b], begin);
        if (m.atomGroup[n] !== group) continue;
        const neighbour = e.atoms.get(n);
        if (!neighbour || neighbour.flags & DEFINITIVE) continue;
        const state = e.bonds.get(b);
        if (!state || state.flags & DEFINITIVE) continue;
        if (bond < 0) {
          bond = b;
          ends[1] = n;
        } else e.push(n);
      }
      if (bond < 0) continue;
      const allowedEach = [0, 0];
      for (let i = 0; i < 2; i++) {
        allowedEach[i] = e.allowedBonds(ends[i], bond);
        const s = e.atoms.get(ends[i])!;
        if (s.flags & LAST_BOND) s.flags |= DEFINITIVE;
        else e.push(ends[i]);
      }
      const allowed = allowedEach[0] & allowedEach[1];
      const last = ends.map((a) => (e!.atoms.get(a)!.flags & LAST_BOND) !== 0);
      let any = false;
      let fork = false;
      const before = e.copy();
      for (let i = 0; i < 3; i++) {
        const bo = i + 1;
        let target: Electrons | null = null;
        if (
          e.current >= bo * 2 &&
          allowed & (1 << (i * 2)) &&
          !(allowed & (1 << (i * 2 + 1)) && (e.oe(ends[0]) < 5 || e.oe(ends[1]) < 5))
        ) {
          any = true;
          if (!fork) {
            fork = true;
            target = e;
          } else {
            target = before.copy();
            stack.push(target);
          }
        }
        if (target) {
          target.setOrder(bond, bo);
          for (let j = 0; j < 2; j++) if (last[j]) target.finalizeAtom(ends[j]);
        }
      }
      if (!any) e = null;
    }
    if (e) {
      const key = e.fingerprint(fpTmp);
      if (seen.has(key)) continue;
      seen.add(key);
      e.spreadNonBonded(stored, degenerate, stats);
      if (degenerate.size >= RESONANCE_LIMITS.maxStructs) break;
    }
  }
  return [...stored.values()];
}

function compareMetrics(a: Metrics, b: Metrics): number {
  if (a.missing !== b.missing) return a.missing - b.missing;
  if (a.abs !== b.abs) return a.abs - b.abs;
  if (a.wtd !== b.wtd) return a.wtd - b.wtd;
  if (a.same !== b.same) return b.same - a.same;
  if (a.opp !== b.opp) return b.opp - a.opp;
  if (a.sumFc !== b.sumFc) return a.sumFc - b.sumFc;
  return a.sumMb - b.sumMb;
}

export interface Supplied {
  /** Bonds RDKit marks conjugated, by index. */
  conjugated: boolean[];
  groups: number;
  /** The largest group's bond count. */
  largestGroup: number;
  /** RDKit's length: how many structures it gives (at most maxStructs). */
  count: number;
  /** In RDKit's order; only when count is at most `upTo`. */
  structures: { bonds: number[]; charges: number[]; rank: string }[] | null;
}

/** Python's ResonanceMolSupplier(mol, settings): its structures in its order, or only their
 * count when there are more than `upTo`. Null when a conjugated group has more bonds than the
 * limit (then RDKit is not run). */
export function supply(form: Form, settings: number = SETTINGS, upTo: number = RESONANCE_LIMITS.drawn): Supplied {
  let flags = settings;
  if (flags & FLAGS.UNCONSTRAINED_CATIONS) flags |= FLAGS.ALLOW_CHARGE_SEPARATION | FLAGS.ALLOW_INCOMPLETE_OCTETS;
  if (flags & FLAGS.UNCONSTRAINED_ANIONS) flags |= FLAGS.ALLOW_CHARGE_SEPARATION;
  const m = molecule(form);
  const sizes = Array.from({ length: m.groups }, (_, g) => m.bondGroup.filter((x) => x === g).length);
  const largestGroup = Math.max(0, ...sizes);
  const base = { conjugated: m.conjugated, groups: m.groups, largestGroup };
  if (largestGroup > RESONANCE_LIMITS.groupBonds) return { ...base, count: 0, structures: null };
  // Each group's structures sorted as CEVect2 sorts them, with their degeneracy classes.
  const groups = Array.from({ length: m.groups }, (_, g) => {
    const sorted = groupStructures(m, g, flags).sort((a, b) => compareMetrics(a.metrics, b.metrics));
    const classes: number[] = [];
    let previous: string | null = null;
    for (const e of sorted) {
      if (e.hash !== previous) classes.push(1);
      else classes[classes.length - 1] += 1;
      previous = e.hash;
    }
    return { sorted, classes };
  });
  // setResonanceMolSupplierLength: multiplied group by group until the cap.
  let count = Math.min(1, RESONANCE_LIMITS.maxStructs);
  for (let g = 0; count < RESONANCE_LIMITS.maxStructs && g < groups.length; g++) {
    count = Math.min(count * groups[g].sorted.length, RESONANCE_LIMITS.maxStructs);
  }
  if (count > upTo) return { ...base, count, structures: null };
  // prepEnumIdxVect: every combination, by (depth, width) in each group, sorted.
  const position = (g: (typeof groups)[number], index: number): [number, number] => {
    let depth = 0;
    while (index >= g.classes[depth]) index -= g.classes[depth++];
    return [depth, index];
  };
  const combinations = Array.from({ length: count }, (_, index) => {
    const v: number[] = new Array(groups.length * 2);
    let rest = index;
    for (let g = groups.length - 1; g >= 0; g--) {
      let d = 1;
      for (let j = 0; j < g; j++) d *= groups[j].sorted.length;
      if (groups[g].sorted.length) {
        [v[g * 2], v[g * 2 + 1]] = position(groups[g], Math.floor(rest / d));
        rest %= d;
      }
    }
    return v;
  });
  combinations.sort((a, b) => {
    let aSum = 0, bSum = 0, aMax = 0, bMax = 0;
    for (let i = 0; i < a.length; i += 2) {
      aSum += a[i];
      bSum += b[i];
      if (!i || a[i] > aMax) aMax = a[i];
      if (!i || b[i] > bMax) bMax = b[i];
    }
    if (aSum !== bSum) return aSum - bSum;
    if (aMax !== bMax) return aMax - bMax;
    for (let i = 0; i < a.length; i += 2) if (a[i] !== b[i]) return a[i] - b[i];
    for (let i = 1; i < a.length; i += 2) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  const structures = combinations.map((v) => {
    const bonds = form.bonds.map(orderOf);
    const charges = form.atoms.map((a) => a.chg);
    const rank: string[] = [];
    groups.forEach((g, i) => {
      const start = g.classes.slice(0, v[i * 2]).reduce((s, n) => s + n, 0);
      const e = g.sorted[start + v[i * 2 + 1]];
      for (const [a, s] of e.atoms) charges[a] = s.fc;
      for (const [b, s] of e.bonds) bonds[b] = s.bo;
      const k = e.metrics;
      rank.push([v[i * 2], k.missing, k.abs, k.wtd, k.same, k.opp, k.sumFc, k.sumMb].join(','));
    });
    return { bonds, charges, rank: rank.join(';') };
  });
  return { ...base, count, structures };
}

export interface ResonanceStructure {
  /** Its place in RDKit's order (decision 3). */
  number: number;
  /** Every bond's order (Kekulé) and every atom's charge, by index. */
  bonds: number[];
  charges: number[];
  /** As drawn: the same bond orders (a bond drawn aromatic takes 1 or 2) and charges. */
  drawing: boolean;
  /** What differs from the drawing: atoms with another charge, bonds of another order. */
  changedAtoms: number[];
  changedBonds: number[];
  /** RDKit's ranking, per group: equal for structures RDKit ranks equal on every measure. */
  rank: string;
  /** In the drawing's layout, with the drawing's chiral flag, its Kekulé bonds as listed. */
  molfile: string;
}

export type ResonanceList =
  | { outcome: 'several' }
  /** A bond other than single, double or triple (or aromatic in a ring): see plainBonds. */
  | { outcome: 'bonds' }
  /** A conjugated group of more bonds than the limit (decision 7). */
  | { outcome: 'too-large'; largestGroup: number }
  /** More than 32: the count only; `capped` when RDKit stopped counting at its maximum. */
  | { outcome: 'counted'; count: number; capped: boolean }
  | { outcome: 'listed'; structures: ResonanceStructure[] };

function differences(drawn: Form | null, bonds: number[], charges: number[]) {
  if (!drawn) return { changedAtoms: [], changedBonds: [], drawing: false };
  const aromatic = new Set(drawn.aromaticBonds);
  const changedBonds = bonds.flatMap((bo, i) => ((aromatic.has(i) ? bo !== 1 && bo !== 2 : bo !== orderOf(drawn.bonds[i])) ? [i] : []));
  const changedAtoms = charges.flatMap((chg, i) => (chg !== drawn.atoms[i].chg ? [i] : []));
  return { changedAtoms, changedBonds, drawing: changedAtoms.length === 0 && changedBonds.length === 0 };
}

function structureMolfile(rdkit: MainModule, drawing: Form, bonds: number[], charges: number[], chiralFlag: boolean): string {
  const form = copyForm(drawing);
  form.bonds.forEach((bond, i) => {
    if (orderOf(bond) === bonds[i]) return;
    bond.bo = bonds[i];
    bond.stereo = 'unspecified';
    delete bond.stereoAtoms;
  });
  form.atoms.forEach((atom, i) => (atom.chg = charges[i]));
  // As RDKit leaves each structure: its Hs fixed, radicals found; no aromaticity, so the
  // Kekulé bonds stay as listed.
  const text = withForm(
    rdkit,
    form,
    { steps: ['SANITIZE_SYMMRINGS', 'SANITIZE_FINDRADICALS', 'SANITIZE_ADJUSTHS'], setAromaticBonds: false, aromatic: false, assignStereo: true, coords: true },
    (m) => m.get_molblock(),
  );
  if (text === null) throw new Error('RDKit could not write a resonance structure');
  return withChiralFlag(text, chiralFlag);
}

/** The panel's list for a drawing, or null when RDKit can't read it: RDKit's structures for
 * it in canonical atom order, by the drawing's own indices. */
export function listResonance(rdkit: MainModule, molfile: string): ResonanceList | null {
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: true }));
  if (!mol) return null;
  let drawing: Form;
  let canon: Canonical | null;
  try {
    drawing = formOf(mol);
    if (pieces(drawing) > 1) return { outcome: 'several' };
    if (!plainBonds(drawing)) return { outcome: 'bonds' };
    canon = canonical(rdkit, mol, drawing);
    canon?.mol.delete();
  } finally {
    mol.delete();
  }
  if (!canon) return null;
  const supplied = supply(canon.form);
  const outcome = resonanceOutcome(supplied.largestGroup, supplied.count);
  if (outcome === 'too-large') return { outcome, largestGroup: supplied.largestGroup };
  if (outcome === 'counted' || !supplied.structures) {
    return { outcome: 'counted', count: supplied.count, capped: supplied.count >= RESONANCE_LIMITS.maxStructs };
  }
  const drawn = readAsDrawn(rdkit, molfile, drawing);
  const flag = chiralFlagOf(molfile);
  return {
    outcome: 'listed',
    structures: supplied.structures.map((s, n) => {
      // By the drawing's own bonds and atoms.
      const bonds = canon.bonds.map((j) => s.bonds[j]);
      const charges = canon.atoms.map((k) => s.charges[k]);
      return {
        number: n + 1,
        bonds,
        charges,
        ...differences(drawn, bonds, charges),
        rank: s.rank,
        molfile: structureMolfile(rdkit, drawing, bonds, charges, flag),
      };
    }),
  };
}
