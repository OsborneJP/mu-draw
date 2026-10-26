import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { FormsKind, ResonanceResult, TautomerResult } from '../chem/formPictures';
import { RESONANCE_LIMITS } from '../chem/resonance';
import { PICTURE } from '../chem/stereoPictures';
import { TAUTOMER_LIMITS } from '../chem/tautomers';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import Docked from './Docked';
import type { FormsMessage, FormsState } from './forms';
import { addForm, closeForms, getFormsState, startForms, subscribeFormsState } from './formsStore';
import './forms.css';

// The tautomers and the resonance structures (docs/plans/v2-tautomers-resonance.md), each in a
// panel below the canvas like the stereoisomers: one numbered picture per structure in the
// drawing's layout, what differs from the drawing highlighted, the drawing's own marked, and
// Add to put one in hand. data-* attributes let the tests read every card exactly.

interface Texts {
  title: string;
  /** "tautomer", "resonance structure". */
  one: string;
  messages: Record<FormsMessage, string>;
  several: string;
}

const TEXTS: Record<FormsKind, Texts> = {
  tautomers: {
    title: 'Tautomers',
    one: 'tautomer',
    messages: {
      empty: 'Draw a structure to list its tautomers.',
      reaction: 'Tautomers are listed for structures, not reactions.',
      'not-elements': 'Tautomers need every atom to be an element, so R-groups, atom lists and query atoms are left out.',
      unreadable: "RDKit can't interpret this structure, so no tautomers are listed.",
      unavailable: 'Tautomers are unavailable',
    },
    several: 'Tautomers are listed for one structure at a time. For a salt, draw the ion on its own.',
  },
  resonance: {
    title: 'Resonance structures',
    one: 'resonance structure',
    messages: {
      empty: 'Draw a structure to list its resonance structures.',
      reaction: 'Resonance structures are listed for structures, not reactions.',
      'not-elements': 'Resonance structures need every atom to be an element, so R-groups, atom lists and query atoms are left out.',
      unreadable: "RDKit can't interpret this structure, so no resonance structures are listed.",
      unavailable: 'Resonance structures are unavailable',
    },
    several: 'Resonance structures are listed for one structure at a time. For a salt, draw the ion on its own.',
  },
};

/** Decisions 4 to 6, word for word in the tests. */
const NOTES = {
  rules:
    'These are the forms RDKit’s tautomer rules reach, not how stable they are. What differs from your drawing is highlighted; a double bond whose E/Z is not known is drawn crossed.',
  stereo: 'RDKit leaves stereo undefined at every atom and double bond a hydrogen moves through, so those are not defined here.',
  order:
    'In RDKit’s order: complete octets first, then fewer charges, then negative charge on the more electronegative atom. What differs from your drawing is highlighted.',
  limits:
    'RDKit lists resonance only within conjugated groups and, with charges separated, only where no atom is left short of an octet: an isolated C=O, an enone, an ester or an acid shows no charge-separated form, and an aniline or a phenol only its Kekulé forms. Lone pairs and curved arrows are not drawn.',
  notListed: 'Your drawing is not one of the structures RDKit lists.',
} as const;

type Note = keyof typeof NOTES;

interface CardData {
  number: number;
  drawing: boolean;
  changedAtoms: number[];
  changedBonds: number[];
  svg: string;
  /** What the tests compare with the fixture. */
  data: Record<string, string>;
}

function Card({ kind, card, inHand }: { kind: FormsKind; card: CardData; inHand: boolean }) {
  const { one } = TEXTS[kind];
  const name = `${one[0].toUpperCase()}${one.slice(1)} ${card.number}`;
  return (
    <li
      className="forms-card"
      data-testid={`${kind}-card`}
      data-number={card.number}
      data-drawing={card.drawing}
      data-changed-atoms={JSON.stringify(card.changedAtoms)}
      data-changed-bonds={JSON.stringify(card.changedBonds)}
      data-in-hand={inHand}
      {...Object.fromEntries(Object.entries(card.data).map(([k, v]) => [`data-${k}`, v]))}
    >
      <div className="forms-card-head">
        <span className="forms-number">{card.number}</span>
        {card.drawing && <span className="forms-drawing">Your drawing</span>}
      </div>
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(card.svg)}`}
        width={PICTURE.width}
        height={PICTURE.height}
        alt={name}
      />
      <div className="forms-card-foot">
        <button type="button" data-testid={`${kind}-add`} aria-label={`${inHand ? 'In hand' : 'Add'}: ${one} ${card.number}`} onClick={() => addForm(kind, card.number)}>
          {inHand ? 'In hand' : 'Add'}
        </button>
      </div>
    </li>
  );
}

function Message({ kind, children }: { kind: FormsKind; children: ReactNode }) {
  return (
    <p className="forms-message" data-testid={`${kind}-message`}>
      {children}
    </p>
  );
}

function Notes({ kind, notes }: { kind: FormsKind; notes: Note[] }) {
  return (
    <>
      {notes.map((note) => (
        <p key={note} className="forms-note" data-testid={`${kind}-note`} data-note={note}>
          {NOTES[note]}
        </p>
      ))}
    </>
  );
}

interface Listed {
  cards: CardData[];
  notes: Note[];
}

function tautomerCards(result: Extract<TautomerResult, { outcome: 'listed' }>): Listed {
  return {
    cards: result.tautomers.map((t) => ({ ...t, data: { smiles: t.smiles, hydrogens: JSON.stringify(t.hydrogens) } })),
    notes: result.tautomers.length > 1 ? ['rules', ...(result.stereoDropped ? (['stereo'] as const) : [])] : [],
  };
}

function resonanceCards(result: Extract<ResonanceResult, { outcome: 'listed' }>): Listed {
  const drawn = result.structures.some((s) => s.drawing);
  return {
    cards: result.structures.map((s) => ({
      ...s,
      data: { bonds: JSON.stringify(s.bonds), charges: JSON.stringify(s.charges), rank: s.rank },
    })),
    notes: [...(result.structures.length > 1 ? (['order'] as const) : []), ...(drawn ? [] : (['notListed'] as const)), 'limits'],
  };
}

function ListedCards({ kind, listed, inHand, failedAdd }: { kind: FormsKind; listed: Listed; inHand: number | null; failedAdd: number | null }) {
  const { one } = TEXTS[kind];
  const n = listed.cards.length;
  return (
    <>
      <p className="forms-summary" data-testid={`${kind}-summary`}>
        {n === 1 ? `1 ${one}: RDKit finds no other.` : `${n} ${one}s.`}
      </p>
      {/* Stays at the top of the panel while the cards scroll beneath it. */}
      <div className="forms-status">
        {inHand !== null && (
          <p className="forms-hint" data-testid={`${kind}-hint`} role="status">
            {`${one[0].toUpperCase()}${one.slice(1)}`} {inHand} is in hand: click the canvas to place it, or press Esc.
          </p>
        )}
        {failedAdd !== null && (
          <p className="forms-hint" data-testid={`${kind}-add-failed`} role="alert">
            {`${one[0].toUpperCase()}${one.slice(1)}`} {failedAdd} could not be put in hand. Try Add again.
          </p>
        )}
      </div>
      <Notes kind={kind} notes={listed.notes} />
      <ol className="forms-cards">
        {listed.cards.map((card) => (
          <Card key={card.number} kind={kind} card={card} inHand={inHand === card.number} />
        ))}
      </ol>
    </>
  );
}

function Ready({ kind, state }: { kind: FormsKind; state: Extract<FormsState, { kind: 'ready' }> }) {
  const { result, inHand, failedAdd } = state;
  const { several } = TEXTS[kind];
  switch (result.outcome) {
    case 'several':
      return <Message kind={kind}>{several}</Message>;
    case 'too-many':
      return (
        <Message kind={kind}>
          {result.status === 'max-transforms'
            ? 'RDKit stopped after 1000 steps: too many tautomers to list here.'
            : `More than ${TAUTOMER_LIMITS.drawn} tautomers: too many to list here.`}
        </Message>
      );
    case 'too-large':
      return (
        <Message kind={kind}>
          A conjugated system of {result.largestGroup} bonds: too large for RDKit to list its resonance structures here (at most{' '}
          {RESONANCE_LIMITS.groupBonds}).
        </Message>
      );
    case 'counted':
      return (
        <Message kind={kind}>
          {result.capped
            ? `RDKit stops counting at ${result.count} resonance structures: too many to draw here.`
            : `${result.count} resonance structures: too many to draw here.`}
        </Message>
      );
    case 'listed':
      return (
        <ListedCards
          kind={kind}
          listed={'tautomers' in result ? tautomerCards(result) : resonanceCards(result)}
          inHand={inHand}
          failedAdd={failedAdd}
        />
      );
  }
}

function Body({ kind, state }: { kind: FormsKind; state: FormsState }) {
  switch (state.kind) {
    case 'working':
      return <p className="forms-message">Working…</p>;
    case 'message':
      return (
        <Message kind={kind}>
          {TEXTS[kind].messages[state.message]}
          {state.detail ? `: ${state.detail}.` : ''}
        </Message>
      );
    case 'ready':
      return <Ready kind={kind} state={state} />;
    default:
      return null;
  }
}

export default function FormsPanel({ kind }: { kind: FormsKind }) {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const state = useSyncExternalStore(
    (listener) => subscribeFormsState(kind, listener),
    () => getFormsState(kind),
  );
  useEffect(() => (ketcher ? startForms(kind, ketcher) : undefined), [kind, ketcher]);
  if (state.kind === 'idle' || !ketcher) return null;
  return (
    <Docked ketcher={ketcher} className="forms-panel" label={TEXTS[kind].title} testId={`${kind}-panel`} state={state.kind}>
      <div className="forms-head">
        <h2>{TEXTS[kind].title}</h2>
        <button type="button" className="forms-close" data-testid={`${kind}-close`} aria-label="Close" onClick={() => closeForms(kind)}>
          ×
        </button>
      </div>
      <Body kind={kind} state={state} />
    </Docked>
  );
}
