import { createContext, useContext, useLayoutEffect, type RefObject } from "react";

export type FeedSpotlightTone = "feed" | "post";

type FeedSpotlightContextValue = {
  registerTarget: (id: string, element: HTMLElement, tone: FeedSpotlightTone) => void;
  releaseTarget: (id: string, element: HTMLElement) => void;
};

export const FeedSpotlightContext = createContext<FeedSpotlightContextValue | null>(null);

export function useFeedSpotlightTarget(
  id: string,
  targetRef: RefObject<HTMLElement | null>,
  active: boolean,
  tone: FeedSpotlightTone = "post",
) {
  const spotlight = useContext(FeedSpotlightContext);

  useLayoutEffect(() => {
    const element = targetRef.current;
    if (!active || element === null || spotlight === null) {
      return;
    }

    spotlight.registerTarget(id, element, tone);
    return () => spotlight.releaseTarget(id, element);
  }, [active, id, spotlight, targetRef, tone]);
}
