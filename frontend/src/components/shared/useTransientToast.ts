import { useCallback, useEffect, useRef, useState } from "react";

export interface TransientToast {
  visible: boolean;
  /** Show the toast; showing it again while visible restarts the timer. */
  show: () => void;
  /** Hide it now and cancel the pending timer. */
  hide: () => void;
}

/**
 * A toast that hides itself `durationMs` after the last `show()` (#2981).
 * Owns its timer: a repeat show resets it, and unmounting clears it so no
 * state update lands on an unmounted screen.
 */
export function useTransientToast(durationMs: number): TransientToast {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clear();
    setVisible(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setVisible(false);
    }, durationMs);
  }, [clear, durationMs]);

  const hide = useCallback(() => {
    clear();
    setVisible(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { visible, show, hide };
}
