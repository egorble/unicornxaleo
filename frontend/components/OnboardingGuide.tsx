import React from 'react';
import { X } from 'lucide-react';

export interface OnboardingStep {
    title: string;
    description: string;
    icon?: string;
}

interface OnboardingGuideProps {
    steps: OnboardingStep[];
    currentStep: number;
    onNext: () => void;
    onDismiss: () => void;
}

const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ steps, currentStep, onNext, onDismiss }) => {
    const step = steps[currentStep];
    if (!step) return null;

    const isLastStep = currentStep === steps.length - 1;
    const totalSteps = steps.length;

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center" onClick={onDismiss}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

            {/* Bottom sheet */}
            <div
                className="relative w-full sm:max-w-md mx-auto bg-white dark:bg-[#1A1A1A] rounded-t-2xl sm:rounded-2xl overflow-hidden animate-[slideUp_0.3s_ease-out] z-10"
                onClick={e => e.stopPropagation()}
            >
                {/* Drag handle (mobile) */}
                <div className="flex justify-center pt-3 pb-1 sm:hidden">
                    <div className="w-10 h-1 bg-gray-300 dark:bg-gray-700 rounded-full" />
                </div>

                {/* Skip button */}
                <button
                    onClick={onDismiss}
                    className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-white/10 text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors z-20"
                >
                    <X className="w-4 h-4" />
                </button>

                {/* Content */}
                <div className="px-6 pt-6 pb-4 text-center">
                    {/* Icon */}
                    {step.icon && (
                        <div className="text-5xl mb-4 animate-[fadeIn_0.3s_ease-out]">{step.icon}</div>
                    )}

                    {/* Title */}
                    <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">
                        {step.title}
                    </h3>

                    {/* Description */}
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-sm mx-auto">
                        {step.description}
                    </p>
                </div>

                {/* Step indicator + Button */}
                <div className="px-6 pb-6 pt-2">
                    {/* Step dots */}
                    {totalSteps > 1 && (
                        <div className="flex items-center justify-center gap-1.5 mb-4">
                            {steps.map((_, i) => (
                                <div
                                    key={i}
                                    className={`h-1.5 rounded-full transition-all duration-300 ${
                                        i === currentStep
                                            ? 'w-6 bg-yc-aleo'
                                            : i < currentStep
                                                ? 'w-1.5 bg-yc-aleo/40'
                                                : 'w-1.5 bg-gray-300 dark:bg-gray-700'
                                    }`}
                                />
                            ))}
                        </div>
                    )}

                    {/* Continue button */}
                    <button
                        onClick={onNext}
                        className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-white/15"
                    >
                        {isLastStep ? 'Got it' : 'Continue'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OnboardingGuide;
