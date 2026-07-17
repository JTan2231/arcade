import { createContext, useContext, useLayoutEffect, type RefObject } from "react";

export type FeedSpotlightTone = "feed" | "post";

type FeedSpotlightContextValue = {
  registerTarget: (id: string, element: HTMLElement, tone: FeedSpotlightTone, strength: number) => void;
  releaseTarget: (id: string, element: HTMLElement) => void;
};

export const FeedSpotlightContext = createContext<FeedSpotlightContextValue | null>(null);

export function useFeedSpotlightTarget(
  id: string,
  targetRef: RefObject<HTMLElement | null>,
  active: boolean,
  tone: FeedSpotlightTone = "post",
  strength = 1,
) {
  const spotlight = useContext(FeedSpotlightContext);
  const normalizedStrength = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 1;

  useLayoutEffect(() => {
    const element = targetRef.current;
    if (!active || element === null || spotlight === null) {
      return;
    }

    spotlight.registerTarget(id, element, tone, normalizedStrength);
    return () => spotlight.releaseTarget(id, element);
  }, [active, id, normalizedStrength, spotlight, targetRef, tone]);
}
