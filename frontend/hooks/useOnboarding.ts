import { useState, useCallback } from 'react';

const STORAGE_PREFIX = 'unicornx:onboarding:';

export type GuideId = 'marketplace' | 'portfolio' | 'leagues' | 'feed' | 'token-leagues';

export interface GuideStep {
    title: string;
    description: string;
    icon?: string; // emoji or icon name
}

/**
 * Hook to manage onboarding guide state.
 * Persists completion in localStorage so guides only show once per device.
 */
export function useOnboarding(guideId: GuideId) {
    const storageKey = STORAGE_PREFIX + guideId;

    const [currentStep, setCurrentStep] = useState(0);
    const [dismissed, setDismissed] = useState(() => {
        try {
            return localStorage.getItem(storageKey) === 'done';
        } catch {
            return false;
        }
    });

    const isVisible = !dismissed;

    const nextStep = useCallback((totalSteps: number) => {
        if (currentStep + 1 >= totalSteps) {
            // Last step — mark as done
            setDismissed(true);
            try {
                localStorage.setItem(storageKey, 'done');
            } catch { /* ignore */ }
        } else {
            setCurrentStep(prev => prev + 1);
        }
    }, [currentStep, storageKey]);

    const dismiss = useCallback(() => {
        setDismissed(true);
        try {
            localStorage.setItem(storageKey, 'done');
        } catch { /* ignore */ }
    }, [storageKey]);

    const reset = useCallback(() => {
        setDismissed(false);
        setCurrentStep(0);
        try {
            localStorage.removeItem(storageKey);
        } catch { /* ignore */ }
    }, [storageKey]);

    return { isVisible, currentStep, nextStep, dismiss, reset };
}

/** Reset all onboarding guides (useful for testing) */
export function resetAllOnboarding() {
    const guides: GuideId[] = ['marketplace', 'portfolio', 'leagues', 'feed', 'token-leagues'];
    guides.forEach(id => {
        try { localStorage.removeItem(STORAGE_PREFIX + id); } catch { /* ignore */ }
    });
}
