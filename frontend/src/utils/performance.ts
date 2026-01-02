// Performance utilities for optimizing rendering

/**
 * Throttle function to limit how often a function can fire
 */
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: number | null = null;
    let previous = 0;

    return function (this: any, ...args: Parameters<T>) {
        const now = Date.now();
        const remaining = wait - (now - previous);

        if (remaining <= 0 || remaining > wait) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            previous = now;
            func.apply(this, args);
        } else if (!timeout) {
            timeout = window.setTimeout(() => {
                previous = Date.now();
                timeout = null;
                func.apply(this, args);
            }, remaining);
        }
    };
}

/**
 * Debounce function to delay execution until after wait time has elapsed
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: number | null = null;

    return function (this: any, ...args: Parameters<T>) {
        if (timeout) clearTimeout(timeout);
        timeout = window.setTimeout(() => {
            func.apply(this, args);
        }, wait);
    };
}

/**
 * Request animation frame throttle for scroll handlers
 */
export function rafThrottle<T extends (...args: any[]) => any>(
    callback: T
): (...args: Parameters<T>) => void {
    let requestId: number | null = null;

    return function (this: any, ...args: Parameters<T>) {
        if (requestId) return;

        requestId = window.requestAnimationFrame(() => {
            callback.apply(this, args);
            requestId = null;
        });
    };
}

/**
 * Check if element is in viewport (for lazy loading)
 */
export function isInViewport(element: HTMLElement, offset = 0): boolean {
    const rect = element.getBoundingClientRect();
    return (
        rect.top >= -offset &&
        rect.left >= -offset &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + offset &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth) + offset
    );
}

/**
 * Intersection Observer for lazy loading components
 */
export function createLazyObserver(
    callback: (entry: IntersectionObserverEntry) => void,
    options?: IntersectionObserverInit
): IntersectionObserver {
    return new IntersectionObserver((entries) => {
        entries.forEach(callback);
    }, {
        rootMargin: '50px',
        threshold: 0.01,
        ...options,
    });
}

