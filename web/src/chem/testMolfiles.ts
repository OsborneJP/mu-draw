// Edits to the test drawings' Molfiles (version 2 only: these read its fixed columns), for the
// tautomer and resonance tests: the same structure with one bond retyped, or numbered in reverse.

/** A version 2 Molfile with its first double bond retyped (Molfile bond types: 4 aromatic, 5 to 8
 * query bonds, 10 a hydrogen bond), as Ketcher writes them. */
export function withDoubleBondTyped(molfile: string, type: number): string {
  const lines = molfile.split('\n');
  const first = 4 + Number(lines[3].slice(0, 3));
  const bonds = Number(lines[3].slice(3, 6));
  const at = lines.slice(first, first + bonds).findIndex((line) => line.slice(6, 9).trim() === '2');
  if (at < 0) throw new Error('no double bond to retype');
  lines[first + at] = `${lines[first + at].slice(0, 6)}${String(type).padStart(3)}${lines[first + at].slice(9)}`;
  return lines.join('\n');
}

/** A version 2 Molfile with its atoms listed in reverse: the same structure, drawn in another
 * order. Bonds and charge, radical and isotope lines follow their atoms. */
export function reversed(molfile: string): string {
  const lines = molfile.split('\n');
  const atoms = Number(lines[3].slice(0, 3));
  const bonds = Number(lines[3].slice(3, 6));
  const renumber = (n: number) => atoms + 1 - n;
  const atomLines = lines.slice(4, 4 + atoms).reverse();
  const bondLines = lines.slice(4 + atoms, 4 + atoms + bonds).map((line) => {
    const [a, b] = [Number(line.slice(0, 3)), Number(line.slice(3, 6))];
    return `${String(renumber(a)).padStart(3)}${String(renumber(b)).padStart(3)}${line.slice(6)}`;
  });
  const rest = lines.slice(4 + atoms + bonds).map((line) => {
    const kind = /^M {2}(CHG|RAD|ISO)/.exec(line)?.[1];
    if (!kind) return line;
    const fields = line.slice(6).trim().split(/\s+/).map(Number);
    const pairs = fields.slice(1).flatMap((v, i) => (i % 2 === 0 ? [renumber(v)] : [v]));
    return `M  ${kind}${String(fields[0]).padStart(3)}${pairs.map((v) => String(v).padStart(4)).join('')}`;
  });
  return [...lines.slice(0, 4), ...atomLines, ...bondLines, ...rest].join('\n');
}
