import { createContext, useContext, useEffect, type RefObject } from "react";

type FeedSpotlightContextValue = {
  registerTarget: (id: string, element: HTMLElement) => void;
  releaseTarget: (id: string, element: HTMLElement) => void;
};

export const FeedSpotlightContext = createContext<FeedSpotlightContextValue | null>(null);

export function useFeedSpotlightTarget(id: string, targetRef: RefObject<HTMLElement | null>, active: boolean) {
  const spotlight = useContext(FeedSpotlightContext);

  useEffect(() => {
    const element = targetRef.current;
    if (!active || element === null || spotlight === null) {
      return;
    }

    spotlight.registerTarget(id, element);
    return () => spotlight.releaseTarget(id, element);
  }, [active, id, spotlight, targetRef]);
}
