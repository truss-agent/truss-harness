export interface ConversationNavigationEffects {
  readonly save: () => void;
  readonly cancelFrame: (frame: number) => void;
  readonly requestFrame: (callback: () => void) => number;
  readonly render: () => void;
  readonly restoreFocus: () => void;
}

/**
 * Defers conversation DOM replacement until the originating click has
 * completed, then restores renderer focus after the replacement.
 */
export function scheduleConversationNavigation(
  previousFrame: number,
  effects: ConversationNavigationEffects,
): number {
  effects.save();
  effects.cancelFrame(previousFrame);
  return effects.requestFrame(() => {
    effects.render();
    effects.restoreFocus();
  });
}
