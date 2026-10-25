import type { Ketcher } from 'ketcher-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { Placement } from '../editor/placeInHand';
import { GROUPS, heldTemplate, pickTemplate, putAwayTemplate, subscribeTemplates, TEMPLATES, type Placer } from './templates';

const KETCHER = {} as Ketcher; // the menu touches Ketcher only through the placer
const [FIRST, SECOND] = TEMPLATES;

/** One pick as the placer sees it: its parse is held until the test says so. */
interface Pending {
  structure: string;
  /** The parse is done: the template is in hand. */
  hold(): void;
  fail(error: Error): void;
  /** A click on the canvas places it. */
  click(): void;
  /** Esc or another tool puts it away. */
  putAway(): void;
  cancelled(): number;
}

/** Stands in for placeInHand: each call is one pending pick, in the order asked. */
function holdPlacer() {
  const picks: Pending[] = [];
  const waiting: ((pick: Pending) => void)[] = [];
  const place: Placer = (_ketcher, structure) =>
    new Promise<Placement>((resolve, reject) => {
      let settle: (placed: boolean) => void = () => {};
      const done = new Promise<boolean>((r) => (settle = r));
      let cancels = 0;
      const placement: Placement = {
        done,
        cancel: () => {
          cancels += 1;
          settle(false);
        },
      };
      const pick: Pending = {
        structure,
        hold: () => resolve(placement),
        fail: reject,
        click: () => settle(true),
        putAway: () => settle(false),
        cancelled: () => cancels,
      };
      picks.push(pick);
      waiting.shift()?.(pick);
    });
  /** The `n`th pick (from 0), once the placer has been asked for it. */
  const asked = (n: number) =>
    picks[n] ? Promise.resolve(picks[n]) : new Promise<Pending>((resolve) => waiting.push(resolve));
  return { place, asked };
}

/** Resolves once the template in hand is `template` (null: none). */
function holding(template: (typeof TEMPLATES)[number] | null): Promise<void> {
  return new Promise((resolve) => {
    if (heldTemplate() === template) return resolve();
    const stop = subscribeTemplates(() => {
      if (heldTemplate() !== template) return;
      stop();
      resolve();
    });
  });
}

afterEach(() => putAwayTemplate());

describe('the generated templates', () => {
  it('come in the groups the plan names, chair first', () => {
    expect(GROUPS).toEqual(['Chair']);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });
});

describe('picking a template', () => {
  it('puts it in hand as KET; a click places it and empties the hand', async () => {
    const { place, asked } = holdPlacer();
    const picked = pickTemplate(KETCHER, FIRST, place);
    const pick = await asked(0);
    expect(JSON.parse(pick.structure)).toEqual(FIRST.ket);
    expect(heldTemplate()).toBeNull(); // not yet: the parse is still running
    pick.hold();
    await holding(FIRST);
    pick.click();
    expect(await picked).toBe(true);
    expect(heldTemplate()).toBeNull();
  });

  it('Esc or another tool puts it away: nothing placed, the hand empty', async () => {
    const { place, asked } = holdPlacer();
    const picked = pickTemplate(KETCHER, FIRST, place);
    const pick = await asked(0);
    pick.hold();
    await holding(FIRST);
    pick.putAway();
    expect(await picked).toBe(false);
    expect(heldTemplate()).toBeNull();
  });

  it('putAwayTemplate() cancels the one in hand', async () => {
    const { place, asked } = holdPlacer();
    const picked = pickTemplate(KETCHER, FIRST, place);
    const pick = await asked(0);
    pick.hold();
    await holding(FIRST);
    putAwayTemplate();
    expect(pick.cancelled()).toBe(1);
    expect(await picked).toBe(false);
    expect(heldTemplate()).toBeNull();
  });

  it('a second pick puts the first away', async () => {
    const { place, asked } = holdPlacer();
    const first = pickTemplate(KETCHER, FIRST, place);
    const one = await asked(0);
    one.hold();
    await holding(FIRST);
    const second = pickTemplate(KETCHER, SECOND, place);
    expect(one.cancelled()).toBe(1);
    expect(await first).toBe(false);
    const two = await asked(1);
    two.hold();
    await holding(SECOND);
    two.click();
    expect(await second).toBe(true);
  });

  it('a first pick whose parse finishes after a second pick is put away, and the second stays', async () => {
    const { place, asked } = holdPlacer();
    const first = pickTemplate(KETCHER, FIRST, place);
    const one = await asked(0);
    const second = pickTemplate(KETCHER, SECOND, place);
    const two = await asked(1);
    two.hold();
    await holding(SECOND);
    one.hold(); // the late one
    expect(await first).toBe(false);
    expect(one.cancelled()).toBe(1);
    expect(heldTemplate()).toBe(SECOND);
    expect(two.cancelled()).toBe(0);
    two.click();
    expect(await second).toBe(true);
  });

  it('a template Ketcher could not take leaves the hand empty', async () => {
    const { place, asked } = holdPlacer();
    const picked = pickTemplate(KETCHER, FIRST, place);
    (await asked(0)).fail(new Error('Ketcher did not arm its paste tool'));
    expect(await picked).toBe(false);
    expect(heldTemplate()).toBeNull();
  });
});
