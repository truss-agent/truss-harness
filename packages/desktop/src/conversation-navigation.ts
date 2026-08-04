export interface ConversationNavigationEffects {
  readonly save: () => void;
  readonly cancelFrame: (frame: number) => void;
  readonly requestFrame: (callback: () => void) => number;
  readonly releaseFocus: () => void;
  readonly render: () => void;
  readonly restoreFocus: () => void;
}

/**
 * Releases the clicked button before it can be removed, defers conversation
 * DOM replacement until the click has completed, then restores input focus.
 */
export function scheduleConversationNavigation(
  previousFrame: number,
  effects: ConversationNavigationEffects,
): number {
  effects.save();
  effects.cancelFrame(previousFrame);
  effects.releaseFocus();
  return effects.requestFrame(() => {
    effects.render();
    effects.restoreFocus();
  });
}
