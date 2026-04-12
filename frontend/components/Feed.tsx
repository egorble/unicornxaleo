import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Newspaper, ExternalLink, RefreshCw, ChevronDown, Loader2, TrendingUp } from 'lucide-react';
import { useOnboarding } from '../hooks/useOnboarding';
import OnboardingGuide, { OnboardingStep } from './OnboardingGuide';


const FEED_GUIDE: OnboardingStep[] = [
    {
        title: 'Live News Feed',
        description: 'Track real-time startup activity that drives your card scores. Funding announcements, partnerships, and social media buzz all contribute to daily points.',
        icon: '\uD83D\uDCF0',
    },
    {
        title: 'How Scoring Works',
        description: 'Our AI scans Twitter every night for startup activity. Events like funding rounds, product launches, and viral tweets earn base points. Your card multiplier amplifies those points.',
        icon: '\uD83E\uDD16',
    },
];

interface FeedEvent {
    id: number;
    startup: string;
    eventType: string;
    description: string;
    points: number;
    tweetId: string | null;
    date: string;
    createdAt: string;
    summary: string | null;
}

interface Pagination {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

// Map Twitter handles for building tweet URLs
const STARTUP_HANDLES: Record<string, string> = {
    'Openclaw': 'openclaw',
    'Lovable': 'lovable_dev',
    'Cursor': 'cursor_ai',
    'OpenAI': 'OpenAI',
    'Anthropic': 'AnthropicAI',
    'Browser Use': 'browser_use',
    'Dedalus Labs': 'dedaluslabs',
    'Autumn': 'autumnpricing',
    'Axiom': 'axiom_xyz',
    'Multifactor': 'MultifactorCOM',
    'Dome': 'getdomeapi',
    'GrazeMate': 'GrazeMate',
    'Tornyol Systems': 'tornyolsystems',
    'Pocket': 'heypocket',
    'Caretta': 'Caretta',
    'AxionOrbital Space': 'axionorbital',
    'Freeport Markets': 'freeportmrkts',
    'Ruvo': 'ruvopay',
    'Lightberry': 'lightberryai',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
    'FUNDING': 'Fundraising',
    'PARTNERSHIP': 'Partnership',
    'KEY_HIRE': 'Team',
    'REVENUE': 'Revenue',
    'PRODUCT_LAUNCH': 'Product',
    'ACQUISITION': 'M&A',
    'MEDIA_MENTION': 'Media',
    'GROWTH': 'Growth',
    'ENGAGEMENT': 'Trending',
};

function getTweetUrl(event: FeedEvent): string | null {
    if (!event.tweetId) return null;
    const handle = STARTUP_HANDLES[event.startup];
    if (handle) {
        return `https://x.com/${handle}/status/${event.tweetId}`;
    }
    return `https://x.com/i/status/${event.tweetId}`;
}

function makeHeadline(event: FeedEvent): string {
    if (event.summary && event.summary.length > 10) return event.summary;
    // Fallback: create a clean headline from first sentence of description
    const typeLabel = EVENT_TYPE_LABELS[event.eventType] || 'Update';
    const desc = (event.description || '').trim();
    // Try to extract first sentence
    const sentenceEnd = desc.search(/[.!?\n]/);
    const firstSentence = sentenceEnd > 10 ? desc.substring(0, sentenceEnd).trim() : '';
    if (firstSentence.length > 15 && firstSentence.length <= 120) {
        return firstSentence;
    }
    // If too long or no clean sentence, create a structured headline
    if (desc.length > 15) {
        // Take first ~90 chars and cut at last word boundary
        const cut = desc.substring(0, 90);
        const lastSpace = cut.lastIndexOf(' ');
        return (lastSpace > 30 ? cut.substring(0, lastSpace) : cut) + '...';
    }
    return `${event.startup}: ${typeLabel}`;
}

function timeAgo(dateStr: string): string {
    // For date-only strings (YYYY-MM-DD), compare by calendar date
    if (dateStr && dateStr.length === 10 && dateStr[4] === '-') {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (dateStr === todayStr) return 'Today';

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        if (dateStr === yesterdayStr) return 'Yesterday';

        const date = new Date(dateStr + 'T12:00:00');
        const diffDays = Math.round((now.getTime() - date.getTime()) / 86400000);
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    // For full timestamps
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

const Feed: React.FC = () => {
    const [events, setEvents] = useState<FeedEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [pagination, setPagination] = useState<Pagination | null>(null);
    const [filterStartup, setFilterStartup] = useState<string | null>(null);
    const hasFetched = useRef(false);
    const { isVisible: showGuide, currentStep: guideStep, nextStep: guideNext, dismiss: guideDismiss } = useOnboarding('feed');

    const fetchFeed = useCallback(async (offset = 0, append = false) => {
        if (offset === 0 && !hasFetched.current) setLoading(true);
        else if (offset > 0) setLoadingMore(true);

        try {
            const res = await fetch(`/api/feed?limit=20&offset=${offset}`);
            const data = await res.json();
            if (data.success) {
                if (append) {
                    setEvents(prev => [...prev, ...data.data]);
                } else {
                    setEvents(data.data);
                }
                setPagination(data.pagination);
            }
        } catch (err) {
        } finally {
            hasFetched.current = true;
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    useEffect(() => {
        fetchFeed();
        const interval = setInterval(() => fetchFeed(), 60000);
        return () => clearInterval(interval);
    }, [fetchFeed]);

    const loadMore = () => {
        if (pagination?.hasMore) {
            fetchFeed(pagination.offset + pagination.limit, true);
        }
    };

    const startupNames = Array.from(new Set(events.map(e => e.startup))).sort();
    const filteredEvents = filterStartup
        ? events.filter(e => e.startup === filterStartup)
        : events;

    return (
        <div className="overflow-x-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-yc-aleo/10 rounded-xl">
                        <Newspaper className="w-6 h-6 text-yc-aleo" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-yc-text-primary dark:text-white tracking-tight">News Feed</h2>
                        <p className="text-sm text-gray-500">
                            {pagination ? `${pagination.total} stories` : 'Loading...'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => fetchFeed()}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:text-yc-aleo transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Filter Chips */}
            {startupNames.length > 0 && (
                <div className="mb-6 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                        <button
                            onClick={() => setFilterStartup(null)}
                            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 ${
                                filterStartup === null
                                    ? 'bg-yc-aleo text-white shadow-lg shadow-yc-aleo/30'
                                    : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
                            }`}
                        >
                            All
                        </button>
                        {startupNames.map(name => (
                            <button
                                key={name}
                                onClick={() => setFilterStartup(filterStartup === name ? null : name)}
                                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 ${
                                    filterStartup === name
                                        ? 'bg-yc-aleo text-white shadow-lg shadow-yc-aleo/30'
                                        : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
                                }`}
                            >
                                {name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-yc-aleo" />
                    <span className="ml-3 text-lg font-bold text-gray-400">Loading feed...</span>
                </div>
            )}

            {/* Empty */}
            {!loading && filteredEvents.length === 0 && (
                <div className="text-center py-20">
                    <Newspaper className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-gray-400 mb-2">No Stories Yet</h3>
                    <p className="text-gray-500">News will appear here once scoring runs.</p>
                </div>
            )}

            {/* News Cards */}
            {!loading && filteredEvents.length > 0 && (
                <div className="space-y-2 rounded-xl overflow-hidden">
                    {filteredEvents.map(event => {
                        const tweetUrl = getTweetUrl(event);
                        const typeLabel = EVENT_TYPE_LABELS[event.eventType] || event.eventType;
                        const headline = makeHeadline(event);
                        const snippet = event.description?.substring(0, 120);

                        return (
                            <article
                                key={event.id}
                                className="glass-panel glass-panel-hover p-4 sm:p-5 transition-colors"
                            >
                                {/* Source line */}
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <span className="text-xs font-extrabold uppercase tracking-wider text-yc-aleo">{event.startup}</span>
                                    <span className="text-gray-300 dark:text-[#333]">|</span>
                                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{typeLabel}</span>
                                    <span className="text-gray-300 dark:text-[#333]">|</span>
                                    <span className="text-xs text-gray-400">{timeAgo(event.date)}</span>
                                    <span className="ml-auto flex items-center gap-1 text-xs font-bold text-emerald-500">
                                        <TrendingUp className="w-3 h-3" />
                                        +{Math.round(event.points)}
                                    </span>
                                </div>

                                {/* Headline */}
                                <h3 className="text-[15px] sm:text-base font-bold text-gray-900 dark:text-white leading-snug">
                                    {headline}
                                </h3>

                                {/* Snippet + Source */}
                                <div className="flex items-end justify-between mt-1.5 gap-4">
                                    {snippet && headline !== snippet && (
                                        <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed line-clamp-2 flex-1">
                                            {snippet}{snippet.length >= 120 ? '...' : ''}
                                        </p>
                                    )}
                                    {tweetUrl && (
                                        <a
                                            href={tweetUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-yc-aleo transition-colors shrink-0"
                                        >
                                            Source <ExternalLink className="w-3 h-3" />
                                        </a>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {/* Load More */}
            {pagination?.hasMore && (
                <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="w-full mt-4 py-3 rounded-xl bg-gray-100 dark:bg-[#1A1A1A] text-gray-600 dark:text-gray-400 font-bold text-sm hover:bg-gray-200 dark:hover:bg-[#222] transition-all flex items-center justify-center gap-2"
                >
                    {loadingMore ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading...
                        </>
                    ) : (
                        <>
                            <ChevronDown className="w-4 h-4" />
                            Load More ({pagination.total - pagination.offset - pagination.limit} remaining)
                        </>
                    )}
                </button>
            )}

            {/* Onboarding Guide */}
            {showGuide && (
                <OnboardingGuide
                    steps={FEED_GUIDE}
                    currentStep={guideStep}
                    onNext={() => guideNext(FEED_GUIDE.length)}
                    onDismiss={guideDismiss}
                />
            )}
        </div>
    );
};

export default Feed;
