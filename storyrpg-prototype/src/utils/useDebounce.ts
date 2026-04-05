/**
 * Debounce utilities for React components
 */

import { useCallback, useRef } from 'react';

/**
 * Hook that returns a debounced version of a callback.
 * The callback will only be called after the specified delay has passed
 * since the last invocation.
 * 
 * @param callback - The function to debounce
 * @param delay - Delay in milliseconds (default: 300ms)
 * @returns Debounced callback
 */
export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
}

/**
 * Hook that returns a throttled version of a callback.
 * The callback will be called at most once per the specified delay.
 * First call is immediate, subsequent calls within the delay are ignored.
 * 
 * @param callback - The function to throttle
 * @param delay - Minimum delay between calls in milliseconds (default: 300ms)
 * @returns Throttled callback
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  const lastCallRef = useRef<number>(0);
  const pendingRef = useRef<boolean>(false);

  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallRef.current;

    if (timeSinceLastCall >= delay) {
      // Enough time has passed, call immediately
      lastCallRef.current = now;
      callback(...args);
    } else if (!pendingRef.current) {
      // Schedule a call after the remaining delay
      pendingRef.current = true;
      setTimeout(() => {
        lastCallRef.current = Date.now();
        pendingRef.current = false;
        callback(...args);
      }, delay - timeSinceLastCall);
    }
    // If already pending, ignore this call
  }, [callback, delay]);
}

/**
 * Hook that returns a callback that ignores rapid consecutive calls.
 * Unlike debounce, the FIRST call goes through immediately, and subsequent
 * calls within the delay are ignored (not queued).
 * 
 * Best for UI interactions like button clicks where you want immediate
 * feedback but prevent double-clicks.
 * 
 * @param callback - The function to debounce
 * @param delay - Lockout delay in milliseconds (default: 300ms)
 * @returns Debounced callback that calls immediately then ignores rapid calls
 */
export function useClickDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  const lastCallRef = useRef<number>(0);

  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCallRef.current >= delay) {
      lastCallRef.current = now;
      callback(...args);
    }
  }, [callback, delay]);
}
