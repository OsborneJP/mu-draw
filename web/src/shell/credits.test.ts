import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FREETYPE_CREDIT, INCHI_CREDIT } from './credits';

interface Component {
  name: string;
  licence: string;
  copyright?: string[];
  statement?: string;
}
const RECORDS = new URL('../../../third_party/notices/records/', import.meta.url);
const components: Component[] = readdirSync(RECORDS)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(new URL(f, RECORDS), 'utf8')) as { components: Component[] }).components);

describe("About's credits match the reviewed records (bar B.7)", () => {
  it("name InChI's copyright holder as the InChI under Licence No. 1.0 (Indigo's) gives it", () => {
    // That licence asks for InChI's copyright line wherever the app shows copyright notices.
    const licensed = components.filter((c) => /^InChI\b/.test(c.name) && c.licence.includes('InChI Licence No. 1.0'));
    expect(licensed).toHaveLength(1);
    expect(licensed[0].copyright).toContain('Copyright (C) IUPAC and InChI Trust');
    expect(INCHI_CREDIT).toContain(
      'Copyright (C) IUPAC and InChI Trust, under the IUPAC/InChI-Trust InChI Licence No. 1.0',
    );
    // RDKit's InChI is the MIT one, as the credit says.
    expect(components.filter((c) => /^InChI\b/.test(c.name) && c.licence === 'MIT')).toHaveLength(1);
    expect(INCHI_CREDIT).toContain('the MIT licence (in RDKit)');
  });

  it("give the FreeType credit with each shipped FreeType's year", () => {
    const years = components
      .flatMap(
        (c) => /^Portions of this software are copyright © (\d{4}) The FreeType Project/.exec(c.statement ?? '') ?? [],
      )
      .filter((m) => /^\d{4}$/.test(m))
      .sort();
    expect(years.length).toBeGreaterThan(0);
    expect(FREETYPE_CREDIT).toBe(
      `Portions of this software are copyright © ${[...new Set(years)].join(', ')} The FreeType Project (www.freetype.org). All rights reserved.`,
    );
  });
});
