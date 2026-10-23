import { expect, it, vi } from 'vitest';
import { blockDebugHotkeys, isDebugSerializeShortcut } from './debugHotkeys';

const key = (code: string, mods: Partial<Record<'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey', boolean>>) => ({
  code,
  altKey: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

it('matches only Alt+Shift+R', () => {
  expect(isDebugSerializeShortcut(key('KeyR', { altKey: true, shiftKey: true }))).toBe(true);
  expect(isDebugSerializeShortcut(key('KeyR', { altKey: true }))).toBe(false);
  expect(isDebugSerializeShortcut(key('KeyR', { ctrlKey: true, shiftKey: true }))).toBe(false);
  expect(isDebugSerializeShortcut(key('KeyT', { altKey: true, shiftKey: true }))).toBe(false);
});

it('stops the shortcut in the capture phase', () => {
  const addEventListener = vi.fn();
  blockDebugHotkeys({ addEventListener });
  const [type, listener, options] = addEventListener.mock.calls[0];
  expect([type, options]).toEqual(['keydown', { capture: true }]);
  const event = { ...key('KeyR', { altKey: true, shiftKey: true }), preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
  listener(event);
  expect(event.stopImmediatePropagation).toHaveBeenCalled();
  expect(event.preventDefault).toHaveBeenCalled();
});
